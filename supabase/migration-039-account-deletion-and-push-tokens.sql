-- 039: native app support — Expo push tokens + in-app account deletion (Apple 5.1.1(v)).
-- Added for the React Native app (mobile/). Safe for the PWA (unused there).

-- Expo/APNs push tokens (one row per device). RLS: users manage only their own.
create table if not exists public.expo_push_tokens (
  token        text primary key,
  user_email   text not null default (auth.jwt() ->> 'email'),
  household_id uuid not null default public.current_household(),
  device       text,
  created_at   timestamptz not null default now()
);
alter table public.expo_push_tokens enable row level security;
create policy expo_push_tokens_rw on public.expo_push_tokens
  for all using (user_email = (auth.jwt() ->> 'email'))
  with check (user_email = (auth.jwt() ->> 'email'));
create index if not exists expo_push_tokens_household_idx on public.expo_push_tokens (household_id);

-- In-app account deletion. Removes the caller's own records; if they were the
-- last member of their household, deletes the household (FK cascade clears all
-- that household's data); finally removes the auth user. NOTE: Sign in with
-- Apple ALSO requires server-side token revocation via Apple's REST API — a
-- separate serverless endpoint to add before App Store submission.
create or replace function public.delete_my_account()
returns void language plpgsql security definer set search_path = public as $$
declare
  uid    uuid := auth.uid();
  uemail text := auth.jwt() ->> 'email';
  hh     uuid := public.current_household();   -- capture BEFORE removing membership
  remaining int;
begin
  if uid is null then return; end if;
  delete from public.member_profiles   where email = uemail;
  delete from public.push_subscriptions where user_email = uemail;
  delete from public.expo_push_tokens  where user_email = uemail;
  delete from public.allowed_users     where email = uemail;
  if hh is not null then
    select count(*) into remaining from public.allowed_users where household_id = hh;
    if remaining = 0 then
      delete from public.households where id = hh;  -- cascades to household data
    end if;
  end if;
  delete from auth.users where id = uid;
end $$;
grant execute on function public.delete_my_account() to authenticated;
