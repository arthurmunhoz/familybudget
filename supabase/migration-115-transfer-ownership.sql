-- Migration 115: hand the household over to another member (owner, 2026-11-16).
-- "A son downloads the app and invites his parents — they'll want to be the
-- owners." The OWNER of the ACTIVE household picks a member; that member
-- becomes the owner and the caller becomes a member. Plus billing is untouched
-- (the subscription belongs to the household / the store account that paid).
--  * Only the active household's owner, never a Modo Casa device session.
--  * Refused (`plus_owner`) while this family rides on another family's Plus
--    that the caller pays for (migration 104): the link needs the payer to own
--    both, so a hand-over would silently drop Plus. Same rule as leave_household.
--  * allowed_users.role follows through the household_members_role_sync trigger.

create or replace function public.transfer_ownership(p_email text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := public.jwt_email();
  v_hh    uuid := public.current_household();
begin
  if v_email is null or v_hh is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if public.is_casa_session() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if not exists (select 1 from household_members
                  where household_id = v_hh and email = v_email and role = 'owner') then
    raise exception 'not_owner' using errcode = '42501';
  end if;
  if p_email is null or lower(p_email) = lower(v_email) then
    raise exception 'same_person' using errcode = '22023';
  end if;
  if not exists (select 1 from household_members where household_id = v_hh and email = p_email) then
    raise exception 'not_member' using errcode = 'P0002';
  end if;
  if exists (select 1 from households where id = v_hh and plus_by = v_email)
     and public.household_plus_link_live(v_hh) then
    raise exception 'plus_owner' using errcode = '42501';
  end if;

  update household_members set role = 'owner'  where household_id = v_hh and email = p_email;
  update household_members set role = 'member' where household_id = v_hh and email = v_email;
end;
$$;
revoke all on function public.transfer_ownership(text) from public, anon;
grant execute on function public.transfer_ownership(text) to authenticated;
