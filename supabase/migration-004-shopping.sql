-- Migration 004: shopping list (already applied via Supabase MCP on 2026-06-12).
-- One shared list, realtime-synced between phones.

create table if not exists shopping_items (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  checked boolean not null default false,
  added_by text not null references allowed_users(email),
  created_at timestamptz not null default now(),
  checked_at timestamptz
);

alter table shopping_items enable row level security;

drop policy if exists shopping_items_rw on shopping_items;
create policy shopping_items_rw on shopping_items
  for all using (public.is_allowed()) with check (public.is_allowed());

alter publication supabase_realtime add table shopping_items;
