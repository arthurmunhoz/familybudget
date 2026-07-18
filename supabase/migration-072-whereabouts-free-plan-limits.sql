-- Free-plan limits for Whereabouts, in the same shape as migration 047's
-- budget limit: BEFORE triggers using household_is_plus, so a stale client
-- can't bypass them and a lapsed plan takes effect on its own.
--
--  • Places: a free household keeps ONE. Existing places are grandfathered —
--    the trigger only blocks NEW ones, and nothing is ever deleted for a plan
--    change.
--  • Safety Radius: a free user gets ONE watch per rolling 24h, capped at 30
--    minutes. Plus keeps the full 4h and no daily limit. Rolling 24h rather
--    than a calendar day so there's no timezone question and no midnight to
--    game.

-- ── Places ───────────────────────────────────────────────────────────────────
create or replace function public.enforce_free_place_limit()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not public.household_is_plus(new.household_id)
     and (select count(*) from public.places where household_id = new.household_id) >= 1 then
    raise exception 'free_plan_place_limit'
      using errcode = 'check_violation',
            hint = 'One Roof Plus is required for more than one place.';
  end if;
  return new;
end $$;

drop trigger if exists trg_free_place_limit on public.places;
create trigger trg_free_place_limit
  before insert on public.places
  for each row execute function public.enforce_free_place_limit();

-- ── Safety Radius ────────────────────────────────────────────────────────────
-- safety_watches is keyed by owner_email and stopWatch DELETES the row, so the
-- table itself can't answer "have you already had your watch today". This log
-- can: append-only, one row per session STARTED.
create table if not exists public.safety_watch_starts (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null default public.current_household()
               references public.households(id) on delete cascade,
  owner_email  text not null default (auth.jwt() ->> 'email'),
  at           timestamptz not null default now()
);

alter table public.safety_watch_starts enable row level security;

-- Own rows only: when your last watch started is nobody else's business, and
-- nothing in the app needs to read another member's history.
create policy safety_watch_starts_select on public.safety_watch_starts
  for select using (owner_email = (auth.jwt() ->> 'email'));

create index if not exists safety_watch_starts_owner_idx
  on public.safety_watch_starts (owner_email, at desc);

/** How long a free session runs. */
create or replace function public.free_watch_minutes() returns int
  language sql immutable as $$ select 30 $$;

create or replace function public.enforce_free_watch_limit()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_plus     boolean := public.household_is_plus(new.household_id);
  v_active   timestamptz;
  v_last     timestamptz;
begin
  -- An UPDATE while a session is still running is an EDIT (changing radius or
  -- who's watched), not a new session: it must neither consume the daily
  -- allowance nor extend the clock, or re-saving would be an infinite watch.
  select expires_at into v_active
    from public.safety_watches
   where owner_email = new.owner_email and expires_at > now();

  if v_active is not null then
    new.expires_at := v_active;
    return new;
  end if;

  if not v_plus then
    select max(at) into v_last
      from public.safety_watch_starts
     where owner_email = new.owner_email;

    if v_last is not null and v_last > now() - interval '24 hours' then
      raise exception 'free_plan_watch_limit'
        using errcode = 'check_violation',
              hint = 'One Roof Plus is required for more than one safety radius per day.';
    end if;

    -- Server decides the end time; a client can't grant itself the full 4h.
    new.expires_at := now() + (public.free_watch_minutes() || ' minutes')::interval;
  end if;

  insert into public.safety_watch_starts (household_id, owner_email)
       values (new.household_id, new.owner_email);

  return new;
end $$;

drop trigger if exists trg_free_watch_limit on public.safety_watches;
create trigger trg_free_watch_limit
  before insert or update on public.safety_watches
  for each row execute function public.enforce_free_watch_limit();
