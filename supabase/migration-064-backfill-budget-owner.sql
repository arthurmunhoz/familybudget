-- 064: backfill budget ownership. Budgets created before migration 058 have
-- owner_email = null. Assign each to its household's owner (allowed_users.role =
-- 'owner', migration 051) so that owner can manage the budget's privacy going
-- forward. New budgets already stamp owner_email = the creator (058's default),
-- so this only touches legacy rows. Visibility is untouched — these stay
-- household-visible; the owner can make one private later from the app.
--
-- Households with no owner assigned are left null (no one to inherit); a member
-- there who makes such a budget private simply becomes its owner then. Idempotent
-- (only fills nulls where an owner exists).
update public.budgets b
set owner_email = (
  select au.email
  from public.allowed_users au
  where au.household_id = b.household_id and au.role = 'owner'
  order by au.email
  limit 1
)
where b.owner_email is null
  and exists (
    select 1 from public.allowed_users au
    where au.household_id = b.household_id and au.role = 'owner'
  );
