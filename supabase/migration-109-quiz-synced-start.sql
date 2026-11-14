-- Perguntas & Tortadas: every phone sees each question at the SAME moment
-- (owner, 2026-11-13: the iPhone showed the question ~5 s before a slower
-- Android had loaded, so it could buzz first).
--   * Each question gets `opens_at`: a short "3, 2, 1" lead-in before the
--     text shows and the buzzer opens. The answer clock starts at opens_at.
--   * Question 1 waits for every player's phone to report it's loaded
--     (quiz_ready) — up to 12 s — then opens 3 s later for everyone.
--   * game_server_now(): phones measure their clock offset against the
--     server with a round trip, instead of trusting a `now` that may have
--     arrived late.
--   * quiz_buzz refuses a press before opens_at.

create or replace function public.game_server_now()
returns timestamptz language sql volatile as $$ select clock_timestamp() $$;

create or replace function public.quiz_load_question(p_session uuid, p_state jsonb, p_q int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare d jsonb; qid int; qq quiz_questions; secs int := 25; opens timestamptz;
begin
  select data into d from game_secrets where session_id = p_session;
  qid := (d -> 'qids' ->> (p_q - 1))::int;
  select * into qq from quiz_questions where id = qid;
  update game_secrets set data = d || jsonb_build_object('answers', to_jsonb(qq.answers)) where session_id = p_session;
  opens := now() + case when p_q = 1 then interval '12 seconds' else interval '3 seconds' end;
  return p_state || jsonb_build_object(
    'phase', 'question', 'q', p_q,
    'question', jsonb_build_object('id', qq.id, 'text', qq.question, 'category', qq.category),
    'opens_at', opens,
    'deadline', opens + make_interval(secs => secs), 'q_deadline', opens + make_interval(secs => secs),
    'buzz', null, 'locked', '[]'::jsonb, 'last', null, 'reveal', null, 'now', now());
end $$;

-- "My phone has the game on screen." Once every active player has said so,
-- question 1 opens 3 s later (instead of waiting the full 12 s).
create or replace function public.quiz_ready(p_session uuid)
returns void language plpgsql security definer set search_path = public as $$
declare s game_sessions := game_lock(p_session); st jsonb := s.state; me text := game_me(); opens timestamptz;
begin
  if s.game <> 'quiz' or s.status <> 'playing' then return; end if;
  if bs_my_team(p_session) is null then raise exception 'not_player'; end if;
  if not (coalesce(st -> 'loaded', '[]'::jsonb) ? me) then
    st := jsonb_set(st, '{loaded}', coalesce(st -> 'loaded', '[]'::jsonb) || to_jsonb(me));
  end if;
  if st ->> 'phase' = 'question' and (st ->> 'q')::int = 1 and st ? 'opens_at'
     and (st ->> 'opens_at')::timestamptz > now() + interval '3 seconds'
     and not exists (select 1 from game_players
                      where session_id = p_session and left_at is null and team is not null
                        and not (st -> 'loaded' ? email)) then
    opens := now() + interval '3 seconds';
    st := st || jsonb_build_object('opens_at', opens, 'deadline', opens + interval '25 seconds',
                                   'q_deadline', opens + interval '25 seconds', 'now', now());
  end if;
  perform game_touch(p_session, st);
end $$;

create or replace function public.quiz_buzz(p_session uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s game_sessions := game_lock(p_session); st jsonb := s.state; v_team text := bs_my_team(p_session);
begin
  if v_team is null then raise exception 'not_player'; end if;
  if s.status <> 'playing' or st ->> 'phase' <> 'question' then
    return jsonb_build_object('first', false);       -- someone beat you to it
  end if;
  if coalesce(st -> 'locked', '[]'::jsonb) ? game_me() then raise exception 'locked_out'; end if;
  if st ? 'opens_at' and now() < (st ->> 'opens_at')::timestamptz then return jsonb_build_object('first', false); end if;
  if now() > (st ->> 'deadline')::timestamptz + interval '1 second' then return jsonb_build_object('first', false); end if;
  st := st || jsonb_build_object(
    'phase', 'answering',
    'buzz', jsonb_build_object('email', game_me(), 'team', v_team, 'at', now()),
    'deadline', now() + interval '15 seconds', 'now', now());
  perform game_touch(p_session, st);
  return jsonb_build_object('first', true);
end $$;

revoke all on function public.quiz_load_question(uuid, jsonb, int) from public, anon, authenticated;
revoke all on function public.quiz_ready(uuid) from public, anon;
revoke all on function public.quiz_buzz(uuid) from public, anon;
revoke all on function public.game_server_now() from public, anon;
grant execute on function public.quiz_ready(uuid) to authenticated;
grant execute on function public.quiz_buzz(uuid) to authenticated;
grant execute on function public.game_server_now() to authenticated;
