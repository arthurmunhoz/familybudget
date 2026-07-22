-- 080: place_events retention + a user delete path.
--
-- 067 gave place_events select + insert policies only. That means location
-- history is append-only and permanent: a member cannot erase their own
-- arrival/departure trail, and nothing ever trims the table, so a household
-- accumulates an unbounded record of where everyone has been.
--
-- (a) place_events_delete — a member may delete their OWN rows, household
--     scoped, mirroring the insert policy's shape.
-- (b) prune_place_events(p_days) — the retention job, security definer so it
--     can sweep every household.
--
-- DELIBERATELY NOT SCHEDULED AND NOT RUN. This migration only creates the
-- function; enabling retention is a product decision (it destroys history) and
-- should be turned on explicitly, e.g. via pg_cron:
--     select cron.schedule('prune-place-events', '30 4 * * *',
--                          $q$select public.prune_place_events(30)$q$);
-- Execute is granted to nobody — service role / cron only.

create policy place_events_delete on public.place_events
  for delete using (
    user_email = (auth.jwt() ->> 'email')
    and household_id = public.current_household()
  );

/** Delete place history older than p_days. Returns the number of rows removed. */
create or replace function public.prune_place_events(p_days int default 30)
returns int language plpgsql security definer set search_path = public as $$
declare
  n int;
begin
  delete from public.place_events where at < now() - make_interval(days => p_days);
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.prune_place_events(int) from public, anon, authenticated;
