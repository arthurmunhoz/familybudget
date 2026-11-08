-- 089-assistant-free-quota.sql — the assistant is a One Roof Plus feature:
-- free households get a small monthly allowance PER MEMBER (5 requests per
-- person per calendar month, UTC); Plus households are unlimited. This is a
-- PRODUCT quota, separate from the per-household daily abuse ceiling in
-- ai_light_allowed (migration 083), which still applies to everyone.
-- Server-only: api/suggest-ping.ts (service role) checks before calling the
-- model and records after a successful parse. Clients see nothing.
create table if not exists public.assistant_usage (
  user_email text not null,
  month      date not null,          -- first day of the month (UTC)
  count      int  not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_email, month)
);

alter table public.assistant_usage enable row level security;
-- No policies: server-only (service role bypasses RLS).
revoke all on table public.assistant_usage from anon, authenticated;

-- May this member ask now? {allowed, plus, used, cap}. Plus = always allowed.
create or replace function public.assistant_quota(p_household uuid, p_email text, p_cap int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  used int;
  m date := date_trunc('month', now() at time zone 'utc')::date;
begin
  if p_household is null or p_email is null then
    return jsonb_build_object('allowed', false, 'reason', 'no_household');
  end if;
  if public.household_is_plus(p_household) then
    return jsonb_build_object('allowed', true, 'plus', true);
  end if;
  select coalesce(count, 0) into used
    from public.assistant_usage
    where user_email = lower(p_email) and month = m;
  used := coalesce(used, 0);
  return jsonb_build_object('allowed', used < greatest(coalesce(p_cap, 5), 0),
                            'plus', false, 'used', used, 'cap', p_cap);
end $$;

-- Count one answered request for this member (Plus too, for the numbers).
-- Returns the member's count this month after the increment.
create or replace function public.assistant_use(p_email text)
returns int language plpgsql security definer set search_path = public as $$
declare
  n int;
  m date := date_trunc('month', now() at time zone 'utc')::date;
begin
  insert into public.assistant_usage (user_email, month, count)
    values (lower(p_email), m, 1)
  on conflict (user_email, month)
    do update set count = public.assistant_usage.count + 1, updated_at = now()
  returning count into n;
  return n;
end $$;

revoke all on function public.assistant_quota(uuid, text, int) from public, anon, authenticated;
revoke all on function public.assistant_use(text)              from public, anon, authenticated;
grant execute on function public.assistant_quota(uuid, text, int) to service_role;
grant execute on function public.assistant_use(text)              to service_role;
