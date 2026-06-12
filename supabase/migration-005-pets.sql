-- Migration 005: Pet care log — pets + their health/care events.
-- Applied via Supabase MCP on 2026-06-12.

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
