-- Migration 102: say WHO left when a game ends because a team emptied
-- (owner, 2026-11: the others saw "Game over 0–0", which read like a tie).
-- game_leave now stamps state.left_by with the leaver's email next to
-- ended = 'abandoned'; the app shows "Patricia left the room". Otherwise
-- identical to the 093 version.

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
