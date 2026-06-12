-- Migration 009: behavioral analytics (applied via Supabase MCP on 2026-06-12).
-- web_events stores page views, clicks, and session starts for every signed-in
-- user. Members can only insert their own events; only admins can read. The
-- Admin page consumes the two aggregate functions below.

create table if not exists web_events (
  id bigint generated always as identity primary key,
  user_email text not null,
  household_id uuid not null default public.current_household(),
  session_id text not null,
  type text not null,            -- 'session_start' | 'page_view' | 'click' | ...
  path text,                     -- route when the event happened
  target text,                   -- e.g. clicked button label
  meta jsonb,
  created_at timestamptz not null default now()
);

create index if not exists web_events_user_time_idx on web_events (user_email, created_at desc);
create index if not exists web_events_type_time_idx on web_events (type, created_at desc);

alter table web_events enable row level security;

drop policy if exists web_events_insert_own on web_events;
create policy web_events_insert_own on web_events
  for insert with check (
    user_email = (auth.jwt() ->> 'email')
    and household_id = public.current_household()
  );

drop policy if exists web_events_admin_select on web_events;
create policy web_events_admin_select on web_events
  for select using (public.is_admin());

-- Per-user activity for the Admin page: last access + 7-day event count.
create or replace function public.admin_user_activity()
returns table (user_email text, last_seen timestamptz, events_7d bigint)
language sql stable security definer
set search_path = public
as $$
  select w.user_email, max(w.created_at),
         count(*) filter (where w.created_at > now() - interval '7 days')
  from web_events w
  where public.is_admin()
  group by w.user_email;
$$;

-- Page views per app over the last N days (path root: 'budget', 'shopping'…).
create or replace function public.admin_app_usage(days int default 7)
returns table (root text, views bigint)
language sql stable security definer
set search_path = public
as $$
  select split_part(coalesce(w.path, '/'), '/', 2) as root, count(*)::bigint
  from web_events w
  where public.is_admin()
    and w.type = 'page_view'
    and w.created_at > now() - make_interval(days => days)
  group by 1
  order by 2 desc;
$$;
