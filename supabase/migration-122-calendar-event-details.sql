-- Migration 122: details of events pulled from Google Calendar, for the event
-- details sheet (tap an external event in the Calendar).
--  * attendees   — [{ "name": text, "status": "accepted"|"tentative"|
--                  "declined"|"needsAction", "organizer"?: true }], at most 50.
--                  A display name only (the email when Google has no name) —
--                  never a separate email field, since the whole household
--                  reads these rows.
--  * organizer   — display name (or email) of the organizer.
--  * meeting_url — the video link (Google Meet hangoutLink, else the first
--                  "video" conference entry point, e.g. Zoom).
-- Written only by api/google-calendar-sync (service role); null for One Roof
-- and Apple rows.
alter table calendar_events
  add column if not exists attendees jsonb,
  add column if not exists organizer text,
  add column if not exists meeting_url text;
