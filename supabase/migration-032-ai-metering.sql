-- 032-ai-metering.sql — per-household AI scan metering + global spend kill-switch.
-- Backs the Haiku-first receipt/bill scanners (api/scan-receipt.ts, api/scan-bill.ts):
-- caps per-household monthly scans, tracks estimated spend, and gives a global kill-switch.
-- NOTE: the RPCs here are re-defined (parameterized + service-role-only) in
-- migration-033; see 033 for the final form. 034 finishes the EXECUTE revokes.

-- 1) Per-household monthly usage counter (one row per household × month × kind)
create table public.ai_usage (
  household_id uuid not null default public.current_household()
    references public.households(id) on delete cascade,
  period       text not null,                 -- 'YYYY-MM' in UTC
  kind         text not null,                 -- 'receipt' | 'bill'
  count        integer not null default 0,
  est_cost_usd numeric(12,4) not null default 0,
  updated_at   timestamptz not null default now(),
  primary key (household_id, period, kind)
);
alter table public.ai_usage enable row level security;
-- Members may READ their own household's usage (for an in-app meter). Writes only via the RPCs below.
create policy ai_usage_select on public.ai_usage
  for select using (household_id = public.current_household());

-- 2) Single-row global config: master switch, free monthly cap, daily $ ceiling
create table public.ai_config (
  id                  boolean primary key default true check (id),  -- enforces a single row
  scanning_enabled    boolean       not null default true,
  free_monthly_cap    integer       not null default 100,    -- per household; tighten to 10-20 at paywall
  daily_spend_cap_usd numeric(10,2) not null default 10.00
);
insert into public.ai_config (id) values (true) on conflict (id) do nothing;
alter table public.ai_config enable row level security;
create policy ai_config_admin on public.ai_config for select using (public.is_admin());

-- 3) Global daily spend accumulator (drives the kill-switch)
create table public.ai_daily_spend (
  day          date primary key,
  est_cost_usd numeric(12,4) not null default 0
);
alter table public.ai_daily_spend enable row level security;
create policy ai_daily_admin on public.ai_daily_spend for select using (public.is_admin());

-- 4) Pre-flight check (read-only): may the caller's household scan right now?
create or replace function public.ai_scan_allowed()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  hh uuid := public.current_household();
  cfg public.ai_config;
  used int;
  today_spend numeric;
begin
  if hh is null then
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
    where household_id = hh and period = to_char(now() at time zone 'utc', 'YYYY-MM');
  if used >= cfg.free_monthly_cap then
    return jsonb_build_object('allowed', false, 'reason', 'monthly_cap',
                              'used', used, 'cap', cfg.free_monthly_cap);
  end if;
  return jsonb_build_object('allowed', true, 'used', used, 'cap', cfg.free_monthly_cap);
end $$;

-- 5) Record a SUCCESSFUL scan (atomic upsert + daily accumulator)
create or replace function public.ai_scan_record(p_kind text, p_cost numeric)
returns void language plpgsql security definer set search_path = public as $$
declare hh uuid := public.current_household();
begin
  if hh is null then return; end if;
  insert into public.ai_usage (household_id, period, kind, count, est_cost_usd, updated_at)
  values (hh, to_char(now() at time zone 'utc', 'YYYY-MM'), p_kind, 1, coalesce(p_cost, 0), now())
  on conflict (household_id, period, kind) do update
    set count        = ai_usage.count + 1,
        est_cost_usd = ai_usage.est_cost_usd + coalesce(p_cost, 0),
        updated_at   = now();
  insert into public.ai_daily_spend (day, est_cost_usd)
  values ((now() at time zone 'utc')::date, coalesce(p_cost, 0))
  on conflict (day) do update
    set est_cost_usd = ai_daily_spend.est_cost_usd + coalesce(p_cost, 0);
end $$;

grant execute on function public.ai_scan_allowed()            to authenticated;
grant execute on function public.ai_scan_record(text, numeric) to authenticated;
