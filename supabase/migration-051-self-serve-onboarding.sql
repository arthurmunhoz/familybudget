-- Migration 051: self-serve household onboarding (create or join).
--
-- Open signup: a first-login user with no allowed_users row can now either
-- CREATE a household (becoming its owner) or JOIN one with a rotatable code —
-- instead of an admin having to provision every household by hand.
--
-- Security model notes:
--  * `is_admin` on allowed_users is a GLOBAL super-admin (the admin RLS policies
--    are NOT household-scoped). Household "ownership" is therefore a NEW,
--    household-scoped role (`allowed_users.role`), deliberately separate from
--    `is_admin`. Household creators get role='owner', is_admin=false.
--  * The admin-only RLS on households/allowed_users is left intact. All
--    self-serve writes go through SECURITY DEFINER RPCs guarded on the caller's
--    JWT email + a "not already in a household" check (matches the existing
--    definer-function pattern, e.g. current_household()).
--  * The join code lives in its own table with RLS and NO policies, so no client
--    can read it directly (owners fetch it via get_join_code()). It is kept off
--    the households row because several deployed clients do
--    `households.select('*')` — a column-level revoke would break them.

-- 1. Household-scoped owner role ---------------------------------------------
alter table public.allowed_users
  add column if not exists role text not null default 'member'
  check (role in ('owner', 'member'));

-- 2. Join-code storage (hidden from clients) --------------------------------
create table if not exists public.household_join_codes (
  household_id uuid primary key references public.households(id) on delete cascade,
  code text not null unique,
  updated_at timestamptz not null default now()
);
-- RLS on, NO policies: only the SECURITY DEFINER functions below (which run as
-- the function owner and bypass RLS) ever touch this table.
alter table public.household_join_codes enable row level security;

-- 3. Unambiguous join-code generator (no 0/O/1/I/L, no word-forming risk) ----
create or replace function public.gen_join_code()
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  alphabet constant text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ'; -- 31 chars, 8 => ~8.5e11
  v_code text;
  i int;
begin
  loop
    v_code := '';
    for i in 1..8 loop
      v_code := v_code || substr(alphabet, floor(random() * length(alphabet))::int + 1, 1);
    end loop;
    exit when not exists (select 1 from public.household_join_codes c where c.code = v_code);
  end loop;
  return v_code;
end;
$$;
revoke execute on function public.gen_join_code() from public;

-- 4. Every household gets a code on creation (any path: admin panel or RPC) ---
create or replace function public.households_after_insert_code()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  insert into public.household_join_codes (household_id, code)
    values (new.id, public.gen_join_code())
    on conflict (household_id) do nothing;
  return new;
end;
$$;

drop trigger if exists households_gen_join_code on public.households;
create trigger households_gen_join_code
  after insert on public.households
  for each row execute function public.households_after_insert_code();

-- 5. Rate-limit table for join attempts (definer-only) -----------------------
create table if not exists public.join_attempts (
  email text not null,
  attempted_at timestamptz not null default now()
);
create index if not exists join_attempts_email_time
  on public.join_attempts (email, attempted_at);
alter table public.join_attempts enable row level security; -- no policies: definer-only

-- 6. Small JWT helpers (email + a best-effort display name) -------------------
create or replace function public.jwt_email()
returns text
language sql
stable
set search_path to 'public'
as $$ select auth.jwt() ->> 'email' $$;

create or replace function public.jwt_display_name()
returns text
language sql
stable
set search_path to 'public'
as $$
  select coalesce(
    nullif(auth.jwt() ->> 'name', ''),
    nullif(auth.jwt() ->> 'full_name', ''),
    split_part(coalesce(auth.jwt() ->> 'email', ''), '@', 1)
  )
$$;

