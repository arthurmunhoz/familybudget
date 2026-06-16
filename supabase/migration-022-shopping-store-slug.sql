-- Migration 022: shopping store catalog slug.
-- A store picked from the built-in catalog records its slug, which maps to a
-- bundled logo (public/store-logos/<slug>.svg) and a brand color. Custom
-- stores leave slug null and render a neutral monogram tile.

alter table shopping_stores add column if not exists slug text;
