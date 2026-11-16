-- Migration 114: take a hand-drawn note off the wall (owner, 2026-11-16).
-- "If someone sends me something I don't want, does it stay on my wall forever?"
--  * The SENDER deletes a note for everyone: the existing pings_delete policy
--    (sender_email = me) already allows it; the app deletes the row, then the
--    PNG (documents bucket, household prefix — storage RLS already allows it).
--  * A RECIPIENT can't delete someone else's note, so they HIDE it: one row
--    per (note, member) in note_hidden. Personal — nobody else's wall changes.
--    Hiding also drops their heart on it. The daily purge (api/send-digest)
--    still deletes old unfavourited notes; the cascade takes these rows along.

create table if not exists public.note_hidden (
  ping_id uuid not null references public.pings(id) on delete cascade,
  user_email text not null default (auth.jwt() ->> 'email'),
  household_id uuid not null default public.current_household(),
  created_at timestamptz not null default now(),
  primary key (ping_id, user_email)
);

alter table public.note_hidden enable row level security;

drop policy if exists note_hidden_select on public.note_hidden;
create policy note_hidden_select on public.note_hidden for select to authenticated
  using (user_email = (auth.jwt() ->> 'email') and household_id = (select public.current_household()));

drop policy if exists note_hidden_insert on public.note_hidden;
create policy note_hidden_insert on public.note_hidden for insert to authenticated
  with check (
    user_email = (auth.jwt() ->> 'email')
    and household_id = (select public.current_household())
    and exists (select 1 from public.pings p where p.id = ping_id and p.image_path is not null
                and p.household_id = (select public.current_household()))
  );

drop policy if exists note_hidden_delete on public.note_hidden;
create policy note_hidden_delete on public.note_hidden for delete to authenticated
  using (user_email = (auth.jwt() ->> 'email'));

drop policy if exists note_hidden_no_casa on public.note_hidden;
create policy note_hidden_no_casa on public.note_hidden as restrictive for all to authenticated
  using (not (select public.is_casa_session())) with check (not (select public.is_casa_session()));

grant select, insert, delete on public.note_hidden to authenticated;
