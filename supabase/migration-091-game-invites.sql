-- 091-game-invites.sql — "Arthur opened a Hangman room" reaches the family.
--
-- Opening a room (game_create) inserts a game_sessions row; an AFTER INSERT
-- trigger asks api/send-ping (action 'game-invite') to push it, the same
-- database-driven fan-out nudges and place alerts use (migration 085,
-- request_push_fanout). The endpoint claims game_sessions.pushed_at with a
-- conditional UPDATE, so the room is announced at most once.
--
-- Who hears it: every OTHER member of the household whose
-- user_settings.notify_games is not false. It defaults to true; a member who
-- doesn't play switches it off in Settings and only sees open rooms on the
-- Home (owner, 2026-11: game pushes must be opt-out per person).

alter table public.user_settings add column if not exists notify_games boolean not null default true;
alter table public.game_sessions add column if not exists pushed_at timestamptz;

create or replace function public.tg_game_sessions_request_push()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.mode = 'live' and new.status = 'lobby' then
    perform public.request_push_fanout(
      jsonb_build_object('action', 'game-invite', 'game_session_id', new.id)
    );
  end if;
  return null;
end;
$$;

revoke all on function public.tg_game_sessions_request_push() from public, anon, authenticated;

drop trigger if exists game_sessions_request_push on public.game_sessions;
create trigger game_sessions_request_push
after insert on public.game_sessions
for each row execute function public.tg_game_sessions_request_push();
