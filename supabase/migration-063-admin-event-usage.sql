-- 063: per-event-type counts for the admin "Feature usage" view — so you can
-- see at a glance which actions are used and which aren't. Counts only the
-- semantic domain events (not behavioral page_view/screen_view/click/
-- session_start/error), over the last N days. Same exclusions as the other admin
-- analytics: admin accounts and internal/dev households are left out. The client
-- lists every KNOWN event type (SEMANTIC_EVENTS) and shows 0 for any missing
-- here, which is how "what's NOT used" surfaces.
create or replace function public.admin_event_usage(days int default 30)
returns table (type text, n bigint)
language sql stable security definer
set search_path = public
as $$
  select w.type, count(*)::bigint
  from web_events w
  where public.is_admin()
    and w.type not in ('page_view', 'screen_view', 'click', 'session_start', 'error')
    and w.created_at > now() - make_interval(days => days)
    and not exists (
      select 1 from allowed_users au
      where au.email = w.user_email and au.is_admin
    )
    and not exists (
      select 1 from households h
      where h.id = w.household_id and h.is_internal
    )
  group by w.type
  order by 2 desc;
$$;
