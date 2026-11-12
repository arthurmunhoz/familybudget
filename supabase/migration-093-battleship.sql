-- 093-battleship.sql — Battleship, live, team vs team (same lobby, teams,
-- ready and rotating turns as hangman, migration 090).
--
-- The SERVER keeps both fleets (game_secrets.data.fleet.{A,B}) and answers
-- every shot; no phone ever receives the other team's fleet. A team reads its
-- OWN fleet through battleship_my_fleet(), which checks the caller's team.
--
-- Public state (game_sessions.state) for battleship:
--   phase      'placing' | 'battle'
--   size 8, fleet [4,3,3,2,2]          board size and ship lengths
--   order/idx                           turn order per team (as hangman)
--   ready {A,B}                         team confirmed its fleet
--   rev {A,B}                           bumps when a team moves a ship (so
--                                       teammates refetch their fleet live)
--   turn_team, shooter                  who fires now
--   shots {A:[..],B:[..]}               shots ON that team's board:
--                                       {r,c,hit,sunk,by,at}
--   sunk {A:[..],B:[..]}                that team's sunk ships, revealed:
--                                       {r,c,len,dir}
--   scores {A,B}                        ships sunk BY that team
--   last {team,r,c,hit,sunk,len,by,at}  the latest shot (drives feedback)
-- Rules: hit → the same player fires again; miss → the other team, next
-- player in its rotation. Sinking the whole fleet ends the game.

-- Cells of a ship {r,c,len,dir:'h'|'v'} as [[r,c],...].
create or replace function public.bs_cells(p_ship jsonb)
returns jsonb language sql immutable as $$
  select coalesce(jsonb_agg(jsonb_build_array(
           (p_ship ->> 'r')::int + case when p_ship ->> 'dir' = 'v' then i else 0 end,
           (p_ship ->> 'c')::int + case when p_ship ->> 'dir' = 'v' then 0 else i end) order by i), '[]'::jsonb)
  from generate_series(0, (p_ship ->> 'len')::int - 1) i
$$;

-- A (possibly partial) fleet: lengths drawn from the fleet, in bounds, no
-- overlaps. p_full also requires every ship to be there.
create or replace function public.bs_check_fleet(p_ships jsonb, p_size int, p_fleet jsonb, p_full boolean)
returns void language plpgsql immutable as $$
declare ship jsonb; cell jsonb; seen text[] := '{}'; key text; left_lens int[]; want int[]; l int; k int;
begin
  if jsonb_typeof(p_ships) <> 'array' then raise exception 'bad_fleet'; end if;
  select array_agg(x::int) into want from jsonb_array_elements_text(p_fleet) x;
  left_lens := want;
  for ship in select * from jsonb_array_elements(p_ships) loop
    l := (ship ->> 'len')::int;
    k := array_position(left_lens, l);
    if k is null or coalesce(ship ->> 'dir', '') not in ('h', 'v') then raise exception 'bad_fleet'; end if;
    left_lens := left_lens[1:k-1] || left_lens[k+1:];
    for cell in select * from jsonb_array_elements(bs_cells(ship)) loop
      if (cell ->> 0)::int < 0 or (cell ->> 0)::int >= p_size or (cell ->> 1)::int < 0 or (cell ->> 1)::int >= p_size then
        raise exception 'bad_fleet';
      end if;
      -- exact r:c keys — jsonb @> ignores order inside arrays ([0,2] would
      -- "contain" [2,0]), so never use containment for cells.
      key := (cell ->> 0) || ':' || (cell ->> 1);
      if key = any(seen) then raise exception 'bad_fleet'; end if;
      seen := seen || key;
    end loop;
  end loop;
  if p_full and coalesce(array_length(left_lens, 1), 0) > 0 then raise exception 'fleet_incomplete'; end if;
end $$;

create or replace function public.bs_my_team(p_session uuid)
returns text language sql stable security definer set search_path = public as $$
  select team from game_players where session_id = p_session and email = game_me() and left_at is null
$$;

-- ── lobby functions, now knowing battleship ─────────────────────────────────

