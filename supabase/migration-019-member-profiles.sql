-- Migration 019: Family Profiles (applied via Supabase MCP on 2026-06-14).
-- One row per member (keyed by email). The whole household can READ every
-- profile; a member can only WRITE their own row. All fields optional.

create table if not exists member_profiles (
  email text primary key references allowed_users(email) on delete cascade,
  household_id uuid not null default public.current_household() references households(id),
  birthday date,
  phone text,
  blood_type text check (
    blood_type is null or blood_type in
    ('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-')
  ),
  height text,
  weight text,
  shoe_size text,
  pants_size text,
  shirt_size text,
  allergies text,
  notes text,
  updated_at timestamptz not null default now()
);

alter table member_profiles enable row level security;

drop policy if exists member_profiles_select on member_profiles;
create policy member_profiles_select on member_profiles
  for select using (household_id = public.current_household());

drop policy if exists member_profiles_write on member_profiles;
create policy member_profiles_write on member_profiles
  for all
  using (email = (auth.jwt() ->> 'email'))
  with check (
    email = (auth.jwt() ->> 'email')
    and household_id = public.current_household()
  );
