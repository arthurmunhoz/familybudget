-- Migration 096: one open room per person, and forgotten rooms close by
-- themselves (owner, 2026-11).
--
-- * A person may host only ONE live room (lobby or playing) at a time.
--   game_create raises 'has_room' when they already have one; called again
--   with p_replace = true it closes the old room(s) first (the app asks
--   "close your other room?").
-- * A live room with no activity for 15 minutes is closed: a lobby becomes
--   'cancelled', a game in progress 'done', both with state.ended = 'expired'.
--   There's no scheduler here: game_sweep() does it for the caller's
--   household, and the app calls it when it lists rooms and while a room is
--   open (the 8 s poll), so a stale room closes for everyone looking at it.
-- * "Activity" includes the lobby: joining, switching team and ready now
--   bump game_sessions.updated_at (trigger on game_players), so a lobby that
--   people are filling up doesn't count as idle.
-- Async (send-a-hangman) sessions are untouched: they're meant to wait.

-- Lobby moves count as activity.
create or replace function public.game_players_touch()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update game_sessions set updated_at = now()
   where id = coalesce(new.session_id, old.session_id) and status in ('lobby', 'playing');
  return null;
end $$;
revoke all on function public.game_players_touch() from public, anon, authenticated;

drop trigger if exists game_players_touch on public.game_players;
create trigger game_players_touch
  after insert or update on public.game_players
  for each row execute function public.game_players_touch();

-- Close the caller's household's live rooms idle for 15 minutes.
create or replace function public.game_sweep()
returns int language plpgsql security definer set search_path = public as $$
declare v_hh uuid := current_household(); n int;
begin
  if v_hh is null then return 0; end if;
  update game_sessions
     set status = case when status = 'lobby' then 'cancelled' else 'done' end,
         state = state || '{"ended":"expired"}'::jsonb,
         updated_at = now()
   where household_id = v_hh and mode = 'live' and status in ('lobby', 'playing')
     and updated_at < now() - interval '15 minutes';
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.game_sweep() from public, anon;
grant execute on function public.game_sweep() to authenticated;

-- game_create: one live room per host (p_replace closes the old one).
drop function if exists public.game_create(text, text, text, jsonb);
create or replace function public.game_create(p_game text, p_mode text default 'live',
                                              p_lang text default 'pt', p_settings jsonb default '{}'::jsonb,
                                              p_replace boolean default false)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_hh uuid := current_household();
begin
  if v_hh is null then raise exception 'no_household'; end if;
  if p_game not in ('hangman', 'battleship', 'quiz') then raise exception 'game_unavailable'; end if;
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
  insert into game_players (session_id, email, team) values (v_id, game_me(), 'A');
  return v_id;
end $$;
revoke all on function public.game_create(text, text, text, jsonb, boolean) from public, anon;
grant execute on function public.game_create(text, text, text, jsonb, boolean) to authenticated;
