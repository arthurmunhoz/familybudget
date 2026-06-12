-- Migration 014: per-user settings (applied via Supabase MCP on 2026-06-12).
-- First use: which hub apps each user shows on their homepage. Hide-only
-- model (hidden_apps array) so newly added apps appear for everyone by
-- default. RLS: each user reads/writes only their own row.

create table if not exists user_settings (
  email text primary key,
  hidden_apps text[] not null default '{}',
  updated_at timestamptz not null default now()
);

alter table user_settings enable row level security;

drop policy if exists user_settings_own on user_settings;
create policy user_settings_own on user_settings
  for all using (email = (auth.jwt() ->> 'email'))
  with check (email = (auth.jwt() ->> 'email'));
