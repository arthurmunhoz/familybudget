-- 059 — Plus-aware household member cap.
--
-- Replaces the flat 6-member cap (migration 016) with: free households max 4,
-- One Roof Plus households max 12. Enforced by the same trigger so no client can
-- bypass it. Keeps raising 'household_member_limit' (the Admin UI + the join
-- flow match on that text), and includes the actual limit in the message.
--
-- household_is_plus() is SECURITY DEFINER (checks household_subscriptions'
-- expires_at), so a lapsed plan reverts to the free cap for NEW joins — but,
-- like everything else, existing members are never kicked out; a household that
-- grew to 12 on Plus and then lapsed simply can't add a 13th.
create or replace function public.enforce_household_member_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit int := case when public.household_is_plus(new.household_id) then 12 else 4 end;
begin
  if (select count(*) from allowed_users where household_id = new.household_id) >= v_limit then
    raise exception 'household_member_limit' using detail = v_limit::text;
  end if;
  return new;
end;
$$;

-- The trigger from 016 still points at this function; recreate defensively in
-- case this migration is applied on a fresh DB.
drop trigger if exists allowed_users_member_limit on public.allowed_users;
create trigger allowed_users_member_limit
  before insert or update of household_id on public.allowed_users
  for each row execute function public.enforce_household_member_limit();
