-- Targeted signals: recipients is a list of member emails; null = whole
-- household. Visibility is enforced so a targeted signal is only readable by its
-- recipients (and the sender).
alter table public.signals add column if not exists recipients text[];

drop policy if exists signals_select on public.signals;
create policy signals_select on public.signals
  for select using (
    household_id = public.current_household()
    and (
      recipients is null
      or sender_email = (auth.jwt() ->> 'email')
      or (auth.jwt() ->> 'email') = any(recipients)
    )
  );
