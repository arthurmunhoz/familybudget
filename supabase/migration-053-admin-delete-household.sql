-- Migration 053: admin_delete_household — cascade-delete a household + all its
-- data in one atomic, is_admin()-guarded RPC.
--
-- Why: the admin "Delete household" button did a plain `delete from households`,
-- which FK-blocks the moment the household has ANY child data (a budget, a
-- shopping item, …). With open signup (migration 051) abandoned households will
-- always have some data, so admins had no working way to clean them up. This
-- deletes every household-scoped row (parent-keyed children first) then the
-- household itself, inside the function's single transaction.
--
-- CAVEAT: this removes the DB rows for `documents` (and avatar/pet-photo paths),
-- but NOT the underlying files in the `documents` storage bucket — those become
-- orphaned. Full storage cleanup needs the Storage API (see the fix-doc-paths
-- edge function pattern); add later if it matters for real deletions.

create or replace function public.admin_delete_household(p_household uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not public.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  -- Parent-keyed children first (they have no household_id of their own).
  delete from entries where month_id in (
    select m.id from months m join budgets b on b.id = m.budget_id where b.household_id = p_household);
  delete from months where budget_id in (select id from budgets where household_id = p_household);
  delete from pet_events where pet_id in (select id from pets where household_id = p_household);
  delete from ping_acks where ping_id in (select id from pings where household_id = p_household);

  -- shopping_items references shopping_stores → items before stores.
  delete from shopping_items where household_id = p_household;
  delete from shopping_stores where household_id = p_household;

  -- Everything else keyed directly by household_id.
  delete from ai_usage where household_id = p_household;
  delete from budgets where household_id = p_household;
  delete from calendar_deletions where household_id = p_household;
  delete from calendar_events where household_id = p_household;
  delete from category_rules where household_id = p_household;
  delete from custom_categories where household_id = p_household;
  delete from documents where household_id = p_household;
  delete from expo_push_tokens where household_id = p_household;
  delete from google_calendar_connections where household_id = p_household;
  delete from household_subscriptions where household_id = p_household;
  delete from important_dates where household_id = p_household;
  delete from member_profiles where household_id = p_household;
  delete from pets where household_id = p_household;
  delete from ping_presets where household_id = p_household;
  delete from pings where household_id = p_household;
  delete from push_subscriptions where household_id = p_household;
  delete from web_events where household_id = p_household;
  delete from widget_tokens where household_id = p_household;
  delete from household_join_codes where household_id = p_household;
  delete from allowed_users where household_id = p_household;

  delete from households where id = p_household;
end;
$$;
grant execute on function public.admin_delete_household(uuid) to authenticated;
