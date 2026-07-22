-- 078: account deletion must also erase the caller's Whereabouts data.
--
-- delete_my_account() (039, extended in 040) predates the location features
-- (065–068). Those tables only cascade on household_id, so deleting a member
-- who is NOT the last in their household left their live position, place
-- arrival/departure history, live-location requests and safety watches behind
-- — location PII surviving an account deletion, which is exactly what the
-- Apple account-deletion requirement is about.
--
-- Everything else about the function is unchanged (member_profiles,
-- push_subscriptions, expo_push_tokens, apple_refresh_tokens, allowed_users,
-- the last-member household cleanup, and the auth.users delete last).
-- The new deletes run BEFORE the allowed_users delete so current_household()
-- is still resolvable, and are keyed off the columns these tables actually use:
-- member_locations.user_email, place_events.user_email,
-- location_live_requests.requester_email/target_email (either side is "mine"),
-- safety_watches.owner_email.

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
  -- Whereabouts: live position, place history, live requests, safety watches.
  delete from public.member_locations     where user_email = uemail;
  delete from public.place_events         where user_email = uemail;
  delete from public.location_live_requests
        where requester_email = uemail or target_email = uemail;
  delete from public.safety_watches       where owner_email = uemail;
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
