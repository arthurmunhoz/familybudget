-- Admin household feed shows screens visited too (2026-11-16): opening a
-- feature says someone was curious about it even without using it. The client
-- folds runs of screen_view into one "looked at A → B → C" line
-- (mobile/src/lib/activityFeed.ts), so the row limit goes up to leave room.
-- page_view (the old PWA) stays out. Signature unchanged.
create or replace function public.admin_household_events(p_household uuid, lim int default 40)
returns table (id bigint, user_email text, type text, path text, target text, meta jsonb, created_at timestamptz)
language sql stable security definer
set search_path = public
as $$
  select w.id, w.user_email, w.type, w.path, w.target, w.meta, w.created_at
  from web_events w
  where public.is_admin()
    and w.household_id = p_household
    and w.type <> 'page_view'
    and not exists (
      select 1 from allowed_users au
      where au.email = w.user_email and au.is_admin
    )
  order by w.created_at desc
  limit least(greatest(lim, 1), 400);
$$;
