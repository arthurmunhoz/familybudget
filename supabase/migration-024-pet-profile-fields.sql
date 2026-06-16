-- Migration 024: richer pet profiles (applied via Supabase MCP on 2026-06-14).
-- species, breed, birthday (→ derived age), colors, weight/length, microchip,
-- notes, and a photo (stored in the documents bucket under <household>/pets/).
-- All optional.

alter table pets add column if not exists species text;
alter table pets add column if not exists breed text;
alter table pets add column if not exists birthday date;
alter table pets add column if not exists color text;
alter table pets add column if not exists color_secondary text;
alter table pets add column if not exists weight text;
alter table pets add column if not exists length text;
alter table pets add column if not exists microchip text;
alter table pets add column if not exists notes text;
alter table pets add column if not exists photo_path text;
