-- Migration 113: the notes wall (owner, 2026-11-15). A hand-drawn note
-- (migration 112) used to vanish from the app after 24 h: the row and the PNG
-- stayed, nothing showed them. Now every note a member can see (pings_select:
-- sent to everyone, to them, or by them) stays on their "Recados" wall, and a
-- member can keep one with a heart.
--
--  * note_favorites — one row per (note, member). A favourite is personal.
--  * Housekeeping (api/send-digest, service role, daily): a note nobody
--    favourited is deleted 30 days after it was sent in a household WITHOUT
--    Plus — row and PNG. Plus households keep everything.
--  * Modo Casa: the home device signs in as the member who paired it, so it
--    could read notes addressed to that member alone. A kitchen screen must
--    only show notes sent to the WHOLE household.

create table if not exists public.note_favorites (
  ping_id uuid not null references public.pings(id) on delete cascade,
  user_email text not null default (auth.jwt() ->> 'email'),
  household_id uuid not null default public.current_household(),
  created_at timestamptz not null default now(),
  primary key (ping_id, user_email)
);

create index if not exists note_favorites_user_idx on public.note_favorites (user_email, household_id);

alter table public.note_favorites enable row level security;

drop policy if exists note_favorites_select on public.note_favorites;
create policy note_favorites_select on public.note_favorites for select to authenticated
  using (user_email = (auth.jwt() ->> 'email') and household_id = (select public.current_household()));

-- Only a note you can actually see (the subquery runs under pings' own RLS).
drop policy if exists note_favorites_insert on public.note_favorites;
create policy note_favorites_insert on public.note_favorites for insert to authenticated
  with check (
    user_email = (auth.jwt() ->> 'email')
    and household_id = (select public.current_household())
    and exists (select 1 from public.pings p where p.id = ping_id and p.image_path is not null
                and p.household_id = (select public.current_household()))
  );

drop policy if exists note_favorites_delete on public.note_favorites;
create policy note_favorites_delete on public.note_favorites for delete to authenticated
  using (user_email = (auth.jwt() ->> 'email'));

-- A home device never keeps favourites (it is a shared screen).
drop policy if exists note_favorites_no_casa on public.note_favorites;
create policy note_favorites_no_casa on public.note_favorites as restrictive for all to authenticated
  using (not (select public.is_casa_session())) with check (not (select public.is_casa_session()));

grant select, insert, delete on public.note_favorites to authenticated;

-- Modo Casa sees a drawn note only when it went to the whole household.
-- Plain nudges are untouched (Roof on the home device sends targeted ones and
-- reads them back with INSERT ... RETURNING).
drop policy if exists pings_casa_notes on public.pings;
create policy pings_casa_notes on public.pings as restrictive for select to authenticated
  using (not (select public.is_casa_session()) or image_path is null or recipients is null);

create index if not exists pings_notes_idx on public.pings (household_id, created_at desc) where image_path is not null;
