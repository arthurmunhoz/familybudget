-- 086: account deletion failed for anyone who had ever added anything.
--
-- delete_my_account() (039 → 040 → 078) deletes the caller's allowed_users
-- row, but five "who did this" columns still referenced allowed_users(email)
-- with the default NO ACTION, so the delete raised
--   update or delete on table "allowed_users" violates foreign key constraint
--   "entries_person_email_fkey" on table "entries"
-- (or the shopping/documents/pets/budgets equivalent) and the whole account
-- deletion rolled back. Only a user who had never logged an entry, added a
-- shopping item, uploaded a document or logged a pet event could leave.
--
-- And the last-member branch was broken behind it: twelve tables reference
-- households(id) with NO ACTION too, so `delete from households` failed for
-- any household that had data.
--
-- Fix:
-- 1. Authorship columns become nullable + ON DELETE SET NULL. The household's
--    shared rows (an expense, a shopping item, a vet visit) stay with the
--    family that keeps using them; they just stop naming the person who left.
--    Both clients already fall back gracefully on a missing name.
-- 2. The leaver's PRIVATE budgets are theirs alone, so they're deleted
--    (months/entries/budget_members cascade). Shared budgets they created lose
--    the owner (SET NULL), which every client already reads as "household".
-- 3. When the leaver was the last member, the household's rows are deleted
--    explicitly before the household itself. Deliberately NOT done by turning
--    the households FKs into cascades: the admin "Delete household" action
--    relies on them to refuse deleting a household that still has data.

-- 1. authorship columns ------------------------------------------------------
alter table public.entries        alter column person_email drop not null;
alter table public.shopping_items alter column added_by     drop not null;
alter table public.documents      alter column added_by     drop not null;
alter table public.pet_events     alter column added_by     drop not null;

alter table public.entries drop constraint entries_person_email_fkey,
  add constraint entries_person_email_fkey foreign key (person_email)
  references public.allowed_users(email) on delete set null;
alter table public.shopping_items drop constraint shopping_items_added_by_fkey,
  add constraint shopping_items_added_by_fkey foreign key (added_by)
  references public.allowed_users(email) on delete set null;
alter table public.documents drop constraint documents_added_by_fkey,
  add constraint documents_added_by_fkey foreign key (added_by)
  references public.allowed_users(email) on delete set null;
alter table public.pet_events drop constraint pet_events_added_by_fkey,
  add constraint pet_events_added_by_fkey foreign key (added_by)
  references public.allowed_users(email) on delete set null;
alter table public.budgets drop constraint budgets_owner_email_fkey,
  add constraint budgets_owner_email_fkey foreign key (owner_email)
  references public.allowed_users(email) on delete set null;

-- 2 + 3. the function -------------------------------------------------------
create or replace function public.delete_my_account()
returns void language plpgsql security definer set search_path = public as $$
declare
  uid    uuid := auth.uid();
  uemail text := auth.jwt() ->> 'email';
  hh     uuid := public.current_household();
  remaining int;
begin
  if uid is null then return; end if;
  delete from public.member_profiles      where email = uemail;
  delete from public.push_subscriptions   where user_email = uemail;
  delete from public.expo_push_tokens     where user_email = uemail;
  delete from public.apple_refresh_tokens where user_email = uemail;
  -- Whereabouts: live position, place history, live requests, safety watches.
  delete from public.member_locations     where user_email = uemail;
  delete from public.place_events         where user_email = uemail;
  delete from public.location_live_requests
        where requester_email = uemail or target_email = uemail;
  delete from public.safety_watches       where owner_email = uemail;
  -- Private budgets are the leaver's own data, not the household's.
  delete from public.budgets
        where owner_email = uemail and visibility = 'private';
  delete from public.allowed_users        where email = uemail;
  if hh is not null then
    select count(*) into remaining from public.allowed_users where household_id = hh;
    if remaining = 0 then
      -- Every table that references households(id) without a cascade.
      -- Children (months/entries, pet_events/routines, budget_members) cascade.
      delete from public.budgets                     where household_id = hh;
      delete from public.calendar_deletions          where household_id = hh;
      delete from public.calendar_events             where household_id = hh;
      delete from public.category_rules              where household_id = hh;
      delete from public.documents                   where household_id = hh;
      delete from public.google_calendar_connections where household_id = hh;
      delete from public.important_dates             where household_id = hh;
      delete from public.member_profiles             where household_id = hh;
      delete from public.pets                        where household_id = hh;
      delete from public.shopping_items              where household_id = hh;
      delete from public.shopping_stores             where household_id = hh;
      delete from public.households where id = hh;
    end if;
  end if;
  delete from auth.users where id = uid;
end $$;
grant execute on function public.delete_my_account() to authenticated;
