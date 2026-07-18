-- 069: Pet Care redesign — configurable routines + completions + weight log.
--
-- The Pet Care screen moves from calendar-first to routine-first:
--  • pet_care_tasks — a pet's configurable routine. kind='daily' items (morning
--    walk, breakfast, dinner…) are a checklist that resets every day, ordered by
--    sort_order (the order drives the widget's "next undone task"). kind=
--    'interval' items (bath every 21d, flea every 30d…) roll their due date from
--    the latest completion + interval_days.
--  • pet_task_done — one row per (task, day) completion. unique(task_id, done_on)
--    makes re-marking idempotent and lets "undo" be a plain delete. done_by is
--    stamped from the JWT so the family sees WHO fed the dog.
--  • pet_weights — a simple weight log per pet (updated on vet visits).
--
-- pet_events is untouched — it becomes the History section (vet visits,
-- vaccines, incidents). RLS follows the pet_events pattern: children reach the
-- household THROUGH pets (exists subquery); pet_task_done goes through its task.

create table if not exists public.pet_care_tasks (
  id uuid primary key default gen_random_uuid(),
  pet_id uuid not null references public.pets(id) on delete cascade,
  kind text not null check (kind in ('daily', 'interval')),
  title text not null,
  icon text not null default 'paw',
  interval_days int check (interval_days > 0),
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  check (kind = 'daily' or interval_days is not null)
);
create index if not exists pet_care_tasks_pet_idx on public.pet_care_tasks (pet_id, sort_order);

create table if not exists public.pet_task_done (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.pet_care_tasks(id) on delete cascade,
  done_on date not null,
  done_by text not null default public.jwt_email(),
  created_at timestamptz not null default now(),
  unique (task_id, done_on)
);
create index if not exists pet_task_done_task_idx on public.pet_task_done (task_id, done_on desc);

create table if not exists public.pet_weights (
  id uuid primary key default gen_random_uuid(),
  pet_id uuid not null references public.pets(id) on delete cascade,
  weight numeric(6, 2) not null check (weight > 0),
  measured_on date not null,
  added_by text not null default public.jwt_email(),
  created_at timestamptz not null default now()
);
create index if not exists pet_weights_pet_idx on public.pet_weights (pet_id, measured_on desc);

alter table public.pet_care_tasks enable row level security;
alter table public.pet_task_done enable row level security;
alter table public.pet_weights enable row level security;

drop policy if exists pet_care_tasks_rw on public.pet_care_tasks;
create policy pet_care_tasks_rw on public.pet_care_tasks
  for all using (exists (
    select 1 from public.pets p
    where p.id = pet_care_tasks.pet_id and p.household_id = public.current_household()
  ))
  with check (exists (
    select 1 from public.pets p
    where p.id = pet_care_tasks.pet_id and p.household_id = public.current_household()
  ));

drop policy if exists pet_task_done_rw on public.pet_task_done;
create policy pet_task_done_rw on public.pet_task_done
  for all using (exists (
    select 1 from public.pet_care_tasks tk
    join public.pets p on p.id = tk.pet_id
    where tk.id = pet_task_done.task_id and p.household_id = public.current_household()
  ))
  with check (exists (
    select 1 from public.pet_care_tasks tk
    join public.pets p on p.id = tk.pet_id
    where tk.id = pet_task_done.task_id and p.household_id = public.current_household()
  ));

drop policy if exists pet_weights_rw on public.pet_weights;
create policy pet_weights_rw on public.pet_weights
  for all using (exists (
    select 1 from public.pets p
    where p.id = pet_weights.pet_id and p.household_id = public.current_household()
  ))
  with check (exists (
    select 1 from public.pets p
    where p.id = pet_weights.pet_id and p.household_id = public.current_household()
  ));
