-- 046: Free-plan limits for the Money app.
--  • Non-Plus households may keep only ONE budget — a BEFORE INSERT trigger
--    rejects a second. Enforced server-side so the client gate can't be bypassed.
--  • Lowers the free AI-scan allowance to 3 per month (Plus stays unlimited) —
--    this is the "launch lever" anticipated in migration 041.

-- household_id carries its column default (current_household()) BEFORE row-level
-- BEFORE-INSERT triggers fire, so new.household_id is already populated here.
-- Existing free households with more than one budget are grandfathered (the
-- trigger only blocks NEW inserts).
create or replace function public.enforce_free_budget_limit()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not public.household_is_plus(new.household_id)
     and (select count(*) from public.budgets where household_id = new.household_id) >= 1 then
    raise exception 'free_plan_budget_limit'
      using errcode = 'check_violation',
            hint = 'One Roof Plus is required for more than one budget.';
  end if;
  return new;
end $$;

drop trigger if exists trg_free_budget_limit on public.budgets;
create trigger trg_free_budget_limit
  before insert on public.budgets
  for each row execute function public.enforce_free_budget_limit();

-- Free households: 3 AI scans per month (receipt + bill combined). Bill scans are
-- already Plus-only in the app, so for free users this is effectively 3 receipt
-- scans/month. Plus households bypass the cap in ai_scan_allowed.
update public.ai_config set free_monthly_cap = 3;
