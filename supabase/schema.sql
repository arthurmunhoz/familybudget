-- One Roof — Supabase schema (original bootstrap; see footer for later migrations)
-- Run this in the Supabase SQL Editor (Dashboard → SQL Editor → New query).

-- Who is allowed to use the app. Add both of your Google account emails here.
create table if not exists allowed_users (
  email text primary key,
  display_name text not null
);

-- IMPORTANT: replace with the Google emails you and Patricia will sign in with.
insert into allowed_users (email, display_name) values
  ('arthurmunhoz@hotmail.com', 'Arthur'),
  ('paty_almeida@live.com', 'Patricia')
on conflict (email) do nothing;

create table if not exists budgets (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  period text not null default 'monthly' check (period in ('daily', 'weekly', 'monthly')),
  created_at timestamptz not null default now()
);

insert into budgets (name)
select 'Our Home Budget'
where not exists (select 1 from budgets);

-- A "month" row is one budget period: monthly = 1st of the month,
-- weekly = the week's start day, daily = the day itself.
create table if not exists months (
  id uuid primary key default gen_random_uuid(),
  budget_id uuid not null references budgets(id) on delete cascade,
  start_date date not null,
  created_at timestamptz not null default now(),
  unique (budget_id, start_date)
);

create table if not exists entries (
  id uuid primary key default gen_random_uuid(),
  month_id uuid not null references months(id) on delete cascade,
  type text not null check (type in ('expense', 'income')),
  label text not null,
  amount numeric(12, 2) not null check (amount > 0),
  category text not null default 'other',
  entry_date date not null,
  person_email text not null references allowed_users(email),
  recurring boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists entries_month_idx on entries (month_id);

-- Learned label → category choices (powers auto-categorization).
create table if not exists category_rules (
  keyword text primary key,
  category text not null,
  updated_at timestamptz not null default now()
);

-- Row-level security: only the two allowed users can touch anything.
-- security definer avoids RLS recursion when allowed_users checks itself.
create or replace function public.is_allowed()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from allowed_users
    where email = (auth.jwt() ->> 'email')
  );
$$;

alter table allowed_users enable row level security;
alter table budgets enable row level security;
alter table months enable row level security;
alter table entries enable row level security;
alter table category_rules enable row level security;

drop policy if exists budgets_rw on budgets;
create policy budgets_rw on budgets
  for all using (public.is_allowed()) with check (public.is_allowed());

drop policy if exists allowed_users_rw on allowed_users;
create policy allowed_users_rw on allowed_users
  for select using (public.is_allowed());

drop policy if exists months_rw on months;
create policy months_rw on months
  for all using (public.is_allowed()) with check (public.is_allowed());

drop policy if exists entries_rw on entries;
create policy entries_rw on entries
  for all using (public.is_allowed()) with check (public.is_allowed());

drop policy if exists category_rules_rw on category_rules;
create policy category_rules_rw on category_rules
  for all using (public.is_allowed()) with check (public.is_allowed());

-- ── Pet care log (migration 005) ─────────────────────────────────────────────

create table if not exists pets (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  emoji text not null default '🐶',
  created_at timestamptz not null default now()
);

insert into pets (name, emoji)
select v.name, v.emoji
from (values ('Lola', '🐶'), ('Aninha', '🐕')) as v(name, emoji)
where not exists (select 1 from pets);

create table if not exists pet_events (
  id uuid primary key default gen_random_uuid(),
  pet_id uuid not null references pets(id) on delete cascade,
  type text not null check (type in ('vet', 'vaccine', 'medication', 'grooming', 'other')),
  title text not null,
  notes text,
  event_date date not null,
  next_due date,
  added_by text not null references allowed_users(email),
  created_at timestamptz not null default now()
);

create index if not exists pet_events_pet_idx on pet_events (pet_id, event_date desc);

alter table pets enable row level security;
alter table pet_events enable row level security;

drop policy if exists pets_rw on pets;
create policy pets_rw on pets
  for all using (public.is_allowed()) with check (public.is_allowed());

drop policy if exists pet_events_rw on pet_events;
create policy pet_events_rw on pet_events
  for all using (public.is_allowed()) with check (public.is_allowed());

-- ── Document vault (migration 006) ───────────────────────────────────────────

create table if not exists documents (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  category text not null default 'other'
    check (category in ('ids', 'insurance', 'medical', 'pets', 'home', 'receipts', 'other')),
  file_path text not null,
  mime_type text not null,
  size_bytes bigint not null default 0,
  added_by text not null references allowed_users(email),
  created_at timestamptz not null default now()
);

alter table documents enable row level security;

drop policy if exists documents_rw on documents;
create policy documents_rw on documents
  for all using (public.is_allowed()) with check (public.is_allowed());

insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict (id) do nothing;

drop policy if exists documents_storage_rw on storage.objects;
create policy documents_storage_rw on storage.objects
  for all to authenticated
  using (bucket_id = 'documents' and public.is_allowed())
  with check (bucket_id = 'documents' and public.is_allowed());

-- ─────────────────────────────────────────────────────────────────────────────
-- NOTE: this file is the original bootstrap and is no longer a complete,
-- standalone setup. Later changes live in their own files — apply in order:
--   migration-004-shopping.sql   (shopping_items + realtime)
--   migration-005-pets.sql       (pet care log)
--   migration-006-documents.sql  (document vault + storage bucket)
--   migration-007-households.sql (multi-tenancy: households, admin, RLS rewrite)
--   migration-008-backdrop.sql   (household backdrop columns — applied, unused yet)
--   migration-009-web-events.sql (behavioral analytics + admin aggregates)
--   migration-010-document-owner.sql (documents.owner_email)
--   migration-011-admin-analytics-v2.sql (period param, admin exclusion, time spent)
--   migration-012-backdrop-v2.sql (households.backdrop_path: null / builtin:beach / upload)
--   migration-013-storage-constraints.sql (bucket size/mime limits)
--   migration-014-user-settings.sql (per-user hidden apps)
--   migration-015-tile-style.sql (hub tile density per user)
--   migration-016-member-limit.sql (max 6 members per household)
--   migration-017-subcategory.sql (optional free-text entry subcategory)
--   migration-018-user-language.sql (per-user interface language)
--   migration-018-important-dates.sql (birthdays, anniversaries, renewals)
--   migration-019-member-profiles.sql (family member profiles)
--   migration-020-member-avatar.sql (member profile photo)
--   migration-021-shopping-stores.sql (per-store shopping list sections)
--   migration-022-shopping-store-slug.sql (catalog slug for store logos)
--   migration-023-internal-household-analytics.sql (exclude dev household)
--   migration-024-pet-profile-fields.sql (pet species/breed/birthday/photo/etc)
--   migration-025-admin-recent-errors.sql (errors panel excludes testing noise)
--   migration-026-push-subscriptions.sql (web push subscriptions for daily digest)
