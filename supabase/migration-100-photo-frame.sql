-- Photo frame ("Modo porta-retrato", Utilities): the household's shared FAMILY
-- album. Each member adds photos; every frame in the household shows them.
--
--  • Bytes live in the private `documents` bucket at
--    <household_id>/frame/<uuid>.jpg (the bucket policy already enforces the
--    household prefix). The app resizes before upload (long side ~1600 px,
--    JPEG 0.8 ≈ 300–400 KB) and every device downloads each photo ONCE into a
--    local cache, so a frame left on all day costs no egress.
--  • This table is the album: one row per photo, who added it, and an optional
--    member tag (the frame prefers a member's photos on their birthday).
--  • Limits, in the shape of migrations 047/072: a BEFORE INSERT trigger on
--    household_is_plus — free 30 photos per household, Plus 500. A lapsed plan
--    never deletes anything; it only blocks NEW photos past the free cap.
--    Errors: free_plan_frame_limit (→ app opens the paywall) and
--    frame_photo_limit (Plus cap reached).
--  • Device photos (the other source) never touch the server — nothing here.

create table if not exists public.frame_photos (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null default public.current_household()
               references public.households(id) on delete cascade,
  path         text not null unique,
  -- Same nullable / ON DELETE SET NULL shape migration 086 gave every other
  -- added_by, so delete_my_account() works for a member who added photos.
  added_by     text default public.jwt_email()
               references public.allowed_users(email) on delete set null,
  -- Optional "this photo is of / for <member>" tag.
  member_email text references public.allowed_users(email) on delete set null,
  width        int check (width is null or width > 0),
  height       int check (height is null or height > 0),
  created_at   timestamptz not null default now(),
  -- The row must point inside its own household's frame folder.
  constraint frame_photos_path_prefix
    check (position((household_id::text || '/frame/') in path) = 1)
);

create index if not exists frame_photos_household_idx
  on public.frame_photos (household_id, created_at desc);

alter table public.frame_photos enable row level security;

-- Is the signed-in user an OWNER of this household? Definer so the policy
-- doesn't depend on allowed_users' own RLS.
create or replace function public.is_household_owner(p_household uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.allowed_users
     where email = public.jwt_email() and household_id = p_household and role = 'owner'
  );
$$;
grant execute on function public.is_household_owner(uuid) to authenticated;

drop policy if exists frame_photos_select on public.frame_photos;
create policy frame_photos_select on public.frame_photos
  for select using (household_id = public.current_household());

-- Insert only as yourself, into your own household.
drop policy if exists frame_photos_insert on public.frame_photos;
create policy frame_photos_insert on public.frame_photos
  for insert with check (
    household_id = public.current_household()
    and added_by = public.jwt_email()
  );

-- Change the tag: your own photo, or any photo if you're the owner.
drop policy if exists frame_photos_update on public.frame_photos;
create policy frame_photos_update on public.frame_photos
  for update using (
    household_id = public.current_household()
    and (added_by = public.jwt_email() or public.is_household_owner(household_id))
  )
  with check (household_id = public.current_household());

-- Delete: your own photo; owners can delete any.
drop policy if exists frame_photos_delete on public.frame_photos;
create policy frame_photos_delete on public.frame_photos
  for delete using (
    household_id = public.current_household()
    and (added_by = public.jwt_email() or public.is_household_owner(household_id))
  );

-- Only the tag may change after insert: path/household/added_by are identity.
-- added_by may go to NULL — that's the ON DELETE SET NULL when the adder
-- deletes their account (delete_my_account), which must not be refused.
create or replace function public.frame_photos_freeze()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.path is distinct from old.path
     or new.household_id is distinct from old.household_id
     or (new.added_by is distinct from old.added_by and new.added_by is not null)
     or new.created_at is distinct from old.created_at then
    raise exception 'frame_photo_immutable' using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists trg_frame_photos_freeze on public.frame_photos;
create trigger trg_frame_photos_freeze
  before update on public.frame_photos
  for each row execute function public.frame_photos_freeze();

-- ── Limits ───────────────────────────────────────────────────────────────────
create or replace function public.frame_photo_cap(p_household uuid) returns int
  language sql stable security definer set search_path = public as $$
  select case when public.household_is_plus(p_household) then 500 else 30 end
$$;

-- Client-callable: { used, cap, plus } for the signed-in household, so the
-- management screen's "12 of 30" can never disagree with the trigger.
create or replace function public.frame_photo_quota()
returns json language sql stable security definer set search_path = public as $$
  select json_build_object(
    'used', (select count(*) from public.frame_photos where household_id = public.current_household()),
    'cap',  public.frame_photo_cap(public.current_household()),
    'plus', public.household_is_plus(public.current_household())
  )
$$;
grant execute on function public.frame_photo_quota() to authenticated;

create or replace function public.enforce_frame_photo_limit()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_used int;
begin
  -- Serialise inserts per household so two members uploading at once can't
  -- both squeeze past the last free slot (count-then-insert race).
  perform pg_advisory_xact_lock(hashtext('frame_photos:' || new.household_id::text));
  select count(*) into v_used from public.frame_photos where household_id = new.household_id;
  if v_used >= public.frame_photo_cap(new.household_id) then
    if public.household_is_plus(new.household_id) then
      raise exception 'frame_photo_limit'
        using errcode = 'check_violation',
              hint = 'The family album is full (500 photos).';
    end if;
    raise exception 'free_plan_frame_limit'
      using errcode = 'check_violation',
            hint = 'One Roof Plus is required for more than 30 photos in the family album.';
  end if;
  return new;
end $$;

drop trigger if exists trg_frame_photo_limit on public.frame_photos;
create trigger trg_frame_photo_limit
  before insert on public.frame_photos
  for each row execute function public.enforce_frame_photo_limit();

-- Every frame in the house refreshes its list live (it still downloads each
-- photo only once).
alter publication supabase_realtime add table public.frame_photos;
