-- Migration 030: rename the "Signals" feature to "Pings" (display name
-- "Quick pings" / "Avisos instantâneos"). Tables, the ack FK column, and
-- policies are renamed. Temporary security_invoker compat views keep the
-- previously-deployed code working until the renamed build ships — dropped in
-- migration 031 once the new code is live.

alter table public.signals rename to pings;
alter table public.signal_acks rename to ping_acks;
alter table public.ping_acks rename column signal_id to ping_id;

alter policy signals_select on public.pings rename to pings_select;
alter policy signals_insert on public.pings rename to pings_insert;
alter policy signals_delete on public.pings rename to pings_delete;
alter policy signal_acks_select on public.ping_acks rename to ping_acks_select;
alter policy signal_acks_insert on public.ping_acks rename to ping_acks_insert;

-- Backward-compat views (TEMPORARY — see migration 031).
create view public.signals with (security_invoker = true) as
  select * from public.pings;
create view public.signal_acks with (security_invoker = true) as
  select ping_id as signal_id, user_email, created_at from public.ping_acks;
