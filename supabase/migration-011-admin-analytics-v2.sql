-- Migration 011: admin analytics v2 (applied via Supabase MCP on 2026-06-12).
-- Period parameter on all aggregates, admin accounts excluded from usage/time,
-- time-spent estimation (5-min idle cap), household last-access for sorting.

drop function if exists public.admin_user_activity();
drop function if exists public.admin_app_usage(int);

-- Per-user: last access ever + event count within the period (all users,
-- including admins — used on the member rows in the Households tab).
create or replace function public.admin_user_activity(days int default 30)
returns table (user_email text, last_seen timestamptz, events bigint)
language sql stable security definer
set search_path = public
as $$
  select w.user_email, max(w.created_at),
         count(*) filter (where w.created_at > now() - make_interval(days => days))
  from web_events w
  where public.is_admin()
  group by w.user_email;
$$;

-- Page views per app root within the period. Admin accounts excluded so
-- the owner's dev/testing doesn't skew real usage.
create or replace function public.admin_app_usage(days int default 30)
returns table (root text, views bigint)
language sql stable security definer
set search_path = public
as $$
  select split_part(coalesce(w.path, '/'), '/', 2) as root, count(*)::bigint
  from web_events w
  where public.is_admin()
    and w.type = 'page_view'
    and w.created_at > now() - make_interval(days => days)
    and not exists (
      select 1 from allowed_users au
      where au.email = w.user_email and au.is_admin
    )
  group by 1
  order by 2 desc;
$$;

-- Estimated seconds spent per app root: the gap between consecutive events
-- in a session is attributed to the app the user was on, capped at 5 minutes
-- so idle/abandoned screens don't count as hours. Admins excluded.
create or replace function public.admin_app_time(days int default 30)
returns table (root text, seconds bigint)
language sql stable security definer
set search_path = public
as $$
  with ev as (
    select split_part(coalesce(w.path, '/'), '/', 2) as root,
           w.created_at,
           lead(w.created_at) over (
             partition by w.session_id order by w.created_at
           ) as next_at
    from web_events w
    where public.is_admin()
      and w.created_at > now() - make_interval(days => days)
      and not exists (
        select 1 from allowed_users au
        where au.email = w.user_email and au.is_admin
      )
  )
  select root,
         sum(least(extract(epoch from (next_at - created_at)), 300))::bigint
  from ev
  where next_at is not null
  group by root
  order by 2 desc;
$$;

-- Last activity per household (any member), for sorting households.
create or replace function public.admin_household_activity()
returns table (household_id uuid, last_seen timestamptz)
language sql stable security definer
set search_path = public
as $$
  select w.household_id, max(w.created_at)
  from web_events w
  where public.is_admin()
  group by w.household_id;
$$;
