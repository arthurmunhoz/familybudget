-- 090-family-games.sql — Family games (hub app "Games"), phase 1: the shared
-- LIVE base (lobby, teams A/B, ready, start, rotating turns) + live Hangman.
--
-- The SERVER runs the game. Clients never write these tables directly: every
-- move is a security-definer RPC that checks the caller is a player of a game
-- in their own household, that it's their turn, and applies the move. Clients
-- only READ game_sessions / game_players (household-scoped RLS) and follow them
-- over Realtime. Anything the other team must not see (the hangman word, later
-- battleship fleets and quiz answers) lives in game_secrets, which no client
-- role can read at all.
--
-- game_sessions.state is the PUBLIC state of the game (JSON, shape per game —
-- see mobile/src/lib/games.ts). Hangman state:
--   phase       'choosing' | 'guessing' | 'round_over'
--   round, rounds            1-based current round / total rounds
--   setter_team, guess_team  'A' | 'B'
--   setter, guesser          emails of whose turn it is (rotating per team)
--   order {A:[..],B:[..]}    turn order per team, idx {A:n,B:n} next pointer
--   category                 category key (the hint), or null for a free word
--   mask                     the word with unguessed letters as '_'
--   guessed [..]             normalised letters tried, wrong / max_wrong
--   scores {A:n,B:n}, solved bool, word (revealed only at round_over)

create table if not exists public.game_sessions (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null default public.current_household()
               references public.households(id) on delete cascade,
  game         text not null check (game in ('hangman', 'battleship', 'quiz')),
  mode         text not null default 'live' check (mode in ('live', 'async')),
  status       text not null default 'lobby' check (status in ('lobby', 'playing', 'done', 'cancelled')),
  host_email   text not null default (auth.jwt() ->> 'email'),
  lang         text not null default 'pt',
  settings     jsonb not null default '{}'::jsonb,
  state        jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists game_sessions_household_idx
  on public.game_sessions (household_id, status, updated_at desc);

create table if not exists public.game_players (
  session_id uuid not null references public.game_sessions(id) on delete cascade,
  email      text not null,
  team       text check (team in ('A', 'B')),
  ready      boolean not null default false,
  joined_at  timestamptz not null default now(),
  left_at    timestamptz,
  primary key (session_id, email)
);

create table if not exists public.game_secrets (
  session_id uuid primary key references public.game_sessions(id) on delete cascade,
  data       jsonb not null default '{}'::jsonb
);

alter table public.game_sessions enable row level security;
alter table public.game_players  enable row level security;
alter table public.game_secrets  enable row level security;

-- Read-only for clients; no insert/update/delete policies on purpose.
drop policy if exists game_sessions_select on public.game_sessions;
create policy game_sessions_select on public.game_sessions
  for select using (household_id = public.current_household());
drop policy if exists game_players_select on public.game_players;
create policy game_players_select on public.game_players
  for select using (exists (
    select 1 from public.game_sessions s
    where s.id = session_id and s.household_id = public.current_household()));
-- game_secrets: no policies at all → invisible to anon/authenticated.
revoke all on table public.game_secrets from anon, authenticated;

alter publication supabase_realtime add table public.game_sessions;
alter publication supabase_realtime add table public.game_players;

-- ── helpers ────────────────────────────────────────────────────────────────

create or replace function public.game_me() returns text
language sql stable as $$ select auth.jwt() ->> 'email' $$;

-- Lock and return the session, refusing anything outside the caller's household.
create or replace function public.game_lock(p_session uuid)
returns public.game_sessions
language plpgsql security definer set search_path = public as $$
declare s public.game_sessions;
begin
  select * into s from game_sessions where id = p_session for update;
  if not found or s.household_id is distinct from current_household() then
    raise exception 'game_not_found' using errcode = 'P0002';
  end if;
  return s;
end $$;

-- Lowercase, accents off: "Ação" → "acao". Letters only matter for matching.
create or replace function public.game_norm(p text) returns text
language sql immutable as $$
  select translate(lower(coalesce(p, '')),
    'áàâãäåçéèêëíìîïñóòôõöúùûüýÿ',
    'aaaaaaceeeeiiiinooooouuuuyy')
$$;

-- The word with letters not yet guessed hidden. Spaces and hyphens show.
create or replace function public.hangman_mask(p_word text, p_guessed jsonb)
returns text language plpgsql immutable as $$
declare out text := ''; ch text; i int;
begin
  for i in 1..char_length(p_word) loop
    ch := substr(p_word, i, 1);
    if game_norm(ch) !~ '[a-z]' or p_guessed ? game_norm(ch) then
      out := out || ch;
    else
      out := out || '_';
    end if;
  end loop;
  return out;
end $$;

create or replace function public.game_touch(p_session uuid, p_state jsonb, p_status text default null)
returns void language sql security definer set search_path = public as $$
  update game_sessions
     set state = p_state, status = coalesce(p_status, status), updated_at = now()
   where id = p_session
$$;

-- Active players of a team, in join order.
create or replace function public.game_team(p_session uuid, p_team text)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(email order by joined_at), '[]'::jsonb)
    from game_players
   where session_id = p_session and team = p_team and left_at is null
