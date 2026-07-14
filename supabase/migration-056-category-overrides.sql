-- Migration 056: per-household overrides for the built-in preset categories.
--
-- The 14 built-ins (categories.ts) are shared code defaults; entries reference
-- them by id ('transport'). To let a household recolor/rename a preset WITHOUT
-- touching the shared defaults or migrating any entries, each household can
-- store an override of a preset's name and/or icon. name/icon are NULLABLE so a
-- household can override just the icon and keep the localized default name.
-- categoryById() layers the override on top of the built-in; a household with no
-- rows sees exactly today's defaults (so old app builds are unaffected).

create table if not exists public.category_overrides (
  household_id uuid not null default public.current_household()
    references public.households(id) on delete cascade,
  base_id text not null,           -- the built-in category id, e.g. 'transport'
  name text,                       -- null = keep the localized default name
  icon text,                       -- null = keep the default icon
  primary key (household_id, base_id)
);
alter table public.category_overrides enable row level security;

create policy category_overrides_select on public.category_overrides
  for select using (household_id = public.current_household());
create policy category_overrides_insert on public.category_overrides
  for insert with check (household_id = public.current_household());
create policy category_overrides_update on public.category_overrides
  for update using (household_id = public.current_household())
  with check (household_id = public.current_household());
create policy category_overrides_delete on public.category_overrides
  for delete using (household_id = public.current_household());
