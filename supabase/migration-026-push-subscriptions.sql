-- Web Push subscriptions: one row per device/browser a user opted in on.
-- The daily digest cron (api/send-digest) reads these with the service role
-- (bypassing RLS) to deliver pet-care + important-date reminders. From the app,
-- users manage only their own subscriptions.
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_email text not null default (auth.jwt() ->> 'email'),
  household_id uuid not null default public.current_household(),
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now()
);

alter table public.push_subscriptions enable row level security;

create policy push_subscriptions_select on public.push_subscriptions
  for select using (user_email = (auth.jwt() ->> 'email'));

create policy push_subscriptions_insert on public.push_subscriptions
  for insert with check (
    user_email = (auth.jwt() ->> 'email')
    and household_id = public.current_household()
  );

create policy push_subscriptions_update on public.push_subscriptions
  for update using (user_email = (auth.jwt() ->> 'email'))
  with check (user_email = (auth.jwt() ->> 'email'));

create policy push_subscriptions_delete on public.push_subscriptions
  for delete using (user_email = (auth.jwt() ->> 'email'));

create index if not exists push_subscriptions_household_idx
  on public.push_subscriptions (household_id);
