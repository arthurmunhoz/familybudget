-- 084: 30-day One Roof Plus trial for every NEWLY CREATED household.
--
-- WHY a server-granted trial instead of a store free trial: a Google Play / App
-- Store free trial requires a payment method up front, which is exactly the
-- friction we're avoiding for a cold Play install. This grants Plus with no card
-- at all, then lapses back to Free on its own.
--
-- HOW it needs no new gating code: household_is_plus() (migration 041) already
-- treats `expires_at` as the real guard, so a row with plan='plus' and an expiry
-- 30 days out is indistinguishable from a paid plan until it lapses — every
-- existing gate (Google Calendar sync, Safety Radius, the 12-member cap, the
-- unlimited AI scans) opens and closes off it with zero changes.
--
-- `product = 'trial'` is the discriminator, following the convention already set
-- by 'admin_test' (044) and 'admin_comp' (048). The RevenueCat webhook upserts on
-- household_id, so a real purchase during the trial cleanly REPLACES this row —
-- no double-entitlement, no need to clear the trial first.
--
-- SCOPE NOTE: the trial is per HOUSEHOLD, not per platform. Households are
-- cross-platform (one Android member, three on iOS), so a platform-dependent
-- length would give one shared household two different answers. 30 days for every
-- new household is the coherent reading of "a month for Android users".
--
-- Deliberately NOT retroactive: existing households (including current paying iOS
-- users) are untouched. Only create_household() grants it.

-- Trial length in one place so it's a one-line change later.
create or replace function public.plus_trial_days()
returns int language sql immutable set search_path = public as $$ select 30 $$;

-- 1. create_household: unchanged behaviour, plus the trial grant ---------------
-- Body is copied from migration 051 with only the trial insert added, since
-- create_or_replace needs the whole function.
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
begin
  if v_email is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if v_name is null then
    raise exception 'household name required' using errcode = '22023';
  end if;
  if exists (select 1 from public.allowed_users where email = v_email) then
    raise exception 'already in a household' using errcode = '23505';
  end if;

  insert into public.households (name) values (v_name) returning id into v_hh; -- trigger mints the code
  insert into public.allowed_users (email, display_name, household_id, is_admin, role)
    values (v_email, public.jwt_display_name(), v_hh, false, 'owner');

  -- The trial. `on conflict do nothing` is defensive only (a household created
  -- one statement ago cannot already have a subscription row) — it guarantees
  -- this can never overwrite a plan, which is the one thing it must never do.
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

-- 2. current_household_plan: report the trial so the client can count down -----
-- Additive: 'plus' and 'admin_free' keep their exact meaning (migration 060), so
-- an older client that ignores the new keys behaves identically.
--   trial_ends_at — expiry of an ACTIVE trial, else null
--   trial_expired — this household HAD a trial and it has now lapsed, and no
--                   purchase replaced it. Drives the "your trial ended" upsell,
--                   which must not show to someone who never had a trial.
create or replace function public.current_household_plan()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'plus', public.household_is_plus(public.current_household()),
    'admin_free', exists (
      select 1 from public.household_subscriptions
      where household_id = public.current_household()
        and plan = 'free'
        and product = 'admin_test'
    ),
    'trial_ends_at', (
      select expires_at from public.household_subscriptions
      where household_id = public.current_household()
        and product = 'trial'
        and expires_at is not null
        and expires_at > now()
    ),
    'trial_expired', exists (
      select 1 from public.household_subscriptions
      where household_id = public.current_household()
        and product = 'trial'
        and expires_at is not null
        and expires_at <= now()
    )
  );
$$;
grant execute on function public.current_household_plan() to authenticated;

-- 3. Test helper: give an EXISTING household a fresh trial (admin only) --------
-- Needed because the trial is only granted at creation: without this, testing the
-- countdown or the lapse on a real device means creating a throwaway household
-- every time. Admin-guarded and it refuses to touch a real purchase — the whole
-- point is that it can't be used to resurrect a lapsed paid plan.
create or replace function public.admin_start_trial(p_household uuid, p_days int default null)
returns timestamptz language plpgsql security definer set search_path = public as $$
declare
  v_expires timestamptz;
  v_product text;
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;
  if p_household is null then
    raise exception 'no household';
  end if;

  select product into v_product from public.household_subscriptions
    where household_id = p_household;
  -- Only ever overwrite nothing, a previous trial, or an admin toggle.
  if v_product is not null and v_product not in ('trial', 'admin_test', 'admin_comp') then
    raise exception 'household has a real purchase; refusing to overwrite';
  end if;

  v_expires := now() + (coalesce(p_days, public.plus_trial_days()) || ' days')::interval;
  insert into public.household_subscriptions
    (household_id, plan, product, store, expires_at, updated_at)
  values (p_household, 'plus', 'trial', 'trial', v_expires, now())
  on conflict (household_id) do update
    set plan = 'plus', product = 'trial', store = 'trial',
        expires_at = v_expires, updated_at = now();
  return v_expires;
end $$;
grant execute on function public.admin_start_trial(uuid, int) to authenticated;
