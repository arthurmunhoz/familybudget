-- Admin overview that stays fast as the user base grows (2026-11).
--
-- The Admin screen used to load every household, every member and every
-- household's last-seen (a GROUP BY over all of web_events) on each open.
-- This replaces that with three cheap reads:
--   • admin_overview(tz)            — today / last 7 days counts + a 7-day
--                                     series, scanning only the last 8 days of
--                                     events through a created_at index.
--   • admin_recent_visitors(lim, before) — who used the app most recently,
--                                     paged by keyset (before = the last row's
--                                     time), reading a denormalised
--                                     allowed_users.last_seen_at.
--   • last_seen_at                  — kept current by a trigger on web_events
--                                     (at most one write per member per minute).
-- Admin accounts and internal households are excluded everywhere, like the
-- other admin_* functions. Every function is guarded by is_admin().

create index if not exists web_events_time_idx on public.web_events (created_at desc);

alter table public.allowed_users add column if not exists last_seen_at timestamptz;
create index if not exists allowed_users_last_seen_idx on public.allowed_users (last_seen_at desc nulls last);

create or replace function public.touch_last_seen()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  update allowed_users
     set last_seen_at = new.created_at
   where email = new.user_email
     and (last_seen_at is null or last_seen_at < new.created_at - interval '1 minute');
  return new;
end;
$$;

drop trigger if exists web_events_touch_last_seen on public.web_events;
create trigger web_events_touch_last_seen
  after insert on public.web_events
  for each row execute function public.touch_last_seen();

-- Backfill from history once.
update public.allowed_users au
   set last_seen_at = x.m
  from (select user_email, max(created_at) as m from public.web_events group by user_email) x
 where x.user_email = au.email
   and (au.last_seen_at is null or au.last_seen_at < x.m);

-- Counts for the top of the Admin screen. "Access" = a session (one cold
-- start of the app). p_tz is the admin's IANA time zone, so "today" is the
-- admin's day.
create or replace function public.admin_overview(p_tz text default 'UTC')
returns jsonb
language sql stable security definer
set search_path = public
as $$
  with today as (
    select (now() at time zone p_tz)::date as t
  ),
  ev as (
    select w.user_email, w.session_id, (w.created_at at time zone p_tz)::date as d
      from web_events w
     where w.created_at > now() - interval '8 days'
       and not exists (select 1 from allowed_users au where au.email = w.user_email and au.is_admin)
       and not exists (select 1 from households h where h.id = w.household_id and h.is_internal)
  )
  select case when public.is_admin() then jsonb_build_object(
    'today_people',   (select count(distinct user_email) from ev, today where d = t),
    'today_sessions', (select count(distinct session_id) from ev, today where d = t),
    'week_people',    (select count(distinct user_email) from ev, today where d > t - 7),
    'week_sessions',  (select count(distinct session_id) from ev, today where d > t - 7),
    'daily', (
      select jsonb_agg(
               jsonb_build_object(
                 'day', g::date,
                 'people', (select count(distinct user_email) from ev where d = g::date),
                 'sessions', (select count(distinct session_id) from ev where d = g::date)
               ) order by g)
        from today, generate_series(t - 6, t, interval '1 day') g
    ),
    'households', (select count(*) from households where not is_internal),
    'people', (
      select count(*) from allowed_users au
        join households h on h.id = au.household_id
       where not h.is_internal and not au.is_admin
    ),
    'new_households_week', (
      select count(*) from households
       where not is_internal and created_at > now() - interval '7 days'
    )
  ) else null end;
$$;

-- The most recent people to use the app, newest first. Page with
-- before = the last row's last_seen_at.
create or replace function public.admin_recent_visitors(lim int default 15, before timestamptz default null)
returns table (email text, display_name text, household_id uuid, household_name text, last_seen_at timestamptz)
language sql stable security definer
set search_path = public
as $$
  select au.email, au.display_name, au.household_id, h.name, au.last_seen_at
    from allowed_users au
    join households h on h.id = au.household_id
   where public.is_admin()
     and au.last_seen_at is not null
     and not au.is_admin
     and not h.is_internal
     and (before is null or au.last_seen_at < before)
   order by au.last_seen_at desc
   limit least(greatest(lim, 1), 100);
$$;

-- Households for the Admin list: most recently active first, searchable by
-- household or member name/email, paged (offset is fine at admin scale —
-- this reads households + allowed_users only, never web_events).
create or replace function public.admin_households(lim int default 20, off int default 0, q text default null)
returns table (id uuid, name text, created_at timestamptz, members bigint, last_seen_at timestamptz)
language sql stable security definer
set search_path = public
as $$
  select h.id, h.name, h.created_at,
         count(au.email) as members,
         max(au.last_seen_at) as last_seen_at
    from households h
    left join allowed_users au on au.household_id = h.id and not au.is_admin
   where public.is_admin()
     and not h.is_internal
     and (
       q is null or q = ''
       or h.name ilike '%' || q || '%'
       or exists (
         select 1 from allowed_users m
          where m.household_id = h.id
            and (m.display_name ilike '%' || q || '%' or m.email ilike '%' || q || '%')
       )
     )
   group by h.id
   order by max(au.last_seen_at) desc nulls last, h.created_at desc
   limit least(greatest(lim, 1), 100) offset greatest(off, 0);
$$;
