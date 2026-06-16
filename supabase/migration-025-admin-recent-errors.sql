-- Migration 024: recent-errors aggregate that excludes testing noise.
-- The admin "Recent errors" panel previously read web_events directly, showing
-- errors from admin accounts and the internal/dev household. Move it behind a
-- security-definer function that applies the same exclusions as the usage
-- analytics, so admins only see errors from real users.

create or replace function public.admin_recent_errors(lim int default 10)
returns table (id bigint, user_email text, target text, path text, created_at timestamptz)
language sql stable security definer
set search_path = public
as $$
  select w.id, w.user_email, w.target, w.path, w.created_at
  from web_events w
  where public.is_admin()
    and w.type = 'error'
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
