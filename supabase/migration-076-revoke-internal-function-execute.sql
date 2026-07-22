-- 076: actually revoke EXECUTE on two internal-only functions.
--
-- `revoke ... from public` only drops the implicit PUBLIC grant — it does NOT
-- touch Supabase's explicit default grants to anon/authenticated, so both of
-- these stayed callable by every signed-in user. Verified live before this
-- migration: proacl on both listed anon=X and authenticated=X.
--
--  * free_watch_used_seconds(text) (073) takes an ARBITRARY email and is
--    security definer — any user could probe Safety Radius usage for a member
--    of another household. The caller-scoped wrapper
--    free_watch_remaining_seconds() is what the client legitimately calls; its
--    grant to authenticated is deliberately left in place.
--  * gen_join_code() (051) mints household join codes. Nothing client-side
--    calls it; its only callers (households_after_insert_code, rotate_join_code,
--    create_household) are security definer and run as the owner, so revoking
--    it from clients cannot break the onboarding flow.

revoke execute on function public.free_watch_used_seconds(text) from anon, authenticated;
revoke execute on function public.gen_join_code() from anon, authenticated;
