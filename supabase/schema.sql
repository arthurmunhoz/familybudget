-- Our Budget — Supabase schema
-- Run this in the Supabase SQL Editor (Dashboard → SQL Editor → New query).

-- Who is allowed to use the app. Add both of your Google account emails here.
create table if not exists allowed_users (
  email text primary key,
  display_name text not null
);

-- IMPORTANT: replace with the Google emails you and Patricia will sign in with.
insert into allowed_users (email, display_name) values
  ('arthurmunhoz@hotmail.com', 'Arthur'),
  ('paty_almeida@live.com', 'Patricia')
on conflict (email) do nothing;

create table if not exists budgets (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  period text not null default 'monthly' check (period in ('daily', 'weekly', 'monthly')),
  created_at timestamptz not null default now()
);

insert into budgets (name)
select 'Our Home Budget'
where not exists (select 1 from budgets);

-- A "month" row is one budget period: monthly = 1st of the month,
-- weekly = the week's start day, daily = the day itself.
create table if not exists months (
  id uuid primary key default gen_random_uuid(),
  budget_id uuid not null references budgets(id) on delete cascade,
  start_date date not null,
  created_at timestamptz not null default now(),
  unique (budget_id, start_date)
);

create table if not exists entries (
  id uuid primary key default gen_random_uuid(),
  month_id uuid not null references months(id) on delete cascade,
  type text not null check (type in ('expense', 'income')),
  label text not null,
  amount numeric(12, 2) not null check (amount > 0),
  category text not null default 'other',
  entry_date date not null,
  person_email text not null references allowed_users(email),
  recurring boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists entries_month_idx on entries (month_id);

-- Learned label → category choices (powers auto-categorization).
create table if not exists category_rules (
  keyword text primary key,
  category text not null,
  updated_at timestamptz not null default now()
);

-- Row-level security: only the two allowed users can touch anything.
-- security definer avoids RLS recursion when allowed_users checks itself.
create or replace function public.is_allowed()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from allowed_users
    where email = (auth.jwt() ->> 'email')
  );
$$;

alter table allowed_users enable row level security;
alter table budgets enable row level security;
alter table months enable row level security;
alter table entries enable row level security;
alter table category_rules enable row level security;

drop policy if exists budgets_rw on budgets;
create policy budgets_rw on budgets
  for all using (public.is_allowed()) with check (public.is_allowed());

drop policy if exists allowed_users_rw on allowed_users;
create policy allowed_users_rw on allowed_users
  for select using (public.is_allowed());

drop policy if exists months_rw on months;
create policy months_rw on months
  for all using (public.is_allowed()) with check (public.is_allowed());

drop policy if exists entries_rw on entries;
create policy entries_rw on entries
  for all using (public.is_allowed()) with check (public.is_allowed());

drop policy if exists category_rules_rw on category_rules;
create policy category_rules_rw on category_rules
  for all using (public.is_allowed()) with check (public.is_allowed());
