-- 061: cross-household recent-activity feed for the Admin "Activity" tab. Same
-- interpretation as admin_household_events (migration 059) but across ALL
-- households, returning household_id so each row can show which family it's from.
-- Excludes admin accounts (an admin's own visits) and internal/dev households —
-- the same exclusions as admin_recent_errors / admin_app_usage, so the feed shows
-- only real end-user activity.
create or replace function public.admin_recent_events(lim int default 60)
returns table (id bigint, household_id uuid, user_email text, type text, path text, target text, created_at timestamptz)
language sql stable security definer
set search_path = public
as $$
  select w.id, w.household_id, w.user_email, w.type, w.path, w.target, w.created_at
  from web_events w
  where public.is_admin()
    and w.type in ('click', 'session_start', 'error')
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
