-- 117: how Roof (the assistant) is used — counts for Admin › Usage.
--
-- Both apps now log one `roof.asked` row in web_events per request (phone:
-- AskSheet; Modo Casa: src/casa/Roof.tsx). meta carries ONLY shape, never
-- what was said: intent (what Roof understood — "add_items", or "reply" /
-- "clock" / "capabilities" for things settled on the device), via
-- ("voice" | "typed"), where ("phone" | "casa"), ok (false = not understood
-- or failed) and chained (the second task of one request).
--
-- One row per intent · via · where, plus a TOTAL row (intent null) whose
-- `people` is the distinct members overall. Same exclusions as the other
-- admin analytics: admin accounts and internal households are left out.
create or replace function public.admin_roof_usage(days int default 30)
returns table (intent text, via text, place text, n bigint, people bigint, failed bigint)
language sql stable security definer
set search_path = public
as $$
  select
    w.meta->>'intent',
    w.meta->>'via',
    w.meta->>'where',
    count(*)::bigint,
    count(distinct w.user_email)::bigint,
    (count(*) filter (where w.meta->>'ok' = 'false'))::bigint
  from web_events w
  where public.is_admin()
    and w.type = 'roof.asked'
    and w.created_at > now() - make_interval(days => days)
    and not exists (
      select 1 from allowed_users au
      where au.email = w.user_email and au.is_admin
    )
    and not exists (
      select 1 from households h
      where h.id = w.household_id and h.is_internal
    )
  group by grouping sets ((w.meta->>'intent', w.meta->>'via', w.meta->>'where'), ())
  order by 4 desc;
$$;

revoke all on function public.admin_roof_usage(int) from public, anon;
grant execute on function public.admin_roof_usage(int) to authenticated;
