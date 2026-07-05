-- 050: Editable per-household nudge presets + a general high-priority flag.
--  • ping_presets: the family's editable set of one-tap nudges. `label` is the
--    custom text; `preset_key` localizes a seeded default (pings.preset.<key>)
--    until someone edits it. `high_priority` = the "Need Help"-style urgent type.
--  • pings.high_priority: carried on each sent nudge so the banner / push key off
--    the flag instead of the old kind='help' special-casing.
create table if not exists public.ping_presets (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null default public.current_household()
                references public.households(id) on delete cascade,
  emoji         text not null default '📣',
  label         text,
  preset_key    text,
  high_priority boolean not null default false,
  sort_order    int not null default 0,
  created_at    timestamptz not null default now()
);
alter table public.ping_presets enable row level security;

drop policy if exists ping_presets_select on public.ping_presets;
create policy ping_presets_select on public.ping_presets
  for select using (household_id = public.current_household());
drop policy if exists ping_presets_insert on public.ping_presets;
create policy ping_presets_insert on public.ping_presets
  for insert with check (household_id = public.current_household());
drop policy if exists ping_presets_update on public.ping_presets;
create policy ping_presets_update on public.ping_presets
  for update using (household_id = public.current_household())
  with check (household_id = public.current_household());
drop policy if exists ping_presets_delete on public.ping_presets;
create policy ping_presets_delete on public.ping_presets
  for delete using (household_id = public.current_household());

alter table public.pings add column if not exists high_priority boolean not null default false;

-- Seed the built-in defaults for the caller's household if it has none. Safe to
-- call repeatedly (no-ops once any preset exists).
create or replace function public.seed_ping_presets()
returns void language plpgsql security definer set search_path = public as $$
declare hh uuid := public.current_household();
begin
  if hh is null then return; end if;
  if exists (select 1 from public.ping_presets where household_id = hh) then return; end if;
  insert into public.ping_presets (household_id, emoji, preset_key, high_priority, sort_order) values
    (hh, '🆘', 'help', true, 0),
    (hh, '🚗', 'omw', false, 1),
    (hh, '⏰', 'late', false, 2),
    (hh, '🍽️', 'dinner', false, 3),
    (hh, '🛒', 'grab', false, 4),
    (hh, '👋', 'love', false, 5);
end $$;
grant execute on function public.seed_ping_presets() to authenticated;
