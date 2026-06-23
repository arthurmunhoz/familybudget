-- Migration 029: per-user hub app ordering.
-- Lets each member arrange their hub tiles. Empty array = the registry's
-- natural order; ids listed here render first (in this order), any not listed
-- are appended (so newly added apps show up at the end until reordered).

alter table public.user_settings
  add column if not exists app_order text[] not null default '{}';
