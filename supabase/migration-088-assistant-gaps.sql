-- What the Home assistant couldn't do (2026-11), so the owner knows what to
-- build next — WITHOUT storing what anyone said.
--
--   kind 'unknown' — the model couldn't map the request to anything. `summary`
--                    is the MODEL'S anonymised rewrite ("move an event to
--                    another day"), in English, with no names, places, numbers
--                    or personal details. The request text itself is never sent
--                    here.
--   kind 'failed'  — understood but the app couldn't carry it out. Only the
--                    intent + a reason code (`move_event` · `not_found`); no
--                    summary at all.
--
-- Written ONLY by api/suggest-ping with the service role (no insert policy).
-- Readable ONLY by the global admin. Rows older than 90 days are deleted on
-- each insert, so nothing lingers.
create table if not exists public.assistant_gaps (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  household_id uuid references public.households(id) on delete set null,
  kind text not null check (kind in ('unknown', 'failed')),
  intent text not null default '',
  reason text not null default '',
  summary text not null default '' check (char_length(summary) <= 160),
  lang text not null default ''
);
create index if not exists assistant_gaps_time_idx on public.assistant_gaps (created_at desc);

alter table public.assistant_gaps enable row level security;

drop policy if exists assistant_gaps_admin_read on public.assistant_gaps;
create policy assistant_gaps_admin_read on public.assistant_gaps
  for select using (public.is_admin());
