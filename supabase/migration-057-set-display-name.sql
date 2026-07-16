-- 057 — let a member set their own display name.
--
-- WHY: allowed_users is select-only for members (writes are admin-only, see
-- migration 007), and display_name is stamped once by create_household /
-- join_household from public.jwt_display_name(), which is:
--   coalesce(jwt->>'name', jwt->>'full_name', split_part(jwt->>'email','@',1))
-- Google's JWT carries `name`, so Google users get a real name. Apple's identity
-- token carries NO name claim (Apple returns the name only once, in the native
-- authorization response, never in the JWT) — so Apple users fall through to the
-- email local-part. With "Hide My Email" that address is a random relay like
-- z5khzgh5ff@privaterelay.appleid.com, and the person shows up to their family
-- as "z5khzgh5ff". There was no way for them to fix it.
--
-- This adds the missing self-service write. Purely additive (new function only,
-- no signature or policy changes), so the shipped App Store build is unaffected.
create or replace function public.set_display_name(p_name text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_email text := public.jwt_email();
  v_name  text := nullif(btrim(p_name), '');
begin
  if v_email is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if v_name is null then
    raise exception 'display name required' using errcode = '22023';
  end if;
  -- Match the household-name ceiling used elsewhere; trim rather than reject so
  -- a long paste can't dead-end the onboarding flow.
  v_name := left(v_name, 40);

  update public.allowed_users set display_name = v_name where email = v_email;
  if not found then
    raise exception 'not in a household' using errcode = '42501';
  end if;
end;
$$;
grant execute on function public.set_display_name(text) to authenticated;
