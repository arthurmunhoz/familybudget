-- 045: per-user token so the Home-Screen Nudges widget can send without the
-- app's login. Minted by the widget_token() RPC (client calls it), used by
-- /api/widget-nudge. Service-role only; auto-cleaned when the user/household goes.
create table if not exists public.widget_tokens (
  token        text primary key,
  user_email   text not null unique references public.allowed_users(email) on delete cascade,
  household_id uuid not null references public.households(id) on delete cascade,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz
);
alter table public.widget_tokens enable row level security;
revoke all on public.widget_tokens from anon, authenticated;

create or replace function public.widget_token()
returns text language plpgsql security definer set search_path = public as $$
declare
  tok    text;
  uemail text := auth.jwt() ->> 'email';
  hh     uuid := public.current_household();
begin
  if uemail is null or hh is null then return null; end if;
  select token into tok from public.widget_tokens where user_email = uemail;
  if tok is null then
    tok := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
    insert into public.widget_tokens (token, user_email, household_id) values (tok, uemail, hh);
  else
    update public.widget_tokens set household_id = hh where user_email = uemail;
  end if;
  return tok;
end $$;
grant execute on function public.widget_token() to authenticated;
