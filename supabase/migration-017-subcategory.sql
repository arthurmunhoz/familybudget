-- Migration 017: entry subcategory (applied via Supabase MCP on 2026-06-14).
-- Optional free-text subcategory on an entry (e.g. Health → "supplements").
-- The autocomplete suggestions are derived from existing entries (household-
-- scoped by RLS), so there is no separate subcategory taxonomy table.

alter table entries add column if not exists subcategory text;
create index if not exists entries_category_subcategory_idx
  on entries (category, subcategory) where subcategory is not null;
