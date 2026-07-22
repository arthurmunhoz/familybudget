-- 082-nudge-push-once.sql — one push fan-out per nudge.
-- api/send-ping.ts re-pushed on every call for the same ping_id, so a replayed
-- request (or a malicious household member re-POSTing an old id) could spam the
-- household's phones. `pushed_at` is the claim marker: the function updates it
-- WHERE pushed_at IS NULL and only fans out if it won that update, which is
-- atomic and therefore also race-safe between two devices.
-- Server-only (service role) — no RLS/grant change needed: the column is
-- readable by whoever can already read the ping, and no client writes it.
alter table public.pings add column if not exists pushed_at timestamptz;

comment on column public.pings.pushed_at is
  'Set by api/send-ping.ts when the push fan-out for this nudge was claimed. Non-null = already pushed, do not push again.';
