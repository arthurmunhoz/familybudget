-- Migration 055: allow household members to UPDATE their custom categories.
--
-- custom_categories had SELECT/INSERT/DELETE policies but no UPDATE one, so the
-- Manage-categories "edit name/icon" save was silently filtered by RLS (0 rows
-- changed, no error) — the edit appeared to not stick. Add the household-scoped
-- UPDATE policy to match the other three.

create policy custom_categories_update on public.custom_categories
  for update
  using (household_id = public.current_household())
  with check (household_id = public.current_household());
