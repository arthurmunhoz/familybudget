-- 118: Admin › Usage names the Utilities TOOL, not just "calc" (owner,
-- 2026-11-17: the row said "Calculator" and hid which tool was used). For a
-- path under /calc/<tool> both functions now return `calc/<tool>` as the root
-- ("calc/deal", "calc/frame"); every other app keeps its first segment. The
-- client maps those to "Utilities – Better deal" (mobile/src/lib/appRoutes.ts).
-- Signatures and exclusions unchanged.
create or replace function public.admin_app_usage(days int default 30)
returns table (root text, views bigint)
language sql stable security definer
set search_path = public
as $$
  select case
             when split_part(coalesce(w.path, '/'), '/', 2) = 'calc'
              and split_part(split_part(w.path, '?', 1), '/', 3) <> ''
             then 'calc/' || split_part(split_part(w.path, '?', 1), '/', 3)
             else split_part(coalesce(w.path, '/'), '/', 2)
           end as root, count(*)::bigint
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

create or replace function public.admin_app_time(days int default 30)
returns table (root text, seconds bigint)
language sql stable security definer
set search_path = public
as $$
  with ev as (
    select case
             when split_part(coalesce(w.path, '/'), '/', 2) = 'calc'
              and split_part(split_part(w.path, '?', 1), '/', 3) <> ''
             then 'calc/' || split_part(split_part(w.path, '?', 1), '/', 3)
             else split_part(coalesce(w.path, '/'), '/', 2)
           end as root,
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
