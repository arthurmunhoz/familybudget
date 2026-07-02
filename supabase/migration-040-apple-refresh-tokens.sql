-- 040: store Apple refresh tokens for Sign in with Apple account-deletion token
-- revocation (Apple review requirement, Guideline 5.1.1(v)). Written/read ONLY by
-- the service role (api/apple-connect.ts stores; api/apple-revoke.ts revokes).
create table if not exists public.apple_refresh_tokens (
  user_email    text primary key,
  refresh_token text not null,
  updated_at    timestamptz not null default now()
);
alter table public.apple_refresh_tokens enable row level security;
revoke all on public.apple_refresh_tokens from anon, authenticated;
-- No RLS policies → no client access; the service role bypasses RLS.

-- Account deletion also clears the stored Apple token.
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
  delete from public.allowed_users        where email = uemail;
  if hh is not null then
    select count(*) into remaining from public.allowed_users where household_id = hh;
    if remaining = 0 then
      delete from public.households where id = hh;
    end if;
  end if;
  delete from auth.users where id = uid;
end $$;
grant execute on function public.delete_my_account() to authenticated;
