-- 034-ai-metering-revoke-client.sql — Supabase default privileges grant EXECUTE on
-- new public functions to anon + authenticated explicitly, which `revoke ... from public`
-- in 033 did not remove. Revoke them so the metering RPCs are service_role-only.
revoke execute on function public.ai_scan_allowed(uuid)              from anon, authenticated;
revoke execute on function public.ai_scan_record(uuid, text, numeric) from anon, authenticated;
