-- 061: Family location — live member positions for the Whereabouts app (Phase 1).
-- One row per member: their latest fix + sharing state. Household-scoped RLS,
-- same invariants as pings — household_id / user_email are stamped by column
-- defaults, reads are limited to the caller's household. Realtime so the map
-- updates live. lat/lng are NULLABLE on purpose: a row can hold sharing state
-- with no exposed fix (before the first fix, or while sharing is paused/off — we
-- null the coordinates then so no stale location leaks to the household).
create table if not exists public.member_locations (
  user_email   text primary key default (auth.jwt() ->> 'email'),
  household_id uuid not null default public.current_household()
               references public.households(id) on delete cascade,
  lat          double precision,
  lng          double precision,
  accuracy     double precision,        -- horizontal accuracy, meters
  speed        double precision,        -- m/s, null if unknown
  battery      smallint,                -- 0..100, null if unknown
  sharing      boolean not null default false,  -- OFF by default: sharing is opt-in
  paused_until timestamptz,             -- if set in the future, sharing is paused
  updated_at   timestamptz not null default now()
);

alter table public.member_locations enable row level security;

-- Everyone in the household can read every member's row (that's the point).
create policy member_locations_select on public.member_locations
  for select using (household_id = public.current_household());

-- A user may only write their OWN row, in their own household.
create policy member_locations_insert on public.member_locations
  for insert with check (
    user_email = (auth.jwt() ->> 'email')
    and household_id = public.current_household()
  );
create policy member_locations_update on public.member_locations
  for update using (user_email = (auth.jwt() ->> 'email'))
  with check (user_email = (auth.jwt() ->> 'email'));
create policy member_locations_delete on public.member_locations
  for delete using (user_email = (auth.jwt() ->> 'email'));

-- Server-authoritative freshness: stamp updated_at on every write so "2 min ago"
-- can't drift with client clock skew.
create or replace function public.touch_member_location()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;
drop trigger if exists member_locations_touch on public.member_locations;
create trigger member_locations_touch
  before insert or update on public.member_locations
  for each row execute function public.touch_member_location();

create index if not exists member_locations_household_idx
  on public.member_locations (household_id);

alter publication supabase_realtime add table public.member_locations;
