-- Migration 016: household member cap (applied via Supabase MCP on 2026-06-12).
-- Max 6 members per household, enforced by a trigger so the limit holds no
-- matter what the client sends. The Admin UI mirrors it with a friendly
-- message (it matches on the 'household_member_limit' exception text).

create or replace function public.enforce_household_member_limit()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if (select count(*) from allowed_users where household_id = new.household_id) >= 6 then
    raise exception 'household_member_limit';
  end if;
  return new;
end;
$$;

drop trigger if exists allowed_users_member_limit on allowed_users;
create trigger allowed_users_member_limit
  before insert or update of household_id on allowed_users
  for each row execute function public.enforce_household_member_limit();
