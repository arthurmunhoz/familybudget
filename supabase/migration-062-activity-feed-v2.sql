-- 062: activity feed v2 — semantic events.
--  (1) The feed now surfaces typed domain events (entry.created, nudge.sent, …)
--      alongside legacy clicks, so it shows PRECISELY what a user did. Filter to
--      everything EXCEPT the high-volume behavioral rows (page_view/screen_view),
--      and return `meta` so the client renders the line from the event payload.
--      (Return signature changes, so drop+recreate rather than replace.)
--  (2) App-usage analytics counts native screen_view alongside web page_view.
--  (3) Partial index keeps the feed queries fast as page_view/screen_view grow.

drop function if exists public.admin_household_events(uuid, int);
create function public.admin_household_events(p_household uuid, lim int default 40)
returns table (id bigint, user_email text, type text, path text, target text, meta jsonb, created_at timestamptz)
language sql stable security definer
set search_path = public
as $$
  select w.id, w.user_email, w.type, w.path, w.target, w.meta, w.created_at
  from web_events w
  where public.is_admin()
    and w.household_id = p_household
    and w.type not in ('page_view', 'screen_view')
    and not exists (
      select 1 from allowed_users au
      where au.email = w.user_email and au.is_admin
    )
  order by w.created_at desc
  limit lim;
$$;

drop function if exists public.admin_recent_events(int);
create function public.admin_recent_events(lim int default 60)
returns table (id bigint, household_id uuid, user_email text, type text, path text, target text, meta jsonb, created_at timestamptz)
language sql stable security definer
set search_path = public
as $$
  select w.id, w.household_id, w.user_email, w.type, w.path, w.target, w.meta, w.created_at
  from web_events w
  where public.is_admin()
    and w.type not in ('page_view', 'screen_view')
    and not exists (
      select 1 from allowed_users au
      where au.email = w.user_email and au.is_admin
    )
    and not exists (
      select 1 from households h
      where h.id = w.household_id and h.is_internal
    )
  order by w.created_at desc
  limit lim;
$$;

-- App usage now counts native screen_view alongside the PWA's page_view, so iOS
-- shows up in the analytics "App usage" tab.
create or replace function public.admin_app_usage(days int default 30)
returns table (root text, views bigint)
language sql stable security definer
set search_path = public
as $$
  select split_part(coalesce(w.path, '/'), '/', 2) as root, count(*)::bigint
  from web_events w
  where public.is_admin()
    and w.type in ('page_view', 'screen_view')
    and w.created_at > now() - make_interval(days => days)
    and not exists (
      select 1 from allowed_users au
      where au.email = w.user_email and au.is_admin
    )
    and not exists (
      select 1 from households h
      where h.id = w.household_id and h.is_internal
    )
  group by 1
  order by 2 desc;
$$;

-- The activity feed only ever scans the non-behavioral rows; a partial index on
-- those keeps it fast even as page_view/screen_view volume grows.
create index if not exists web_events_activity_idx
  on web_events (created_at desc)
  where type not in ('page_view', 'screen_view');
