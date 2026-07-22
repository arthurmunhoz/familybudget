-- 081: drop the legacy public.is_allowed() helper.
--
-- It predates multi-tenancy: it answers "is this email in allowed_users?" with
-- NO household scoping, so any policy that used it would grant access across
-- households. Everything migrated to current_household()/is_admin() long ago
-- and CLAUDE.md already tells agents not to write new policies against it —
-- but a security definer function that returns "yes, you're allowed" left
-- lying around is a trap for the next person writing a policy in a hurry.
--
-- Verified dead against the live DB immediately before dropping: 0 policies,
-- 0 views, 0 constraints, 0 column defaults, 0 other functions and 0 non-normal
-- pg_depend entries reference it. `drop function` (not `... cascade`) so the
-- drop fails loudly rather than silently taking a dependent object with it.

drop function if exists public.is_allowed();
