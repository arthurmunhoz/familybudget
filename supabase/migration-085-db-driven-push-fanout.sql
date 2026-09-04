-- The push fan-out no longer depends on the sender's phone.
--
-- Both clients INSERT the row (nudge, place crossing) and then make a SECOND
-- call to api/send-ping to ask for the push. That second call is the fragile
-- half: an app suspended the moment the phone is pocketed, or a headless
-- geofence task torn down right after recording a crossing, leaves the row
-- saved and the push never requested. Measured 2026-09-04: 11 of one member's
-- nudges over four days reached nobody, with no request ever arriving at the
-- endpoint. Postgres has no such problem, so the row itself now asks.
--
-- Two layers, deliberately: an AFTER INSERT trigger for immediacy, and a
-- per-minute pg_cron sweeper that re-asks for anything still unpushed. The
-- trigger alone loses a push whenever the HTTP call fails; the sweeper is what
-- makes it eventually-always rather than usually.
--
-- Safety: api/send-ping claims `pushed_at` with a conditional UPDATE before it
-- sends, so the trigger, the sweeper and the phone can all ask for the same row
-- and exactly one fan-out happens. place_events gains that column here for the
-- same reason.
--
-- The URL and the shared secret are NOT in this file (it is committed) — they
-- live in vault.secrets as `app_base_url` and `internal_push_secret`, the
-- latter matching Vercel's INTERNAL_PUSH_SECRET. With either missing the
-- function no-ops and the clients' own calls still work.

create extension if not exists pg_net;
create extension if not exists pg_cron;

alter table public.place_events add column if not exists pushed_at timestamptz;

create or replace function public.request_push_fanout(p_body jsonb)
returns void
language plpgsql
security definer
set search_path = public, vault, net
as $$
declare
  v_url text;
  v_secret text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'app_base_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'internal_push_secret';
  if v_url is null or v_secret is null then
    return;
  end if;
  perform net.http_post(
    url := v_url || '/api/send-ping',
    body := p_body,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_secret
    ),
    timeout_milliseconds := 8000
  );
end;
$$;

revoke all on function public.request_push_fanout(jsonb) from public;
revoke all on function public.request_push_fanout(jsonb) from anon, authenticated;

create or replace function public.tg_pings_request_push()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.request_push_fanout(jsonb_build_object('ping_id', new.id));
  return null;
end;
$$;

drop trigger if exists pings_request_push on public.pings;
create trigger pings_request_push
after insert on public.pings
for each row execute function public.tg_pings_request_push();

create or replace function public.tg_place_events_request_push()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.request_push_fanout(
    jsonb_build_object('action', 'place-event', 'place_event_id', new.id)
  );
  return null;
end;
$$;

drop trigger if exists place_events_request_push on public.place_events;
create trigger place_events_request_push
after insert on public.place_events
for each row execute function public.tg_place_events_request_push();

-- Windows are short on purpose: a nudge nobody has been told about for an hour,
-- or an "arrived at Home" from twenty minutes ago, is noise rather than news.
create or replace function public.sweep_unpushed_fanouts()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  for r in
    select id from public.pings
    where pushed_at is null
      and expires_at > now()
      and created_at > now() - interval '1 hour'
    order by created_at
    limit 50
  loop
    perform public.request_push_fanout(jsonb_build_object('ping_id', r.id));
  end loop;

  for r in
    select id from public.place_events
    where pushed_at is null
      and at > now() - interval '20 minutes'
    order by at
    limit 50
  loop
    perform public.request_push_fanout(
      jsonb_build_object('action', 'place-event', 'place_event_id', r.id)
    );
  end loop;
end;
$$;

revoke all on function public.sweep_unpushed_fanouts() from public;
revoke all on function public.sweep_unpushed_fanouts() from anon, authenticated;

select cron.unschedule('sweep-unpushed-fanouts')
where exists (select 1 from cron.job where jobname = 'sweep-unpushed-fanouts');

select cron.schedule(
  'sweep-unpushed-fanouts',
  '* * * * *',
  $cron$select public.sweep_unpushed_fanouts()$cron$
);
