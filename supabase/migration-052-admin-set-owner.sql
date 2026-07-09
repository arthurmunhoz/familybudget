-- Migration 052: admin_set_owner — let a GLOBAL admin assign a household's owner.
--
-- Backfill (migration 051) could only auto-assign owners for unambiguous cases
-- (the admin's own household + single-member households), so multi-member
-- households can end up ownerless. This atomic, is_admin()-guarded RPC makes the
-- named member the SOLE owner of their household (demoting any prior owner),
-- keeping the one-owner-per-household invariant. Global `is_admin` already has
-- full RLS access to allowed_users; this just makes the swap atomic + validated.

create or replace function public.admin_set_owner(p_household uuid, p_email text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not public.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.allowed_users where email = p_email and household_id = p_household
  ) then
    raise exception 'member not in household' using errcode = 'P0002';
  end if;
  update public.allowed_users
    set role = 'member'
    where household_id = p_household and role = 'owner' and email <> p_email;
  update public.allowed_users
    set role = 'owner'
    where household_id = p_household and email = p_email;
end;
$$;
grant execute on function public.admin_set_owner(uuid, text) to authenticated;
