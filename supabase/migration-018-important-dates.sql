-- Migration 018: Important Dates app (applied via Supabase MCP on 2026-06-14).
-- Birthdays, anniversaries, renewal deadlines. Household-scoped RLS;
-- household_id auto-stamped via public.current_household().

create table if not exists important_dates (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null default public.current_household() references households(id),
  title text not null,
  type text not null default 'other'
    check (type in ('birthday', 'anniversary', 'renewal', 'other')),
  event_date date not null,
  repeats_annually boolean not null default true,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists important_dates_household_idx
  on important_dates (household_id, event_date);

alter table important_dates enable row level security;

drop policy if exists important_dates_rw on important_dates;
create policy important_dates_rw on important_dates
  for all using (household_id = public.current_household())
  with check (household_id = public.current_household());
