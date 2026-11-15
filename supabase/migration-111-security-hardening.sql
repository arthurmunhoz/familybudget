-- Migration 111: security review fixes (owner, 2026-11-15).
--
-- 1. Modo Casa devices get a server-side identity. The tablet binds its own
--    Supabase session to its home_devices row (casa_bind_session). From then:
--    - unpairing ends that session on the server (auth.sessions row deleted,
--      so its refresh token dies) and current_household() turns null for it at
--      once, so a copied token stops working instead of living on;
--    - the session can't touch documents, Whereabouts or document files;
--    - months/entries (the money) open only after the PIN is checked HERE
--      (casa_unlock), not in the browser.
-- 2. home_devices: members may only rename, unpair and stamp last_seen; an
--    unpair can't be undone and the trial clock (created_at) can't be moved.
-- 3. The Money PIN verifier is no longer readable by any client: the phone
--    still writes sha256("<household>:<pin>") into pin_hash (shipped apps do),
--    a trigger moves it to pin_secret and leaves pin_hash = 'set'.
-- 4. Own-row tables (location, live requests, watches, place watchers, push
--    subscriptions/tokens) can no longer be moved into a household the writer
--    isn't a member of.
-- 5. households: only the owner edits it, and only name/backdrop — never
--    the Plus link (plus_from/plus_by) or is_internal.
-- 6. join_household: wrong codes now COUNT (the old limiter's insert was rolled
--    back with the "invalid code" exception, so it never fired). Answered as an
--    HTTP 400 with the same error message, so clients behave as before.
--    gen_join_code draws from gen_random_uuid() (a CSPRNG), not random().
-- 7. Pairing code bookkeeping for api/widget.ts (requester shown on the phone,
--    wrong-code counter) and RevenueCat event bookkeeping.

-- ── 7. bookkeeping columns/tables used by api/ ──────────────────────────────
alter table public.home_pair_codes add column if not exists req_city text;
alter table public.home_pair_codes add column if not exists req_device text;

create table if not exists public.pair_attempts (
  id bigserial primary key,
  email text not null,
  attempted_at timestamptz not null default now()
);
create index if not exists pair_attempts_email_at on public.pair_attempts (email, attempted_at);
alter table public.pair_attempts enable row level security;
revoke all on public.pair_attempts from anon, authenticated;

alter table public.household_subscriptions add column if not exists environment text;
alter table public.household_subscriptions add column if not exists last_event_ms bigint;

-- ── 1. the device's own session ─────────────────────────────────────────────
alter table public.home_devices add column if not exists session_id uuid;
create index if not exists home_devices_session on public.home_devices (session_id) where session_id is not null;

-- The session id inside the caller's JWT (null for service role / anon).
create or replace function public.jwt_session_id()
returns uuid language sql stable set search_path = public as $$
  select nullif(auth.jwt() ->> 'session_id', '')::uuid;
$$;

-- The Modo Casa device this session belongs to (null on phones).
create or replace function public.casa_device_id()
returns uuid language sql stable security definer set search_path = public as $$
  select d.id from home_devices d where d.session_id = public.jwt_session_id() limit 1;
$$;

create or replace function public.is_casa_session()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from home_devices d where d.session_id = public.jwt_session_id());
$$;

create or replace function public.casa_session_revoked()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from home_devices d
                  where d.session_id = public.jwt_session_id() and d.revoked_at is not null);
$$;

