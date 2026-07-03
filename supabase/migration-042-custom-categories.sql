-- 042: Household-defined budget categories.
-- Built-in categories stay hardcoded in src/lib/categories.ts; this table adds
-- per-household extras created from the entry form. entries.category stores the
-- uuid as text for custom ones (categoryById falls back to 'other' if a custom
-- category is ever deleted, so old entries keep rendering).
create table if not exists public.custom_categories (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null default public.current_household()
               references public.households(id) on delete cascade,
  name         text not null check (length(trim(name)) between 1 and 40),
  icon         text not null default '🏷️' check (length(icon) between 1 and 16),
  created_at   timestamptz not null default now()
);
alter table public.custom_categories enable row level security;

drop policy if exists custom_categories_select on public.custom_categories;
create policy custom_categories_select on public.custom_categories
  for select using (household_id = public.current_household());

drop policy if exists custom_categories_insert on public.custom_categories;
create policy custom_categories_insert on public.custom_categories
  for insert with check (household_id = public.current_household());

drop policy if exists custom_categories_delete on public.custom_categories;
create policy custom_categories_delete on public.custom_categories
  for delete using (household_id = public.current_household());
