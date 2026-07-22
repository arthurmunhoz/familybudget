-- 079: let a user revoke their own Home-Screen widget token.
--
-- widget_token() (045) mints a long-lived bearer token that /api/widget accepts
-- INSTEAD of a session — so signing out of the app did not actually stop the
-- device from sending nudges or reading the agenda. There was no way for a
-- client to delete the row either: widget_tokens is service-role only
-- (`revoke all ... from anon, authenticated`, no RLS policies).
--
-- Same shape as widget_token(): security definer, search_path pinned, scoped to
-- the caller's own jwt_email and granted to authenticated. The mobile app calls
-- this on sign-out; a fresh sign-in simply mints a new token via widget_token().

create or replace function public.revoke_widget_token()
returns void language plpgsql security definer set search_path = public as $$
declare
  uemail text := auth.jwt() ->> 'email';
begin
  if uemail is null then return; end if;
  delete from public.widget_tokens where user_email = uemail;
end $$;
grant execute on function public.revoke_widget_token() to authenticated;
