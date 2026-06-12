-- Migration 015: hub tile density (applied via Supabase MCP on 2026-06-12).
-- Per user: 'large' (icon + name + description, 2 columns) or 'compact'
-- (icon + name, 3 columns).

alter table user_settings
  add column if not exists tile_style text not null default 'large'
  check (tile_style in ('large', 'compact'));
