-- Migration 104: creating ANOTHER family is a One Roof Plus feature, and an
-- account belongs to at most 3 families (owner, 2026-11).
--
-- Rules:
--   · A first-time user (no account row) still creates their first family
--     freely and gets the signup trial (084) — onboarding is unchanged.
--   · Someone who already has a family may create another only while they
--     are the OWNER of their ACTIVE family and it has a PAID Plus plan. The
--     signup trial does not count: the trial is what new families get, so
--     counting it would let anyone chain families forever. A plain member of a
--     Plus family can't either: they'd be spending someone else's plan.
--   · The extra family RIDES ON that Plus (no trial, no subscription row of its
--     own): `households.plus_from` = the paying family, `plus_by` = the payer.
--     household_is_plus() follows the link while the paying family still has a
--     paid Plus AND the payer still owns both families. Cancel the plan and
--     every family it covers goes free together.
--   · While the link is live the payer can't hand the extra family to someone
--     else ('plus_owner'): they keep paying for it. Once the plan lapses a
--     hand-over is allowed and clears the link.
--   · Joining by code stays free (someone else invited you), but joining and
--     creating both stop at 3 memberships: 'household_limit'.
-- The client hides/explains this, but these checks are the real gate.

create or replace function public.household_has_paid_plus(p_household uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.household_subscriptions
    where household_id = p_household
      and plan = 'plus'
      and coalesce(product, '') <> 'trial'
      and (expires_at is null or expires_at > now())
  );
$$;
revoke all on function public.household_has_paid_plus(uuid) from public, anon, authenticated;

alter table public.households
  add column if not exists plus_from uuid references public.households(id) on delete set null,
  add column if not exists plus_by text;

-- The link is live: the paying family has a paid Plus and the payer owns both.
create or replace function public.household_plus_link_live(p_household uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.households h
    where h.id = p_household
      and h.plus_from is not null
      and h.plus_by is not null
      and public.household_has_paid_plus(h.plus_from)
      and exists (select 1 from public.household_members m
                   where m.household_id = h.plus_from and m.email = h.plus_by and m.role = 'owner')
      and exists (select 1 from public.household_members m
                   where m.household_id = h.id and m.email = h.plus_by and m.role = 'owner')
  );
$$;
revoke all on function public.household_plus_link_live(uuid) from public, anon, authenticated;

-- 041's check + the link. A family's OWN row wins when it has one (an admin
-- "force free" row, or a plan bought for it directly); the link is only read
-- for a family without a row.
create or replace function public.household_is_plus(p_household uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when exists (select 1 from public.household_subscriptions where household_id = p_household) then
      exists (
        select 1 from public.household_subscriptions
        where household_id = p_household
          and plan = 'plus'
          and (expires_at is null or expires_at > now())
      )
    else public.household_plus_link_live(p_household)
  end;
$$;

create or replace function public.max_households_per_account()
returns int language sql immutable as $$ select 3 $$;

-- create_household: 099's body + the Plus gate, the cap, and the Plus link
-- (no trial) for an extra family.
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
  v_first boolean;
  v_from  uuid;
begin
  if v_email is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if v_name is null then
    raise exception 'household name required' using errcode = '22023';
  end if;

  select display_name into v_dn from public.allowed_users where email = v_email;
  v_first := not found;

  if not v_first then
    if (select count(*) from public.household_members where email = v_email)
         >= public.max_households_per_account() then
      raise exception 'household_limit' using errcode = '54000';
    end if;
    v_from := public.current_household();
    if not public.household_has_paid_plus(v_from) then
      raise exception 'plus_required' using errcode = '42501';
    end if;
    if not exists (select 1 from public.household_members
                    where household_id = v_from and email = v_email and role = 'owner') then
      raise exception 'plus_owner_required' using errcode = '42501';
    end if;
  end if;

  insert into public.households (name, plus_from, plus_by)
    values (v_name, v_from, case when v_from is null then null else v_email end)
    returning id into v_hh; -- trigger mints the code

  if v_first then
    insert into public.allowed_users (email, display_name, household_id, is_admin, role)
      values (v_email, public.jwt_display_name(), v_hh, false, 'owner');
    insert into public.household_subscriptions
      (household_id, plan, product, store, expires_at, updated_at)
    values
      (v_hh, 'plus', 'trial', 'trial',
       now() + (public.plus_trial_days() || ' days')::interval, now())
    on conflict (household_id) do nothing;
  else
    insert into public.household_members (household_id, email, role, display_name)
      values (v_hh, v_email, 'owner', v_dn);
    perform public.activate_household_for(v_email, v_hh);
  end if;

  return v_hh;
end;
$$;
grant execute on function public.create_household(text) to authenticated;

-- join_household: 099's body + the 3-family cap.
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
  if (select count(*) from public.household_members where email = v_email)
       >= public.max_households_per_account() then
    raise exception 'household_limit' using errcode = '54000';
  end if;
  insert into public.household_members (household_id, email, role, display_name)
    values (v_hh, v_email, 'member', v_name);
  perform public.activate_household_for(v_email, v_hh);
  return v_hh;
end;
$$;
grant execute on function public.join_household(text) to authenticated;

-- leave_household: 099's body + the payer can't hand over a family they pay for.
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
    if exists (select 1 from households where id = p_household and plus_by = v_email)
       and public.household_plus_link_live(p_household) then
      raise exception 'plus_owner' using errcode = '42501';
    end if;
    if p_new_owner is null then
      raise exception 'last_owner' using errcode = '42501';
    end if;
    update household_members set role = 'owner'
     where household_id = p_household and email = p_new_owner and email <> v_email;
    if not found then
      raise exception 'new owner not in household' using errcode = 'P0002';
    end if;
    update households set plus_from = null, plus_by = null where id = p_household;
  end if;

  delete from household_members where household_id = p_household and email = v_email;
  if v_others = 0 then
    perform public.wipe_household(p_household);
  end if;
  return public.current_household();
end;
$$;
grant execute on function public.leave_household(uuid, text) to authenticated;
