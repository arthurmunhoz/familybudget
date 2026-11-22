-- Migration 121: Bingo (owner, 2026-11-22) — the first game with NO teams:
-- everyone for themselves, each with their own card.
--
-- 75-ball bingo: a 5×5 card, column c holds five numbers from c*15+1..c*15+15
-- (B 1–15, I 16–30, N 31–45, G 46–60, O 61–75), the centre is free. The
-- SERVER draws a ball every `pace` seconds (bingo_tick — any phone in the room
-- calls it when its countdown ends, and the server checks its own clock, as
-- quiz_tick does). Nothing is marked FOR a player: they tap their own numbers
-- (bingo_mark — only numbers already drawn) and call it themselves
-- (bingo_call — the first valid call the server receives wins).
--
-- game_sessions.state (public):
--   order  [email..]          players at the start
--   cards  {email: [25 ints]} row-major 5×5, 0 = the free centre
--   marks  {email: [ints]}    the numbers that player has marked
--   drawn  [ints]             balls so far, in order
--   next_at, now              when the next ball comes / server time at the last ball
--   pace   seconds between balls (settings.pace calm 12 | normal 9 | fast 6)
--   goal   'line' | 'full'    settings.goal: a line wins, or the whole card
--                             (then the FIRST line is still called out: state.line)
--   line   {by, cells, at} | null
--   winner email | null, win {by, kind, cells, at}
--   paused bool               the host holds the next ball
-- game_secrets.data.bag: the balls still to come, in the order they will come.
-- game_players.team is NULL for bingo.

alter table public.game_sessions drop constraint if exists game_sessions_game_check;
alter table public.game_sessions add constraint game_sessions_game_check
  check (game in ('hangman', 'battleship', 'quiz', 'bingo'));

-- A random card.
create or replace function public.bingo_card() returns jsonb
language plpgsql volatile as $$
declare card int[] := array_fill(0, array[25]); pick int[]; c int; r int;
begin
  for c in 0..4 loop
    select array_agg(n) into pick
      from (select n from generate_series(c * 15 + 1, c * 15 + 15) n order by random() limit 5) x;
    for r in 0..4 loop
      card[r * 5 + c + 1] := pick[r + 1];
    end loop;
  end loop;
  card[13] := 0;
  return to_jsonb(card);
end $$;

create or replace function public.bingo_has(p_arr jsonb, p_n int) returns boolean
language sql immutable as $$
  select exists (select 1 from jsonb_array_elements_text(coalesce(p_arr, '[]'::jsonb)) e where e::int = p_n)
$$;

