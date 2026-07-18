-- 066: Live location mode — a member "watches" another (opens their detail) and
-- their device temporarily ramps up to high-frequency GPS, then drops back to the
-- battery-saver cadence when no one is watching. One row per (watcher, target);
-- the watcher heartbeats it (extends expires_at) while the detail sheet is open.
-- The TARGET device subscribes (Realtime) to rows aimed at it and ramps up only
-- if it's still sharing. Household-scoped RLS, same invariants as member_locations.
create table if not exists public.location_live_requests (
  requester_email text not null default (auth.jwt() ->> 'email'),
  target_email    text not null,
  household_id    uuid not null default public.current_household()
                  references public.households(id) on delete cascade,
  expires_at      timestamptz not null default (now() + interval '45 seconds'),
  updated_at      timestamptz not null default now(),
  primary key (requester_email, target_email)
);

alter table public.location_live_requests enable row level security;

-- Any household member can see requests in the household (so the target sees the
-- ones aimed at them). A user may only create/refresh/cancel their OWN requests.
create policy live_requests_select on public.location_live_requests
  for select using (household_id = public.current_household());
create policy live_requests_insert on public.location_live_requests
  for insert with check (
    requester_email = (auth.jwt() ->> 'email')
    and household_id = public.current_household()
  );
create policy live_requests_update on public.location_live_requests
  for update using (requester_email = (auth.jwt() ->> 'email'))
  with check (requester_email = (auth.jwt() ->> 'email'));
create policy live_requests_delete on public.location_live_requests
  for delete using (requester_email = (auth.jwt() ->> 'email'));

create or replace function public.touch_live_request()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;
drop trigger if exists live_requests_touch on public.location_live_requests;
create trigger live_requests_touch
  before insert or update on public.location_live_requests
  for each row execute function public.touch_live_request();

create index if not exists live_requests_target_idx
  on public.location_live_requests (target_email, expires_at);

alter publication supabase_realtime add table public.location_live_requests;
