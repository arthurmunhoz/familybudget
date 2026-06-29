-- Migration 036: Google Calendar connections (one per user who links their
-- Google account). Stores OAuth tokens needed for server-side sync. Tokens are
-- written ONLY by the service role (the connect/sync functions); the client can
-- read its own connection STATUS but never the token columns.

create table if not exists google_calendar_connections (
  user_email text primary key references allowed_users(email) on delete cascade,
  household_id uuid not null default public.current_household() references households(id),
  -- Which Google account is linked (shown in the UI).
  google_email text,
  -- OAuth material — service-role only (see column revokes below).
  access_token text,
  refresh_token text,
  token_expiry timestamptz,
  -- Which calendar to sync (default the user's primary).
  calendar_id text not null default 'primary',
  connected_at timestamptz not null default now(),
  last_synced_at timestamptz,
  last_error text
);

alter table google_calendar_connections enable row level security;

-- A user can see (the status of) their own connection…
drop policy if exists gcal_conn_select on google_calendar_connections;
create policy gcal_conn_select on google_calendar_connections
  for select using (user_email = (auth.jwt() ->> 'email'));

-- …and disconnect it. Inserts/updates of tokens happen via the service role
-- only (no insert/update policy → RLS denies it for normal users).
drop policy if exists gcal_conn_delete on google_calendar_connections;
create policy gcal_conn_delete on google_calendar_connections
  for delete using (user_email = (auth.jwt() ->> 'email'));

-- Defense in depth: even on an allowed-row select, never expose the tokens to
-- the client. The app selects only status columns; this makes it enforced.
revoke select (access_token, refresh_token) on google_calendar_connections from authenticated;
revoke select (access_token, refresh_token) on google_calendar_connections from anon;