$$;

-- ── lobby ──────────────────────────────────────────────────────────────────

create or replace function public.game_create(p_game text, p_mode text default 'live',
                                              p_lang text default 'pt', p_settings jsonb default '{}'::jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_hh uuid := current_household();
begin
  if v_hh is null then raise exception 'no_household'; end if;
  if p_game not in ('hangman') then raise exception 'game_unavailable'; end if;
  insert into game_sessions (household_id, game, mode, host_email, lang, settings)
  values (v_hh, p_game, coalesce(p_mode, 'live'), game_me(), coalesce(p_lang, 'pt'), coalesce(p_settings, '{}'::jsonb))
  returning id into v_id;
  insert into game_secrets (session_id) values (v_id);
  insert into game_players (session_id, email, team) values (v_id, game_me(), 'A');
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
  values (p_session, game_me(), case when nb < na then 'B' else 'A' end);
  update game_sessions set updated_at = now() where id = p_session;
end $$;

create or replace function public.game_set_team(p_session uuid, p_team text)
returns void language plpgsql security definer set search_path = public as $$
declare s game_sessions := game_lock(p_session);
begin
  if s.status <> 'lobby' then raise exception 'game_started'; end if;
  if p_team not in ('A', 'B') then raise exception 'bad_team'; end if;
  update game_players set team = p_team, ready = false
   where session_id = p_session and email = game_me();
  update game_sessions set updated_at = now() where id = p_session;
end $$;

create or replace function public.game_set_ready(p_session uuid, p_ready boolean)
returns void language plpgsql security definer set search_path = public as $$
declare s game_sessions := game_lock(p_session);
begin
  if s.status <> 'lobby' then raise exception 'game_started'; end if;
  update game_players set ready = coalesce(p_ready, false)
   where session_id = p_session and email = game_me();
  update game_sessions set updated_at = now() where id = p_session;
end $$;

-- Leave. In the lobby the row goes; the host leaving cancels the room. Mid-game
-- the player is marked gone and skipped; a team left empty ends the game.
create or replace function public.game_leave(p_session uuid)
returns void language plpgsql security definer set search_path = public as $$
declare s game_sessions := game_lock(p_session); st jsonb;
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
    else
      update game_sessions set updated_at = now() where id = p_session;
    end if;
  end if;
end $$;

-- The host can cancel the room or end a game in progress.
create or replace function public.game_cancel(p_session uuid)
returns void language plpgsql security definer set search_path = public as $$
declare s game_sessions := game_lock(p_session);
begin
  if s.host_email <> game_me() then raise exception 'not_host'; end if;
  update game_sessions
     set status = case when status = 'lobby' then 'cancelled' else 'done' end,
         state = state || '{"ended":"cancelled"}'::jsonb, updated_at = now()
   where id = p_session;
end $$;

-- Next player of a team after its pointer; advances the pointer.
create or replace function public.game_next_of(p_state jsonb, p_team text, out who text, out state jsonb)
language plpgsql immutable as $$
declare arr jsonb := p_state -> 'order' -> p_team; n int := jsonb_array_length(arr); i int;
begin
  i := coalesce((p_state -> 'idx' ->> p_team)::int, 0);
  who := arr ->> (i % n);
  state := jsonb_set(p_state, array['idx', p_team], to_jsonb((i + 1) % n));
end $$;

-- ── hangman ────────────────────────────────────────────────────────────────

create or replace function public.hangman_new_round(p_session uuid, p_state jsonb, p_round int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare st jsonb := p_state; setter_team text; guess_team text; a text; b text;
begin
  -- Odd rounds: team A picks the word, team B guesses. Then they swap.
  setter_team := case when p_round % 2 = 1 then 'A' else 'B' end;
  guess_team  := case when setter_team = 'A' then 'B' else 'A' end;
  select who, state into a, st from game_next_of(st, setter_team);
  select who, state into b, st from game_next_of(st, guess_team);
  st := st || jsonb_build_object(
    'phase', 'choosing', 'round', p_round,
    'setter_team', setter_team, 'guess_team', guess_team,
    'setter', a, 'guesser', b,
    'category', null, 'mask', null, 'guessed', '[]'::jsonb, 'wrong', 0,
    'solved', null, 'word', null, 'last', null);
  update game_secrets set data = '{}'::jsonb where session_id = p_session;
  return st;
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
  rounds := least(greatest(coalesce((s.settings ->> 'rounds')::int, 6), 2), 20);
  rounds := rounds + rounds % 2;            -- even, so both teams guess equally
  st := jsonb_build_object(
    'order', jsonb_build_object('A', ta, 'B', tb),
    'idx', jsonb_build_object('A', 0, 'B', 0),
    'rounds', rounds, 'max_wrong', 7,
    'scores', jsonb_build_object('A', 0, 'B', 0));
  st := hangman_new_round(p_session, st, 1);
  update game_players set ready = true where session_id = p_session and left_at is null;
  perform game_touch(p_session, st, 'playing');
end $$;

-- Someone whose turn it was left: hand the turn to the next player of that team.
create or replace function public.hangman_reseat(p_session uuid)
returns void language plpgsql security definer set search_path = public as $$
declare s game_sessions; st jsonb; who text;
begin
  select * into s from game_sessions where id = p_session;
  st := jsonb_set(s.state, '{order,A}', game_team(p_session, 'A'));
  st := jsonb_set(st, '{order,B}', game_team(p_session, 'B'));
  if not (st -> 'order' -> (st ->> 'setter_team')) ? (st ->> 'setter') then
    select g.who, g.state into who, st from game_next_of(st, st ->> 'setter_team') g;
    st := jsonb_set(st, '{setter}', to_jsonb(who));
  end if;
  if not (st -> 'order' -> (st ->> 'guess_team')) ? (st ->> 'guesser') then
    select g.who, g.state into who, st from game_next_of(st, st ->> 'guess_team') g;
    st := jsonb_set(st, '{guesser}', to_jsonb(who));
  end if;
  perform game_touch(p_session, st);
end $$;

-- The setter picks the word (category = the hint; null when typed freely).
create or replace function public.hangman_set_word(p_session uuid, p_category text, p_word text)
returns void language plpgsql security definer set search_path = public as $$
declare s game_sessions := game_lock(p_session); w text := btrim(regexp_replace(coalesce(p_word, ''), '\s+', ' ', 'g'));
        st jsonb;
begin
  if s.status <> 'playing' or s.state ->> 'phase' <> 'choosing' then raise exception 'not_now'; end if;
  if s.state ->> 'setter' <> game_me() then raise exception 'not_your_turn'; end if;
  if char_length(w) < 2 or char_length(w) > 30
     or game_norm(w) !~ '^[a-z]([a-z -]*[a-z])?$'
     or char_length(regexp_replace(game_norm(w), '[^a-z]', '', 'g')) < 2 then
    raise exception 'bad_word';
  end if;
  update game_secrets set data = jsonb_build_object('word', w) where session_id = p_session;
  st := s.state || jsonb_build_object(
    'phase', 'guessing', 'category', nullif(btrim(coalesce(p_category, '')), ''),
    'mask', hangman_mask(w, '[]'::jsonb), 'guessed', '[]'::jsonb, 'wrong', 0, 'last', null);
  perform game_touch(p_session, st);
end $$;

create or replace function public.hangman_finish_round(p_session uuid, p_state jsonb, p_word text, p_solved boolean)
returns void language plpgsql security definer set search_path = public as $$
declare st jsonb := p_state;
        -- Solved: a point to the guessers. House finished: a point to the team
        -- that picked the word.
        team text := case when p_solved then p_state ->> 'guess_team' else p_state ->> 'setter_team' end;
begin
  st := jsonb_set(st, array['scores', team], to_jsonb(coalesce((st -> 'scores' ->> team)::int, 0) + 1));
  st := st || jsonb_build_object('phase', 'round_over', 'solved', p_solved, 'word', p_word,
                                 'mask', p_word);
  perform game_touch(p_session, st);
end $$;

-- Guess a single letter (only the current guesser).
create or replace function public.hangman_guess(p_session uuid, p_letter text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s game_sessions := game_lock(p_session); l text := game_norm(substr(btrim(coalesce(p_letter, '')), 1, 1));
        w text; st jsonb; hit boolean; mask text;
begin
  if s.status <> 'playing' or s.state ->> 'phase' <> 'guessing' then raise exception 'not_now'; end if;
  if s.state ->> 'guesser' <> game_me() then raise exception 'not_your_turn'; end if;
  if l !~ '^[a-z]$' then raise exception 'bad_letter'; end if;
  if (s.state -> 'guessed') ? l then return jsonb_build_object('repeat', true); end if;
  select data ->> 'word' into w from game_secrets where session_id = p_session;
  hit := position(l in game_norm(w)) > 0;
  st := jsonb_set(s.state, '{guessed}', (s.state -> 'guessed') || to_jsonb(l));
  mask := hangman_mask(w, st -> 'guessed');
  st := st || jsonb_build_object('mask', mask, 'last', jsonb_build_object('letter', l, 'hit', hit, 'at', now()));
  if not hit then st := jsonb_set(st, '{wrong}', to_jsonb((st ->> 'wrong')::int + 1)); end if;
  if position('_' in mask) = 0 then
    perform hangman_finish_round(p_session, st, w, true);
  elsif (st ->> 'wrong')::int >= (st ->> 'max_wrong')::int then
    perform hangman_finish_round(p_session, st, w, false);
  else
    perform game_touch(p_session, st);
  end if;
  return jsonb_build_object('hit', hit);
end $$;

-- Risk the whole word: right wins the round, wrong costs two pieces.
create or replace function public.hangman_guess_word(p_session uuid, p_word text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s game_sessions := game_lock(p_session); w text; st jsonb; ok boolean;
begin
  if s.status <> 'playing' or s.state ->> 'phase' <> 'guessing' then raise exception 'not_now'; end if;
  if s.state ->> 'guesser' <> game_me() then raise exception 'not_your_turn'; end if;
  select data ->> 'word' into w from game_secrets where session_id = p_session;
  ok := regexp_replace(game_norm(p_word), '[^a-z]', '', 'g') = regexp_replace(game_norm(w), '[^a-z]', '', 'g');
  st := s.state || jsonb_build_object('last', jsonb_build_object('word', btrim(p_word), 'hit', ok, 'at', now()));
  if ok then
    perform hangman_finish_round(p_session, st, w, true);
  else
    st := jsonb_set(st, '{wrong}', to_jsonb(least((st ->> 'wrong')::int + 2, (st ->> 'max_wrong')::int)));
    if (st ->> 'wrong')::int >= (st ->> 'max_wrong')::int then
      perform hangman_finish_round(p_session, st, w, false);
    else
      perform game_touch(p_session, st);
    end if;
  end if;
  return jsonb_build_object('hit', ok);
end $$;

-- After a round: anyone moves on; past the last round the game is done.
create or replace function public.hangman_next(p_session uuid)
returns void language plpgsql security definer set search_path = public as $$
declare s game_sessions := game_lock(p_session); r int;
begin
  if s.status <> 'playing' or s.state ->> 'phase' <> 'round_over' then return; end if;
  if not exists (select 1 from game_players where session_id = p_session and email = game_me()) then
    raise exception 'not_player';
  end if;
  r := (s.state ->> 'round')::int;
  if r >= (s.state ->> 'rounds')::int then
    perform game_touch(p_session, s.state || '{"ended":"finished"}'::jsonb, 'done');
  else
    perform game_touch(p_session, hangman_new_round(p_session, s.state, r + 1));
  end if;
end $$;

-- The host can skip whoever is holding the game up (away from the phone).
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
  end if;
end $$;

-- Clients call the public RPCs only; helpers stay internal.
revoke all on function public.game_lock(uuid) from public, anon, authenticated;
revoke all on function public.game_touch(uuid, jsonb, text) from public, anon, authenticated;
revoke all on function public.game_team(uuid, text) from public, anon, authenticated;
revoke all on function public.hangman_new_round(uuid, jsonb, int) from public, anon, authenticated;
revoke all on function public.hangman_reseat(uuid) from public, anon, authenticated;
revoke all on function public.hangman_finish_round(uuid, jsonb, text, boolean) from public, anon, authenticated;

revoke all on function public.game_create(text, text, text, jsonb) from public, anon;
revoke all on function public.game_join(uuid) from public, anon;
revoke all on function public.game_set_team(uuid, text) from public, anon;
revoke all on function public.game_set_ready(uuid, boolean) from public, anon;
revoke all on function public.game_leave(uuid) from public, anon;
revoke all on function public.game_cancel(uuid) from public, anon;
revoke all on function public.game_start(uuid) from public, anon;
revoke all on function public.game_skip_turn(uuid) from public, anon;
revoke all on function public.hangman_set_word(uuid, text, text) from public, anon;
revoke all on function public.hangman_guess(uuid, text) from public, anon;
revoke all on function public.hangman_guess_word(uuid, text) from public, anon;
revoke all on function public.hangman_next(uuid) from public, anon;
grant execute on function public.game_create(text, text, text, jsonb) to authenticated;
grant execute on function public.game_join(uuid) to authenticated;
grant execute on function public.game_set_team(uuid, text) to authenticated;
grant execute on function public.game_set_ready(uuid, boolean) to authenticated;
grant execute on function public.game_leave(uuid) to authenticated;
grant execute on function public.game_cancel(uuid) to authenticated;
grant execute on function public.game_start(uuid) to authenticated;
grant execute on function public.game_skip_turn(uuid) to authenticated;
grant execute on function public.hangman_set_word(uuid, text, text) to authenticated;
grant execute on function public.hangman_guess(uuid, text) to authenticated;
grant execute on function public.hangman_guess_word(uuid, text) to authenticated;
grant execute on function public.hangman_next(uuid) to authenticated;
