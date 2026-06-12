-- Migration 003: budget periods (already applied via Supabase MCP on 2026-06-12).
-- Budgets get a period (daily/weekly/monthly); months become generic periods
-- keyed by start_date (monthly = 1st of month, weekly = week start, daily = the day).

alter table budgets add column if not exists period text not null default 'monthly'
  check (period in ('daily', 'weekly', 'monthly'));

alter table months add column if not exists start_date date;

update months set start_date = make_date(year, month, 1) where start_date is null;

alter table months alter column start_date set not null;

alter table months drop constraint if exists months_budget_year_month_key;
alter table months drop constraint if exists months_budget_start_key;
alter table months add constraint months_budget_start_key unique (budget_id, start_date);

alter table months drop column if exists year;
alter table months drop column if exists month;
