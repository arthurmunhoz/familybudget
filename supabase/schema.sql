-- One Roof — Supabase schema (original bootstrap; see footer for later migrations)
-- Run this in the Supabase SQL Editor (Dashboard → SQL Editor → New query).

-- Who is allowed to use the app. Add both of your Google account emails here.
create table if not exists allowed_users (
  email text primary key,
  display_name text not null
);

-- IMPORTANT: replace with the Google emails you and Patricia will sign in with.
insert into allowed_users (email, display_name) values
  ('arthurmunhoz@hotmail.com', 'Arthur'),
  ('paty_almeida@live.com', 'Patricia')
on conflict (email) do nothing;

create table if not exists budgets (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  period text not null default 'monthly' check (period in ('daily', 'weekly', 'monthly')),
  created_at timestamptz not null default now()
);

insert into budgets (name)
select 'Our Home Budget'
where not exists (select 1 from budgets);

-- A "month" row is one budget period: monthly = 1st of the month,
-- weekly = the week's start day, daily = the day itself.
create table if not exists months (
  id uuid primary key default gen_random_uuid(),
  budget_id uuid not null references budgets(id) on delete cascade,
  start_date date not null,
  created_at timestamptz not null default now(),
  unique (budget_id, start_date)
);

create table if not exists entries (
  id uuid primary key default gen_random_uuid(),
  month_id uuid not null references months(id) on delete cascade,
  type text not null check (type in ('expense', 'income')),
  label text not null,
  amount numeric(12, 2) not null check (amount > 0),
  category text not null default 'other',
  entry_date date not null,
  person_email text not null references allowed_users(email),
  recurring boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists entries_month_idx on entries (month_id);

-- Learned label → category choices (powers auto-categorization).
create table if not exists category_rules (
  keyword text primary key,
  category text not null,
  updated_at timestamptz not null default now()
);

-- Row-level security: only the two allowed users can touch anything.
-- security definer avoids RLS recursion when allowed_users checks itself.
create or replace function public.is_allowed()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from allowed_users
    where email = (auth.jwt() ->> 'email')
  );
$$;

alter table allowed_users enable row level security;
alter table budgets enable row level security;
alter table months enable row level security;
alter table entries enable row level security;
alter table category_rules enable row level security;

drop policy if exists budgets_rw on budgets;
create policy budgets_rw on budgets
  for all using (public.is_allowed()) with check (public.is_allowed());

drop policy if exists allowed_users_rw on allowed_users;
create policy allowed_users_rw on allowed_users
  for select using (public.is_allowed());

drop policy if exists months_rw on months;
create policy months_rw on months
  for all using (public.is_allowed()) with check (public.is_allowed());

drop policy if exists entries_rw on entries;
create policy entries_rw on entries
  for all using (public.is_allowed()) with check (public.is_allowed());

drop policy if exists category_rules_rw on category_rules;
create policy category_rules_rw on category_rules
  for all using (public.is_allowed()) with check (public.is_allowed());

-- ── Pet care log (migration 005) ─────────────────────────────────────────────

create table if not exists pets (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  emoji text not null default '🐶',
  created_at timestamptz not null default now()
);

insert into pets (name, emoji)
select v.name, v.emoji
from (values ('Lola', '🐶'), ('Aninha', '🐕')) as v(name, emoji)
where not exists (select 1 from pets);

create table if not exists pet_events (
  id uuid primary key default gen_random_uuid(),
  pet_id uuid not null references pets(id) on delete cascade,
  type text not null check (type in ('vet', 'vaccine', 'medication', 'grooming', 'other')),
  title text not null,
  notes text,
  event_date date not null,
  next_due date,
  added_by text not null references allowed_users(email),
  created_at timestamptz not null default now()
);

create index if not exists pet_events_pet_idx on pet_events (pet_id, event_date desc);

alter table pets enable row level security;
alter table pet_events enable row level security;

drop policy if exists pets_rw on pets;
create policy pets_rw on pets
  for all using (public.is_allowed()) with check (public.is_allowed());

drop policy if exists pet_events_rw on pet_events;
create policy pet_events_rw on pet_events
  for all using (public.is_allowed()) with check (public.is_allowed());

