-- 058 — private budgets (One Roof Plus).
--
-- A budget is household-wide by default (exactly as today). A Plus member can
-- create a PRIVATE one: only its owner sees it, and the owner alone decides who
-- else can. People it's shared with can view it and add entries; only the owner
-- can rename/delete it or change the member list.
--
-- THE POINT TO NOT MISS: months and entries do not check the household directly —
-- they reach it THROUGH budgets (see migration 007), testing only household_id.
-- Hiding the budgets row alone would leave every period and entry of a private
-- budget readable by the whole household. All three policies are rewritten to go
-- through one visibility gate: public.can_see_budget().
--
-- The helpers are SECURITY DEFINER on purpose: a policy on budgets that queried
-- budgets/budget_members directly would re-enter RLS and recurse (same reason
-- current_household()/is_admin() are definer).
--
-- Additive: visibility defaults to 'household' and every existing row keeps it,
-- so the shipped App Store build — which selects budgets.* and inserts
-- {name, period} — is unaffected.

-- 1. columns --------------------------------------------------------------
alter table public.budgets
  add column if not exists visibility text not null default 'household'
    check (visibility in ('household', 'private'));

-- Stamped by the client-invisible default, like household_id elsewhere.
-- Nullable: rows that predate this migration have no owner, and they're all
-- 'household', where owner_email is never consulted.
alter table public.budgets
  add column if not exists owner_email text references public.allowed_users(email);

alter table public.budgets
  alter column owner_email set default public.jwt_email();

create index if not exists budgets_visibility_idx on public.budgets (household_id, visibility);

-- 2. the share list -------------------------------------------------------
create table if not exists public.budget_members (
  budget_id  uuid not null references public.budgets(id) on delete cascade,
  email      text not null references public.allowed_users(email) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (budget_id, email)
);
alter table public.budget_members enable row level security;

-- 3. visibility gate ------------------------------------------------------
-- Can the caller see this budget at all? Definer so callers from RLS policies
-- don't recurse back into budgets/budget_members.
create or replace function public.can_see_budget(p_budget uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1
    from public.budgets b
    where b.id = p_budget
      and b.household_id = public.current_household()
      and (
        b.visibility <> 'private'
        or b.owner_email = public.jwt_email()
        or exists (
          select 1 from public.budget_members m
          where m.budget_id = b.id and m.email = public.jwt_email()
        )
      )
  )
$$;

-- Used by budgets_select. It must NOT re-query budgets: a definer function that
-- selects from budgets runs on its own snapshot and cannot see the row being
-- inserted, so `INSERT ... RETURNING` — which PostgREST always emits — would fail
-- the SELECT check, for household budgets too. budget_members is a different
-- table, so looking it up here is safe (and still avoids recursion).
create or replace function public.is_budget_member(p_budget uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.budget_members m
    where m.budget_id = p_budget and m.email = public.jwt_email()
  )
$$;

create or replace function public.is_budget_owner(p_budget uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.budgets b
    where b.id = p_budget
      and b.household_id = public.current_household()
      and b.owner_email = public.jwt_email()
  )
$$;

-- entries hang off months; resolve to the parent budget in one definer hop
-- rather than nesting an RLS-checked subquery inside another policy.
create or replace function public.can_see_month(p_month uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select public.can_see_budget((select m.budget_id from public.months m where m.id = p_month))
$$;

grant execute on function public.can_see_budget(uuid) to authenticated;
grant execute on function public.is_budget_member(uuid) to authenticated;
grant execute on function public.is_budget_owner(uuid) to authenticated;
grant execute on function public.can_see_month(uuid) to authenticated;

-- 4. Plus gate ------------------------------------------------------------
-- A TRIGGER, not a policy check, and only on the transition INTO private.
-- If it were a blanket WITH CHECK, a lapsed subscription would stop the owner
-- editing a private budget they already have. A lapsed plan must never
-- un-private a budget or lock its owner out — the lever is CREATING one.
create or replace function public.budgets_plus_guard()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  -- No JWT = the service role (our own server code); not subject to the paywall.
  if public.jwt_email() is null then
    return new;
  end if;
  if new.visibility = 'private'
     and (tg_op = 'INSERT' or old.visibility is distinct from 'private')
     and not public.current_household_is_plus() then
    raise exception 'private budgets are a One Roof Plus feature' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists budgets_plus_guard on public.budgets;
create trigger budgets_plus_guard
  before insert or update on public.budgets
  for each row execute function public.budgets_plus_guard();

-- 5. policies -------------------------------------------------------------
-- budgets: see what's visible to me; only the owner may change a private one.
drop policy if exists budgets_rw on public.budgets;

-- Tests the row's OWN columns — see is_budget_member() above for why this must
-- not call can_see_budget().
drop policy if exists budgets_select on public.budgets;
create policy budgets_select on public.budgets
  for select using (
    household_id = public.current_household()
    and (
      visibility <> 'private'
      or owner_email = public.jwt_email()
      or public.is_budget_member(id)
    )
  );

drop policy if exists budgets_insert on public.budgets;
create policy budgets_insert on public.budgets
  for insert with check (
    household_id = public.current_household()
    and (visibility <> 'private' or owner_email = public.jwt_email())
  );

drop policy if exists budgets_update on public.budgets;
create policy budgets_update on public.budgets
  for update
  using (
    household_id = public.current_household()
    and (visibility <> 'private' or owner_email = public.jwt_email())
  )
  with check (
    household_id = public.current_household()
    and (visibility <> 'private' or owner_email = public.jwt_email())
  );

drop policy if exists budgets_delete on public.budgets;
create policy budgets_delete on public.budgets
  for delete using (
    household_id = public.current_household()
    and (visibility <> 'private' or owner_email = public.jwt_email())
  );

-- months + entries: inherit the budget's visibility (this is the actual fix).
drop policy if exists months_rw on public.months;
create policy months_rw on public.months
  for all
  using (public.can_see_budget(budget_id))
  with check (public.can_see_budget(budget_id));

drop policy if exists entries_rw on public.entries;
create policy entries_rw on public.entries
  for all
  using (public.can_see_month(month_id))
  with check (public.can_see_month(month_id));

-- budget_members: anyone who can see the budget can see WHO can see it
-- (the app shows the list to members read-only); only the owner may change it,
-- and only to people in the same household.
drop policy if exists budget_members_select on public.budget_members;
create policy budget_members_select on public.budget_members
  for select using (public.can_see_budget(budget_id));

drop policy if exists budget_members_insert on public.budget_members;
create policy budget_members_insert on public.budget_members
  for insert with check (
    public.is_budget_owner(budget_id)
    and exists (
      select 1 from public.allowed_users au
      where au.email = budget_members.email
        and au.household_id = public.current_household()
    )
  );

drop policy if exists budget_members_delete on public.budget_members;
create policy budget_members_delete on public.budget_members
  for delete using (public.is_budget_owner(budget_id));
