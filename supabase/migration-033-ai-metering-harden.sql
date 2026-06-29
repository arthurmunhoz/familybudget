-- 033-ai-metering-harden.sql — make AI metering tamper-proof.
-- The scanners (api/scan-receipt.ts, api/scan-bill.ts) resolve the caller's
-- household server-side (email -> allowed_users) and call these RPCs with the
-- SERVICE ROLE. Recording must NOT be client-callable: otherwise a signed-in
-- user could POST to ai_scan_record and inflate global daily spend to trip the
-- kill-switch for everyone. Re-create both RPCs to take an explicit household
-- and grant EXECUTE to service_role only. (034 finishes revoking anon/auth,
-- which Supabase default privileges grant explicitly on new public functions.)

drop function if exists public.ai_scan_allowed();
drop function if exists public.ai_scan_record(text, numeric);

-- Pre-flight check for an explicit household (called by the server with service role)
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
  select coalesce(sum(count), 0) into used
    from public.ai_usage
    where household_id = p_household and period = to_char(now() at time zone 'utc', 'YYYY-MM');
  if used >= cfg.free_monthly_cap then
    return jsonb_build_object('allowed', false, 'reason', 'monthly_cap',
                              'used', used, 'cap', cfg.free_monthly_cap);
  end if;
  return jsonb_build_object('allowed', true, 'used', used, 'cap', cfg.free_monthly_cap);
end $$;

-- Record a successful scan for an explicit household. Cost is clamped so a single
-- call can never add an absurd amount to the global daily accumulator.
create or replace function public.ai_scan_record(p_household uuid, p_kind text, p_cost numeric)
returns void language plpgsql security definer set search_path = public as $$
declare c numeric := least(greatest(coalesce(p_cost, 0), 0), 0.50);
begin
  if p_household is null then return; end if;
  insert into public.ai_usage (household_id, period, kind, count, est_cost_usd, updated_at)
  values (p_household, to_char(now() at time zone 'utc', 'YYYY-MM'), p_kind, 1, c, now())
  on conflict (household_id, period, kind) do update
    set count        = ai_usage.count + 1,
        est_cost_usd = ai_usage.est_cost_usd + c,
        updated_at   = now();
  insert into public.ai_daily_spend (day, est_cost_usd)
  values ((now() at time zone 'utc')::date, c)
  on conflict (day) do update
    set est_cost_usd = ai_daily_spend.est_cost_usd + c;
end $$;

-- Server-only: revoke from public/anon/authenticated, grant to service_role.
revoke all on function public.ai_scan_allowed(uuid)               from public;
revoke all on function public.ai_scan_record(uuid, text, numeric)  from public;
grant execute on function public.ai_scan_allowed(uuid)              to service_role;
grant execute on function public.ai_scan_record(uuid, text, numeric) to service_role;