-- Deal the cards and shuffle the bag (called by game_start).
create or replace function public.bingo_begin(p_session uuid, p_settings jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare ord jsonb; cards jsonb; marks jsonb; bag jsonb; pace int; goal text; st jsonb;
begin
  pace := case p_settings ->> 'pace' when 'calm' then 12 when 'fast' then 6 else 9 end;
  goal := case when p_settings ->> 'goal' = 'line' then 'line' else 'full' end;
  select coalesce(jsonb_agg(email order by joined_at), '[]'::jsonb),
         coalesce(jsonb_object_agg(email, bingo_card()), '{}'::jsonb),
         coalesce(jsonb_object_agg(email, '[]'::jsonb), '{}'::jsonb)
    into ord, cards, marks
    from game_players where session_id = p_session and left_at is null;
  select jsonb_agg(n order by random()) into bag from generate_series(1, 75) n;
  update game_secrets set data = jsonb_build_object('bag', bag) where session_id = p_session;
  st := jsonb_build_object(
    'order', ord, 'cards', cards, 'marks', marks, 'drawn', '[]'::jsonb,
    'pace', pace, 'goal', goal, 'line', null, 'winner', null, 'win', null, 'paused', false,
    'next_at', now() + interval '7 seconds', 'now', now());
  update game_players set ready = true where session_id = p_session and left_at is null;
  perform game_touch(p_session, st, 'playing');
end $$;

-- The next ball, once the server's clock says it's time. Anyone in the room
-- may call it; early calls are no-ops.
create or replace function public.bingo_tick(p_session uuid)
returns void language plpgsql security definer set search_path = public as $$
declare s game_sessions := game_lock(p_session); st jsonb := s.state; bag jsonb; n int;
begin
  if s.status <> 'playing' or s.game <> 'bingo' then return; end if;
  if coalesce((st ->> 'paused')::boolean, false) then return; end if;
  if now() < (st ->> 'next_at')::timestamptz then return; end if;
  select data -> 'bag' into bag from game_secrets where session_id = p_session;
  if coalesce(jsonb_array_length(bag), 0) = 0 then
    -- Every ball came out and the last minute passed with no call.
    perform game_touch(p_session, st || jsonb_build_object('ended', 'finished', 'now', now()), 'done');
    return;
  end if;
  n := (bag ->> 0)::int;
  update game_secrets set data = jsonb_set(data, '{bag}', bag - 0) where session_id = p_session;
  st := st || jsonb_build_object(
    'drawn', (st -> 'drawn') || to_jsonb(n),
    -- After the last ball: a minute to finish marking and call.
    'next_at', now() + make_interval(secs => case when jsonb_array_length(bag) = 1 then 60 else (st ->> 'pace')::int end),
    'now', now());
  perform game_touch(p_session, st);
end $$;

-- Mark one of MY numbers. Only a number already drawn can be marked.
create or replace function public.bingo_mark(p_session uuid, p_n int)
returns void language plpgsql security definer set search_path = public as $$
declare s game_sessions := game_lock(p_session); st jsonb := s.state; me text := game_me();
begin
  if s.status <> 'playing' or s.game <> 'bingo' then raise exception 'not_now'; end if;
  if not (st -> 'cards' ? me) then raise exception 'not_player'; end if;
  if p_n is null or p_n < 1 or not bingo_has(st -> 'cards' -> me, p_n) then raise exception 'not_now'; end if;
  if not bingo_has(st -> 'drawn', p_n) then raise exception 'not_drawn'; end if;
  if bingo_has(st -> 'marks' -> me, p_n) then return; end if;
  st := jsonb_set(st, array['marks', me], coalesce(st -> 'marks' -> me, '[]'::jsonb) || to_jsonb(p_n));
  perform game_touch(p_session, st);
end $$;

-- "BINGO!" — checked against what the caller MARKED (a number drawn but not
-- marked doesn't count: paying attention is the game).
create or replace function public.bingo_call(p_session uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  s game_sessions := game_lock(p_session); st jsonb := s.state; me text := game_me();
  card jsonb; mk jsonb; ok boolean[] := array_fill(false, array[25]); i int; v int;
  lines int[][] := array[
    [0,1,2,3,4],[5,6,7,8,9],[10,11,12,13,14],[15,16,17,18,19],[20,21,22,23,24],
    [0,5,10,15,20],[1,6,11,16,21],[2,7,12,17,22],[3,8,13,18,23],[4,9,14,19,24],
    [0,6,12,18,24],[4,8,12,16,20]];
  l int; cells int[] := null; whole boolean := true; hit boolean; kind text;
begin
  if s.status <> 'playing' or s.game <> 'bingo' then raise exception 'not_now'; end if;
  if not (st -> 'cards' ? me) then raise exception 'not_player'; end if;
  card := st -> 'cards' -> me; mk := st -> 'marks' -> me;
  for i in 0..24 loop
    v := (card ->> i)::int;
    ok[i + 1] := v = 0 or (bingo_has(mk, v) and bingo_has(st -> 'drawn', v));
    if not ok[i + 1] then whole := false; end if;
  end loop;
  for l in 1..12 loop
    hit := true;
    for i in 1..5 loop
      if not ok[lines[l][i] + 1] then hit := false; end if;
    end loop;
    if hit then cells := lines[l:l][1:5]; exit; end if;
  end loop;
  if whole then
    kind := 'full';
    cells := array(select generate_series(0, 24));
  elsif cells is not null and st ->> 'goal' = 'line' then
    kind := 'line';
  elsif cells is not null and (st -> 'line' is null or jsonb_typeof(st -> 'line') = 'null') then
    -- Playing for the whole card: the first line is called out and it goes on.
    st := st || jsonb_build_object('line', jsonb_build_object('by', me, 'cells', to_jsonb(array(select unnest(cells))), 'at', now()));
    perform game_touch(p_session, st);
    return jsonb_build_object('kind', 'line', 'won', false);
  else
    raise exception 'no_bingo';
  end if;
  st := st || jsonb_build_object(
    'winner', me,
    'win', jsonb_build_object('by', me, 'kind', kind, 'cells', to_jsonb(array(select unnest(cells))), 'at', now()),
    'ended', 'finished', 'now', now());
  perform game_touch(p_session, st, 'done');
  return jsonb_build_object('kind', kind, 'won', true);
end $$;

-- The host holds the next ball ("espera!") and lets it go again.
create or replace function public.bingo_pause(p_session uuid, p_on boolean)
returns void language plpgsql security definer set search_path = public as $$
declare s game_sessions := game_lock(p_session); st jsonb := s.state;
begin
  if s.status <> 'playing' or s.game <> 'bingo' then return; end if;
  if s.host_email <> game_me() then raise exception 'not_host'; end if;
  if coalesce(p_on, false) then
    st := st || jsonb_build_object('paused', true, 'now', now());
  else
    st := st || jsonb_build_object('paused', false, 'next_at', now() + interval '4 seconds', 'now', now());
  end if;
  perform game_touch(p_session, st);
end $$;

-- ── lobby functions, now knowing bingo (no teams) ───────────────────────────

create or replace function public.game_create(p_game text, p_mode text default 'live',
                                              p_lang text default 'pt', p_settings jsonb default '{}'::jsonb,
                                              p_replace boolean default false)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_hh uuid := current_household();
begin
  if v_hh is null then raise exception 'no_household'; end if;
  if p_game not in ('hangman', 'battleship', 'quiz', 'bingo') then raise exception 'game_unavailable'; end if;
  perform game_sweep();
  if coalesce(p_mode, 'live') = 'live' then
    if exists (select 1 from game_sessions where household_id = v_hh and host_email = game_me()
                and mode = 'live' and status in ('lobby', 'playing')) then
      if not coalesce(p_replace, false) then raise exception 'has_room'; end if;
      update game_sessions
         set status = case when status = 'lobby' then 'cancelled' else 'done' end,
             state = state || '{"ended":"cancelled"}'::jsonb,
             updated_at = now()
       where household_id = v_hh and host_email = game_me()
         and mode = 'live' and status in ('lobby', 'playing');
    end if;
  end if;
  insert into game_sessions (household_id, game, mode, host_email, lang, settings)
  values (v_hh, p_game, coalesce(p_mode, 'live'), game_me(), coalesce(p_lang, 'pt'), coalesce(p_settings, '{}'::jsonb))
  returning id into v_id;
  insert into game_secrets (session_id) values (v_id);
  insert into game_players (session_id, email, team)
  values (v_id, game_me(), case when p_game = 'bingo' then null else 'A' end);
  return v_id;
end $$;

create or replace function public.game_join(p_session uuid)
returns void language plpgsql security definer set search_path = public as $$
declare s game_sessions := game_lock(p_session); na int; nb int;
begin
  if exists (select 1 from game_players where session_id = p_session and email = game_me()) then
    update game_players set left_at = null where session_id = p_session and email = game_me();
    return;
  end if;
  if s.status <> 'lobby' then raise exception 'game_started'; end if;
  select count(*) filter (where team = 'A'), count(*) filter (where team = 'B')
    into na, nb from game_players where session_id = p_session and left_at is null;
  insert into game_players (session_id, email, team)
  values (p_session, game_me(), case when s.game = 'bingo' then null when nb < na then 'B' else 'A' end);
  update game_sessions set updated_at = now() where id = p_session;
end $$;

create or replace function public.game_leave(p_session uuid)
returns void language plpgsql security definer set search_path = public as $$
declare s game_sessions := game_lock(p_session);
begin
  if s.status = 'lobby' then
    if s.host_email = game_me() then
      update game_sessions set status = 'cancelled', updated_at = now() where id = p_session;
    else
      delete from game_players where session_id = p_session and email = game_me();
      update game_sessions set updated_at = now() where id = p_session;
    end if;
    return;
  end if;
  update game_players set left_at = now(), ready = false
   where session_id = p_session and email = game_me();
  if s.status = 'playing' then
    if s.game = 'bingo' then
      -- No teams: it goes on while anyone is still playing.
      if not exists (select 1 from game_players where session_id = p_session and left_at is null) then
        perform game_touch(p_session, s.state || jsonb_build_object('ended', 'abandoned', 'left_by', game_me()), 'done');
      else
        update game_sessions set updated_at = now() where id = p_session;
      end if;
    elsif jsonb_array_length(game_team(p_session, 'A')) = 0 or jsonb_array_length(game_team(p_session, 'B')) = 0 then
      perform game_touch(p_session, s.state || jsonb_build_object('ended', 'abandoned', 'left_by', game_me()), 'done');
    elsif s.game = 'hangman' and (s.state ->> 'setter' = game_me() or s.state ->> 'guesser' = game_me()) then
      perform hangman_reseat(p_session);
    elsif s.game = 'battleship' and s.state ->> 'shooter' = game_me() then
      perform bs_reseat(p_session);
    else
      update game_sessions set updated_at = now() where id = p_session;
    end if;
  end if;
end $$;

-- game_start: identical to migration 097 but for the bingo branch on top.
create or replace function public.game_start(p_session uuid)
returns void language plpgsql security definer set search_path = public as $$
declare s game_sessions := game_lock(p_session); ta jsonb; tb jsonb; st jsonb; rounds int; qids jsonb; n int; v_lang text;
begin
  if s.host_email <> game_me() then raise exception 'not_host'; end if;
  if s.status <> 'lobby' then raise exception 'game_started'; end if;
  if exists (select 1 from game_players where session_id = p_session and left_at is null and not ready
             and email <> s.host_email) then
    raise exception 'not_ready';
  end if;
  if s.game = 'bingo' then
    perform bingo_begin(p_session, s.settings);
    return;
  end if;
  ta := game_team(p_session, 'A'); tb := game_team(p_session, 'B');
  if jsonb_array_length(ta) = 0 or jsonb_array_length(tb) = 0 then raise exception 'need_two_teams'; end if;
  if s.game = 'battleship' then
    st := jsonb_build_object(
      'phase', 'placing', 'size', 8, 'fleet', '[4,3,3,2,2]'::jsonb,
      'order', jsonb_build_object('A', ta, 'B', tb),
      'idx', jsonb_build_object('A', 0, 'B', 0),
      'ready', jsonb_build_object('A', false, 'B', false),
      'rev', jsonb_build_object('A', 0, 'B', 0),
      'shots', jsonb_build_object('A', '[]'::jsonb, 'B', '[]'::jsonb),
      'sunk', jsonb_build_object('A', '[]'::jsonb, 'B', '[]'::jsonb),
      'scores', jsonb_build_object('A', 0, 'B', 0),
      'turn_team', null, 'shooter', null, 'last', null);
    update game_secrets set data = jsonb_build_object('fleet', jsonb_build_object('A', '[]'::jsonb, 'B', '[]'::jsonb))
     where session_id = p_session;
  elsif s.game = 'quiz' then
    n := least(greatest(coalesce((s.settings ->> 'questions')::int, 10), 5), 30);
    v_lang := case when exists (select 1 from quiz_questions where lang = s.lang) then s.lang else 'en' end;
    select coalesce(jsonb_agg(id), '[]'::jsonb) into qids
      from (select q.id from quiz_questions q
              left join quiz_seen sn on sn.household_id = s.household_id and sn.qkey = q.qkey
             where q.lang = v_lang
             order by sn.seen_at nulls first, random() limit n) x;
    if jsonb_array_length(qids) = 0 then raise exception 'no_questions'; end if;
    insert into quiz_seen (household_id, qkey)
      select s.household_id, q.qkey from quiz_questions q
       where q.id in (select (jsonb_array_elements_text(qids))::int)
    on conflict (household_id, qkey) do update set seen_at = now();
    update game_secrets set data = jsonb_build_object('qids', qids) where session_id = p_session;
    st := jsonb_build_object(
      'order', jsonb_build_object('A', ta, 'B', tb),
      'total', jsonb_array_length(qids),
      'scores', jsonb_build_object('A', 0, 'B', 0));
    st := quiz_load_question(p_session, st, 1);
  else
    rounds := least(greatest(coalesce((s.settings ->> 'rounds')::int, 6), 2), 20);
    rounds := rounds + rounds % 2;            -- even, so both teams guess equally
    st := jsonb_build_object(
      'order', jsonb_build_object('A', ta, 'B', tb),
      'idx', jsonb_build_object('A', 0, 'B', 0),
      'rounds', rounds, 'max_wrong', 7,
      'scores', jsonb_build_object('A', 0, 'B', 0));
    st := hangman_new_round(p_session, st, 1);
  end if;
  update game_players set ready = true where session_id = p_session and left_at is null;
  perform game_touch(p_session, st, 'playing');
end $$;

revoke all on function public.bingo_card() from public, anon, authenticated;
revoke all on function public.bingo_begin(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.bingo_tick(uuid) from public, anon;
revoke all on function public.bingo_mark(uuid, int) from public, anon;
revoke all on function public.bingo_call(uuid) from public, anon;
revoke all on function public.bingo_pause(uuid, boolean) from public, anon;
grant execute on function public.bingo_tick(uuid) to authenticated;
grant execute on function public.bingo_mark(uuid, int) to authenticated;
grant execute on function public.bingo_call(uuid) to authenticated;
grant execute on function public.bingo_pause(uuid, boolean) to authenticated;
revoke all on function public.game_create(text, text, text, jsonb, boolean) from public, anon;
grant execute on function public.game_create(text, text, text, jsonb, boolean) to authenticated;
revoke all on function public.game_join(uuid) from public, anon;
grant execute on function public.game_join(uuid) to authenticated;
revoke all on function public.game_leave(uuid) from public, anon;
grant execute on function public.game_leave(uuid) to authenticated;
revoke all on function public.game_start(uuid) from public, anon;
grant execute on function public.game_start(uuid) to authenticated;
