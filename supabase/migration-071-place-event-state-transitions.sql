-- Whereabouts: a place crossing is only recorded when it CHANGES state.
--
-- The bug: standing inside a place produced a fresh "arrived" push over and
-- over. Two causes, both fixed here at the data layer so no client can get it
-- wrong:
--
--  1. The old guard suppressed a repeat only if an identical event existed in
--     the last 5 MINUTES. But expo-location keeps its region state in memory and
--     re-seeds it to Unknown on every startGeofencingAsync, then calls
--     requestStateForRegion — so each app open re-emits Enter for every place
--     you're standing in. Any open more than 5 minutes after the last one
--     recorded another "arrive". Production had 13 consecutive arrives at Home
--     and not one leave.
--  2. Two arrives landed 77ms apart, so the 5-minute check itself lost a race:
--     both callers ran the SELECT before either INSERT committed.
--
-- The rule now: compare against the LAST event for this person+place and drop
-- anything that isn't a transition. Time doesn't enter into it, so a repeat is
-- suppressed forever rather than for five minutes, and the advisory lock makes
-- the check-then-insert atomic.
--
-- Runs as SECURITY INVOKER on purpose: RLS still decides what the caller may
-- read and insert, exactly as a direct insert did.

create index if not exists place_events_member_idx
  on public.place_events (place_id, user_email, at desc);

create or replace function public.record_place_event(p_place_id uuid, p_type text)
returns uuid
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_email text := auth.jwt() ->> 'email';
  v_last  text;
  v_id    uuid;
begin
  if v_email is null or p_type not in ('arrive', 'leave') then
    return null;
  end if;

  -- Both of a member's devices can wake on the same crossing; serialize them so
  -- the read below can't happen twice before the insert.
  perform pg_advisory_xact_lock(hashtextextended(p_place_id::text || ':' || v_email, 0));

  select type into v_last
    from public.place_events
   where place_id = p_place_id
     and user_email = v_email
   order by at desc
   limit 1;

  -- Never announce a departure from somewhere we never saw them arrive. On a
  -- fresh registration iOS reports Outside for every place they're NOT at,
  -- which would otherwise fire "left School" for a school they were never in.
  if v_last is null and p_type = 'leave' then
    return null;
  end if;

  -- Already inside (or already outside): not a crossing.
  if v_last is not distinct from p_type then
    return null;
  end if;

  insert into public.place_events (place_id, type)
       values (p_place_id, p_type)
    returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.record_place_event(uuid, text) from public;
grant execute on function public.record_place_event(uuid, text) to authenticated;
