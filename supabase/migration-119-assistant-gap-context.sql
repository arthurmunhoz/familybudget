-- 119: who, when and in what context Roof couldn't do something (owner,
-- 2026-11-17: "it's only a list of things it couldn't do — whose was it, when,
-- in what context?"). Migration 088 kept assistant_gaps without the member on
-- purpose; the owner now wants it for the admin list. Still NEVER the words:
-- `summary` stays the model's anonymised rewrite, and the new columns are the
-- member and short codes only.
--   user_email — the member who asked (the JWT's email, set by the server)
--   via        — 'voice' | 'typed'
--   place      — 'phone' | 'casa' (Modo Casa)
--   screen     — the app screen Roof was opened on ("/", "/shopping")
--   prev       — the intent of the request just before, in the same
--                conversation ("list_items") — what they were in the middle of
-- Older rows (and requests from app versions before 1.6.1) have these empty.
alter table public.assistant_gaps
  add column if not exists user_email text,
  add column if not exists via text not null default '',
  add column if not exists place text not null default '',
  add column if not exists screen text not null default '',
  add column if not exists prev text not null default '';
