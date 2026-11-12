-- Quiz: hear the answer the way the speaker MEANT it (owner, 2026-11).
-- An English room with Brazilian accents: "two" came back as "true" and
-- "chew", "platypus" as "pretty plus". Three changes:
--
-- 1. quiz_answer takes the recogniser's other guesses too (p_alts — the app
--    sends up to ~10 alternatives it heard). Right if ANY of them matches;
--    the one that matched is what everyone sees.
-- 2. quiz_sound(): a sound-alike key — spaces off, common spellings folded
--    (ph→f, ch/sh→x, th→t, c→k, z→s, y→i, w→u, h silent), doubled letters
--    folded, every run of vowels one "a". "pretty plus" → "prataplas",
--    "platypus" → "platapas". Same key counts from 4 letters; keys of 8+
--    may differ by 2. Short words (cat/cut) still need the real thing.
-- 3. quiz_homophones: number words that sound like other words (two ← to,
--    too, true; four ← for; three ← tree …). Only applies when that number
--    word is an accepted answer.

create or replace function public.quiz_sound(p text)
returns text language sql immutable as $$
  select regexp_replace(regexp_replace(
           replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(
             replace(quiz_norm(p), ' ', ''),
             'ph', 'f'), 'ck', 'k'), 'sh', 'x'), 'ch', 'x'), 'th', 't'), 'qu', 'k'),
             'c', 'k'), 'z', 's'), 'y', 'i'), 'w', 'u'), 'h', ''),
           '(.)\1+', '\1', 'g'),
         '[aeiou]+', 'a', 'g')
$$;

create table if not exists public.quiz_homophones (
  word text not null,   -- the accepted answer, normalised ("two")
  heard text not null,  -- what a recogniser writes for it ("to")
  primary key (word, heard)
);
alter table public.quiz_homophones enable row level security;
revoke all on public.quiz_homophones from anon, authenticated;

insert into public.quiz_homophones (word, heard) values
  ('one', 'won'), ('one', 'wan'),
  ('two', 'to'), ('two', 'too'), ('two', 'tu'), ('two', 'true'), ('two', 'chew'), ('two', 'tool'),
  ('three', 'tree'), ('three', 'tri'), ('three', 'free'),
  ('four', 'for'), ('four', 'fore'), ('four', 'foe'), ('four', 'fall'),
  ('five', 'fife'), ('five', 'fight'),
  ('six', 'sex'), ('six', 'sicks'),
  ('seven', 'heaven'),
  ('eight', 'ate'), ('eight', 'it'), ('eight', 'hate'),
  ('nine', 'night'), ('nine', 'nein'),
  ('ten', 'tan'), ('ten', 'tem'),
  ('twelve', 'tough'),
  ('dois', 'doce'), ('tres', 'tais'), ('seis', 'seus'),
  ('dos', 'doce'), ('tres', 'trae')
on conflict do nothing;

create or replace function public.quiz_matches(p_given text, p_answers text[])
returns boolean language plpgsql stable as $$
declare g text := quiz_norm(p_given); gs text; a text; n text; ns text; tol int;
begin
  if g = '' then return false; end if;
  gs := quiz_sound(g);
  foreach a in array p_answers loop
    n := quiz_norm(a);
    if n = '' then continue; end if;
    if g = n or replace(g, ' ', '') = replace(n, ' ', '') then return true; end if;
    tol := case when char_length(n) >= 8 then 2 when char_length(n) >= 4 then 1 else 0 end;
    if tol > 0 and quiz_lev(g, n) <= tol then return true; end if;
    -- "rio de janeiro" given for "rio": the answer as a whole word inside
    if char_length(n) >= 4 and (' ' || g || ' ') like ('% ' || n || ' %') then return true; end if;
    -- a number word heard as its sound-alike
    if exists (select 1 from quiz_homophones h where h.word = n and h.heard = g) then return true; end if;
    -- sounds the same (accents, the recogniser splitting a word)
    ns := quiz_sound(n);
    -- (same key from 4 letters; long words may also differ by 2 — a
    -- tolerance on short keys let "pigeon" pass for "penguin")
    if char_length(ns) >= 4 and gs = ns then return true; end if;
    if char_length(ns) >= 8 and quiz_lev(gs, ns) <= 2 then return true; end if;
  end loop;
  return false;
end $$;

-- One signature only (an overload with a defaulted arg would make PostgREST's
-- 2-argument calls from older app builds ambiguous).
drop function if exists public.quiz_answer(uuid, text);
create or replace function public.quiz_answer(p_session uuid, p_text text, p_alts text[] default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  s game_sessions := game_lock(p_session); st jsonb := s.state; ans text[]; ok boolean := false; v_team text;
  shown text := btrim(coalesce(p_text, '')); cand text;
begin
  if s.status <> 'playing' or st ->> 'phase' <> 'answering' then raise exception 'not_now'; end if;
  if st -> 'buzz' ->> 'email' <> game_me() then raise exception 'not_your_turn'; end if;
  v_team := st -> 'buzz' ->> 'team';
  select array(select jsonb_array_elements_text(data -> 'answers')) into ans from game_secrets where session_id = p_session;
  -- a little grace for the network, then it's too late
  if now() <= (st ->> 'deadline')::timestamptz + interval '2 seconds' then
    foreach cand in array (array[p_text] || coalesce(p_alts[1:12], '{}'::text[])) loop
      if quiz_matches(cand, ans) then
        ok := true;
        shown := btrim(cand);
        exit;
      end if;
    end loop;
  end if;
  st := st || jsonb_build_object('last', jsonb_build_object(
    'email', game_me(), 'team', v_team, 'text', left(shown, 60), 'correct', ok, 'at', now()));
  if ok then
    st := jsonb_set(st, array['scores', v_team], to_jsonb(coalesce((st -> 'scores' ->> v_team)::int, 0) + 1));
    st := quiz_reveal(p_session, st, v_team, game_me());
  else
    st := quiz_after_miss(p_session, st, game_me());
  end if;
  perform game_touch(p_session, st);
  return jsonb_build_object('correct', ok);
end $$;
revoke all on function public.quiz_answer(uuid, text, text[]) from public, anon;
grant execute on function public.quiz_answer(uuid, text, text[]) to authenticated;
revoke all on function public.quiz_sound(text) from public, anon;