-- ── Document vault (migration 006) ───────────────────────────────────────────

create table if not exists documents (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  category text not null default 'other'
    check (category in ('ids', 'insurance', 'medical', 'pets', 'home', 'receipts', 'other')),
  file_path text not null,
  mime_type text not null,
  size_bytes bigint not null default 0,
  added_by text not null references allowed_users(email),
  created_at timestamptz not null default now()
);

alter table documents enable row level security;

drop policy if exists documents_rw on documents;
create policy documents_rw on documents
  for all using (public.is_allowed()) with check (public.is_allowed());

insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict (id) do nothing;

drop policy if exists documents_storage_rw on storage.objects;
create policy documents_storage_rw on storage.objects
  for all to authenticated
  using (bucket_id = 'documents' and public.is_allowed())
  with check (bucket_id = 'documents' and public.is_allowed());

-- ─────────────────────────────────────────────────────────────────────────────
-- NOTE: this file is the original bootstrap and is no longer a complete,
-- standalone setup. Later changes live in their own files — apply in order:
--   migration-004-shopping.sql   (shopping_items + realtime)
--   migration-005-pets.sql       (pet care log)
--   migration-006-documents.sql  (document vault + storage bucket)
--   migration-007-households.sql (multi-tenancy: households, admin, RLS rewrite)
--   migration-008-backdrop.sql   (household backdrop columns — applied, unused yet)
--   migration-009-web-events.sql (behavioral analytics + admin aggregates)
--   migration-010-document-owner.sql (documents.owner_email)
--   migration-011-admin-analytics-v2.sql (period param, admin exclusion, time spent)
--   migration-012-backdrop-v2.sql (households.backdrop_path: null / builtin:beach / upload)
--   migration-013-storage-constraints.sql (bucket size/mime limits)
--   migration-014-user-settings.sql (per-user hidden apps)
--   migration-015-tile-style.sql (hub tile density per user)
--   migration-016-member-limit.sql (max 6 members per household)
--   migration-017-subcategory.sql (optional free-text entry subcategory)
--   migration-018-user-language.sql (per-user interface language)
--   migration-018-important-dates.sql (birthdays, anniversaries, renewals)
--   migration-019-member-profiles.sql (family member profiles)
--   migration-020-member-avatar.sql (member profile photo)
--   migration-021-shopping-stores.sql (per-store shopping list sections)
--   migration-022-shopping-store-slug.sql (catalog slug for store logos)
--   migration-023-internal-household-analytics.sql (exclude dev household)
--   migration-024-pet-profile-fields.sql (pet species/breed/birthday/photo/etc)
--   migration-025-admin-recent-errors.sql (errors panel excludes testing noise)
--   migration-026-push-subscriptions.sql (web push subscriptions for daily digest)
--   migration-027-signals.sql (household one-tap signals + acks, realtime)
--   migration-028-signal-recipients.sql (per-signal recipient targeting)
--   migration-029-app-order.sql (per-user hub app ordering)
--   migration-030-rename-signals-to-pings.sql (Signals → Pings, +compat views)
--   migration-031-drop-signals-compat-views.sql (drop the temporary shims)
--   migration-032-ai-metering.sql (per-household AI scan metering + kill-switch)
--   migration-033-ai-metering-harden.sql (parameterize RPCs, service-role-only)
--   migration-034-ai-metering-revoke-client.sql (revoke anon/auth execute)
--   migration-035-calendar.sql (shared calendar_events: events, recurrence, color-by-member)
--   migration-036-google-calendar.sql (google_calendar_connections: OAuth tokens for sync)
--   migration-037-calendar-push.sql (two-way push: updated_at, time_zone, calendar_deletions)
--   migration-038-merge-dates.sql (calendar_events.kind; copy important_dates → calendar)
--   migration-039-account-deletion-and-push-tokens.sql (expo_push_tokens; delete_my_account RPC)
--   migration-040-apple-refresh-tokens.sql (Sign in with Apple token revocation storage)
--   migration-041-one-roof-plus.sql (household_subscriptions + Plus AI-scan bypass; RevenueCat)
--   migration-042-custom-categories.sql (household-defined budget categories)
--   migration-043-store-color.sql (shopping_stores.color for custom store tiles)
--   migration-044-admin-set-plan.sql (admin_set_plan RPC: toggle household Plus for testing)
--   migration-045-widget-tokens.sql (Home-Screen Nudges widget send token + RPC)
--   migration-046-apple-calendar.sql (calendar_events source='apple' + apple_event_id; on-device EventKit sync)
--   migration-047-free-plan-limits.sql (free plan: 1 budget max trigger + free_monthly_cap=3)
--   migration-048-admin-comp-plan.sql (admin_set_household_plan + admin_household_is_plus: comp any household to Plus)
--   migration-049-pet-tag-color.sql (pets.tag_color: per-pet calendar dot color)
--   migration-050-nudge-presets.sql (ping_presets table + pings.high_priority + seed_ping_presets)
--   migration-051-self-serve-onboarding.sql (allowed_users.role owner/member + household_join_codes + create_household/join_household/get_join_code/rotate_join_code/remove_member RPCs)
--   migration-052-admin-set-owner.sql (admin_set_owner: global admin assigns a household's owner)
--   migration-053-admin-delete-household.sql (admin_delete_household: cascade-delete a household + all its data)
--   migration-054-delete-custom-category.sql (delete_custom_category: remove a custom category + reassign its entries/rules to 'other')
--   migration-055-custom-categories-update-policy.sql (household-scoped UPDATE policy on custom_categories — edits were silently RLS-blocked)
--   migration-056-category-overrides.sql (per-household name/icon overrides for the built-in preset categories)
--   migration-057-set-display-name.sql (set_display_name: a member can rename themselves — Apple sign-in leaves no name in the JWT, so they were stuck with the email local-part)
--   migration-058-private-budgets.sql (budgets.visibility/owner_email + budget_members + can_see_budget/is_budget_member/is_budget_owner/can_see_month; months+entries now inherit the budget's visibility)
--   migration-059-plus-member-limit.sql (household member cap is now Plus-aware: free 4, Plus 12 — replaces the flat 6 from migration 016)
--   migration-059-admin-household-events.sql (admin_household_events: recent interpreted activity feed for one household — clicks/session_start/error from web_events, admin accounts excluded)
--   migration-060-household-plan-admin-free.sql (current_household_plan: returns {plus, admin_free} so the mobile client can suppress the RevenueCat OR when an admin forced Free for testing — fixes the Plus preview toggle not turning off)
--   migration-061-admin-recent-events.sql (admin_recent_events: cross-household recent-activity feed for the Admin Activity tab — returns household_id, excludes admin accounts + internal households)
--   migration-062-activity-feed-v2.sql (semantic events: feed RPCs now return meta + filter out page_view/screen_view; admin_app_usage counts screen_view; partial index web_events_activity_idx)
--   migration-063-admin-event-usage.sql (admin_event_usage: per-event-type counts for the admin "Feature usage" view — what's used vs not)
--   migration-064-backfill-budget-owner.sql (data: assign pre-058 ownerless budgets to their household owner so the owner controls privacy)
--   migration-065-member-locations.sql (member_locations: one row/member with latest fix + sharing/paused_until state, household-scoped RLS + Realtime — backs the Whereabouts family-location app)
--   migration-066-location-live-requests.sql (location_live_requests: watcher→target "live mode" requests; target ramps up to high-frequency GPS while watched, then relaxes)
--   migration-067-places-and-geofences.sql (places + place_events: saved household places monitored as native geofences; arrive/leave events drive the activity feed + household push)
--   migration-068-safety-watches.sql (safety_watches: temporary "event mode" circle — watch chosen members and alert when one leaves the radius; breach detection runs on the watcher's device; One Roof Plus)
--   migration-069-pet-care-routines.sql (Pet Care redesign: pet_care_tasks daily/interval routines + pet_task_done completions + pet_weights log; RLS through pets)
--   migration-070-place-watchers.sql (place_watchers: per-user opt-in to a place's alerts + whose crossings to hear about; drops the old place-level notify flags that notified the whole household)
--   migration-071-place-event-state-transitions.sql (record_place_event(): a crossing is recorded only when it CHANGES state, so standing inside a place can't re-fire "arrived" on every app open; advisory-locked against the two-device race, and a "leave" with no prior "arrive" is dropped)
--   migration-072-whereabouts-free-plan-limits.sql (free plan: ONE place per household, and ONE safety-radius watch per rolling 24h capped at 30 min — both BEFORE triggers on household_is_plus, existing rows grandfathered; safety_watch_starts logs session starts because stopWatch deletes the watch row)
--   migration-073-safety-radius-free-time-budget.sql (free Safety Radius is 30 MINUTES OF USE per rolling 24h, not one session: safety_watch_starts becomes safety_watch_usage with started_at/ended_at, an AFTER DELETE trigger refunds unused time on an early stop, and free_watch_remaining_seconds() is the single source both the trigger and the client read)
--   migration-074-place-watch-requires-a-direction.sql (place_watchers CHECK: a subscription must have at least one of notify_arrivals/notify_departures — a row with neither read as "subscribed" in the UI but could never match the direction filter in the push fan-out, so it was silent forever)
--   migration-075-gcal-token-column-grants.sql (SECURITY: migration 036's column-level revoke was a no-op under the table-level grant — google_calendar_connections OAuth tokens were readable by any signed-in user; table SELECT is now revoked and re-granted as a column list of status fields only)
--   migration-076-revoke-internal-function-execute.sql (SECURITY: `revoke ... from public` never removed Supabase's anon/authenticated default grants — free_watch_used_seconds(text) (cross-household usage probe) and gen_join_code() are now explicitly revoked; free_watch_remaining_seconds() stays granted)
--   migration-077-fix-mutable-search-path.sql (pins `set search_path = public` on touch_member_location, touch_live_request and free_watch_minutes — the last functions resolving unqualified names against the caller's search_path)
--   migration-078-delete-account-clears-location-data.sql (delete_my_account also erases the caller's member_locations, place_events, location_live_requests and safety_watches — location PII used to survive deletion for any member who wasn't the last in their household)
--   migration-079-revoke-widget-token.sql (revoke_widget_token(): a user can delete their own widget_tokens row, so signing out actually kills the Home-Screen widget's bearer token)
--   migration-080-place-events-retention.sql (place_events_delete policy — a member can erase their own location history — plus prune_place_events(p_days) for retention; deliberately NOT scheduled and NOT run)
--   migration-081-drop-is-allowed.sql (drops the legacy, household-UNSCOPED is_allowed() helper — verified referenced by no policy/view/constraint/default/function)
--   migration-082-nudge-push-once.sql (pings.pushed_at: api/send-ping.ts claims a nudge before fanning out, so the same ping_id can never push twice)
--   migration-083-ai-light-metering.sql (ai_light_usage + ai_light_allowed/ai_light_record: per-household daily abuse ceiling + spend accounting for the cheap AI endpoints — suggest-ping, suggest-stores — kept separate from the scanners' free_monthly_cap)
--   migration-084-plus-trial-on-signup.sql (create_household() grants a 30-day Plus trial: household_subscriptions row with plan='plus', product='trial', expires_at=now()+30d — every existing gate opens/closes off expires_at with no new gating code. current_household_plan() additively reports trial_ends_at + trial_expired; admin_start_trial() re-arms a trial for device testing and refuses to overwrite a real purchase)
--   migration-085-db-driven-push-fanout.sql (the DATABASE asks for the push fan-out, not the sender's phone: AFTER INSERT triggers on pings + place_events call api/send-ping through pg_net, plus a per-minute pg_cron sweeper for anything still unpushed. place_events.pushed_at gives crossings the same one-shot claim pings already had, so trigger/sweeper/phone can all ask and exactly one push happens. URL + INTERNAL_PUSH_SECRET live in vault.secrets, never in the file)
--   migration-086-delete-account-with-data.sql (delete_my_account() works for members with data: entries.person_email / shopping_items, documents, pet_events .added_by become nullable ON DELETE SET NULL, budgets.owner_email SET NULL; the leaver's private budgets are deleted; a last member's household rows are deleted explicitly before the household — households FKs stay NO ACTION so admin "Delete household" still refuses a household with data)
--   migration-087-admin-overview.sql (Admin that stays fast: web_events created_at index; allowed_users.last_seen_at kept by a trigger on web_events; admin_overview(tz) today/7-day counts + series; admin_recent_visitors(lim, before) keyset-paged; admin_households(lim, off, q) paged + searchable)
--   migration-088-assistant-gaps.sql (assistant_gaps: what the Home assistant couldn't do — kind 'unknown' carries the MODEL'S anonymised English rewrite (never the request text), kind 'failed' only intent + reason code. Service-role writes only, is_admin() reads only, rows >90 days deleted on each insert)
--   migration-089-assistant-free-quota.sql (assistant_usage: the Home assistant's product quota — free households get 5 requests per MEMBER per calendar month (UTC), Plus and the signup trial unlimited. assistant_quota(household, email, cap) answers before the model call, assistant_use(email) counts after a parsed answer; both service-role only, separate from the 083 daily abuse ceiling)
--   migration-090-family-games.sql (family games, phase 1: game_sessions (public state JSON, household RLS read-only) + game_players + game_secrets (no client access — the hangman word lives here). Every move is a security-definer RPC that checks household, player and turn: game_create/join/set_team/set_ready/leave/cancel/start/skip_turn + hangman_set_word/guess/guess_word/next. Both read tables are in the supabase_realtime publication)
--   migration-091-game-invites.sql (user_settings.notify_games default true = per-member opt-out for game pushes; game_sessions.pushed_at one-shot claim; AFTER INSERT trigger on game_sessions → request_push_fanout({action:'game-invite'}) → api/send-ping pushes 'X opened a room' to the other members with notify_games on, in each member's language, data.url /games/<id>)
--   migration-092-hangman-send.sql ("send a hangman": hangman_send(recipients, category, word, lang) creates one one-round async session per recipient (sender = setter team A, recipient = only guesser team B) straight into phase guessing; hangman_finish_round marks async sessions done and asks api/send-ping action 'game-result' to tell the sender (one-shot on result_pushed_at); the 091 insert trigger now announces async sessions too, to the recipient only)
--   migration-093-battleship.sql (live battleship, team vs team: fleets live ONLY in game_secrets.data.fleet.{A,B}; battleship_my_fleet returns the caller's own team's fleet; battleship_set_fleet (any teammate, partial while placing, bumps state.rev), battleship_ready (full fleet required; both ready → battle, team A first), battleship_fire (server answers hit/sunk; hit = same shooter again, miss = other team's next player; all sunk → done + winner). game_create/start/leave/skip_turn now branch on game. Cells compared by exact r/c — jsonb @> ignores order inside arrays)
--   migration-094-quiz.sql (live buzzer quiz, team vs team: quiz_questions bank table (clients can't read it — answers); game_start loads N random questions in the session's language into game_secrets.qids, current accepted answers in game_secrets.answers; quiz_buzz (row lock → first press the SERVER receives wins), quiz_answer (tolerant match: quiz_norm folds accents/case/articles, quiz_lev allows 1–2 typos on longer answers), quiz_tick (anyone; advances only when the server's own clock passed state.deadline), quiz_next (skip the reveal). Wrong/slow → locked out of that question, reopened for the rest)
--   migration-095-quiz-bank.sql (GENERATED by mobile/scripts/quiz-bank.py — the question bank, pt/en/es; re-runnable, replaces the bank)
--   migration-096-game-room-limits.sql (one live room per host: game_create raises has_room unless p_replace; game_sweep() closes live rooms idle 15 min as ended=expired; game_players changes bump game_sessions.updated_at)
--   migration-097-quiz-no-repeat.sql (quiz_questions.qkey = md5(lang|question); quiz_seen per household; game_start serves never-seen questions first, then the longest-ago seen)
--   migration-098-pet-reminders.sql (pet_care_tasks.remind_at time — optional approximate time of a routine; user_settings.notify_pets boolean default true — per-member opt-in. Reminders are LOCAL notifications scheduled on each phone (remind_at + 45 min, skipped once a pet_task_done row exists); no server logic, RLS unchanged. 090–097 are the Games migrations)
--   migration-099-multi-household.sql (one account, several households: household_members (household_id, email, role, display_name, joined_at) is the source of truth, backfilled from allowed_users; allowed_users stays one row per person and its household_id/role now mean the ACTIVE household; current_household() = active if still a member, else the first membership; my_households() / set_active_household(id) / leave_household(id, new_owner) + join_household / create_household that ADD a membership; remove_member / get_join_code / rotate_join_code act on the active household; member cap moved to household_members; switching re-stamps push tokens / web-push subscriptions / widget token; admin_set_owner, admin_delete_household and delete_my_account work on memberships; allowed_users / member_profiles / budget_members policies see co-members of the active household)
--   migration-100-photo-frame.sql (Utilities › Photo frame: frame_photos = the household's shared family album, bytes in `documents` at <household_id>/frame/<uuid>.jpg; household RLS, delete own / owners any, only member_email (tag) changes after insert; BEFORE INSERT trigger on household_is_plus caps it at 30 free / 500 Plus (free_plan_frame_limit / frame_photo_limit), frame_photo_quota() for the app's count; added to supabase_realtime. 088/089 precede it; 090–099 are reserved by other work)
--   migration-101-games-multi-household.sql (hangman_send checks recipients through household_members, after 099)
--   migration-102-game-left-by.sql (game_leave stamps state.left_by when a game ends because a team emptied)
--   migration-103-quiz-sound-alike.sql (quiz_answer(p_session, p_text, p_alts default null) — right if the spoken text OR any recogniser alternative matches, the matching one is shown; quiz_sound() sound-alike key (spellings folded, vowel runs → a; same key from 4 letters, ±2 from 8); quiz_homophones (number words: two ← to/too/true/chew, three ← tree …). Old 2-arg calls still resolve)
--   migration-104-extra-family-plus.sql (creating ANOTHER family: only the OWNER of an active family with a PAID Plus (trial doesn't count) — 'plus_required' / 'plus_owner_required'; the new family rides on that Plus via households.plus_from/plus_by, read by household_is_plus(); the payer can't hand it over while paying — 'plus_owner'; max 3 families per account on create AND join — 'household_limit')
--   migration-105-modo-casa.sql (Modo Casa: home_devices (paired tablets) + home_pair_codes (service-role pairing, api/widget.ts ?action=casa-start|claim|poll) + home_settings (Money PIN hash); home_trial_ends()/home_plan(): 30 days from the first tablet, then display-only without Plus)
--   migration-106-casa-home-loc.sql (home_pair_codes.home_loc: the phone's home city handed to the device at pairing)
--   migration-107-pet-task-time.sql (pet_care_tasks.at_time: a routine item's time of day, orders the day)
--   migration-108-budget-icon.sql (budgets.icon: an emoji per budget)
--   migration-109-quiz-synced-start.sql (quiz: state.opens_at lead-in per question — question 1 waits for every phone's quiz_ready (max 12 s) then opens 3 s later; quiz_buzz refuses before it; game_server_now() for round-trip clock sync)
--   migration-110-game-rematch.sql (game_rematch: "Play again" — the first tap creates the room and stores it in the finished game's state.rematch; everyone else joins THAT room on their old team)
--   migration-111-security-hardening.sql (security review: Modo Casa device sessions bound + ended server-side on unpair, kept out of documents/location, money behind a server-checked PIN; home_devices/households column limits; own-row tables pinned to my households; join_household counts wrong codes; CSPRNG join codes)
--   migration-112-drawn-notes.sql (pings.image_path: a hand-drawn note PNG under <household>/notes/; Modo Casa may read notes)
--   migration-113-note-wall.sql (note_favorites: a member keeps a drawn note with a heart; notes stay on the wall; Modo Casa only reads notes sent to the whole household)
--   migration-114-note-hide.sql (note_hidden: a recipient takes a drawn note off THEIR wall; the sender deletes it for everyone via pings_delete)
