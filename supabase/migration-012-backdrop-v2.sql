-- Migration 012: backdrop v2 (applied via Supabase MCP on 2026-06-12).
-- One column, three states:
--   null            → no backdrop (the default for new households)
--   'builtin:beach' → the original beach scene (Munhoz Family only)
--   anything else   → uploaded image path in the documents bucket
--                     (<household_id>/backdrop/<uuid>.jpg)
-- Members can update their own household via the policy from migration 008.

alter table households rename column photo_path to backdrop_path;
alter table households drop column if exists sign_text;
update households set backdrop_path = 'builtin:beach' where backdrop_path = '/family.jpg';
