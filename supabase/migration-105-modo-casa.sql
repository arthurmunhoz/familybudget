-- Migration 105: Modo Casa — a spare tablet at home becomes the family's hub
-- (owner, 2026-11). The web app shows ONLY this now.
--
-- How a tablet gets in: it shows a pairing code (QR); a member scans it with
-- the phone app (Settings › Modo Casa), the server (service role, api/widget.ts
-- ?action=casa-*) checks the member and the plan, records the device and mints
-- the tablet its OWN Supabase session for that member (a magic-link token the
-- tablet exchanges). From then on the tablet is that member under the normal
-- RLS — it sees only that family. Revoking the device (or the member leaving)
-- ends it.
--
-- Plan: the first 30 days from the household's FIRST paired device are the
-- full thing; after that, without Plus, the tablet only shows the day. Plus:
-- the assistant on the tablet and more than one tablet. The server checks the
-- device count at pairing and the plan before the assistant answers; the other
-- locks are on the tablet's screen (whoever paired it can do those same things
-- from the phone anyway).

create table if not exists public.home_devices (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  paired_by text not null,
  name text not null default 'Dispositivo',
  created_at timestamptz not null default now(),
  last_seen_at timestamptz,
  revoked_at timestamptz
);
create index if not exists home_devices_household on public.home_devices (household_id);

alter table public.home_devices enable row level security;

-- Members see their family's tablets; any member may rename or revoke one.
-- Rows are created only by the service role (pairing).
drop policy if exists home_devices_select on public.home_devices;
create policy home_devices_select on public.home_devices for select to authenticated
  using (exists (select 1 from public.household_members m
                  where m.household_id = home_devices.household_id and m.email = public.jwt_email()));
drop policy if exists home_devices_update on public.home_devices;
create policy home_devices_update on public.home_devices for update to authenticated
  using (exists (select 1 from public.household_members m
                  where m.household_id = home_devices.household_id and m.email = public.jwt_email()))
  with check (exists (select 1 from public.household_members m
                  where m.household_id = home_devices.household_id and m.email = public.jwt_email()));

-- Pending pairings: the tablet asks for a code (+ a secret only it knows), the
-- phone claims the code, the tablet collects its token with the secret.
-- Service role only — no client policies at all.
create table if not exists public.home_pair_codes (
  code text primary key,
  secret text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '10 minutes',
  household_id uuid references public.households(id) on delete cascade,
  device_id uuid references public.home_devices(id) on delete cascade,
  claimed_by text,
  claimed_at timestamptz,
  token_hash text,
  collected_at timestamptz
);
alter table public.home_pair_codes enable row level security;

-- When the free trial of Modo Casa ends for a household: 30 days after its
-- first paired tablet (revoked ones count — re-pairing doesn't restart it).
create or replace function public.home_trial_ends(p_household uuid)
returns timestamptz language sql stable security definer set search_path = public as $$
  select min(created_at) + interval '30 days' from public.home_devices where household_id = p_household;
$$;
revoke all on function public.home_trial_ends(uuid) from public, anon;
grant execute on function public.home_trial_ends(uuid) to authenticated;

-- What the tablet may do right now, for the caller's ACTIVE household:
-- { plus, trial_ends, full } — full = Plus or still in the trial.
create or replace function public.home_plan()
returns json language sql stable security definer set search_path = public as $$
  select json_build_object(
    'plus', public.household_is_plus(h),
    'trial_ends', public.home_trial_ends(h),
    'full', public.household_is_plus(h) or coalesce(public.home_trial_ends(h) > now(), true)
  )
  from (select public.current_household() as h) x;
$$;
revoke all on function public.home_plan() from public, anon;
grant execute on function public.home_plan() to authenticated;

-- The family's PIN for Money on the tablet (set from the phone, Settings ›
-- Modo Casa). Only a hash is kept: sha256 of "<household_id>:<pin>", computed
-- by the client. It keeps the budget off the living-room screen; it is not a
-- security boundary (members can read the budget on their phones anyway).
create table if not exists public.home_settings (
  household_id uuid primary key default public.current_household() references public.households(id) on delete cascade,
  pin_hash text,
  updated_at timestamptz not null default now()
);
alter table public.home_settings enable row level security;
drop policy if exists home_settings_rw on public.home_settings;
create policy home_settings_rw on public.home_settings for all to authenticated
  using (exists (select 1 from public.household_members m
                  where m.household_id = home_settings.household_id and m.email = public.jwt_email()))
  with check (exists (select 1 from public.household_members m
                  where m.household_id = home_settings.household_id and m.email = public.jwt_email()));
