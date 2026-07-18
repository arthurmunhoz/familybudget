-- 069: Per-user place subscriptions (Whereabouts Phase 2 fix).
--
-- Places are shared household furniture, but WATCHING one must be personal:
-- creating "Home" should not sign the whole family up for alerts about each
-- other. So notification settings move OFF the place and onto a per-user row:
-- each member opts in per place and chooses WHOSE crossings they care about.
--
-- `watched` empty = everyone in the household. The push fan-out
-- (api/send-ping ?action=place-event) reads this table with the service role,
-- so a crossing only reaches people who explicitly asked for it.
create table if not exists public.place_watchers (
  place_id          uuid not null references public.places(id) on delete cascade,
  user_email        text not null default (auth.jwt() ->> 'email'),
  household_id      uuid not null default public.current_household()
                    references public.households(id) on delete cascade,
  watched           text[] not null default '{}',
  notify_arrivals   boolean not null default true,
  notify_departures boolean not null default false,
  created_at        timestamptz not null default now(),
  primary key (place_id, user_email)
);

alter table public.place_watchers enable row level security;

-- Strictly personal: you only ever see or change your OWN subscriptions.
create policy place_watchers_select on public.place_watchers
  for select using (user_email = (auth.jwt() ->> 'email'));
create policy place_watchers_insert on public.place_watchers
  for insert with check (
    user_email = (auth.jwt() ->> 'email')
    and household_id = public.current_household()
  );
create policy place_watchers_update on public.place_watchers
  for update using (user_email = (auth.jwt() ->> 'email'))
  with check (user_email = (auth.jwt() ->> 'email'));
create policy place_watchers_delete on public.place_watchers
  for delete using (user_email = (auth.jwt() ->> 'email'));

create index if not exists place_watchers_place_idx on public.place_watchers (place_id);

-- The old place-level flags are superseded: they made one member's preference
-- everyone's notification. Drop them so nothing can read them by accident.
alter table public.places drop column if exists notify_arrivals;
alter table public.places drop column if exists notify_departures;
