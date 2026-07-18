-- 067: Places & geofences (Whereabouts Phase 2). Saved household locations
-- (Home, School, Grandma's…) that each member's device monitors as a native
-- geofence; crossing one records a place_event ("Emma arrived at School") which
-- drives the activity feed + a push to the rest of the household.
-- Household-scoped RLS + Realtime, same invariants as member_locations.
create table if not exists public.places (
  id                 uuid primary key default gen_random_uuid(),
  household_id       uuid not null default public.current_household()
                     references public.households(id) on delete cascade,
  name               text not null,
  icon               text not null default '📍',
  lat                double precision not null,
  lng                double precision not null,
  radius_m           integer not null default 150 check (radius_m between 50 and 5000),
  notify_arrivals    boolean not null default true,
  notify_departures  boolean not null default false,
  created_by         text not null default (auth.jwt() ->> 'email'),
  created_at         timestamptz not null default now()
);

alter table public.places enable row level security;

-- Places are shared household furniture: any member can manage them.
create policy places_select on public.places
  for select using (household_id = public.current_household());
create policy places_insert on public.places
  for insert with check (household_id = public.current_household());
create policy places_update on public.places
  for update using (household_id = public.current_household())
  with check (household_id = public.current_household());
create policy places_delete on public.places
  for delete using (household_id = public.current_household());

create table if not exists public.place_events (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null default public.current_household()
               references public.households(id) on delete cascade,
  place_id     uuid not null references public.places(id) on delete cascade,
  user_email   text not null default (auth.jwt() ->> 'email'),
  type         text not null check (type in ('arrive', 'leave')),
  at           timestamptz not null default now()
);

alter table public.place_events enable row level security;

create policy place_events_select on public.place_events
  for select using (household_id = public.current_household());

-- A member may only record their OWN crossings, for a place in their household.
create policy place_events_insert on public.place_events
  for insert with check (
    user_email = (auth.jwt() ->> 'email')
    and household_id = public.current_household()
    and exists (
      select 1 from public.places p
      where p.id = place_id and p.household_id = public.current_household()
    )
  );

create index if not exists places_household_idx on public.places (household_id);
create index if not exists place_events_feed_idx on public.place_events (household_id, at desc);

alter publication supabase_realtime add table public.places;
alter publication supabase_realtime add table public.place_events;