-- 7. create_household: caller becomes owner of a brand-new household ----------
create or replace function public.create_household(p_name text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_email text := public.jwt_email();
  v_name  text := nullif(btrim(p_name), '');
  v_hh    uuid;
begin
  if v_email is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if v_name is null then
    raise exception 'household name required' using errcode = '22023';
  end if;
  if exists (select 1 from public.allowed_users where email = v_email) then
    raise exception 'already in a household' using errcode = '23505';
  end if;

  insert into public.households (name) values (v_name) returning id into v_hh; -- trigger mints the code
  insert into public.allowed_users (email, display_name, household_id, is_admin, role)
    values (v_email, public.jwt_display_name(), v_hh, false, 'owner');
  return v_hh;
end;
$$;
grant execute on function public.create_household(text) to authenticated;

-- 8. join_household: caller joins an existing household via its code ----------
create or replace function public.join_household(p_code text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_email text := public.jwt_email();
  v_code  text := upper(btrim(coalesce(p_code, '')));
  v_hh    uuid;
begin
  if v_email is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if exists (select 1 from public.allowed_users where email = v_email) then
    raise exception 'already in a household' using errcode = '23505';
  end if;

  -- Rate limit: max 10 attempts / 10 min per email (blunts code brute-forcing).
  insert into public.join_attempts (email) values (v_email);
  if (select count(*) from public.join_attempts
        where email = v_email and attempted_at > now() - interval '10 minutes') > 10 then
    raise exception 'too many attempts, try again later' using errcode = '54000';
  end if;

  select household_id into v_hh from public.household_join_codes where code = v_code;
  if v_hh is null then
    raise exception 'invalid code' using errcode = 'P0002';
  end if;

  insert into public.allowed_users (email, display_name, household_id, is_admin, role)
    values (v_email, public.jwt_display_name(), v_hh, false, 'member');
  return v_hh;
end;
$$;
grant execute on function public.join_household(text) to authenticated;

-- 9. Owner-only: read / rotate the code, remove a member ---------------------
create or replace function public.get_join_code()
returns text
language sql
security definer
set search_path to 'public'
as $$
  select c.code
  from public.household_join_codes c
  join public.allowed_users au on au.household_id = c.household_id
  where au.email = public.jwt_email() and au.role = 'owner';
$$;
grant execute on function public.get_join_code() to authenticated;

create or replace function public.rotate_join_code()
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_hh   uuid;
  v_code text;
begin
  select household_id into v_hh from public.allowed_users
    where email = public.jwt_email() and role = 'owner';
  if v_hh is null then
    raise exception 'not a household owner' using errcode = '42501';
  end if;
  v_code := public.gen_join_code();
  update public.household_join_codes set code = v_code, updated_at = now() where household_id = v_hh;
  return v_code;
end;
$$;
grant execute on function public.rotate_join_code() to authenticated;

create or replace function public.remove_member(p_email text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_hh uuid;
begin
  select household_id into v_hh from public.allowed_users
    where email = public.jwt_email() and role = 'owner';
  if v_hh is null then
    raise exception 'not a household owner' using errcode = '42501';
  end if;
  if p_email = public.jwt_email() then
    raise exception 'cannot remove yourself' using errcode = '22023';
  end if;
  -- Only plain members of the owner's own household; owners are protected.
  delete from public.allowed_users
    where email = p_email and household_id = v_hh and role <> 'owner';
  delete from public.member_profiles
    where email = p_email and household_id = v_hh;
end;
$$;
grant execute on function public.remove_member(text) to authenticated;

-- 10. Backfill: code + owner for existing households -------------------------
do $$
declare
  h record;
begin
  for h in select id from public.households where id not in (select household_id from public.household_join_codes) loop
    insert into public.household_join_codes (household_id, code) values (h.id, public.gen_join_code());
  end loop;
end $$;

-- Your household (the global admin) becomes its owner.
update public.allowed_users set role = 'owner' where is_admin = true and role <> 'owner';

-- Any single-member household with no owner yet: the sole member becomes owner.
update public.allowed_users au set role = 'owner'
where au.role = 'member'
  and (select count(*) from public.allowed_users x where x.household_id = au.household_id) = 1
  and not exists (
    select 1 from public.allowed_users o where o.household_id = au.household_id and o.role = 'owner'
  );
