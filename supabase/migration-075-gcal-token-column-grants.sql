-- 075: actually hide the Google OAuth tokens from clients.
--
-- Migration 036 tried this with
--   revoke select (access_token, refresh_token) ... from authenticated, anon;
-- which is a NO-OP: a TABLE-level select grant already covers every column, and
-- revoking a column subset can't punch a hole in it. Verified live before this
-- migration: has_column_privilege('authenticated', …, 'refresh_token', 'SELECT')
-- was true — any signed-in user could select their own refresh_token and use it
-- to mint Google Calendar access tokens outside the app.
--
-- The correct shape: drop the table-level SELECT, then re-grant SELECT as a
-- COLUMN LIST covering exactly the status columns the client reads
-- (getGoogleConnection in src/lib/googleCalendar.ts and
-- mobile/src/lib/googleCalendar.ts select precisely these six). access_token,
-- refresh_token, token_expiry, time_zone and household_id are read only by the
-- service role in api/google-calendar-sync.ts, which bypasses both RLS and
-- these grants. DELETE stays untouched so "Disconnect" keeps working.

revoke select on public.google_calendar_connections from anon, authenticated;

grant select (
  user_email,
  google_email,
  calendar_id,
  connected_at,
  last_synced_at,
  last_error
) on public.google_calendar_connections to authenticated;
