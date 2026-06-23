-- Household "signals": one-tap pings (need a hand, on my way, dinner's ready…)
-- pushed to the household + shown as a live banner on the Hub. signal_acks
-- records who tapped "got it". Both are realtime so open apps update instantly.
create table if not exists public.signals (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null default public.current_household(),
  sender_email text not null default (auth.jwt() ->> 'email'),
  kind text not null,
  emoji text not null,
  message text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '6 hours')
);

alter table public.signals enable row level security;

create policy signals_select on public.signals
  for select using (household_id = public.current_household());

create policy signals_insert on public.signals
  for insert with check (
    household_id = public.current_household()
    and sender_email = (auth.jwt() ->> 'email')
  );

create policy signals_delete on public.signals
  for delete using (sender_email = (auth.jwt() ->> 'email'));

create index if not exists signals_household_active_idx
  on public.signals (household_id, expires_at);

create table if not exists public.signal_acks (
  signal_id uuid not null references public.signals(id) on delete cascade,
  user_email text not null default (auth.jwt() ->> 'email'),
  created_at timestamptz not null default now(),
  primary key (signal_id, user_email)
);

alter table public.signal_acks enable row level security;

-- Acks are visible to / writable by members of the signal's household.
create policy signal_acks_select on public.signal_acks
  for select using (
    exists (
      select 1 from public.signals s
      where s.id = signal_acks.signal_id
        and s.household_id = public.current_household()
    )
  );

create policy signal_acks_insert on public.signal_acks
  for insert with check (
    user_email = (auth.jwt() ->> 'email')
    and exists (
      select 1 from public.signals s
      where s.id = signal_acks.signal_id
        and s.household_id = public.current_household()
    )
  );

alter publication supabase_realtime add table public.signals;
alter publication supabase_realtime add table public.signal_acks;
