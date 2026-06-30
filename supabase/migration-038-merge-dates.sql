-- Migration 038: merge Important Dates into the Calendar.
-- Adds a `kind` to calendar_events (event/birthday/anniversary/renewal/other) so
-- migrated dates keep their type marker + age label, then copies every
-- important_dates row into calendar_events as an all-day event (yearly when it
-- repeats). Migrated rows are One Roof-only (created_by null → never pushed to
-- Google) and household-owned (owner_email null → clay). Idempotent via NOT
-- EXISTS so re-running won't duplicate. important_dates is left DORMANT as a
-- backup and dropped in a later migration once the merge is confirmed.

alter table calendar_events
  add column if not exists kind text not null default 'event'
    check (kind in ('event', 'birthday', 'anniversary', 'renewal', 'other'));

insert into calendar_events
  (household_id, title, start_date, end_date, all_day, kind, recurrence,
   reminder_minutes, notes, source, created_at, updated_at)
select
  d.household_id, d.title, d.event_date, d.event_date, true, d.type,
  case when d.repeats_annually then 'yearly' else 'none' end,
  0, d.notes, 'oneroof', d.created_at, now()
from important_dates d
where not exists (
  select 1 from calendar_events e
  where e.household_id = d.household_id
    and e.source = 'oneroof'
    and e.kind = d.type
    and e.title = d.title
    and e.start_date = d.event_date
);
