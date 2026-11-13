-- Migration 107: a time of day for a pet routine item (owner, 2026-11-13:
-- "put a time on the daily routine so it's in order, first to last").
--
-- `at_time` is WHEN the thing happens and orders the day (timed items first,
-- earliest first; untimed ones after, in their manual order). `remind_at`
-- (migration 098) stays the REMINDER: set only when the member asked to be
-- reminded, normally to the same time. Old apps never read at_time, so they
-- keep working; existing reminders seed the new column.
alter table public.pet_care_tasks add column if not exists at_time time;
update public.pet_care_tasks set at_time = remind_at where at_time is null and remind_at is not null;

select 'migration 107 ok' as result;
