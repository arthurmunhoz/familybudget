-- 092-hangman-send.sql — "Send a hangman": pick a word, send it to one or more
-- family members; each gets a notification and plays whenever they like that
-- day; the result comes back to the sender (owner, 2026-11).
--
-- Reuses the live hangman machinery: every recipient gets their OWN one-round
-- session (mode 'async', created straight into phase 'guessing'), with the
-- sender as the setter (team A) and the recipient as the only guesser (team B).
-- hangman_guess / hangman_guess_word work unchanged. When the round ends the
-- session is marked done and the database asks api/send-ping to tell the
-- sender how it went (action 'game-result', one-shot on result_pushed_at).
-- The challenge itself is announced by the existing game_sessions INSERT
-- trigger (migration 091), now also for async sessions.

alter table public.game_sessions add column if not exists result_pushed_at timestamptz;

-- Same rule as hangman_set_word: letters (accents fold), spaces, hyphens, 2–30.
create or replace function public.hangman_clean_word(p_word text)
returns text language plpgsql immutable as $$
declare w text := btrim(regexp_replace(coalesce(p_word, ''), '\s+', ' ', 'g'));
begin
  if char_length(w) < 2 or char_length(w) > 30
     or game_norm(w) !~ '^[a-z]([a-z -]*[a-z])?$'
     or char_length(regexp_replace(game_norm(w), '[^a-z]', '', 'g')) < 2 then
    raise exception 'bad_word';
  end if;
  return w;
end $$;

create or replace function public.hangman_send(p_recipients text[], p_category text, p_word text, p_lang text default 'pt')
returns uuid[] language plpgsql security definer set search_path = public as $$
declare
  v_hh uuid := current_household();
  v_me text := game_me();
  w text := hangman_clean_word(p_word);
  r text;
  v_id uuid;
  ids uuid[] := '{}';
  st jsonb;
begin
  if v_hh is null then raise exception 'no_household'; end if;
  if coalesce(array_length(p_recipients, 1), 0) = 0 then raise exception 'no_recipients'; end if;
  foreach r in array p_recipients loop
    if r = v_me then continue; end if;
    -- Only members of the sender's own household.
    if not exists (select 1 from allowed_users where email = r and household_id = v_hh) then
      raise exception 'not_member';
    end if;
    st := jsonb_build_object(
      'phase', 'guessing', 'round', 1, 'rounds', 1, 'max_wrong', 7,
      'setter_team', 'A', 'guess_team', 'B', 'setter', v_me, 'guesser', r,
      'order', jsonb_build_object('A', jsonb_build_array(v_me), 'B', jsonb_build_array(r)),
      'idx', jsonb_build_object('A', 0, 'B', 0),
      'scores', jsonb_build_object('A', 0, 'B', 0),
      'category', nullif(btrim(coalesce(p_category, '')), ''),
      'mask', hangman_mask(w, '[]'::jsonb), 'guessed', '[]'::jsonb, 'wrong', 0, 'last', null);
    insert into game_sessions (household_id, game, mode, status, host_email, lang, state)
    values (v_hh, 'hangman', 'async', 'playing', v_me, coalesce(p_lang, 'pt'), st)
    returning id into v_id;
    insert into game_secrets (session_id, data) values (v_id, jsonb_build_object('word', w));
    insert into game_players (session_id, email, team, ready) values (v_id, v_me, 'A', true), (v_id, r, 'B', true);
    ids := ids || v_id;
  end loop;
  if coalesce(array_length(ids, 1), 0) = 0 then raise exception 'no_recipients'; end if;
  return ids;
end $$;

-- End of a round. Live: as before. Async (a sent hangman): the session is
-- finished, and the sender gets told the result.
create or replace function public.hangman_finish_round(p_session uuid, p_state jsonb, p_word text, p_solved boolean)
returns void language plpgsql security definer set search_path = public as $$
declare st jsonb := p_state;
        -- Solved: a point to the guessers. House finished: a point to the team
        -- that picked the word.
        team text := case when p_solved then p_state ->> 'guess_team' else p_state ->> 'setter_team' end;
        v_mode text;
begin
  st := jsonb_set(st, array['scores', team], to_jsonb(coalesce((st -> 'scores' ->> team)::int, 0) + 1));
  st := st || jsonb_build_object('phase', 'round_over', 'solved', p_solved, 'word', p_word,
                                 'mask', p_word);
  select mode into v_mode from game_sessions where id = p_session;
  if v_mode = 'async' then
    perform game_touch(p_session, st || '{"ended":"finished"}'::jsonb, 'done');
    perform request_push_fanout(jsonb_build_object('action', 'game-result', 'game_session_id', p_session));
  else
    perform game_touch(p_session, st);
  end if;
end $$;

-- Announce async challenges too (live rooms only while still a lobby).
create or replace function public.tg_game_sessions_request_push()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (new.mode = 'live' and new.status = 'lobby') or new.mode = 'async' then
    perform public.request_push_fanout(
      jsonb_build_object('action', 'game-invite', 'game_session_id', new.id)
    );
  end if;
  return null;
end;
$$;

revoke all on function public.hangman_finish_round(uuid, jsonb, text, boolean) from public, anon, authenticated;
revoke all on function public.tg_game_sessions_request_push() from public, anon, authenticated;
revoke all on function public.hangman_send(text[], text, text, text) from public, anon;
grant execute on function public.hangman_send(text[], text, text, text) to authenticated;