-- Called by the tablet right after it signs in (and on every start, for
-- tablets paired before this migration). Only the member who paired it, only
-- while it's still paired, and only once.
create or replace function public.casa_bind_session(p_device uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_sid uuid := public.jwt_session_id();
  n int;
begin
  if v_sid is null then return false; end if;
  if exists (select 1 from home_devices where id = p_device and session_id = v_sid) then return true; end if;
  update home_devices set session_id = v_sid
   where id = p_device and paired_by = public.jwt_email() and revoked_at is null and session_id is null;
  get diagnostics n = row_count;
  return n > 0;
end $$;
revoke all on function public.casa_bind_session(uuid) from public, anon;
grant execute on function public.casa_bind_session(uuid) to authenticated;

-- current_household(): unchanged, except a revoked tablet's session gets null
-- (which every household-scoped policy then denies).
create or replace function public.current_household()
returns uuid
language sql stable security definer
set search_path = public
as $$
  select case when public.casa_session_revoked() then null else coalesce(
    (select au.household_id
       from allowed_users au
       join household_members m on m.email = au.email and m.household_id = au.household_id
      where au.email = (auth.jwt() ->> 'email')),
    (select m.household_id
       from household_members m
      where m.email = (auth.jwt() ->> 'email')
      order by m.joined_at, m.household_id
      limit 1)
  ) end;
$$;

-- Unpairing (or deleting) a device ends its session on the server.
create or replace function public.home_devices_end_session()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.session_id is not null and (tg_op = 'DELETE' or new.revoked_at is not null) then
    delete from auth.sessions where id = old.session_id;
  end if;
  return null;
end $$;
drop trigger if exists home_devices_end_session on public.home_devices;
create trigger home_devices_end_session
  after update of revoked_at or delete on public.home_devices
  for each row execute function public.home_devices_end_session();

-- ── 2. home_devices: what a member may change ───────────────────────────────
revoke update on public.home_devices from authenticated, anon;
grant update (name, revoked_at, last_seen_at) on public.home_devices to authenticated;

create or replace function public.home_devices_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  -- Service role (pairing, admin) is not limited here.
  if coalesce(auth.role(), '') <> 'authenticated' then return new; end if;
  if old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at then
    raise exception 'device_revoked' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists home_devices_guard on public.home_devices;
create trigger home_devices_guard before update on public.home_devices
  for each row execute function public.home_devices_guard();

-- ── 1b. what a Modo Casa session may not touch ──────────────────────────────
-- RESTRICTIVE policies are ANDed with the existing ones, so phones are
-- unaffected; "(select …)" makes Postgres evaluate the check once per query.
do $$
declare t text;
begin
  foreach t in array array['documents', 'member_locations', 'location_live_requests', 'safety_watches',
                           'place_watchers', 'place_events', 'places']
  loop
    if to_regclass('public.' || t) is not null then
      execute format('drop policy if exists %I on public.%I', t || '_no_casa', t);
      execute format(
        'create policy %I on public.%I as restrictive for all to authenticated
           using (not (select public.is_casa_session())) with check (not (select public.is_casa_session()))',
        t || '_no_casa', t);
    end if;
  end loop;
end $$;

-- Files: a tablet may read the family's avatars, pet photos, backdrop and
-- frame photos — not documents or their previews.
drop policy if exists documents_storage_no_casa on storage.objects;
create policy documents_storage_no_casa on storage.objects as restrictive for all to authenticated
  using (bucket_id <> 'documents' or not (select public.is_casa_session())
         or (storage.foldername(name))[2] = any (array['avatars', 'backdrop', 'pets', 'frame']))
  with check (bucket_id <> 'documents' or not (select public.is_casa_session())
         or (storage.foldername(name))[2] = any (array['avatars', 'backdrop', 'pets', 'frame']));

-- ── 3. the Money PIN, checked on the server ─────────────────────────────────
alter table public.home_settings add column if not exists pin_secret text;
-- Move existing verifiers out of sight (before the trigger exists).
update public.home_settings set pin_secret = lower(pin_hash), pin_hash = 'set'
 where pin_hash is not null and pin_hash <> 'set';

revoke select, insert, update on public.home_settings from authenticated, anon;
grant select (household_id, pin_hash, updated_at) on public.home_settings to authenticated;
grant insert (household_id, pin_hash, updated_at) on public.home_settings to authenticated;
grant update (household_id, pin_hash, updated_at) on public.home_settings to authenticated;

-- pin_hash as written by the phone = the verifier; it becomes pin_secret and
-- pin_hash reads 'set'. An upsert's conflict path arrives as an UPDATE that
-- carries the new hash; a plain insert is rewritten right after (AFTER INSERT).
create or replace function public.home_settings_pin()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.pin_hash is null then
    new.pin_secret := null;
  elsif new.pin_hash = 'set' then
    new.pin_secret := case when tg_op = 'UPDATE' then old.pin_secret end;
    if new.pin_secret is null then new.pin_hash := null; end if;
  else
    new.pin_secret := lower(new.pin_hash);
    if tg_op = 'UPDATE' then new.pin_hash := 'set'; end if;
  end if;
  return new;
end $$;
drop trigger if exists home_settings_pin on public.home_settings;
create trigger home_settings_pin before insert or update on public.home_settings
  for each row execute function public.home_settings_pin();

create or replace function public.home_settings_pin_hide()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.pin_hash is not null and new.pin_hash <> 'set' then
    update home_settings set pin_hash = 'set' where household_id = new.household_id;
  end if;
  return null;
end $$;
drop trigger if exists home_settings_pin_hide on public.home_settings;
create trigger home_settings_pin_hide after insert on public.home_settings
  for each row execute function public.home_settings_pin_hide();

create table if not exists public.pin_attempts (
  id bigserial primary key,
  household_id uuid not null references public.households(id) on delete cascade,
  attempted_at timestamptz not null default now()
);
create index if not exists pin_attempts_hh_at on public.pin_attempts (household_id, attempted_at);
alter table public.pin_attempts enable row level security;
revoke all on public.pin_attempts from anon, authenticated;

create table if not exists public.home_unlocks (
  device_id uuid primary key references public.home_devices(id) on delete cascade,
  until timestamptz not null
);
alter table public.home_unlocks enable row level security;
revoke all on public.home_unlocks from anon, authenticated;

-- Check the PIN. { ok } or { ok:false, error: no_pin | wrong | too_many }.
-- Wrong tries are RETURNED, not raised, so they persist: 5 per family per
-- 10 minutes. On a tablet, success opens the money for 30 minutes (the tablet
-- locks itself sooner when idle and calls casa_lock).
create or replace function public.casa_unlock(p_pin text)
returns json language plpgsql security definer set search_path = public as $$
declare
  h uuid := public.current_household();
  v_secret text;
  v_dev uuid := public.casa_device_id();
begin
  if h is null then return json_build_object('ok', false, 'error', 'no_household'); end if;
  select pin_secret into v_secret from home_settings where household_id = h;
  if v_secret is null then return json_build_object('ok', false, 'error', 'no_pin'); end if;
  if (select count(*) from pin_attempts where household_id = h and attempted_at > now() - interval '10 minutes') >= 5 then
    return json_build_object('ok', false, 'error', 'too_many');
  end if;
  if encode(sha256(convert_to(h::text || ':' || coalesce(p_pin, ''), 'UTF8')), 'hex') <> v_secret then
    insert into pin_attempts (household_id) values (h);
    return json_build_object('ok', false, 'error', 'wrong');
  end if;
  if v_dev is not null then
    insert into home_unlocks (device_id, until) values (v_dev, now() + interval '30 minutes')
      on conflict (device_id) do update set until = excluded.until;
  end if;
  return json_build_object('ok', true);
end $$;
revoke all on function public.casa_unlock(text) from public, anon;
grant execute on function public.casa_unlock(text) to authenticated;

create or replace function public.casa_lock()
returns void language sql security definer set search_path = public as $$
  delete from home_unlocks where device_id = public.casa_device_id();
$$;
revoke all on function public.casa_lock() from public, anon;
grant execute on function public.casa_lock() to authenticated;

-- Money rows: phones always; a tablet only while unlocked.
create or replace function public.casa_money_ok()
returns boolean language sql stable security definer set search_path = public as $$
  select case when public.casa_device_id() is null then true
              else exists (select 1 from home_unlocks u where u.device_id = public.casa_device_id() and u.until > now()) end;
$$;
grant execute on function public.casa_money_ok() to authenticated;

drop policy if exists months_casa_pin on public.months;
create policy months_casa_pin on public.months as restrictive for all to authenticated
  using ((select public.casa_money_ok())) with check ((select public.casa_money_ok()));
drop policy if exists entries_casa_pin on public.entries;
create policy entries_casa_pin on public.entries as restrictive for all to authenticated
  using ((select public.casa_money_ok())) with check ((select public.casa_money_ok()));

-- ── 4. own rows stay in my own households ───────────────────────────────────
drop policy if exists member_locations_update on public.member_locations;
create policy member_locations_update on public.member_locations
  for update using (user_email = (auth.jwt() ->> 'email'))
  with check (user_email = (auth.jwt() ->> 'email') and public.is_member_of(household_id));

drop policy if exists live_requests_update on public.location_live_requests;
create policy live_requests_update on public.location_live_requests
  for update using (requester_email = (auth.jwt() ->> 'email'))
  with check (requester_email = (auth.jwt() ->> 'email') and public.is_member_of(household_id));

drop policy if exists safety_watches_update on public.safety_watches;
create policy safety_watches_update on public.safety_watches
  for update using (owner_email = (auth.jwt() ->> 'email'))
  with check (owner_email = (auth.jwt() ->> 'email') and public.is_member_of(household_id));

drop policy if exists place_watchers_update on public.place_watchers;
create policy place_watchers_update on public.place_watchers
  for update using (user_email = (auth.jwt() ->> 'email'))
  with check (user_email = (auth.jwt() ->> 'email') and public.is_member_of(household_id));

drop policy if exists push_subscriptions_update on public.push_subscriptions;
create policy push_subscriptions_update on public.push_subscriptions
  for update using (user_email = (auth.jwt() ->> 'email'))
  with check (user_email = (auth.jwt() ->> 'email') and public.is_member_of(household_id));

drop policy if exists expo_push_tokens_rw on public.expo_push_tokens;
create policy expo_push_tokens_rw on public.expo_push_tokens
  for all using (user_email = (auth.jwt() ->> 'email'))
  with check (user_email = (auth.jwt() ->> 'email') and public.is_member_of(household_id));

-- ── 5. households: owner-only, safe columns only ────────────────────────────
revoke update on public.households from authenticated, anon;
grant update (name, backdrop_path) on public.households to authenticated;
drop policy if exists households_member_update on public.households;
create policy households_member_update on public.households
  for update using (
    id = public.current_household()
    and exists (select 1 from public.household_members m
                 where m.household_id = households.id and m.email = public.jwt_email() and m.role = 'owner'))
  with check (id = public.current_household());

-- ── 6. join codes ───────────────────────────────────────────────────────────
create or replace function public.gen_join_code()
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  alphabet constant text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ'; -- 31 chars, 8 => ~8.5e11
  v_code text;
  b bytea;
  i int;
begin
  loop
    b := uuid_send(gen_random_uuid());
    v_code := '';
    for i in 0..7 loop
      v_code := v_code || substr(alphabet, (get_byte(b, i) % 31) + 1, 1);
    end loop;
    exit when not exists (select 1 from public.household_join_codes c where c.code = v_code);
  end loop;
  return v_code;
end;
$$;

-- Same contract as migration 104 (returns the household id; errors carry the
-- same messages), but a wrong code is answered with HTTP 400 WITHOUT raising,
-- so the attempt row is committed and the 10-per-10-minutes limit is real.
drop function if exists public.join_household(text);
create function public.join_household(p_code text)
returns json
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_email text := public.jwt_email();
  v_code  text := upper(btrim(coalesce(p_code, '')));
  v_hh    uuid;
  v_name  text;
begin
  if v_email is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  if (select count(*) from public.join_attempts
        where email = v_email and attempted_at > now() - interval '10 minutes') >= 10 then
    raise exception 'too many attempts, try again later' using errcode = '54000';
  end if;
  insert into public.join_attempts (email) values (v_email);

  select household_id into v_hh from public.household_join_codes where code = v_code;
  if v_hh is null then
    perform set_config('response.status', '400', true);
    return json_build_object('code', 'P0002', 'message', 'invalid code', 'details', null, 'hint', null);
  end if;

  select display_name into v_name from public.allowed_users where email = v_email;
  if not found then
    insert into public.allowed_users (email, display_name, household_id, is_admin, role)
      values (v_email, public.jwt_display_name(), v_hh, false, 'member'); -- sync trigger adds the membership
    return to_json(v_hh);
  end if;

  if exists (select 1 from public.household_members where household_id = v_hh and email = v_email) then
    raise exception 'already a member' using errcode = '23505';
  end if;
  if (select count(*) from public.household_members where email = v_email)
       >= public.max_households_per_account() then
    raise exception 'household_limit' using errcode = '54000';
  end if;
  insert into public.household_members (household_id, email, role, display_name)
    values (v_hh, v_email, 'member', v_name);
  perform public.activate_household_for(v_email, v_hh);
  return to_json(v_hh);
end;
$$;
revoke all on function public.join_household(text) from public, anon;
grant execute on function public.join_household(text) to authenticated;
