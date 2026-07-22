-- 083-ai-light-metering.sql — abuse ceiling for the cheap AI endpoints.
-- api/suggest-ping.ts and api/suggest-stores.ts call Claude Haiku for ANY valid
-- JWT with no accounting at all, while the scanners gate on ai_scan_allowed.
-- These are NOT product quotas: the scanners' free_monthly_cap (3) must never
-- apply here, so this is a separate per-household PER-DAY ceiling set high
-- enough that real usage never reaches it. Spend still lands in ai_daily_spend
-- so the global kill-switch sees the true daily cost.
create table if not exists public.ai_light_usage (
  household_id uuid not null,
  day          date not null default (now() at time zone 'utc')::date,
  kind         text not null,
  count        int not null default 0,
  est_cost_usd numeric(10,4) not null default 0,
  updated_at   timestamptz not null default now(),
  primary key (household_id, day, kind)
);

alter table public.ai_light_usage enable row level security;
-- No policies: server-only (service role bypasses RLS). Clients see nothing.
revoke all on table public.ai_light_usage from anon, authenticated;

-- Pre-flight: global kill-switch + global daily spend cap + a generous
-- per-household/per-day count ceiling for this endpoint kind.
create or replace function public.ai_light_allowed(p_household uuid, p_kind text, p_cap int)
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
  select coalesce(count, 0) into used
    from public.ai_light_usage
    where household_id = p_household
      and day = (now() at time zone 'utc')::date
      and kind = p_kind;
  if coalesce(used, 0) >= greatest(coalesce(p_cap, 200), 1) then
    return jsonb_build_object('allowed', false, 'reason', 'rate_limit',
                              'used', used, 'cap', p_cap);
  end if;
  return jsonb_build_object('allowed', true, 'used', coalesce(used, 0), 'cap', p_cap);
end $$;

-- Record one successful call. Cost is clamped so one call can never move the
-- global accumulator much.
create or replace function public.ai_light_record(p_household uuid, p_kind text, p_cost numeric)
returns void language plpgsql security definer set search_path = public as $$
declare c numeric := least(greatest(coalesce(p_cost, 0), 0), 0.05);
begin
  if p_household is null then return; end if;
  insert into public.ai_light_usage (household_id, day, kind, count, est_cost_usd, updated_at)
  values (p_household, (now() at time zone 'utc')::date, p_kind, 1, c, now())
  on conflict (household_id, day, kind) do update
    set count        = ai_light_usage.count + 1,
        est_cost_usd = ai_light_usage.est_cost_usd + c,
        updated_at   = now();
  insert into public.ai_daily_spend (day, est_cost_usd)
  values ((now() at time zone 'utc')::date, c)
  on conflict (day) do update
    set est_cost_usd = ai_daily_spend.est_cost_usd + c;
end $$;

-- Server-only, exactly like ai_scan_allowed / ai_scan_record.
revoke all on function public.ai_light_allowed(uuid, text, int)      from public, anon, authenticated;
revoke all on function public.ai_light_record(uuid, text, numeric)   from public, anon, authenticated;
grant execute on function public.ai_light_allowed(uuid, text, int)    to service_role;
grant execute on function public.ai_light_record(uuid, text, numeric) to service_role;
