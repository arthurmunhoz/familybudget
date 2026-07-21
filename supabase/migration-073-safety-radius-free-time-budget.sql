-- Safety Radius free tier: 30 MINUTES OF USE per rolling 24h, not one session.
--
-- Migration 072 spent the whole daily allowance on the first START, so a user
-- who turned a watch on and off again after ten seconds lost the day. The
-- allowance is now a time budget: stop early and the unused minutes stay
-- yours, so you can come back for the rest.
--
-- That needs actual END times, so safety_watch_starts (append-only starts)
-- becomes safety_watch_usage (sessions with a start AND an end). The end is
-- written optimistically as the planned expiry and CORRECTED down when the
-- watch is deleted early — that correction is the refund.

alter table public.safety_watch_starts rename to safety_watch_usage;
alter table public.safety_watch_usage  rename column at to started_at;
alter index  if exists safety_watch_starts_owner_idx rename to safety_watch_usage_owner_idx;
alter policy safety_watch_starts_select on public.safety_watch_usage
  rename to safety_watch_usage_select;

-- Existing rows predate the ledger: under the old rule each start consumed the
-- entire daily allowance, so a full session is the honest equivalent.
alter table public.safety_watch_usage add column if not exists ended_at timestamptz;
update public.safety_watch_usage
   set ended_at = started_at + (public.free_watch_minutes() || ' minutes')::interval
 where ended_at is null;
alter table public.safety_watch_usage alter column ended_at set not null;

/** Seconds of watching consumed in the last 24h.
 *  `least(ended_at, now())` means a session still running counts only the time
 *  it has actually used so far, not its planned end. */
create or replace function public.free_watch_used_seconds(p_owner text)
returns int language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(
    ceil(extract(epoch from
      sum(greatest(least(ended_at, now()) - started_at, interval '0'))
    ))::int, 0)
  from public.safety_watch_usage
  where owner_email = p_owner
    and started_at > now() - interval '24 hours'
$$;

/** What the CALLER has left. The client reads this to show "x min left today"
 *  and to know when the allowance is gone — same helper the trigger enforces
 *  with, so the number shown can never disagree with the number applied. */
create or replace function public.free_watch_remaining_seconds()
returns int language sql stable security definer set search_path = public, pg_temp as $$
  select greatest(
    0,
    public.free_watch_minutes() * 60
      - public.free_watch_used_seconds(auth.jwt() ->> 'email')
  )
$$;

revoke all on function public.free_watch_used_seconds(text) from public;
revoke all on function public.free_watch_remaining_seconds() from public;
grant execute on function public.free_watch_remaining_seconds() to authenticated;

create or replace function public.enforce_free_watch_limit()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_plus      boolean := public.household_is_plus(new.household_id);
  v_active    timestamptz;
  v_remaining int;
begin
  -- An UPDATE while a session is still running is an EDIT (changing radius or
  -- who's watched), not a new session: it must neither consume the allowance
  -- nor extend the clock, or re-saving would be an infinite watch.
  select expires_at into v_active
    from public.safety_watches
   where owner_email = new.owner_email and expires_at > now();

  if v_active is not null then
    new.expires_at := v_active;
    return new;
  end if;

  if v_plus then
    return new;   -- no cap, and no ledger row: a lapse must not inherit usage
  end if;

  v_remaining := public.free_watch_minutes() * 60
                 - public.free_watch_used_seconds(new.owner_email);

  if v_remaining <= 0 then
    raise exception 'free_plan_watch_limit'
      using errcode = 'check_violation',
            hint = 'One Roof Plus removes the daily safety-radius limit.';
  end if;

  -- Server decides the end time; a client can't grant itself more than what's
  -- left. Booked as used up front, refunded by the delete trigger if stopped.
  new.expires_at := now() + make_interval(secs => v_remaining);

  insert into public.safety_watch_usage (household_id, owner_email, started_at, ended_at)
       values (new.household_id, new.owner_email, now(), new.expires_at);

  return new;
end $$;

/** Stopping early refunds the unused time — this is what lets someone turn a
 *  watch off after a few seconds and come back for the rest of their 30. */
create or replace function public.close_safety_watch_usage()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.safety_watch_usage
     set ended_at = now()
   where owner_email = old.owner_email
     and started_at <= now()
     and ended_at   >  now();   -- still open; an already-expired row is settled
  return old;
end $$;

drop trigger if exists trg_close_watch_usage on public.safety_watches;
create trigger trg_close_watch_usage
  after delete on public.safety_watches
  for each row execute function public.close_safety_watch_usage();
