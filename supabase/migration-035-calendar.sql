-- Migration 032: Shared Calendar (calendar_events).
-- A real family calendar: all-day OR timed events, multi-day spans, simple
-- recurrence, color-by-member, and optional reminders. Forward-compat columns
-- for two-way Google Calendar sync are included now so the sync engine needs
-- no follow-up migration. Household-scoped RLS; household_id + created_by are
-- auto-stamped via column defaults (clients DON'T pass them).

create table if not exists calendar_events (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null default public.current_household() references households(id),
  title text not null,
  -- Dates are ISO YYYY-MM-DD strings end-to-end; end_date = start_date for a
  -- single-day event, later for a multi-day span (inclusive).
  start_date date not null,
  end_date date not null,
  all_day boolean not null default true,
  -- null when all_day; HH:MM[:SS] local wall-clock otherwise.
  start_time time,
  end_time time,
  location text,
  notes text,
  -- Who the event belongs to (drives color-by-member). null = whole household.
  owner_email text references allowed_users(email) on delete set null,
  -- Optional explicit color (hex). null → derived from owner in the client, so
  -- existing events recolor for free if the member palette changes.
  color text,
  -- Simple recurrence; maps cleanly to a Google RRULE (FREQ=DAILY/WEEKLY/...).
  recurrence text not null default 'none'
    check (recurrence in ('none', 'daily', 'weekly', 'monthly', 'yearly')),
  recurrence_until date,
  -- Minutes-before to remind; null = no reminder. The daily digest treats any
  -- non-null value as "remind on the day" (minute-precision lands with APNs).
  reminder_minutes integer,
  -- Two-way Google sync bookkeeping (unused until the sync engine ships).
  source text not null default 'oneroof' check (source in ('oneroof', 'google')),
  google_event_id text,
  google_calendar_id text,
  synced_at timestamptz,
  -- Nullable: service-role sync inserts have no auth.jwt() to stamp.
  created_by text default (auth.jwt() ->> 'email'),
  created_at timestamptz not null default now()
);

create index if not exists calendar_events_household_idx
  on calendar_events (household_id, start_date);

-- At most one local row per imported Google event, scoped to the household.
create unique index if not exists calendar_events_google_uniq
  on calendar_events (household_id, google_event_id)
  where google_event_id is not null;

alter table calendar_events enable row level security;

drop policy if exists calendar_events_rw on calendar_events;
create policy calendar_events_rw on calendar_events
  for all using (household_id = public.current_household())
  with check (household_id = public.current_household());
