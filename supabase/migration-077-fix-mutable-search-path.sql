-- 077: pin search_path on the three remaining functions that lacked it.
--
-- A function with no `set search_path` resolves unqualified names against the
-- CALLER's search_path. For the two trigger functions that caller is whoever
-- runs the INSERT/UPDATE, so a session that prepends a schema it controls can
-- change what the trigger body resolves to. Every other function in this
-- codebase already pins it (see 073); these three were simply missed.
--
-- Bodies are unchanged — this is purely the SET clause. All three stay
-- SECURITY INVOKER, and free_watch_minutes stays IMMUTABLE, so behavior and
-- results are identical.

create or replace function public.touch_member_location()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at = now();
  return new;
end $$;

create or replace function public.touch_live_request()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at = now();
  return new;
end $$;

create or replace function public.free_watch_minutes()
returns integer language sql immutable set search_path = public as $$ select 30 $$;
