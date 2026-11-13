-- Migration 108: a budget's own icon (owner, 2026-11-13) — an emoji chosen
-- when creating the budget or in "Name and icon"; NULL = the default (💰).
alter table public.budgets add column if not exists icon text;

select 'migration 108 ok' as result;
