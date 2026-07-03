-- 041: One Roof Plus entitlement (per household) + AI-scan Plus bypass.
-- Entitlement is per HOUSEHOLD: RevenueCat uses household_id as the app_user_id,
-- so any member's purchase entitles the whole household. Written ONLY by the
-- RevenueCat webhook (service role); members may READ their household's plan for
-- gating UX but CANNOT change it (no member write policy, no write privilege).
create table if not exists public.household_subscriptions (
  household_id uuid primary key references public.households(id) on delete cascade,
  plan         text not null default 'free' check (plan in ('free', 'plus')),
  product      text,
  store        text,
  expires_at   timestamptz,   -- null = no expiry (e.g. lifetime); else the guard
  updated_at   timestamptz not null default now()
);
alter table public.household_subscriptions enable row level security;
revoke all on public.household_subscriptions from anon, authenticated;
grant select on public.household_subscriptions to authenticated;
drop policy if exists hs_member_select on public.household_subscriptions;
create policy hs_member_select on public.household_subscriptions
  for select using (household_id = public.current_household());
-- No insert/update/delete policy => clients can't write; the service role
-- (RevenueCat webhook) bypasses RLS.

-- Is a given household on an active Plus plan? expires_at is the real guard, so
-- a stale 'plus' row with a past expiry is correctly treated as not-plus.
create or replace function public.household_is_plus(p_household uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.household_subscriptions
    where household_id = p_household
      and plan = 'plus'
      and (expires_at is null or expires_at > now())
  );
$$;

-- Client-callable variant for the signed-in user's own household.
create or replace function public.current_household_is_plus()
returns boolean language sql stable security definer set search_path = public as $$
  select public.household_is_plus(public.current_household());
$$;
grant execute on function public.current_household_is_plus() to authenticated;

-- Plus households get unlimited scans. The global kill-switch (scanning disabled
-- / daily spend cap) still applies; only the per-household monthly free cap is
-- bypassed for Plus.
create or replace function public.ai_scan_allowed(p_household uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  cfg public.ai_config;
  used int;
  today_spend numeric;
begin
  if p_household is null then
    return jsonb_build_object('allowed', false, 'reason', 'no_household');
  end if;
  select * into cfg from public.ai_config where id;
  if not cfg.scanning_enabled then
    return jsonb_build_object('allowed', false, 'reason', 'disabled');
  end if;
  select coalesce(est_cost_usd, 0) into today_spend
    from public.ai_daily_spend where day = (now() at time zone 'utc')::date;
  if coalesce(today_spend, 0) >= cfg.daily_spend_cap_usd then
    return jsonb_build_object('allowed', false, 'reason', 'daily_cap');
  end if;
  -- Plus: unlimited scans (still subject to the global caps checked above).
  if public.household_is_plus(p_household) then
    return jsonb_build_object('allowed', true, 'plus', true);
  end if;
  select coalesce(sum(count), 0) into used
    from public.ai_usage
    where household_id = p_household and period = to_char(now() at time zone 'utc', 'YYYY-MM');
  if used >= cfg.free_monthly_cap then
    return jsonb_build_object('allowed', false, 'reason', 'monthly_cap',
                              'used', used, 'cap', cfg.free_monthly_cap);
  end if;
  return jsonb_build_object('allowed', true, 'used', used, 'cap', cfg.free_monthly_cap);
end $$;

-- LAUNCH LEVER: the free monthly scan cap is still 100 (effectively unlimited).
-- When the paywall is live and purchasable, lower it so Plus has real value:
--   update public.ai_config set free_monthly_cap = 15;
