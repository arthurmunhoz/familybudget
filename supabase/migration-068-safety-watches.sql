-- 068: Safety Radius / "event mode" (Whereabouts Phase 3, a One Roof Plus
-- feature). At a park or fair you drop a circle around yourself, pick which kids
-- to watch, and get alerted the moment one crosses the edge.
--
-- One active watch per person (PK owner_email) — you're either running one or
-- you're not. Breach detection runs on the WATCHER's device against the live
-- member_locations feed (no server job needed); this table persists the config
-- so it survives an app restart and is visible to the household for transparency.
create table if not exists public.safety_watches (
  owner_email  text primary key default (auth.jwt() ->> 'email'),
  household_id uuid not null default public.current_household()
               references public.households(id) on delete cascade,
  center_lat   double precision not null,
  center_lng   double precision not null,
  radius_m     integer not null default 150 check (radius_m between 50 and 5000),
  watched      text[] not null default '{}',
  expires_at   timestamptz not null default (now() + interval '4 hours'),
  created_at   timestamptz not null default now()
);

alter table public.safety_watches enable row level security;

-- Household-visible on purpose: being inside someone's safety radius is not a
-- secret (matches the "pausing is visible, never covert" stance).
create policy safety_watches_select on public.safety_watches
  for select using (household_id = public.current_household());

-- Only the owner may create/change/stop their own watch.
create policy safety_watches_insert on public.safety_watches
  for insert with check (
    owner_email = (auth.jwt() ->> 'email')
    and household_id = public.current_household()
  );
create policy safety_watches_update on public.safety_watches
  for update using (owner_email = (auth.jwt() ->> 'email'))
  with check (owner_email = (auth.jwt() ->> 'email'));
create policy safety_watches_delete on public.safety_watches
  for delete using (owner_email = (auth.jwt() ->> 'email'));

create index if not exists safety_watches_household_idx
  on public.safety_watches (household_id, expires_at);

alter publication supabase_realtime add table public.safety_watches;
