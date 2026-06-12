-- Migration 007: multi-tenancy (applied via Supabase MCP on 2026-06-12).
-- Households own all data; users belong to one household; Arthur (is_admin)
-- can create households and manage their members from the in-app Admin page.

create table if not exists households (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

alter table allowed_users add column if not exists household_id uuid references households(id);
alter table allowed_users add column if not exists is_admin boolean not null default false;
alter table budgets add column if not exists household_id uuid references households(id);
alter table shopping_items add column if not exists household_id uuid references households(id);
alter table pets add column if not exists household_id uuid references households(id);
alter table documents add column if not exists household_id uuid references households(id);
alter table category_rules add column if not exists household_id uuid references households(id);

-- Backfill everything that exists today into the original household.
do $$
declare hid uuid;
begin
  select id into hid from households order by created_at limit 1;
  if hid is null then
    insert into households (name) values ('Munhoz Family') returning id into hid;
  end if;
  update allowed_users set household_id = hid where household_id is null;
  update budgets set household_id = hid where household_id is null;
  update shopping_items set household_id = hid where household_id is null;
  update pets set household_id = hid where household_id is null;
  update category_rules set household_id = hid where household_id is null;
  update documents set household_id = hid where household_id is null;
  -- storage objects move under a per-household folder to match the new policy
  update documents set file_path = hid::text || '/' || file_path
    where position(hid::text in file_path) <> 1;
  update storage.objects set name = hid::text || '/' || name
    where bucket_id = 'documents' and position(hid::text in name) <> 1;
end $$;

update allowed_users set is_admin = true where email = 'arthurmunhoz@hotmail.com';

alter table allowed_users alter column household_id set not null;
alter table budgets alter column household_id set not null;
alter table shopping_items alter column household_id set not null;
alter table pets alter column household_id set not null;
alter table documents alter column household_id set not null;
alter table category_rules alter column household_id set not null;

-- The signed-in user's household / admin flag (security definer: avoids RLS recursion).
create or replace function public.current_household()
returns uuid
language sql stable security definer
set search_path = public
as $$
  select household_id from allowed_users where email = (auth.jwt() ->> 'email');
$$;

create or replace function public.is_admin()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select coalesce(
    (select is_admin from allowed_users where email = (auth.jwt() ->> 'email')),
    false
  );
$$;

-- New rows land in the inserter's household automatically.
alter table budgets alter column household_id set default public.current_household();
alter table shopping_items alter column household_id set default public.current_household();
alter table pets alter column household_id set default public.current_household();
alter table documents alter column household_id set default public.current_household();
alter table category_rules alter column household_id set default public.current_household();

-- category_rules are learned per household now.
alter table category_rules drop constraint category_rules_pkey;
alter table category_rules add primary key (household_id, keyword);

-- ── Policies: household-scoped instead of "any allowed user" ────────────────

alter table households enable row level security;

drop policy if exists households_admin_all on households;
create policy households_admin_all on households
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists households_member_select on households;
create policy households_member_select on households
  for select using (id = public.current_household());

drop policy if exists allowed_users_rw on allowed_users;
drop policy if exists allowed_users_member_select on allowed_users;
create policy allowed_users_member_select on allowed_users
  for select using (household_id = public.current_household() or public.is_admin());

drop policy if exists allowed_users_admin_all on allowed_users;
create policy allowed_users_admin_all on allowed_users
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists budgets_rw on budgets;
create policy budgets_rw on budgets
  for all using (household_id = public.current_household())
  with check (household_id = public.current_household());

drop policy if exists months_rw on months;
create policy months_rw on months
  for all using (exists (
    select 1 from budgets b
    where b.id = months.budget_id and b.household_id = public.current_household()
  ))
  with check (exists (
    select 1 from budgets b
    where b.id = months.budget_id and b.household_id = public.current_household()
  ));

drop policy if exists entries_rw on entries;
create policy entries_rw on entries
  for all using (exists (
    select 1 from months m join budgets b on b.id = m.budget_id
    where m.id = entries.month_id and b.household_id = public.current_household()
  ))
  with check (exists (
    select 1 from months m join budgets b on b.id = m.budget_id
    where m.id = entries.month_id and b.household_id = public.current_household()
  ));

drop policy if exists category_rules_rw on category_rules;
create policy category_rules_rw on category_rules
  for all using (household_id = public.current_household())
  with check (household_id = public.current_household());

drop policy if exists shopping_items_rw on shopping_items;
create policy shopping_items_rw on shopping_items
  for all using (household_id = public.current_household())
  with check (household_id = public.current_household());

drop policy if exists pets_rw on pets;
create policy pets_rw on pets
  for all using (household_id = public.current_household())
  with check (household_id = public.current_household());

drop policy if exists pet_events_rw on pet_events;
create policy pet_events_rw on pet_events
  for all using (exists (
    select 1 from pets p
    where p.id = pet_events.pet_id and p.household_id = public.current_household()
  ))
  with check (exists (
    select 1 from pets p
    where p.id = pet_events.pet_id and p.household_id = public.current_household()
  ));

-- Storage: files live under <household_id>/<category>/<file>.
drop policy if exists documents_storage_rw on storage.objects;
create policy documents_storage_rw on storage.objects
  for all to authenticated
  using (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = public.current_household()::text
  )
  with check (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = public.current_household()::text
  );

drop policy if exists documents_rw on documents;
create policy documents_rw on documents
  for all using (household_id = public.current_household())
  with check (household_id = public.current_household());
