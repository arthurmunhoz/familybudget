-- 049: Per-pet calendar color. Distinct from the fur `color`/`color_secondary`
-- text fields — this is the swatch used to tag a pet's events on the Pet Care
-- calendar (colored dots). Null = fall back to a palette color by pet order.
alter table public.pets add column if not exists tag_color text;
