-- 043: per-store custom color for the shopping list's store tiles/sections.
-- (Applied to prod from the dashboard under the name "042_store_color" before
-- 042 was taken by custom-categories — same SQL, file renumbered only.)
-- Null = derive from the built-in catalog (by slug) or the neutral monogram.
alter table public.shopping_stores add column if not exists color text
  check (color is null or color ~ '^#[0-9a-fA-F]{6}$');