create or replace function public.game_create(p_game text, p_mode text default 'live',
                                              p_lang text default 'pt', p_settings jsonb default '{}'::jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_hh uuid := current_household();
begin
  if v_hh is null then raise exception 'no_household'; end if;
  if p_game not in ('hangman', 'battleship') then raise exception 'game_unavailable'; end if;
  insert into game_sessions (household_id, game, mode, host_email, lang, settings)
  values (v_hh, p_game, coalesce(p_mode, 'live'), game_me(), coalesce(p_lang, 'pt'), coalesce(p_settings, '{}'::jsonb))
  returning id into v_id;
  insert into game_secrets (session_id) values (v_id);
  insert into game_players (session_id, email, team) values (v_id, game_me(), 'A');
  return v_id;
end $$;

create or replace function public.game_start(p_session uuid)
returns void language plpgsql security definer set search_path = public as $$
declare s game_sessions := game_lock(p_session); ta jsonb; tb jsonb; st jsonb; rounds int;
begin
  if s.host_email <> game_me() then raise exception 'not_host'; end if;
  if s.status <> 'lobby' then raise exception 'game_started'; end if;
  if exists (select 1 from game_players where session_id = p_session and left_at is null and not ready
             and email <> s.host_email) then
    raise exception 'not_ready';
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

-- Whoever is shooting left or is away: the turn goes to the next player of
-- the same team (with the current order of who's still here).
create or replace function public.bs_reseat(p_session uuid)
returns void language plpgsql security definer set search_path = public as $$
declare s game_sessions; st jsonb; who text; team text;
begin
  select * into s from game_sessions where id = p_session;
  st := jsonb_set(s.state, '{order,A}', game_team(p_session, 'A'));
  st := jsonb_set(st, '{order,B}', game_team(p_session, 'B'));
  team := st ->> 'turn_team';
  if team is not null and not (st -> 'order' -> team) ? (st ->> 'shooter') then
    select g.who, g.state into who, st from game_next_of(st, team) g;
    st := jsonb_set(st, '{shooter}', to_jsonb(who));
  end if;
  perform game_touch(p_session, st);
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
    if jsonb_array_length(game_team(p_session, 'A')) = 0 or jsonb_array_length(game_team(p_session, 'B')) = 0 then
      perform game_touch(p_session, s.state || '{"ended":"abandoned"}'::jsonb, 'done');
    elsif s.game = 'hangman' and (s.state ->> 'setter' = game_me() or s.state ->> 'guesser' = game_me()) then
      perform hangman_reseat(p_session);
    elsif s.game = 'battleship' and s.state ->> 'shooter' = game_me() then
      perform bs_reseat(p_session);
    else
      update game_sessions set updated_at = now() where id = p_session;
    end if;
  end if;
end $$;

create or replace function public.game_skip_turn(p_session uuid)
returns void language plpgsql security definer set search_path = public as $$
declare s game_sessions := game_lock(p_session); st jsonb := s.state; who text; team text;
begin
  if s.host_email <> game_me() then raise exception 'not_host'; end if;
  if s.status <> 'playing' then return; end if;
  if s.game = 'hangman' then
    team := case when st ->> 'phase' = 'choosing' then st ->> 'setter_team' else st ->> 'guess_team' end;
    select g.who, g.state into who, st from game_next_of(st, team) g;
    st := jsonb_set(st, case when st ->> 'phase' = 'choosing' then '{setter}' else '{guesser}' end::text[], to_jsonb(who));
    perform game_touch(p_session, st);
  elsif s.game = 'battleship' and st ->> 'phase' = 'battle' then
    select g.who, g.state into who, st from game_next_of(st, st ->> 'turn_team') g;
    perform game_touch(p_session, jsonb_set(st, '{shooter}', to_jsonb(who)));
  end if;
end $$;

-- ── placing ─────────────────────────────────────────────────────────────────

-- My team's fleet (any team member). Never the other team's.
create or replace function public.battleship_my_fleet(p_session uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_team text := bs_my_team(p_session); d jsonb;
begin
  if v_team is null then raise exception 'not_player'; end if;
  select data into d from game_secrets where session_id = p_session;
  return coalesce(d -> 'fleet' -> v_team, '[]'::jsonb);
end $$;

-- Any member of a team moves its ships (the whole current layout, partial is
-- fine while placing). Teammates see it through `rev`.
create or replace function public.battleship_set_fleet(p_session uuid, p_ships jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare s game_sessions := game_lock(p_session); v_team text := bs_my_team(p_session);
begin
  if v_team is null then raise exception 'not_player'; end if;
  if s.status <> 'playing' or s.state ->> 'phase' <> 'placing' then raise exception 'not_now'; end if;
  if (s.state -> 'ready' ->> v_team)::boolean then raise exception 'not_now'; end if;
  perform bs_check_fleet(p_ships, (s.state ->> 'size')::int, s.state -> 'fleet', false);
  update game_secrets set data = jsonb_set(data, array['fleet', v_team], p_ships) where session_id = p_session;
  perform game_touch(p_session, jsonb_set(s.state, array['rev', v_team],
                                          to_jsonb(coalesce((s.state -> 'rev' ->> v_team)::int, 0) + 1)));
end $$;

-- A team confirms (or un-confirms) its fleet. Both confirmed → battle; team A
-- fires first.
create or replace function public.battleship_ready(p_session uuid, p_ready boolean)
returns void language plpgsql security definer set search_path = public as $$
declare s game_sessions := game_lock(p_session); v_team text := bs_my_team(p_session); st jsonb; ships jsonb; who text;
begin
  if v_team is null then raise exception 'not_player'; end if;
  if s.status <> 'playing' or s.state ->> 'phase' <> 'placing' then raise exception 'not_now'; end if;
  if p_ready then
    select data -> 'fleet' -> v_team into ships from game_secrets where session_id = p_session;
    perform bs_check_fleet(coalesce(ships, '[]'::jsonb), (s.state ->> 'size')::int, s.state -> 'fleet', true);
  end if;
  st := jsonb_set(s.state, array['ready', v_team], to_jsonb(coalesce(p_ready, false)));
  if (st -> 'ready' ->> 'A')::boolean and (st -> 'ready' ->> 'B')::boolean then
    select g.who, g.state into who, st from game_next_of(st, 'A') g;
    st := st || jsonb_build_object('phase', 'battle', 'turn_team', 'A', 'shooter', who);
  end if;
  perform game_touch(p_session, st);
end $$;

-- ── battle ──────────────────────────────────────────────────────────────────

create or replace function public.battleship_fire(p_session uuid, p_r int, p_c int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  s game_sessions := game_lock(p_session);
  st jsonb := s.state;
  me_team text := st ->> 'turn_team';
  target text;
  fleet jsonb;
  ship jsonb;
  hit_ship jsonb := null;
  shots jsonb;
  is_hit boolean := false;
  is_sunk boolean := false;
  all_sunk boolean;
  who text;
  n_hits int;
begin
  if s.status <> 'playing' or st ->> 'phase' <> 'battle' then raise exception 'not_now'; end if;
  if st ->> 'shooter' <> game_me() then raise exception 'not_your_turn'; end if;
  if p_r < 0 or p_c < 0 or p_r >= (st ->> 'size')::int or p_c >= (st ->> 'size')::int then raise exception 'bad_cell'; end if;
  target := case when me_team = 'A' then 'B' else 'A' end;
  shots := st -> 'shots' -> target;
  if exists (select 1 from jsonb_array_elements(shots) x where (x ->> 'r')::int = p_r and (x ->> 'c')::int = p_c) then
    return jsonb_build_object('repeat', true);
  end if;
  select data -> 'fleet' -> target into fleet from game_secrets where session_id = p_session;
  for ship in select * from jsonb_array_elements(fleet) loop
    if exists (select 1 from jsonb_array_elements(bs_cells(ship)) e
                where (e ->> 0)::int = p_r and (e ->> 1)::int = p_c) then
      hit_ship := ship; is_hit := true;
    end if;
  end loop;
  shots := shots || jsonb_build_array(jsonb_build_object('r', p_r, 'c', p_c, 'hit', is_hit, 'by', game_me(), 'at', now()));
  if is_hit then
    -- sunk when every cell of that ship has been hit
    select count(*) into n_hits
      from jsonb_array_elements(bs_cells(hit_ship)) sc
     where exists (select 1 from jsonb_array_elements(shots) x
                    where (x ->> 'r')::int = (sc ->> 0)::int and (x ->> 'c')::int = (sc ->> 1)::int);
    is_sunk := n_hits = (hit_ship ->> 'len')::int;
  end if;
  st := jsonb_set(st, array['shots', target], shots);
  st := st || jsonb_build_object('last', jsonb_build_object(
    'team', me_team, 'r', p_r, 'c', p_c, 'hit', is_hit, 'sunk', is_sunk,
    'len', case when is_sunk then (hit_ship ->> 'len')::int else null end, 'by', game_me(), 'at', now()));
  if is_sunk then
    st := jsonb_set(st, array['sunk', target], (st -> 'sunk' -> target) || jsonb_build_array(hit_ship));
    st := jsonb_set(st, array['scores', me_team], to_jsonb(coalesce((st -> 'scores' ->> me_team)::int, 0) + 1));
    all_sunk := jsonb_array_length(st -> 'sunk' -> target) >= jsonb_array_length(fleet);
    if all_sunk then
      perform game_touch(p_session, st || jsonb_build_object('ended', 'finished', 'winner', me_team), 'done');
      return jsonb_build_object('hit', true, 'sunk', true, 'won', true);
    end if;
  end if;
  if not is_hit then
    -- miss: the other team fires, next player in its rotation
    select g.who, g.state into who, st from game_next_of(st, target) g;
    st := st || jsonb_build_object('turn_team', target, 'shooter', who);
  end if;
  perform game_touch(p_session, st);
  return jsonb_build_object('hit', is_hit, 'sunk', is_sunk);
end $$;

revoke all on function public.bs_reseat(uuid) from public, anon, authenticated;
revoke all on function public.bs_my_team(uuid) from public, anon, authenticated;
revoke all on function public.game_create(text, text, text, jsonb) from public, anon;
revoke all on function public.game_start(uuid) from public, anon;
revoke all on function public.game_leave(uuid) from public, anon;
revoke all on function public.game_skip_turn(uuid) from public, anon;
revoke all on function public.battleship_my_fleet(uuid) from public, anon;
revoke all on function public.battleship_set_fleet(uuid, jsonb) from public, anon;
revoke all on function public.battleship_ready(uuid, boolean) from public, anon;
revoke all on function public.battleship_fire(uuid, int, int) from public, anon;
grant execute on function public.game_create(text, text, text, jsonb) to authenticated;
grant execute on function public.game_start(uuid) to authenticated;
grant execute on function public.game_leave(uuid) to authenticated;
grant execute on function public.game_skip_turn(uuid) to authenticated;
grant execute on function public.battleship_my_fleet(uuid) to authenticated;
grant execute on function public.battleship_set_fleet(uuid, jsonb) to authenticated;
grant execute on function public.battleship_ready(uuid, boolean) to authenticated;
grant execute on function public.battleship_fire(uuid, int, int) to authenticated;
