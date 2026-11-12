-- Migration 099: one account, several households ("Participar de mais de uma
-- família"). A person can belong to the family with their spouse and kids AND
-- to the one with their parents, and switches which one is ACTIVE.
--
-- The model:
--  * public.household_members (household_id, email, role, display_name,
--    joined_at) is the SOURCE OF TRUTH for who belongs where. Backfilled from
--    allowed_users (which had exactly one household per email).
--  * allowed_users stays ONE ROW PER PERSON — a dozen FKs point at its email,
--    and every shipped client + api/ function reads it. Its household_id/role
--    now mean "the ACTIVE household and my role in it". That column IS the
--    active-household pointer (rather than a new user_settings column): every
--    legacy reader that asks "which household is this user in?" keeps getting
--    the active one with no change, and only definer RPCs/admin can write it.
--  * public.current_household() returns the active household when the user is
--    still a member of it, else their first membership, else null. Every RLS
--    policy goes through it, so switching = one UPDATE of allowed_users.
--  * Push tokens / web-push subscriptions / the widget token are re-stamped with
--    the active household on every switch, so an api/ build that predates this
--    migration still pushes the ACTIVE household. The 099-aware api/ functions
--    resolve recipients by email through household_members instead, so a member
--    of several households gets every household's pushes.
--
-- Never write household_members from a client: the RPCs below do it
-- (my_households, set_active_household, join_household, create_household,
-- leave_household, remove_member). Admin RLS (is_admin) is unchanged.
--
-- Known limits (documented in CLAUDE.md):
--  * the active household is per ACCOUNT, not per device — switching on the phone
--    also switches a tablet signed into the same account (on its next profile load);
--  * member_profiles stays one row per person; it's readable by every household
--    the person belongs to, but an avatar stored under another household's
--    storage folder can't be signed from this one (storage policy is per prefix);
--  * Whereabouts sharing (member_locations) stays with the household where it
--    was turned on; leaving that household stops it.
--  * migration 092's hangman_send() checks recipients with allowed_users
--    .household_id, so a recipient whose ACTIVE household is another one is
--    refused there until that function is updated.

-- 1. Memberships ---------------------------------------------------------------
create table if not exists public.household_members (
  household_id uuid not null references public.households(id) on delete cascade,
  email        text not null references public.allowed_users(email) on delete cascade,
  role         text not null default 'member' check (role in ('owner', 'member')),
  display_name text,
  joined_at    timestamptz not null default now(),
  primary key (household_id, email)
);
create index if not exists household_members_email_idx
  on public.household_members (email, joined_at);

insert into public.household_members (household_id, email, role, display_name)
  select au.household_id, au.email, au.role, au.display_name
  from public.allowed_users au
  where au.household_id is not null
on conflict (household_id, email) do nothing;

alter table public.household_members enable row level security;

-- 2. current_household(): the active one if still a member, else the first ------
create or replace function public.current_household()
returns uuid
language sql stable security definer
set search_path = public
as $$
  select coalesce(
    (select au.household_id
       from allowed_users au
       join household_members m on m.email = au.email and m.household_id = au.household_id
      where au.email = (auth.jwt() ->> 'email')),
    (select m.household_id
       from household_members m
      where m.email = (auth.jwt() ->> 'email')
      order by m.joined_at, m.household_id
      limit 1)
  );
$$;

create or replace function public.is_member_of(p_household uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from household_members
     where household_id = p_household and email = (auth.jwt() ->> 'email')
  );
$$;
grant execute on function public.is_member_of(uuid) to authenticated;

-- Members see the roster of their ACTIVE household and their own memberships.
drop policy if exists household_members_select on public.household_members;
create policy household_members_select on public.household_members
  for select using (
    household_id = public.current_household()
    or email = (auth.jwt() ->> 'email')
    or public.is_admin()
  );
drop policy if exists household_members_admin_all on public.household_members;
create policy household_members_admin_all on public.household_members
  for all using (public.is_admin()) with check (public.is_admin());

-- 3. Member cap moves to memberships ---------------------------------------------
-- Same function name + message as 059 ('household_member_limit', detail = cap).
-- It used to sit on allowed_users "before insert or update of household_id",
-- which would now fire on every SWITCH. An existing membership is never counted
-- against itself (the sync trigger below upserts on every switch).
create or replace function public.enforce_household_member_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit int := case when public.household_is_plus(new.household_id) then 12 else 4 end;
begin
  if exists (select 1 from household_members
              where household_id = new.household_id and email = new.email) then
    return new;
  end if;
  if (select count(*) from household_members where household_id = new.household_id) >= v_limit then
    raise exception 'household_member_limit' using detail = v_limit::text;
  end if;
  return new;
end;
$$;

drop trigger if exists allowed_users_member_limit on public.allowed_users;
drop trigger if exists household_members_member_limit on public.household_members;
create trigger household_members_member_limit
  before insert on public.household_members
  for each row execute function public.enforce_household_member_limit();

-- 4. allowed_users → household_members sync -------------------------------------
-- Covers the admin panels (they insert/update allowed_users directly) and any
-- legacy path: whatever allowed_users says is the active household must be a
-- membership. A display-name change applies to every membership (one person,
-- one name).
create or replace function public.tg_allowed_users_sync_membership()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.household_id is not null then
    insert into household_members (household_id, email, role, display_name)
      values (new.household_id, new.email, new.role, new.display_name)
    on conflict (household_id, email) do update
      set role = excluded.role, display_name = excluded.display_name
      where household_members.role is distinct from excluded.role
         or household_members.display_name is distinct from excluded.display_name;
  end if;
  if tg_op = 'UPDATE' and new.display_name is distinct from old.display_name then
    update household_members set display_name = new.display_name
     where email = new.email and display_name is distinct from new.display_name;
  end if;
  return null;
end;
$$;

drop trigger if exists allowed_users_sync_membership on public.allowed_users;
create trigger allowed_users_sync_membership
  after insert or update of household_id, role, display_name on public.allowed_users
  for each row execute function public.tg_allowed_users_sync_membership();

-- A membership's role changed (ownership handover, admin_set_owner): mirror it
-- onto allowed_users when that household is the person's active one.
create or replace function public.tg_household_members_role_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update allowed_users set role = new.role
   where email = new.email and household_id = new.household_id and role is distinct from new.role;
  return null;
end;
$$;

drop trigger if exists household_members_role_sync on public.household_members;
create trigger household_members_role_sync
  after update of role on public.household_members
  for each row execute function public.tg_household_members_role_sync();

-- 5. Switching (internal) --------------------------------------------------------
-- Points allowed_users at the household and re-stamps the person's device
-- registrations (see header). Not callable by clients.
create or replace function public.activate_household_for(p_email text, p_household uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  select role into v_role from household_members
   where email = p_email and household_id = p_household;
  if v_role is null then
    raise exception 'not a member' using errcode = '42501';
  end if;
  update allowed_users set household_id = p_household, role = v_role
   where email = p_email
     and (household_id is distinct from p_household or role is distinct from v_role);
  update expo_push_tokens set household_id = p_household
   where user_email = p_email and household_id is distinct from p_household;
  update push_subscriptions set household_id = p_household
   where user_email = p_email and household_id is distinct from p_household;
  update widget_tokens set household_id = p_household
   where user_email = p_email and household_id is distinct from p_household;
end;
$$;
revoke all on function public.activate_household_for(text, uuid) from public;
revoke all on function public.activate_household_for(text, uuid) from anon, authenticated;

-- 6. Leaving a membership (any path: leave, remove_member, admin) ----------------
-- Personal rows tied to the household being left go with it; if it was the
-- active household the person moves to their next one, and with no household
-- left the account row goes (back to onboarding — exactly what remove_member
-- did before). During an account deletion the allowed_users row is already
-- gone (this runs from the FK cascade) and there is nothing to do.
create or replace function public.tg_household_members_after_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_active uuid;
  v_next   uuid;
begin
  select household_id into v_active from allowed_users where email = old.email;
  if not found then
    return null;
  end if;

  delete from member_locations
   where user_email = old.email and household_id = old.household_id;
  delete from safety_watches
   where owner_email = old.email and household_id = old.household_id;
  delete from place_watchers
   where user_email = old.email and household_id = old.household_id;
  delete from location_live_requests
   where (requester_email = old.email or target_email = old.email)
     and household_id = old.household_id;
  -- Its sync would keep writing Google events into a household they left.
  delete from google_calendar_connections
   where user_email = old.email and household_id = old.household_id;

  if v_active = old.household_id then
    select household_id into v_next from household_members
     where email = old.email
     order by joined_at, household_id
     limit 1;
    if v_next is null then
      delete from allowed_users where email = old.email;
      return null;
    end if;
    perform public.activate_household_for(old.email, v_next);
    v_active := v_next;
  end if;

  -- The person's profile (birthday, phone…) follows them to a household they
  -- are still in.
  update member_profiles set household_id = v_active
   where email = old.email and household_id = old.household_id;
  return null;
end;
$$;

drop trigger if exists household_members_after_delete on public.household_members;
create trigger household_members_after_delete
  after delete on public.household_members
  for each row execute function public.tg_household_members_after_delete();

-- 7. Wiping a household nobody belongs to any more (internal) --------------------
-- Every table that references households(id) WITHOUT a cascade (same list as
-- migration 086's delete_my_account); everything else cascades.
create or replace function public.wipe_household(p_household uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from household_members where household_id = p_household) then
    raise exception 'household still has members' using errcode = '42501';
  end if;
  delete from budgets                     where household_id = p_household;
  delete from calendar_deletions          where household_id = p_household;
  delete from calendar_events             where household_id = p_household;
  delete from category_rules              where household_id = p_household;
  delete from documents                   where household_id = p_household;
  delete from google_calendar_connections where household_id = p_household;
  delete from important_dates             where household_id = p_household;
  delete from member_profiles             where household_id = p_household;
  delete from pets                        where household_id = p_household;
  delete from shopping_items              where household_id = p_household;
  delete from shopping_stores             where household_id = p_household;
  delete from households where id = p_household;
end;
$$;
revoke all on function public.wipe_household(uuid) from public;
revoke all on function public.wipe_household(uuid) from anon, authenticated;

-- 8. Client RPCs ----------------------------------------------------------------
-- My households, the active one flagged. Names come from households (whose RLS
-- only shows the active one), hence definer.
create or replace function public.my_households()
returns table (
  household_id uuid,
  name         text,
  role         text,
  joined_at    timestamptz,
  member_count int,
  is_active    boolean
)
language sql stable security definer
set search_path = public
as $$
  select m.household_id, h.name, m.role, m.joined_at,
         (select count(*)::int from household_members x where x.household_id = m.household_id),
         m.household_id = public.current_household()
    from household_members m
    join households h on h.id = m.household_id
   where m.email = public.jwt_email()
   order by m.joined_at, h.name;
$$;
grant execute on function public.my_households() to authenticated;

create or replace function public.set_active_household(p_household uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := public.jwt_email();
begin
  if v_email is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if not exists (select 1 from household_members
                  where email = v_email and household_id = p_household) then
    raise exception 'not a member' using errcode = '42501';
  end if;
  perform public.activate_household_for(v_email, p_household);
  return p_household;
end;
$$;
grant execute on function public.set_active_household(uuid) to authenticated;

-- join_household: a first-time user gets their account row (as before); someone
-- who already has a household now ADDS a membership and switches to it.
create or replace function public.join_household(p_code text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_email text := public.jwt_email();
  v_code  text := upper(btrim(coalesce(p_code, '')));
  v_hh    uuid;
  v_name  text;
begin
  if v_email is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  -- Rate limit: max 10 attempts / 10 min per email (blunts code brute-forcing).
  insert into public.join_attempts (email) values (v_email);
  if (select count(*) from public.join_attempts
        where email = v_email and attempted_at > now() - interval '10 minutes') > 10 then
    raise exception 'too many attempts, try again later' using errcode = '54000';
  end if;

  select household_id into v_hh from public.household_join_codes where code = v_code;
  if v_hh is null then
    raise exception 'invalid code' using errcode = 'P0002';
  end if;

  select display_name into v_name from public.allowed_users where email = v_email;
  if not found then
    insert into public.allowed_users (email, display_name, household_id, is_admin, role)
      values (v_email, public.jwt_display_name(), v_hh, false, 'member'); -- sync trigger adds the membership
    return v_hh;
  end if;

  if exists (select 1 from public.household_members where household_id = v_hh and email = v_email) then
    raise exception 'already a member' using errcode = '23505';
  end if;
  insert into public.household_members (household_id, email, role, display_name)
    values (v_hh, v_email, 'member', v_name);
  perform public.activate_household_for(v_email, v_hh);
  return v_hh;
end;
$$;
grant execute on function public.join_household(text) to authenticated;

-- create_household: same as 084 (owner + Plus trial), and an existing user may
-- now create another one (it becomes active).
create or replace function public.create_household(p_name text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_email text := public.jwt_email();
  v_name  text := nullif(btrim(p_name), '');
  v_hh    uuid;
  v_dn    text;
begin
  if v_email is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if v_name is null then
    raise exception 'household name required' using errcode = '22023';
  end if;

  insert into public.households (name) values (v_name) returning id into v_hh; -- trigger mints the code

  select display_name into v_dn from public.allowed_users where email = v_email;
  if not found then
    insert into public.allowed_users (email, display_name, household_id, is_admin, role)
      values (v_email, public.jwt_display_name(), v_hh, false, 'owner');
  else
    insert into public.household_members (household_id, email, role, display_name)
      values (v_hh, v_email, 'owner', v_dn);
    perform public.activate_household_for(v_email, v_hh);
  end if;

  insert into public.household_subscriptions
    (household_id, plan, product, store, expires_at, updated_at)
  values
    (v_hh, 'plus', 'trial', 'trial',
     now() + (public.plus_trial_days() || ' days')::interval, now())
  on conflict (household_id) do nothing;

  return v_hh;
end;
$$;
grant execute on function public.create_household(text) to authenticated;

-- leave_household: mirrors the owner rules (one owner per household, owners
-- can't be removed). The only owner of a household that still has other
-- members must name who takes over (p_new_owner). Your ONLY household can't be
-- left — that's what account deletion is for. Leaving a household you are alone
-- in deletes it and its data (the app says so before calling).
create or replace function public.leave_household(p_household uuid, p_new_owner text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email  text := public.jwt_email();
  v_role   text;
  v_others int;
begin
  if v_email is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  select role into v_role from household_members
   where household_id = p_household and email = v_email;
  if v_role is null then
    raise exception 'not a member' using errcode = '42501';
  end if;
  if (select count(*) from household_members where email = v_email) <= 1 then
    raise exception 'last_household' using errcode = '22023';
  end if;

  select count(*) into v_others from household_members
   where household_id = p_household and email <> v_email;

  if v_role = 'owner' and v_others > 0
     and not exists (select 1 from household_members
                      where household_id = p_household and email <> v_email and role = 'owner') then
    if p_new_owner is null then
      raise exception 'last_owner' using errcode = '42501';
    end if;
    update household_members set role = 'owner'
     where household_id = p_household and email = p_new_owner and email <> v_email;
    if not found then
      raise exception 'new owner not in household' using errcode = 'P0002';
    end if;
  end if;

  delete from household_members where household_id = p_household and email = v_email;
  if v_others = 0 then
    perform public.wipe_household(p_household);
  end if;
  return public.current_household();
end;
$$;
grant execute on function public.leave_household(uuid, text) to authenticated;

-- 9. Owner RPCs read the ACTIVE household's membership ---------------------------
create or replace function public.get_join_code()
returns text
language sql
security definer
set search_path to 'public'
as $$
  select c.code
    from public.household_join_codes c
    join public.household_members m on m.household_id = c.household_id
   where c.household_id = public.current_household()
     and m.email = public.jwt_email() and m.role = 'owner';
$$;
grant execute on function public.get_join_code() to authenticated;

create or replace function public.rotate_join_code()
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_hh   uuid := public.current_household();
  v_code text;
begin
  if v_hh is null or not exists (select 1 from public.household_members
                                  where household_id = v_hh and email = public.jwt_email() and role = 'owner') then
    raise exception 'not a household owner' using errcode = '42501';
  end if;
  v_code := public.gen_join_code();
  update public.household_join_codes set code = v_code, updated_at = now() where household_id = v_hh;
  return v_code;
end;
$$;
grant execute on function public.rotate_join_code() to authenticated;

-- Removes the member from the owner's ACTIVE household only; their other
-- households are untouched (the delete trigger moves them / ends the account).
create or replace function public.remove_member(p_email text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_hh uuid := public.current_household();
begin
  if v_hh is null or not exists (select 1 from public.household_members
                                  where household_id = v_hh and email = public.jwt_email() and role = 'owner') then
    raise exception 'not a household owner' using errcode = '42501';
  end if;
  if p_email = public.jwt_email() then
    raise exception 'cannot remove yourself' using errcode = '22023';
  end if;
  delete from public.household_members
   where email = p_email and household_id = v_hh and role <> 'owner';
end;
$$;
grant execute on function public.remove_member(text) to authenticated;

-- 10. Admin RPCs on memberships ----------------------------------------------------
create or replace function public.admin_set_owner(p_household uuid, p_email text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not public.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.household_members where email = p_email and household_id = p_household
  ) then
    raise exception 'member not in household' using errcode = 'P0002';
  end if;
  update public.household_members
    set role = 'member'
    where household_id = p_household and role = 'owner' and email <> p_email;
  update public.household_members
    set role = 'owner'
    where household_id = p_household and email = p_email;
end;
$$;
grant execute on function public.admin_set_owner(uuid, text) to authenticated;

-- Same as 053, except people are removed by MEMBERSHIP first: the old
-- `delete from allowed_users where household_id = …` would delete the whole
-- account of anyone whose ACTIVE household this was, other households and all.
create or replace function public.admin_delete_household(p_household uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not public.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  delete from household_members where household_id = p_household;

  delete from entries where month_id in (
    select m.id from months m join budgets b on b.id = m.budget_id where b.household_id = p_household);
  delete from months where budget_id in (select id from budgets where household_id = p_household);
  delete from pet_events where pet_id in (select id from pets where household_id = p_household);
  delete from ping_acks where ping_id in (select id from pings where household_id = p_household);

  delete from shopping_items where household_id = p_household;
  delete from shopping_stores where household_id = p_household;

  delete from ai_usage where household_id = p_household;
  delete from budgets where household_id = p_household;
  delete from calendar_deletions where household_id = p_household;
  delete from calendar_events where household_id = p_household;
  delete from category_rules where household_id = p_household;
  delete from custom_categories where household_id = p_household;
  delete from documents where household_id = p_household;
  delete from expo_push_tokens where household_id = p_household;
  delete from google_calendar_connections where household_id = p_household;
  delete from household_subscriptions where household_id = p_household;
  delete from important_dates where household_id = p_household;
  delete from member_profiles where household_id = p_household;
  delete from pets where household_id = p_household;
  delete from ping_presets where household_id = p_household;
  delete from pings where household_id = p_household;
  delete from push_subscriptions where household_id = p_household;
  delete from web_events where household_id = p_household;
  delete from widget_tokens where household_id = p_household;
  delete from household_join_codes where household_id = p_household;

  delete from households where id = p_household;
end;
$$;
grant execute on function public.admin_delete_household(uuid) to authenticated;

-- 11. delete_my_account: every household the person was in ------------------------
-- Same personal deletes as 086; afterwards each household nobody belongs to any
-- more is wiped (086 only looked at the active one).
create or replace function public.delete_my_account()
returns void language plpgsql security definer set search_path = public as $$
declare
  uid    uuid := auth.uid();
  uemail text := auth.jwt() ->> 'email';
  v_hhs  uuid[];
  hh     uuid;
begin
  if uid is null then return; end if;
  v_hhs := array(select household_id from public.household_members where email = uemail);
  delete from public.member_profiles      where email = uemail;
  delete from public.push_subscriptions   where user_email = uemail;
  delete from public.expo_push_tokens     where user_email = uemail;
  delete from public.apple_refresh_tokens where user_email = uemail;
  delete from public.member_locations     where user_email = uemail;
  delete from public.place_events         where user_email = uemail;
  delete from public.location_live_requests
        where requester_email = uemail or target_email = uemail;
  delete from public.safety_watches       where owner_email = uemail;
  delete from public.budgets
        where owner_email = uemail and visibility = 'private';
  delete from public.allowed_users        where email = uemail; -- cascades the memberships
  foreach hh in array coalesce(v_hhs, '{}') loop
    if not exists (select 1 from public.household_members where household_id = hh) then
      perform public.wipe_household(hh);
    end if;
  end loop;
  delete from auth.users where id = uid;
end $$;
grant execute on function public.delete_my_account() to authenticated;

-- 12. Policies that asked allowed_users "same household?" ---------------------------
-- Co-members of the ACTIVE household can read each other's account row even
-- when that person's own active household is another one (names on Family,
-- Nudges, games).
drop policy if exists allowed_users_member_select on public.allowed_users;
create policy allowed_users_member_select on public.allowed_users
  for select using (
    household_id = public.current_household()
    or public.is_admin()
    or exists (select 1 from public.household_members m
                where m.email = allowed_users.email
                  and m.household_id = public.current_household())
  );

-- A profile (one per person) is visible to every household they belong to, and
-- they can keep editing it from any of them.
drop policy if exists member_profiles_select on public.member_profiles;
create policy member_profiles_select on public.member_profiles
  for select using (
    household_id = public.current_household()
    or exists (select 1 from public.household_members m
                where m.email = member_profiles.email
                  and m.household_id = public.current_household())
  );
drop policy if exists member_profiles_write on public.member_profiles;
create policy member_profiles_write on public.member_profiles
  for all
  using (email = (auth.jwt() ->> 'email'))
  with check (
    email = (auth.jwt() ->> 'email')
    and public.is_member_of(household_id)
  );

drop policy if exists budget_members_insert on public.budget_members;
create policy budget_members_insert on public.budget_members
  for insert with check (
    public.is_budget_owner(budget_id)
    and exists (
      select 1 from public.household_members m
      where m.email = budget_members.email
        and m.household_id = public.current_household()
    )
  );

-- 13. Device registrations follow the active household (no-op today: they were
-- stamped from current_household(), which was the only household) -----------------
update public.expo_push_tokens t set household_id = au.household_id
  from public.allowed_users au
 where au.email = t.user_email and t.household_id is distinct from au.household_id;
update public.push_subscriptions s set household_id = au.household_id
  from public.allowed_users au
 where au.email = s.user_email and s.household_id is distinct from au.household_id;
update public.widget_tokens w set household_id = au.household_id
  from public.allowed_users au
 where au.email = w.user_email and w.household_id is distinct from au.household_id;
