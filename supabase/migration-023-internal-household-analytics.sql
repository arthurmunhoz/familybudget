-- Migration 023: exclude internal/dev households from usage analytics.
-- The seeded "Preview Family" household (used for local previews) was skewing
-- the admin App-usage / time numbers. Add an `is_internal` flag on households
-- and exclude flagged households from admin_app_usage / admin_app_time — the
-- same treatment admin accounts already get.

alter table households add column if not exists is_internal boolean not null default false;

update households set is_internal = true where name = 'Preview Family';

-- Page views per app root within the period. Admin accounts AND internal
-- households excluded so the owner's dev/testing doesn't skew real usage.
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
    and not exists (
      select 1 from households h
      where h.id = w.household_id and h.is_internal
    )
  group by 1
  order by 2 desc;
$$;

-- Estimated seconds spent per app root. Admins AND internal households excluded.
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
      and not exists (
        select 1 from households h
        where h.id = w.household_id and h.is_internal
      )
  )
  select root,
         sum(least(extract(epoch from (next_at - created_at)), 300))::bigint
  from ev
  where next_at is not null
  group by root
  order by 2 desc;
$$;
