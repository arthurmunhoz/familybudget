-- Migration 101: games × several households (099). "Send a hangman" checked
-- recipients with allowed_users.household_id, which since 099 is only each
-- person's ACTIVE household — a member looking at another of their families
-- couldn't be sent one. Membership is household_members now.
-- Apply AFTER 099.

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
    if not exists (select 1 from household_members where email = r and household_id = v_hh) then
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
