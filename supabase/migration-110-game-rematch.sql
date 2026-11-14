-- "Play again" puts everyone in ONE new room (owner, 2026-11-13: each player
-- tapping it opened a room of their own). The first tap creates the room and
-- writes it into the finished game's state (`state.rematch = {id, by, at}`);
-- every other phone on that results screen sees it live ("Ana wants to play
-- again") and a tap — theirs or the button — joins that same room, on the
-- team they had. game_create's own invite push still goes out as usual.

create or replace function public.game_rematch(p_session uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare s game_sessions := game_lock(p_session); me text := game_me(); v_id uuid; nxt game_sessions; v_team text;
begin
  if s.mode <> 'live' or s.status <> 'done' then raise exception 'game_unavailable'; end if;
  select team into v_team from game_players where session_id = p_session and email = me;
  if not found then raise exception 'not_player'; end if;
  if s.state ? 'rematch' then
    select * into nxt from game_sessions where id = (s.state -> 'rematch' ->> 'id')::uuid;
    if found and nxt.status = 'lobby' then
      perform game_join(nxt.id);
      if v_team is not null then
        update game_players set team = v_team, ready = false where session_id = nxt.id and email = me;
      end if;
      return nxt.id;
    end if;
  end if;
  v_id := game_create(s.game, 'live', s.lang, coalesce(s.settings, '{}'::jsonb), true);
  if v_team is not null then
    update game_players set team = v_team where session_id = v_id and email = me;
  end if;
  perform game_touch(p_session, s.state || jsonb_build_object(
    'rematch', jsonb_build_object('id', v_id, 'by', me, 'at', now())));
  return v_id;
end $$;

revoke all on function public.game_rematch(uuid) from public, anon;
grant execute on function public.game_rematch(uuid) to authenticated;
