-- Migration 002: multiple budgets.
-- Run this in the Supabase SQL Editor on the existing project.
-- Creates the budgets table, moves existing months into a default
-- "Our Home Budget", and scopes the month uniqueness per budget.

create table if not exists budgets (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

alter table budgets enable row level security;

drop policy if exists budgets_rw on budgets;
create policy budgets_rw on budgets
  for all using (public.is_allowed()) with check (public.is_allowed());

-- Default budget for all existing months.
insert into budgets (name)
select 'Our Home Budget'
where not exists (select 1 from budgets);

alter table months add column if not exists budget_id uuid references budgets(id) on delete cascade;

update months
set budget_id = (select id from budgets order by created_at limit 1)
where budget_id is null;

alter table months alter column budget_id set not null;

-- A month is now unique per budget, not globally.
alter table months drop constraint if exists months_year_month_key;
alter table months drop constraint if exists months_budget_year_month_key;
alter table months add constraint months_budget_year_month_key unique (budget_id, year, month);
