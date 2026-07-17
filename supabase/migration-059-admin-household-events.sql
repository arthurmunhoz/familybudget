-- Migration 059: recent-activity feed for one household (Admin).
-- Powers the "Recent activity" section on the admin household detail page. It's
-- an INTERPRETED view of the existing behavioral analytics (web_events): the
-- client turns each row into a readable line (icon + actor + action + time), so
-- this function only needs to hand back the raw meaningful events for a single
-- household, newest first.
--
-- Only the action-carrying types are returned — clicks (the button label is the
-- closest thing we have to an "action"), session starts, and errors. page_view
-- rows are dropped here (they're navigation noise, and app usage already has its
-- own aggregate). Admin-account events are excluded so an admin's own visits to
-- a household don't pollute its feed, matching admin_recent_errors / _app_usage.

create or replace function public.admin_household_events(p_household uuid, lim int default 40)
returns table (id bigint, user_email text, type text, path text, target text, created_at timestamptz)
language sql stable security definer
set search_path = public
as $$
  select w.id, w.user_email, w.type, w.path, w.target, w.created_at
  from web_events w
  where public.is_admin()
    and w.household_id = p_household
    and w.type in ('click', 'session_start', 'error')
    and not exists (
      select 1 from allowed_users au
      where au.email = w.user_email and au.is_admin
    )
  order by w.created_at desc
  limit lim;
$$;
