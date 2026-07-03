-- 044: admin-only toggle for a household's One Roof Plus plan, so the owner can
-- preview the Free experience. Writes household_subscriptions (which is
-- otherwise service-role-only) for the CALLER'S OWN household — guarded by
-- is_admin() so a regular member can't grant themselves Plus. Sets a permanent
-- comp (no expiry) when 'plus'; 'free' downgrades. Does NOT touch RevenueCat —
-- if the caller has a real store subscription that still entitles them.
create or replace function public.admin_set_plan(p_plan text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;
  if p_plan not in ('free', 'plus') then
    raise exception 'invalid plan';
  end if;
  insert into public.household_subscriptions (household_id, plan, product, store, expires_at, updated_at)
  values (public.current_household(), p_plan, 'admin_test', 'admin', null, now())
  on conflict (household_id) do update
    set plan = excluded.plan, product = 'admin_test', store = 'admin', expires_at = null, updated_at = now();
end $$;
grant execute on function public.admin_set_plan(text) to authenticated;
