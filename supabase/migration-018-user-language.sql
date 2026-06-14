-- Migration 018: per-user interface language (applied via Supabase MCP on 2026-06-14).
-- Follows the user across devices so a Spanish-speaking parent and an
-- English-speaking teenager in the same household each get their own language.

alter table user_settings
  add column if not exists language text not null default 'en'
  check (language in ('en', 'es', 'pt'));
