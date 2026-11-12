-- 098: Pet routine reminders ("Ninguém marcou a ração da Lola ainda. Já fez?").
--
-- • pet_care_tasks.remind_at — an optional, approximate wall-clock time for a
--   routine ("Morning food ~8:00"). NULL = no reminder (every existing row).
--   It is a plain `time` with no zone ON PURPOSE: it means "8 in the morning
--   wherever the phone is", and each device turns it into a local date itself.
-- • user_settings.notify_pets — per-member opt-in, default ON. Someone who
--   doesn't look after the pets switches it off in Settings → Notifications.
--
-- There is no server logic: the reminders are LOCAL notifications scheduled
-- on each member's phone (mobile/src/lib/petReminders.ts), because Vercel
-- Hobby crons run once a day. The phone fires it remind_at + 45 min later
-- unless someone has a pet_task_done row for that task and day by then; the
-- "Done" button on the notification writes that row with the member's own
-- session (same RLS as a tap in Pet Care). No policy changes: both tables'
-- existing RLS already covers the new columns.

alter table public.pet_care_tasks add column if not exists remind_at time;

alter table public.user_settings add column if not exists notify_pets boolean not null default true;
