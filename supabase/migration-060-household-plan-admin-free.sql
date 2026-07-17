-- 060: expose the caller's household plan AS A PAIR — is it Plus, and has an
-- admin explicitly forced it to Free for testing (admin_set_plan wrote
-- plan='free', product='admin_test', migration 044)?
--
-- Why: the mobile client computes `isPlus = hasPlus(revenueCat) || serverPlus`,
-- ORing a live RevenueCat entitlement on top of the server plan so a just-
-- purchased user isn't briefly gated as Free while the webhook catches up. But
-- that OR makes the admin "preview the Free experience" toggle impossible to
-- turn OFF while the admin holds a real (e.g. sandbox) entitlement: the server
-- row goes 'free' yet hasPlus(revenueCat) stays true. This lets the client
-- suppress the RevenueCat OR ONLY when an admin deliberately forced Free.
--
-- current_household_is_plus() (migration 041) is unchanged — appleCalendar's
-- self-gating still uses it; this is an additive companion.
create or replace function public.current_household_plan()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'plus', public.household_is_plus(public.current_household()),
    'admin_free', exists (
      select 1 from public.household_subscriptions
      where household_id = public.current_household()
        and plan = 'free'
        and product = 'admin_test'
    )
  );
$$;
grant execute on function public.current_household_plan() to authenticated;
