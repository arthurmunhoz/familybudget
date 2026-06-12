-- Migration 008: per-household backdrop columns (applied via Supabase MCP on
-- 2026-06-12). NOTE: applied to the DB but NOT yet used by the app — the
-- feature pivoted from "custom polaroid in the beach scene" to "fully custom
-- uploaded backdrop image" and is still pending. photo_path values starting
-- with '/' are bundled app assets; anything else is a documents-bucket path.

alter table households add column if not exists photo_path text;
alter table households add column if not exists sign_text text;

update households set photo_path = '/family.jpg', sign_text = 'TAMPA'
where name = 'Munhoz Family' and photo_path is null;

-- Members may update their own household (backdrop photo, sign, name).
drop policy if exists households_member_update on households;
create policy households_member_update on households
  for update using (id = public.current_household())
  with check (id = public.current_household());
