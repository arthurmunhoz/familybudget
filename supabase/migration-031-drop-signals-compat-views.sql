-- Migration 031: drop the temporary Signals→Pings backward-compat views from
-- migration 030. The renamed (pings) code is live in production, so the old
-- `signals` / `signal_acks` view shims are no longer needed.

drop view if exists public.signal_acks;
drop view if exists public.signals;
