-- Migration 106: the phone hands its home city to the Modo Casa device at
-- pairing (owner, 2026-11: the device should show the weather and its sky
-- right away). Carried on the pairing row, read once by casa-poll.
alter table public.home_pair_codes add column if not exists home_loc jsonb;
