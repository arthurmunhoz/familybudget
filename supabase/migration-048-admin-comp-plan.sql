-- 048: Let an admin comp ANY household to One Roof Plus for free (and revoke).
--  • admin_set_household_plan(household, plan) writes household_subscriptions for
--    a TARGET household (that table is otherwise service-role-only). product is
--    'admin_comp' to distinguish a manual comp from a RevenueCat purchase or the
--    own-household admin_set_plan test toggle. No expiry (a permanent comp until
--    revoked).
--  • admin_household_is_plus(household) lets an admin read ANY household's current
--    entitlement — the base household_subscriptions RLS scopes reads to the
--    caller's own household, so admins need this security-definer read.
create or replace function public.admin_set_household_plan(p_household uuid, p_plan text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;
  if p_plan not in ('free', 'plus') then
    raise exception 'invalid plan';
  end if;
  if p_household is null then
    raise exception 'no household';
  end if;
  insert into public.household_subscriptions (household_id, plan, product, store, expires_at, updated_at)
  values (p_household, p_plan, 'admin_comp', 'admin', null, now())
  on conflict (household_id) do update
    set plan = excluded.plan, product = 'admin_comp', store = 'admin', expires_at = null, updated_at = now();
end $$;
grant execute on function public.admin_set_household_plan(uuid, text) to authenticated;

create or replace function public.admin_household_is_plus(p_household uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;
  return public.household_is_plus(p_household);
end $$;
grant execute on function public.admin_household_is_plus(uuid) to authenticated;
