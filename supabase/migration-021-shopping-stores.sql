-- Migration 021: shopping list stores.
-- Optional per-store sections for the shared shopping list. A store is a
-- household-scoped label; items carry an optional store_id (null = "Anywhere").
-- Deleting a store drops its items back to "Anywhere" (on delete set null).

create table if not exists shopping_stores (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null default public.current_household() references households(id),
  name text not null,
  created_at timestamptz not null default now()
);

alter table shopping_stores enable row level security;

drop policy if exists shopping_stores_rw on shopping_stores;
create policy shopping_stores_rw on shopping_stores
  for all using (household_id = public.current_household())
  with check (household_id = public.current_household());

alter publication supabase_realtime add table shopping_stores;

alter table shopping_items
  add column if not exists store_id uuid references shopping_stores(id) on delete set null;
