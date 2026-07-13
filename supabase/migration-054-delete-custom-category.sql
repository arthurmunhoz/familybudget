-- Migration 054: delete_custom_category — atomically remove a household custom
-- category and reassign anything pointing at it to the built-in "other".
--
-- Manage-categories UI (Money app) lets users edit/delete the categories they
-- created. Edit is a plain custom_categories UPDATE (RLS-scoped). Delete needs
-- to also move that category's entries + keyword rules to "other" so nothing is
-- orphaned — done here in one transaction, guarded to the caller's household.
-- (categoryById already falls back to "other" for unknown ids, but reassigning
-- keeps aggregation/filtering correct.)

create or replace function public.delete_custom_category(p_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_hh uuid := public.current_household();
begin
  if v_hh is null then
    raise exception 'no household' using errcode = '42501';
  end if;
  if not exists (select 1 from custom_categories where id = p_id and household_id = v_hh) then
    raise exception 'category not found' using errcode = 'P0002';
  end if;

  update entries set category = 'other'
    where category = p_id::text
      and month_id in (
        select m.id from months m join budgets b on b.id = m.budget_id where b.household_id = v_hh
      );
  delete from category_rules where category = p_id::text and household_id = v_hh;
  delete from custom_categories where id = p_id and household_id = v_hh;
end;
$$;
grant execute on function public.delete_custom_category(uuid) to authenticated;
