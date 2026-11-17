@AGENTS.md

# One Roof — native iOS app (Expo) — guide for developer agents

This is the React Native / Expo rewrite of the One Roof PWA (which lives in the
parent `family-budget/` repo). It reuses the same **Supabase** backend (same
project, same tables, same RLS). Goal: PWA parity on iOS + App Store readiness.
Architecture, systems, remaining setup, and the improvement backlog are in
`DOCUMENTATION.md` (the official app doc) — read it.

## Stack
- **Expo SDK 56 + expo-router** (file routes in `src/app/`), TypeScript, React 19.
- **Supabase** via `@/lib/supabase` (Keychain session via
  `@/lib/secureSessionStore` + url-polyfill, `flowType: 'pkce'`). RLS is
  the security boundary — NEVER filter `household_id` client-side for security;
  column defaults stamp `household_id`/`created_by`/`sender_email`/etc. on insert.
- **Private budgets (migration 058)**: a budget is `visibility='household'` by
  default; a Plus member can make one `'private'` (owner = `budgets.owner_email`,
  share list = `budget_members`). **months and entries reach the household
  THROUGH budgets** — hiding the budgets row alone leaves every period and entry
  readable, so all three policies go through `public.can_see_budget()`. A SELECT
  policy on budgets must test the row's own columns and must NOT call a definer
  function that re-queries budgets: that runs on its own snapshot, can't see the
  row being inserted, and breaks `INSERT ... RETURNING` — which PostgREST always
  emits (this bit us; see `is_budget_member`). Plus is gated by a TRIGGER on the
  transition INTO private, never a blanket check: a lapsed plan must never
  un-private a budget or lock its owner out. **Anything using the SERVICE ROLE
  bypasses all of this** and must filter visibility by hand (see the `budget`
  action in `api/widget.ts`).
- No NativeWind/Tailwind — styling is the theme + `StyleSheet`/inline.

## Conventions (reuse these — don't reinvent)
- **UI primitives** `@/components/ui`: `Screen`, `AppHeader`, `Card`, `Btn`,
  `Field`, `Txt({variant})`, `EmptyState`, `Loader`. Build every screen from these.
  **On/off switches are `@/components/Toggle`, never react-native's `Switch`** —
  one look app-wide (Android: accent thumb, soft-accent track on / neutral off;
  iOS: accent track), and it takes no colour props so screens can't drift again.
  Also `@/components/Toast` (self-dismissing confirmation, feed it a NEW object
  each time) and `@/components/DraggableList` (long-press-to-drag sortable —
  device-verified working). Reorder needs `react-native-draggable-flatlist`? No:
  it uses `useAnimatedGestureHandler`, REMOVED in reanimated 4 (we're on 4.3.1) —
  DraggableList is a small custom sortable on the modern `Gesture.Pan` +
  reanimated-4 APIs instead. The app-wide `<GestureHandlerRootView>` lives in
  `_layout` (added 2026-10-23 — there was none, and the only root on Settings
  sat INSIDE its ScrollView around the hub-apps list, where a root's recognizer
  can block the scroll view's pan: Settings "couldn't scroll"). Gestures inside
  a RN `<Modal>` still need the modal's content wrapped in its own root (the
  app one doesn't reach a modal's separate native hierarchy) — see
  `NudgeSettings.tsx`. Never add one anywhere else, least of all inside a
  scroller. DraggableList picks a row up after a 350 ms hold; shorter lifted
  rows when a finger rested a moment before scrolling.
- **Forms: `@/components/form`** (2026-11 redesign — "inset grouped list").
  A form is `FormSection`s of compact rows, not a stack of labelled boxes:
  `TextRow` (label left, input right-aligned), `NoteRow` (multi-line),
  `SelectRow` (current value in the row, options in a checked `SelectSheet` —
  use it instead of a wall of chips for any list longer than ~3), `DateRow`
  (platform date pop-up, × clears), `NumberBox` + `UnitButton` for measures
  ("170 lb ⌄" — the unit is a small chip that opens a list, not a visible
  segmented pill). Accent is for what's actionable (unit chips, checkmarks,
  the primary button), not for every selected chip. Sheets nest inside the
  row's tree (sibling Modals fail on iOS).
  **The 2026-11 sheet look on top of these rows:** `icon={<RowIcon Icon={…}
  tint={appColour} />}` on any row (FormRow/TextRow/NoteRow/SelectRow/DateRow)
  puts a tinted tile before the label; `UnitButton` takes the same `tint`; the
  head is a tile/photo + tracked kicker + the main field typed large; Save is a
  docked `TintButton` in the app's colour (`inline` makes it a plain pill
  inside a card). `EditProfile` (Family purple) and Pet Care's `VisitForm` are
  the references. Family's empty profile is `EmptyProfile` in `Family.tsx`.
  A filled profile (`MemberDetails` in `apps/family/MemberDetail.tsx`) has NO
  wrapping card: birthday is a `CARD_GRADIENT.birthday` card, phone a tile row
  with a green "Call" pill (not on your own profile), short fields a 2-column
  grid of stat tiles each with its own `APP_GRADIENT` icon (`FIELD_LOOK`), and
  allergies/notes kicker + text tiles. Tiles have a hairline border and no `elevation`.
  Under the birthday card sits `MemberToday` ("Today for Sam", 2026-11): that
  member's calendar today (owner_email = them; else their next event), expenses
  they logged today (+ 7-day total), Whereabouts place/last seen + battery
  (only when sharing, gated on `WHEREABOUTS_ENABLED`) and items they added to
  the shopping list today. Plain RLS reads, so private budgets just don't count.
  It shows on an empty profile too.
  `ConvertSheet` heads with the field's own `FIELD_LOOK` gradient tile, units
  are tiles (stored one in the gradient); the Birthday page is a
  `CARD_GRADIENT.birthday` countdown + stat/fact tiles + kicker sections. Pet
  Care's no-pets state is `EmptyPets` (same shape as `EmptyProfile`), and
  `PetEditor` rows carry pets-orange `RowIcon`s + a `TintButton`. `DayRow` takes
  `icon`. `Toggle` takes an optional `tint` — the sheet's APP colour only.
  `AnimatedLock` (components/) is the private-budget padlock: shackle lifts when
  off, clamps shut with a bounce when on.
  Money's `FormSheet` takes `icon` + `colors` (+ `kicker`) for the 2026-11 head
  (gradient tile, kicker, display title, no footer hairline); without them it
  keeps the plain head (EntryForm/categories still do). Months' new-period,
  rename, "…" menu and `BudgetAccessSheet` use the budget's own `budgetLook`
  gradient; `TintButton` takes `colors` for that. Money's `DatePickerModal` is
  now a thin wrapper over the shared `PickerSheet` (takes `tint`).
  `EntryForm` takes `colors` + `kicker` (MonthDetail passes the budget look +
  period): head tile, RowIcons, pills/category grid/Add and the Save
  `TintButton` follow the budget colour via a local `LookContext`, which
  `ManageCategoriesSheet` also accepts (`colors`). The category is picked ONLY from the
  chip under the amount; Description and Subcategory are plain free-text rows
  — no second category strip, no used-before subcategory pills (owner,
  2026-11). Only a scanned receipt prefills the subcategory (`initial`). The amount hero stays
  red/green (expense/income semantics). `ToggleRow` takes `icon` + `tint`.
  MonthDetail's bottom Scan / New entry bar MUST use `useBottomGap` (it used
  half the inset and sat under the Android nav bar).
- **Background is soft grey-white, not cream (2026-11).** Glass light tokens:
  every branded scheme's light wash base is `#F2F2F3`, `sheet` is `#F6F6F7`,
  and text greys/border are neutral (`#1E1E22`/`#66666D`/`#6E6E75`). The NATIVE
  splash (`app.json`, `#FBF6F0`), `LaunchIntro`'s BG and the widget bg are
  still cream — they must change together and need a native rebuild.
  Calendar's `EventForm`: kind chips are neutral with the selected one as soft
  wash + outline; rows carry RowIcons; `DateTimeRow`/`InputRow` take `icon`.
  `HOUSEHOLD_COLOR` (clay) is data colour for household events — not restyled.
- **Assistant gaps (migration 088, 2026-11):** what the Home assistant
  couldn't do is logged to `assistant_gaps` for Admin › Usage — and the
  request TEXT is never stored. `unknown` rows carry the MODEL'S anonymised
  English rewrite (schema field `gap`); `failed` rows only `intent` + a reason
  code, reported by the app via `reportGap()` → `suggest-ping?action=assistant-gap`.
  Keep it that way: web-style analytics are readable by the global admin across
  every household.
- **Assistant events** (`locateEvent` in lib/assistant): finds the event by
  loose title on a day, or its NEXT occurrence (recurring series expanded).
  `move_event` keeps the length; `remove_event` / `edit_event` (rename, place,
  note, reminder) work on anyone's event (RLS). A recurring one asks first:
  move / delete the WHOLE series, or stop it from that day (`recurrence_until`)
  — one occurrence can't be expressed. Events from a connected Apple/Google
  calendar are refused (the next sync would undo it). Calendar accepts
  `?date=YYYY-MM-DD`; Documents accepts `?open=<id>` (inside VaultGate).
  **Whose event (2026-11-14):** move / remove / edit / find carry `person`
  ("o dentista do Pedro", "Sam's dentist") → `eventWho()` (askActions: a
  member → matched by `owner_email`; anyone else, e.g. a child without an
  account → by the first name in the TITLE, "Dentista Pedro"). The matching is
  the pure `pickOccurrence()` (tested): every title that has all the words
  said counts ("dentista" fits "Dentista" AND "Dentista Pedro"); when two
  DIFFERENT events are left and nothing said (person, day) tells them apart
  it's `ambiguous` and the app answers `whichEvent()` — the candidates as
  tappable rows (who · day, time) that carry the move/remove/edit out on that
  exact occurrence (`moveAnswer` / `removeAnswer`). Never "the first one"
  again. Occurrences of ONE series are not a question (the soonest). A
  model `ref` is overridden when it isn't the person named, or when no
  person/day was said and the title fits several people's events.
  `ActionRowData.onPress` / `PickRow.pick` is the generic tappable row.
- **Assistant, pets (2026-11-14):** the rule for vet visits — a pet of the
  household named with TODAY, a past day or no day ("marca uma consulta da
  Aninha hoje", "a Lola tomou vacina") is `pet_log` (a `pet_events` row);
  only a FUTURE day ("agenda o veterinário da Lola sexta às 10") is
  `add_event` on the calendar. `pets_due` has `pet_view`: `due` (what's left
  today — with no pet named, every pet, the answer grouped per pet),
  `routine` ("quais são as rotinas da Lola?": daily items with their time and
  today's tick + interval routines with next due, `petRoutine()`), `overdue`
  ("algum cuidado atrasado?"). `pet_next` takes one pet, several
  ("Lola, Aninha") or all, and lists interval routines (last done +
  interval) next to events with a `next_due`. The app sends `petKinds`
  ("Lola = dog") so "as cachorras / the dogs / los gatos" = every pet of that
  species. The old "pet name + routine word → pets_due" override in
  `understandWithSource` only replaces READ answers (`PET_SWAPPABLE`) — it
  turned "a Chloe tomou a vacina hoje, próxima em 1 ano" into a question.
- **Cut-off requests never write** (`lib/assistantGuard.ts`, pure, also used
  by the eval): a request ending on an article / preposition / "and" ("marca
  uma consulta da", "add milk to the") that the server read as a WRITE becomes
  `need_detail`. The system prompt also tells the model to leave a cut slot
  empty. Eval cases with `"safe": true` pass only when the app wouldn't write;
  cases can override the fixture with `context` and accept `{"anyOf": [...]}`.
- **Assistant is Plus (migration 089):** free households get 5 requests per
  MEMBER per calendar month (UTC); Plus and the signup trial are unlimited.
  The server checks `assistant_quota` before the model call (402
  `assistant_limit` when out — the app answers `limit_reached` with the way
  to `/paywall`, never the local parser) and counts with `assistant_use`
  after a parsed answer, returning `quota {used, cap}` / `{plus}`; AskSheet
  shows "n of 5 left" above the input for free members. Fails OPEN if the
  RPCs error. Cap = `ASSISTANT_FREE_MONTHLY` in api/suggest-ping.ts.
- **Assistant, how a request flows (2026-11 review):** `understandWithSource`
  in `lib/assistant.ts`. The local regex parser (`localParse`) is ONLY the
  fallback when the server is unreachable or says `unknown`. When the server
  names a known intent but a slot is missing (`fromServer` → null), the app
  answers `need_detail` (asks for it, `ask.need.*`); an intent this build
  doesn't know → `needs_update` ("update the app"). Never let the regexes
  guess there: "apaga o gasto do X" read as a list item. `localParse` also
  refuses list intents when the words say money/calendar (`NOT_LIST`).
  Refs: `recentContext()` sends the last 8 entries (`e1…`) and the coming
  events (`v1…`, 3 days back to 45 ahead) and keeps a ref → row map; the
  server returns `ref`, and `locateEvent` / `lastEntry` act on exactly that
  row before falling back to name matching. AskSheet loads the whole context
  once when it opens (`loadContext`) and refreshes it after every answer.
  Gaps: `local_guess` / `need_detail` / `needs_update` are reported as
  codes. Server: `parseAssistant()` is exported (pure parse, no auth);
  the GROUPED schema is the default (slots nested per area, flattened back so
  the app sees the same shape; eval 56/56 at ~126 output tokens vs ~227 flat);
  `ASSISTANT_SCHEMA=flat` (Vercel env) falls back to the flat one. Run the eval before every assistant deploy:
  `ANTHROPIC_API_KEY=… npx --yes tsx scripts/assistant-eval.ts both`; add
  every phrase that misfired on a device to `scripts/assistant-eval.json`.
- **Assistant, newer actions (2026-11):** data in `lib/assistantActions.ts`,
  wording in `components/home/askActions.ts`, one generic `ActionView` (headline,
  rows, Undo / two choices / Open). AskSheet hands any intent it doesn't handle
  to `actMore()`. Every write returns what its Undo needs. Context sent to
  Claude also has `PET TASKS` and `CATEGORIES`. Each new intent ships in the
  APP (the server only understands), so it needs a store release; older apps
  get null from `fromServer` and fall back.
- **Roof review (2026-11-17) — talk rules, new intents, Modo Casa money.**
  - `lib/assistantTalk.ts` = what is settled ON THE DEVICE before any server
    call: `isYes` / `isNo` / `pickByVoice` (answers to Roof's own question —
    "sim", "cancela", "o segundo", "Costco"), `isUndoAsk`, `isRepeatAsk`,
    `clockAsk` (time, date, bare "bom dia" → day_summary). `src/casa/talk.ts`
    is a BYTE COPY; `__tests__/assistantTalk.test.ts` fails when the two (or
    the two `KNOWN_INTENTS` lists) drift — edit the phone file, then `cp`.
  - AskSheet `answerHere()` runs those against the answer on screen
    (`awaiting()`): an unsent nudge, chooseBudget, chooseStore, an action's
    choices / pick rows. A yes/no to a waiting answer beats `isGoodbye` ("ok").
    Modo Casa does the same in `Roof.tsx` `ask()` (`pendingPick`, `lastDone`),
    asks a "which one?" ALOUD and listens; silence leaves the pick up for a tap.
  - `then` (server, top-level): a SECOND task said in the same breath, as a
    standalone request; both apps ask it right after the first answer (max 2
    chained, never after an answer that is itself a question).
  - Spoken text ≠ history text: `spokenText()` cuts long lists / agendas to a
    few rows + "e mais N"; `summarize()` stays the full line sent to Claude.
  - New intents (need THIS app version; older apps answer `needs_update`):
    `create_list`, `edit_item` (items = old label, title = new), `my_nudges`,
    `ask_location` (a location-request nudge, sent on a tap / "sim"),
    `free_check` (timed events only; all-day rows never make anyone busy),
    `pet_who` (`pet_task_done.done_by`), `call_member` (`tel:` via `go()`),
    `days_until`. An `unknown` answer is NOT counted against the free month.
    The server logs `roof_ms` per request (Vercel logs).
  - **Usage (migration 117):** every request logs ONE `roof.asked` web_event
    (phone: AskSheet `submit`; Modo Casa: `note()` in Roof.tsx `ask`). meta =
    `intent` (or `reply` / `clock` / `capabilities` for what the device
    settled itself), `via` voice|typed, `where` phone|casa, `ok`, `chained` —
    never the words. Admin › Usage › "Uso do Roof" reads
    `admin_roof_usage(days)` (per intent·via·where + a total row); like every
    admin count it leaves out admin accounts and internal households.
  - Modo Casa money (owner, 2026-11-17, replaces "money lives on the phone"):
    `add_money` by voice is allowed — unlocked it writes (with Undo); locked
    it opens Money on the PIN screen and `Hub` writes the `PendingMoney` when
    the PIN unlocks (RLS only opens `entries` then). Every money READ / fix /
    delete just opens the PIN screen. Location (`where_is`, `ask_location`)
    answers "only on the phone" — a Casa session can't read locations
    (migration 111); it used to say "isn't sharing".
- **Nudges carousel (Home, 2026-11-15):** one nudge shows full width; two or more
  sit in a horizontal snap carousel (next card peeks, dots under it). Card height
  is FIXED (`CARD_H`) for every kind — text, urgent, sent, drawing — so Home never
  jumps (owner); a drawing fills the card's height on the left with only when / seen-by / replies beside it. It replaced the
  stack + "see all" overlay. The Roof dock's mute persists per device
  (AsyncStorage `roof.paused`) until tapped again.
  Tapping a `location-request` nudge PUSH acks it, uploads a fix and lands on
  Home (`backgroundNotifications.answerLocationRequests`).
- **Admin (2026-11):** `ADMIN_LOOK` (palette.ts) — vivid indigo gradient for
  the overview card (the old navy made the week bars muddy on light) + `tint`
  for tabs/period pills (soft wash + outline), toggles, initials and Create.
  `admin/household/[id]` is in the same language: gradient-tile head, Plus
  switch row, members/add/activity/danger-zone tile cards; all strings i18n'd.
  The demo account isn't `is_admin`, so to look at these on the simulator
  bypass the `Redirect` gate temporarily (and revert).
- **Home + "Comando" look (2026-11).** The Hub is `TodaySection` (date ·
  weather · household line, "Hi, Ana. 3 things for today.", the ask bar,
  today's agenda as gradient cards — it also owns the Today WIDGET sync, so it
  must stay mounted) + banners + a 4-column grid of gradient app icons + a
  floating family dock. Colours: `components/home/palette.ts` — `APP_GRADIENT`
  per app id, `CARD_GRADIENT`, and `budgetLook(id)` (a budget keeps ONE
  gradient on every Money screen). Draw gradients with `GradientBox`
  (react-native-svg — no expo-linear-gradient in the binary). Gradients are
  identity and stay fixed in both themes; everything around them uses theme
  tokens. Light is the default appearance (theme-pref). The page background is
  now FLAT (the scheme's base colour) — the blob wash was removed 2026-11 at
  the owner's request; don't bring the pattern back. Restyling another app:
  RETHINK its screens, don't reskin them — every number shown once (no tile
  repeating a label), headline numbers in a gradient hero in that app's
  colours. Money keeps GREEN = received/in and RED = spent/out everywhere
  (`apps/budget/StatChip` = solid chips on the gradient so those stay legible),
  so budget gradients and category colours avoid green/red/orange. Money now:
  budget cards → budget screen (`TrendCard` received-vs-spent per period +
  plain period rows) → period (hero, "Where it went" stacked bar + top 5
  categories, Entries with a segmented sort, bottom: Scan receipt + New entry
  in the budget gradient). A revamped screen should feel like the Home all
  the way through, not just in one card (owner, 2026-11): a big display title
  with its state in the same faded type under it ("Shopping / 6 to buy."),
  round top-bar buttons, tiles instead of chips for the main filter, rows of a
  section grouped into ONE rounded card, uppercase tracked section labels, and
  the input as a floating capsule (Shopping is the reference).
  Shopping orders its store tiles AND sections by open items, most first
  (ties keep the household's order; `storesByCount`).
- **Today cards are styled by WHAT they are (2026-11, `home/AgendaCard`).**
  `lib/agendaKind.ts` `classifyAgenda(ev, pets, members)` (pure, pinned by
  `__tests__/agendaKind.test.ts`; pt/en/es keywords, accent-insensitive, whole
  words, `stem*` = prefix) → kind + icon + petId/memberEmail. Order: the
  event's `kind` (birthday/anniversary/renewal) → a household pet NAMED in
  title/notes/place, or a pet-care word (vet, tosa, groom…) → pet → health →
  school (before work: "reunião de pais") → travel → sport → meal → work →
  event. A vaccine word with no pet named is health. Each kind has its gradient
  in `AGENDA_GRADIENT` (palette.ts; white-text contrast checked) and a lucide
  glyph in a frosted chip + the same glyph large and faint as the card's art.
  The face bottom-right: the named pet's photo (else species emoji), else for
  birthdays the member named in the title (else the owner), else the event's
  owner (photo or initial in `memberColor`); household events have none.
  Birthday "turns N" falls back to `member_profiles.birthday` / the pet's
  birthday when the event's start year isn't the birth year. Pet care due
  cards use the pet look (`petTypeIcon(type)`). Same 236×132 footprint; a
  one-shot staggered fade/rise + glyph settle (timing, no springs, off under
  Reduce Motion). The widget payload is unchanged.
- **Weather sky (2026-11):** the Hub's header has the current weather drawn
  behind it (`home/WeatherScene`, pure SVG; `sceneFor(code, isDay)` in
  `home/sceneKind.ts` — open-meteo now also returns `is_day`): sun, partly,
  cloudy, fog, rain, snow, storm, night. Strongest top-left, faded downward
  and rightward under masks so text stays legible. The Hub drops its TOP
  safe-area edge (scroll gets `paddingTop: insets.top`) so the sky runs under
  the status bar. The day's weather alert is a quiet line under the date
  line now, not a banner.
- **`ToggleRow` toggles on a tap ANYWHERE in the row** (2026-11): inside a
  sheet's scroller a tap aimed at the small native switch could be eaten as
  a scroll start (the owner couldn't flip All day / Remind me). `PickerSheet`
  (every date/time pop-up) takes a `title` (the row's label) and has the
  sheet look: title + round ✕, the picker on a card, Done with the curve.
- **Admin (2026-11, `app/admin.tsx`) must stay fast as users grow — never
  load whole tables.** Overview = `admin_overview(tz)` (today / 7-day people
  and sessions + a 7-day series; scans only the last 8 days of web_events via
  the created_at index) and `admin_recent_visitors(lim, before)` (keyset-paged,
  reads `allowed_users.last_seen_at`, which a trigger on web_events keeps
  current, ≤1 write/member/minute). Households = `admin_households(lim, off,
  q)` (paged + searched in SQL). Activity loads 30 at a time; names are looked
  up only for the people/households on screen. All from migration 087; the
  Overview says "apply 087" if it's missing.
- **Calendar (2026-11):** round back + Google/Apple round buttons, big
  title with "n things this week" faded, then a **Day · Week · Month**
  segmented (the old "Upcoming" list is GONE — owner's call, 2026-11-11).
  One anchor date (`selected`) drives all three; swiping sideways
  (`SwipePager`: follows the finger damped, slides out/in with timing curves,
  no springs; Reduce Motion = fade) or the chevrons move one day/week/month.
  - **Month**: the grid in one card (selected = Calendar-red gradient circle,
    today soft red) + the selected day's events in detail (time range or
    multi-day span, "turns N", who with their colour dot, place, first line of
    notes). Paging months lands on today if it's in that month, else the 1st.
  - **Week / Day** share `TimeGrid`: hour gutter, all-day bars on top
    (`allDayRows`, multi-day bars span columns, max 3 rows then "+n"), timed
    blocks at their times in the OWNER's colour (opaque `c.sheet` under a
    tint — the grid is on a translucent card), a Calendar-red "now" line +
    time pill on today (refreshed every 30 s). Overlaps sit side by side:
    `calendarLayout.ts` `layoutColumns` (clusters → first free column → stretch
    right over free columns; tested in `__tests__/calendarLayout.test.ts`).
    Recurrence comes from `occurrencesByDay` as everywhere. Tap a block → the
    editor (read-only Google/Apple rows don't open); tap an empty slot → New
    event at that half hour (1 h long); tap the all-day strip → an all-day
    event. Week: a day header opens that Day. Day: a week strip above.
  - **Phone week = 7 narrow columns** (titles only, 10 pt, no times), not
    horizontal scroll or a 3-day window: the whole week stays at a glance,
    horizontal scrolling would fight the swipe-to-change-week gesture, and a
    tap on the day header zooms into Day for detail. Columns go "compact"
    only when narrower than 84 pt, so iPad portrait already gets full blocks.
  - **Wide (≥ 760 pt — iPad either way, the iPad app on a Mac):** title and
    segmented share a row, Month puts the day list BESIDE the grid (its own
    scroller), hour rows are 60 pt. Sizes come from `useWindowDimensions`, so
    split view / Stage Manager resizes re-layout live.
  - The pan only activates on a clearly horizontal drag and fails on vertical
    movement, so the hour grid's vertical ScrollView inside still scrolls.
  `EventForm`: the title typed large in the header, kind as emoji chips,
  When grouped, Who as round colour chips (`WhoPicker`), Save docked in the
  Calendar red. Google / Apple sync screens share `apps/calendar/SyncScreen`.
- **Nudges screen (2026-11):** big title; WHO as round chips (Everyone +
  members); presets as a 2-column grid of tiles (urgent = red gradient);
  "Write your own" is sent EXACTLY as typed (≤120 chars, 💬, one-off — no AI
  rewording, not saved). Settings/PresetEditor sheets in the same look.
  `components/TintButton` (moved from pets) is the shared docked gradient
  button.
- **New budget sheet (2026-11):** its own sheet in `Budgets.tsx` (not the
  shared FormSheet): the name typed in place beside a Money-green tile, the
  grouping as three equal tiles (month / week / day), the Plus-only private
  switch as one row, and "Create budget" docked in the Money gradient.
- **A new Money entry "shrinks and lands" (2026-11, `components/LandingGhost`).**
  On saving a NEW entry, `EntryForm` inserts with `.select('*').single()`,
  measures its sheet (`FormSheet sheetRef`, window coords) and re-renders the
  Modal with `animationType` 'none' ('fade' under Reduce Motion) BEFORE handing
  off (`onSaved(landing)` from an effect), so the sheet vanishes without its
  slide-out. `MonthDetail` puts a ghost card at the sheet's exact rect on a
  full-screen `pointerEvents="none"` stage, shows the returned row at once
  (`pending`, dropped as soon as the refetch replaces `entries` — an identity
  check, no effect), keeps that row at opacity 0, measures it, scrolls it into
  view INSTANTLY if it's off screen (the ghost still covers the page) and
  COMPUTES the landing spot from the clamped scroll delta — re-measuring right
  after `scrollTo` can read the pre-scroll position — and the ghost flies
  there (520 ms, `Easing.bezier(0.2,0,0,1)`, no spring):
  the amount fades out early, the row's own content (`EntryRowBody`, shared
  with the real row) fades in late, then a glow in `budgetLook` + fade reveals
  the real row. Reduce Motion (`useReducedMotion`): no flight, just the glow on
  the row and a fade. A row the list doesn't show (person filter, future
  hidden) or a measure that never answers (1.2 s) → the ghost just fades.
  Saving itself is never delayed — the ghost starts after the insert, like the
  old close. Edits land the same way (2026-11-14: the update returns the row, and
  `pending` swaps it in place of the old one until the refetch). Deletes, the
  receipt scan (it only prefills the form) and the assistant's `add_money`
  (never opens the form) keep the plain path.
  **Reanimated skips animations under Reduce Motion by default**
  (`ReduceMotion.System`: a `withTiming` jumps to its end value), so the glow
  and fade pass `reduceMotion: ReduceMotion.Never` — without it the reduced
  path showed nothing at all. Any animation that IS the reduced-motion
  fallback needs the same. Shared values are written with `.set()` (compiler
  lint). Simulator-verified 2026-11-11 (iPhone 17 Pro, both paths); Android
  not checked (a Modal there is its own window — the start rect may sit a
  status bar off). Shopping was NOT
  given this: its add capsule stays open, adds can be several items at once,
  rows swap a `tmp-` id for the server's (remount mid-flight) and the
  SectionList virtualises — it keeps its scroll-to + pulse confirmation.
- **A scanned receipt ticks off the family's lists (2026-11-14).** `scanReceipt`
  (MonthDetail) also sends `listItems: {id, name, list}[]` — the household's
  OPEN `shopping_items` (`fetchOpenList` in lib/assistant, RLS-scoped) shaped by
  `scanListPayload` (lib/receiptMatches, ≤150, "General" for no store). The SAME
  Haiku call in `api/scan-receipt.ts` then returns `matchedItems: string[]`
  (ids): the model sees refs `i1…` (not uuids), writes one short entry per
  receipt product line with the ref it bought or null (asking only for hits
  skipped the "broader kind" matches like "roupas pro Léo" ← "CAMISETA M/C
  AZ"), and the server maps refs back, dropping unknown ones. No `listItems`
  → request, prompt, schema, max_tokens and response exactly as before (older
  apps). The ids ride with the prefill (`scanMatch`) and are offered ONLY when
  that new entry is SAVED (cancel / New entry / editing drop them): after the
  landing ghost and a 320 ms beat (two overlapping Modals fail on iOS),
  `ReceiptListsSheet` (FormSheet, Lists gradient, kicker "Expense saved",
  "3 items from your lists", rows grouped by list via the pure `matchGroups`
  — re-read at save time so items bought elsewhere drop out — each pre-ticked)
  → "Remove from lists" = `checkItemIds` (the same `checked`/`checked_at`
  write as the list and the assistant's `check_items`, so Realtime moves them
  everywhere) + a `Toast` with Undo (`uncheckItems`). Toast now takes an
  optional `action` (tappable pill, stays 5 s). Nothing matched / empty lists
  → no sheet. Pinned by `__tests__/receiptMatches.test.ts`.
- **Nudge banners on the Hub (`apps/pings/NudgesBanner`, 2026-11):** a
  RECEIVED nudge is a LIGHT card with a thin Nudges-blue edge (red gradient
  only when urgent; owner 2026-11-15: the full blue was heavy),
  "From Sam · 4m ago", the message large, Got it / Call as pills inside. A
  SENT nudge is a plain card with ONE line "Seen by: Ana, Sam" (first
  names, the most recent first — a row per person grew too tall for big
  families) and an "n of total" chip; ✕ hides it on this device.
- **Hand-drawn notes (migration 112, 2026-11-15):** Nudges screen → "Recado à
  mão" card → `app/draw-note.tsx` (fullScreenModal, no swipe-dismiss — it
  fights the pen) → `apps/pings/DrawNote`: a ruled-paper sheet drawn with
  react-native-svg + a gesture-handler Pan (NO native module — works on
  shipped binaries); the eraser removes whole strokes; undo keeps 50 steps.
  Send = react-native-view-shot PNG (1080 wide) → `documents` bucket
  `<household>/notes/<uuid>.png` → `sendPing('drawing', '✏️', notes.pushText,
  …, { imagePath, expiresAt: +24h })`, so recipients, push and "seen by" are
  the normal nudge ones. The push carries `data.note` = the ping id (url stays
  '/', so older builds just open Home); a tap goes to `/?note=<id>` and
  `NudgesBanner` (prop `openNoteId` from the Hub) opens the viewer directly. `pings.image_path` must start with
  `<household_id>/notes/` (CHECK). On Home, `NudgesBanner` shows the note as a
  received note = KRAFT card (not the Nudges blue — owner) whose left half is the
  drawing bled edge to edge (middle of the sheet, cover) fading into the kraft, with
  "Ver recado" on the right (whole card opens it; OPENING a received note acks it —
  no Got it); sent
  note = the sheet beside "seen by"; `NoteViewer` opens it full
  screen sized to the PNG's shape, Salvar (left) + Fechar (right) at the bottom. Salvar downloads the PNG and opens
  the system share sheet (Save Image / gallery) — no photo-library module. Older apps just show the
  row's text. The PNGs are not deleted when the nudge expires (yet).
  `NewItemButton` takes `colors` to be a filled gradient button (white label
  + plus) — Money's New budget, New month (the budget's own gradient) and
  the calendar's New event use it.
- **Launch (2026-11):** the native splash (expo-splash-screen: cream
  `#FBF6F0` in BOTH appearances, the glass icon at 150pt) is hidden by
  `components/LaunchIntro` on its first layout — that layer starts
  pixel-identical to it, pops the icon, raises "One Roof" + tagline, and
  fades into the app once auth has resolved (≥0.9 s, ≤6 s). `_layout` keeps
  a 4 s failsafe hide. Changing the splash image/colour needs a prebuild.
  App icon = the "glass" house (assets/images/icon.png + the three Android
  adaptive layers + splash-icon.png, rendered from one SVG).
- **Several families per account (migration 099, 2026-11)** — model in the
  root `CLAUDE.md` (multi-tenancy rules). App side:
  - `lib/households.ts`: `fetchMyHouseholds` (`my_households`, [] on a server
    without 099), `setActiveHousehold`, `joinHousehold`, `leaveHousehold`,
    `householdError`, `switchForNotification`. Every change notifies
    `onHouseholdChange` listeners; `AuthProvider` re-reads profile + members,
    and when `profile.household_id` MOVES it calls `clearCache()` +
    `revalidateAll()` (useCachedQuery: runs every mounted query and every
    `useRevalidateOnForeground` screen) — the Hub stays mounted under Settings,
    so refreshing only the visible screen is not enough. Anything that holds
    household data outside those two mechanisms must key on
    `profile.household_id` (Plus, the Hub's household name and Settings'
    invite code do). `AuthProvider` also re-checks the active household on
    every foreground (it's per ACCOUNT; another device may have switched).
  - `profiles` comes from `household_members` (falls back to allowed_users):
    a member whose active household is another one would vanish from an
    `allowed_users.eq('household_id')` query. Do the same in any new members
    list (Settings' `HouseholdSection` and Admin › household already do).
  - Settings › Family is ONE card (`components/FamilySection.tsx`, 2026-11 —
    the old "My families" card + Household section repeated each other): the
    active family (tile, name, "n of max members · Owner"), its members (owner
    removes), the invite code (owner shares / resets; members see who to ask),
    then `FamilySwitcher` from `MyHouseholds.tsx` inside the same card: your
    OTHER families (tap to switch) and Join / Leave. The rows and sheets below
    still live in `MyHouseholds.tsx`:
    each family as a row with its own gradient tile (`budgetLook(id)`)
    + initial, members · Owner, and a Family-purple check that springs in on
    the active one; tap another to switch. "Join another family" opens a sheet
    (invite-code capsule that shakes on a bad code, `TintButton` in the Family
    gradient); "Leave this family" (only with 2+ families) leaves the ACTIVE
    one: a confirm, or — for the only owner of a family with members — the
    hand-over sheet to pick the new owner; alone in it, a destructive confirm
    (the family is deleted). Hidden entirely when `my_households` is missing.
  - Pushes from the api carry `data.household`; `routeFromNotification` switches
    to it (`switchForNotification`) before routing, so a tap opens the right
    family's screen. Titles carry the family name for people in several.
  - Widgets follow the active household: the widget token is re-stamped on
    switch, and `useSyncNudgeWidget` resyncs from the new `profiles`.
- **Settings (2026-11):** round back + big title + your name faded; Plus as
  a purple gradient card (features, one action inside); apps listed with
  their Home gradient tiles; tinted gradient icon tiles on every card;
  Account is one card of rows (email, sign out, delete).
  There is NO colour picker any more (owner, 2026-11): each app has its own
  gradient, and a user-chosen global accent clashed with it (a green Done in
  the pink Calendar). `SchemePrefProvider` always serves DEFAULT_SCHEME and
  clears any choice an older build saved. Pickers opened from an app take
  that app's colour (`PickerSheet tint`, via `DateTimeRow` / `DayRow`). Note the apps list
  is a DraggableList: a scroll gesture that STARTS on a row can pick it up.
- **Export family data (2026-11-13, Settings › Account, any member):**
  `lib/familyExport.ts` reads with the member's own session (RLS decides —
  others' private budgets stay out; no location, no photos) and writes one
  .zip (`lib/zip.ts`, pure-JS STORE zip, tested with `unzip -t`): CSVs with a
  UTF-8 BOM, names/headers in the app language (`export.*` keys) + optionally
  the vault files under Documents/ after Face ID. `components/ExportSheet`
  shares it from the Modal's `onDismiss` — presenting the share sheet while
  the Modal slides out silently fails on iOS. Export only, no import.
- **Wake phrase per language (2026-11-13):** pt "Oi Casa", es "Oye Casa", en
  "Hey Roof" — "Roof" with a Brazilian/Spanish R kept being missed. `CASA_CALL`
  in `lib/roofWake.ts` and `src/casa/wake.ts` (greeting + "casa" only; "casa"
  alone is an everyday word). The old "Ei Roof" spellings still work.
- **Roof — the assistant's voice (2026-11, Plus).** Two per-device prefs in
  `lib/roof.ts` (`wake` off by default, `speak` on), set in Settings ›
  Assistente Roof (`components/RoofSettings`). With both off the assistant
  works only from the mic button and answers on screen — keep that path.
  - **Wake word** (`lib/roofWake.ts`): no engine — the phone's own recogniser
    runs continuously ON-DEVICE (`requiresOnDeviceRecognition`; no on-device
    model = "unsupported", never a server fallback) while the app is open on
    the Home, and `afterWake()` matches "ei/hey/oye roof" spellings (tested in
    `__tests__/roofWake.test.ts`). Words after the call are sent at once
    (`AskSheet autoSend`); a bare call opens the sheet listening. Restarts
    every 60 s, backs off on errors, stops off-Home and in background.
    `RoofPill` on the Home shows it and pauses it.
  - **Spoken reply** (`roofSay`): only for a SPOKEN request, Plus, `speak` on.
    Azure TTS (`pt-BR-ThalitaMultilingualNeural`; en Ava, es Dalia) via
    `/api/suggest-ping?action=speak` (Vercel env `AZURE_SPEECH_KEY` +
    `AZURE_SPEECH_REGION`), Plus-gated and metered with `ai_light_*` kind
    `voice`. MP3s cached by text hash in `Paths.cache/roof-voice/`.
  - **One chime** (owner, 2026-11-12): on the call the wake recogniser chimes,
    calls `onWake` (the Hub opens AskSheet at once with `wakeHeard`, shown as
    "listening") and KEEPS capturing — no second recogniser, no second chime.
    `onHeard` streams the text; `SPEECH_SETTLE_MS` (1.5 s) of unchanged words
    (or ~7 s of nothing) ends it with `onDone(request)` → `autoSend`. A
    "final" result is NOT the end (iOS 18, below). The Hub keeps the hook
    enabled while `wakeCapture` and bumps `wakeEpoch` on close to re-arm it.
  - **ONE recogniser, one owner (review 2026-11-14).** The wake listener and
    every `useVoice` share the native module. Start / stop / abort ONLY via
    `micStart(me)` / `micStop(me)` / `micAbort(me)` in lib/voice — the token
    makes a stop/abort from anyone but the current owner a no-op, and the
    listeners ignore events while they don't own the mic. Never call
    `speechModule().abort()` directly. Why: the Hub remounts AskSheet on a
    wake (new key) and the old sheet's unmount abort killed the wake capture
    mid-request (that, plus the session deactivation below, is what looked
    like "iOS ends the session at the pause after the call"); the delayed
    aborts that let a chime finish (roofWake cleanup, `cancel()`) used to kill
    the NEXT session. useVoice also ignores an 'end' that arrives before its
    own session's 'start' (an abort's 'end' lands late).
  - **Bare call, recogniser ended anyway** (rare now): `onDone('', true)`,
    sent only once the wake chime has finished → Hub bumps `continueListening`
    → AskSheet starts its own mic NORMALLY: "one moment" until audio flows,
    then the start chime + "listening". (It used to start `quiet` and show
    "listening" over the ~0.5–1 s deaf gap — the first words were lost.)
    While listening the sheet's button shows `ListeningBars` (tap still
    stops). Settings › Roof shows the last thing the wake listener heard
    (memory only, never stored) to tune spellings.
  - **Keeps listening** (Plus only): after an answer to a SPOKEN request (and
    after Roof finished saying it, +350 ms), AskSheet starts its own mic again,
    quietly (no chime; "one moment" until live); the answer stays on screen
    with a small "listening" strip under it (`follow`). It STOPS after 10 s
    without a word (`FOLLOW_IDLE_MS`, stop chime) — the TV in the room must
    not become requests. Free households: answer on screen, mic off.
  - **"Desfaz isso" / "undo that" / "deshaz eso"** (`isUndoAsk`, the whole
    request only) → `undo_last`, decided on the phone before the server (an
    older server filed it as remove_items): runs the previous answer's Undo
    (`undoOf` in AskSheet — the same code as the Undo buttons) and shows it
    undone. A server may also send `undo_last` (KNOWN_INTENTS has it).
  - **Finding the event to move / remove / edit** (`locateIn`, pure + tested):
    move_event's `date` / `newDate` are "" when not said (not today; a
    time-only move stays on the occurrence's day). A ref'd series lands on
    the DAY said, not the occurrence the context listed. A day said with
    nothing matching falls back to the coming weeks (the model still sends
    date = today for "muda o dentista para sexta"), through the same
    person / "which one?" checks. The cut-off guard (`assistantGuard`) also
    covers the offline local fallback.
  - The Home's bottom dock IS Roof (`home/RoofDock`, compact by the owner's
    call): orb with a status dot (green breathing = listening, grey = not), a
    mute button (pause / resume, or turns "Ei Roof" on via `turnOnRoofWake`)
    and an UP ARROW that opens the sheet listening AND with the keyboard up
    (`typeToo`; typing cancels the mic). No hint text. The family avatars moved
    up under the greeting (`home/FamilyStrip`); the old ask bar, `RoofPill` and
    the Family TILE are gone from the Home (Settings no longer lists Family).
  - Prefs are ONE external store (`useSyncExternalStore` in lib/roof.ts): the
    old hook copied the launch-time value and Settings / Home drifted apart.
- **"Ask Roof" on every app** (`components/RoofExamples`, 2026-11): a sheet of
  example requests for THAT area; tapping one opens AskSheet with it typed in
  (`seed` — nothing is sent or spent until the user sends; the Home's generic
  examples hide when `seed` is set). `variant="card"` under Utilities' title;
  `variant="pill"` ("✨ Roof") in the top bar of Calendar, Shopping, Money
  (AppHeader `right`), Documents, Nudges, Games (GameTopBar `right`), Pets and
  Family (PhotoHero `extra`). Examples are `roofEx.<area>.<n>` keys; "{name}"
  = another member's first name. Only list things the assistant really does.
- **Home loading**: FamilyStrip shows a borderless breathing skeleton (a
  borderWidth with no colour drew black rings on Android); RoofDock takes
  `loading` (Plus or Roof prefs unknown — `useRoofPrefsReady`) and draws the
  whole dock with an empty mute slot, fading the dot and button in.
- **Modo Casa (migration 105, 2026-11-13)**: the WEB app is now only the home
  device hub (`src/casa/`); pairing = `api/widget.ts ?action=casa-start|claim|poll`
  (device shows code/QR `oneroof://casa?code=` → phone `app/casa.tsx` → Settings
  › Modo Casa `components/CasaSettings` claims it → the device exchanges a
  magic-link token for its OWN session as that member). Unpair sets
  `home_devices.revoked_at`; the device signs out on its next check (load,
  focus/visibility, every 5 min). Money PIN = sha256("<household>:<pin>")
  (`lib/sha256.ts`, tested against node). Limits: 1 device free, "unlimited" on Plus (50 abuse ceiling, CASA_DEVICES_PLUS)
  (server); trial 30 days from the first device (`home_plan()`); other free-tier
  locks are on the device's screen only (by design). Never say "tablet" in UI
  copy — "dispositivo". Vercel: deploy with `--force` after adding an action to
  an existing function (a cached build served the old widget.ts once).
  **Security model since migration 111 (2026-11-15 review)** — keep it:
  - The device binds its session to its row (`casa_bind_session`, right after
    pairing and on every device check). A bound session is a "Modo Casa
    session" in SQL (`is_casa_session()` / `casa_device_id()`): RESTRICTIVE
    policies keep it out of documents, Whereabouts tables and document files
    (storage: only `avatars|backdrop|pets|frame`), and `months`/`entries` open
    only while `casa_unlock(pin)` has unlocked that device (30 min; the device
    calls `casa_lock` on idle). Unpair (`revoked_at`, from the phone OR the
    device) deletes its `auth.sessions` row and `current_household()` returns
    null for it at once — revocation is server-side, not the device's goodwill.
  - The PIN verifier is NOT readable: phones still write sha256 into
    `pin_hash`, a trigger moves it to `pin_secret` and `pin_hash` reads `'set'`.
    Never compare a PIN on a client; never select `pin_secret` (no grant).
  - `home_devices`: clients may update only `name`, `revoked_at`,
    `last_seen_at`; an unpair can't be undone (trigger).
  - Pairing codes: CSPRNG, 5 min, claim is atomic, ≤10 wrong codes per member
    per 10 min (`pair_attempts`), and the phone shows WHERE the request came
    from (`casa-peek` → "Chrome · Android · Tampa, FL") before pairing.
  **Roof on Modo Casa (2026-11-14)** does everything the phone's Roof does
  EXCEPT money (add/summary/list/fix → "money is on the phone", with a button
  to the PIN-locked Money panel), games ("played on everyone's phone") and
  documents (a kitchen screen never opens the vault). Same server, same
  request shape (no `surface` field — the server is unchanged); the device
  sends no money entries/categories/documents as context. Executors live in
  `src/casa/`: `intent.ts` (COPY of the phone's pure `Intent`/`fromServer`/
  `petsAsked`/`assistantGuard` — keep in step), `roofData.ts` (web port of
  `lib/assistant` event locate/move/remove/series + `lib/assistantActions`),
  `assistant.ts` (`act()` → answers with rows / tappable "which one?" rows /
  choices / Undo), `Roof.tsx` (`AnswerCard`), `roofTips.tsx` (capabilities
  per area with "Ver mais", like `CapabilitiesView`; `app_help` topic `roof`
  opens it). Wording reuses the phone's `ask.*` / `roofEx.*` keys, copied into
  the web dicts, plus `casa.ra.*`. A new phone intent needs its Casa
  executor too (or a deliberate refusal).
- **Assistant knows the app** (`app_help`, 2026-11-12): `APP_GUIDE` in
  api/suggest-ping.ts is the only source it may answer from (keep it TRUE when
  features change); `topic` picks what the app shows under the reply —
  `home/HelpView`: the games with their REAL rules from i18n (`games.how.*`,
  `games.bs.how*`, `games.quiz.how*`) and "Open Games"; Plus / families / Roof
  get a button to their screen.
- **Modo Casa → `/casa-mode`** (2026-11-14): a HOME TILE (`casa` in `lib/apps.ts`, not in Settings — owner: people rarely open Settings)
  opens its own screen in the `/families` shape: animated
  hero art (`components/CasaDevicesArt`: old phone + tablet + laptop, "any
  device with internet will do"), the devices card (`CasaSettings`: pair,
  unpair, Money PIN) and the rules. `oneroof://casa?code=` lands there.
- **Settings › Casa → "Add another family" → `/families`** (2026-11-12): join
  by code / create, with the rules spelled out (3 per account, create needs a
  paid Plus as owner, the new family rides on it, what happens when Plus ends).
  `useFamilies()` / `MAX_FAMILIES` live in `lib/families.ts`.
- **The ask bar (`components/home/AskSheet` + `lib/assistant`).** The server
  only UNDERSTANDS (`/api/suggest-ping?action=assistant` → `{intent, items,
  store, scope, person, date, reply}`, Claude Haiku, structured output); the
  app DOES it with the user's own session (RLS stays the boundary). Intents:
  `add_items` (resolves/creates the store, skips items already open, Undo
  deletes what it added and a store it created) and `agenda` (me = own +
  household-wide events, all, or a named member; pet care due shows on today).
  `localParse` covers the two common phrasings offline / before a deploy — keep
  `__tests__/assistant.test.ts` green when touching it. New intent = schema +
  `understand` branch + an executor here + an answer view (AnswerViews).
  Intents today: shopping (add — asks WHICH list when none matches, never
  invents one —, list, find, check, remove, move to a store, clear bought,
  uncheck), agenda (a day or a PERIOD via `date_end`), events (add with end
  time / repeat / special date / place / reminder; move; remove; edit; "when
  is the next X"; birthdays), money (add; summary, total or one category /
  thing; latest entries; fix or delete the last one), nudge (sent only on a
  tap; urgent = high priority; "who saw it"), pets (due, mark done, log a
  visit/vaccine with next due, next due, weight), family details (read and
  change), where is someone (respects paused/off sharing), weather (Home
  city, 16 days), which is cheaper per unit, open a document, day overview,
  open app, split a bill (asks equal vs by item; opens
  `/calc/even?bill=&people=&tip=` prefilled), discount. Claude gets the
  open shopping items as context so questions match across languages; where
  the local parser sees a period or a utility phrasing, it overrides an older
  server's weaker answer (see `understand`).
  **Voice timing:** the recogniser starts at once but the UI says "one
  moment" (`starting`) until the first mic VOLUME reading proves audio is
  flowing — then the start chime + "listening" (the cue to talk). The iOS
  session runs in mode `default`, not the module's `measurement` (which
  turns output down — faint, late-sounding chimes). Every way out of the
  sheet goes through `closeSheet` → `voice.cancel()`, which plays the stop
  chime and aborts.
  **iOS 18 flags EVERY pause as a final result** (expo-speech-recognition's
  `speechDuration > 0` hack) and then restarts the transcript; in one-shot
  (`continuous: false`) mode the module ENDS the session at that first
  pause — "marca uma… consulta" was sent as "marca uma". So on iOS the
  request mic runs `continuous: true` and the APP ends it: 1.5 s of
  unchanged words (`SPEECH_SETTLE_MS`) → `micStop` → 'end' sends the text;
  6 s with no word at all ends a one-shot listen. Android keeps one-shot
  (its recogniser ends on its own silence; isFinal there is the real end).
  `stitch(seg, text, isFinal)` banks a stretch on every final (a same-length
  reset after a pause used to drop the first stretch) and drops a final
  that only repeats it — keep `__tests__/assistant.test.ts` green.
  **The START chime player has `keepAudioSessionActive: true`.** expo-audio
  otherwise deactivates the shared iOS session ~0.1 s after a player pauses
  or finishes (`AudioModule.deactivateSession`) — which lands while the mic
  records, right as the user starts talking. The STOP chime and Roof's voice
  keep the default (they play when no mic runs; their deactivation is what
  lets other apps' music resume) — so never start a mic within ~0.35 s of
  either ending. Games / vault sounds use default players too: a sound that
  ENDS during a voice answer could still deactivate the session (not seen
  yet; give it keepAudioSessionActive if the quiz mic starts dropping).
  A chime REWINDS then plays (`await seekTo(0)` → `play()`): a finished
  expo-audio player sits at the end, and play() before the async seek lands
  is silent — the chimes sounded only every other time. pause() first stays
  (Android: a finished player still "plays" and a bare seek restarts it).
  The sheet closes by DRAGGING its top strip down (PanResponder on the handle
  zone: >110pt or a flick closes via closeSheet, less springs back) and is
  capped at 84% of the room so some backdrop always shows to tap.
  **It's a conversation (2026-11):** while the sheet is open, each finished
  turn moves up as the question + a one-line summary of the answer
  (`summarize` in AskSheet — written for the user AND sent to Claude), and
  `history` (last 6 turns) rides along on every request so follow-ups resolve
  ("o que tem no Walmart?" → "tira o leite", "e amanhã?", "e a Lola?").
  Tapping the mic after an answer commits the turn first; "New chat" clears.
  A new Answer kind needs a `summarize` case (tsc enforces the switch).
  `add_money` with several budgets and none clearly named (or a name that
  isn't a budget, like a store) asks "which budget?" (`chooseBudget`, cards
  in each budget's gradient) — never the first budget silently. It lands in
  the period holding the date, else the budget's LATEST period, with the
  entry date clamped into it (`pickBudget` / `periodForBudget`, tested).
  `pets_due` takes a `pet` and includes today's daily-routine items not yet
  ticked (`petsDue`: overdue, then the routine in its order, then due today),
  so "what's next for Lola?" leads with the first undone thing.
  Daily-routine rows in that answer carry the Pet Care tick: tapping marks /
  unmarks the task for today right there (`setDailyDone`, same
  pet_task_done rows; the headline and "n of m" follow), and
  `lib/petCareNotify` reloads widgets on every device — shared with the Pet
  Care screen.
- **Phone numbers are shown through `formatPhone(raw, region)`** (`lib/phone.ts`,
  2026-11, pinned by `__tests__/phone.test.ts`): the country comes from an
  explicit +code, then the number's shape (11 digits with 9 third = Brazilian
  mobile), then the device region for the ambiguous 10 digits; it prints
  "+1 (415) 123-1234" / "+55 (11) 98765-4321" / "+44 207 946 0958" and never
  guesses a country it can't tell. The luggage tag always prints it this way
  (whoever finds the bag may be abroad) and the editor tidies the field on blur.
- **The Hub's family dock hugs its members** (2026-11): centred, as wide as
  its avatars + "Family"; only a household too big to fit stretches it edge
  to edge (and scrolls) — and only then does it take the screen's curve.
  While the members load (an empty list — a household always has you) it
  shows two breathing placeholder circles (`DockSkeleton`), not an empty bar.
  The household-of-one invite (`InviteBanner`) is a Family-gradient card like
  a received nudge, with one "Share your invite code" pill → Settings.
- **Store screenshots: `store/app-store-v3/`** (2026-11 redesign) — same
  pipeline as v2 (`render.sh`, copy per language in `copy.js`, captures in
  `shots/<lang>/`), 10 slides: hero, assistant, AI receipt, calendar,
  shopping, money, whereabouts, nudges, pets, utilities. Captured on the iPhone
  17 Pro Max simulator with the Preview Family demo account; its language is
  switched through `user_settings`. For the shots, a few things were overridden
  in code temporarily (sunny weather, Sam's location "4 min ago", the assistant's
  third example), then reverted — never commit those.
  Play: `render-play.sh` → `out-play/<lang>/` (8 at 1080×1920, from the
  Galaxy S9+ captures in `shots-android/`; no Whereabouts, it's off on Android).
  **Uploading (1.5.0, 2026-11):** App Store Connect's primary slot is now
  "iPhone with Dynamic Island (medium display)" and takes 6.3" sizes
  (1206×2622) — 1320×2868 is NOT accepted there; resize. Upload ONE AT A TIME:
  batch uploads left tiles stuck "processing" forever, which blocks "Add for
  Review" ("screenshots must finish uploading"); a tile that stays stuck needs
  removing and re-uploading (the assistant PNG never processed; the same image
  as JPEG did at once). Reorder by dragging the tile. Only English (U.S.) is
  localized on either store; pt/es screenshots exist but need translated
  name/description/keywords before a localization can be added. The Play AAB
  (~120 MB) must be dragged in by hand — the browser upload tool caps at 10 MB
  and `eas submit` has no service-account key yet.
- **Store screenshots for 1.6.0: `store/app-store-v4/`** (2026-11-14) — same
  pipeline and look as v3, re-cut to lead with Roof: hero, roof, calendar
  (Week), lists, receipt → lists (dark slide), money, games, casa (Modo Casa
  web hub in a landscape device frame + the /casa-mode phone screen), pets,
  utilities + a nudge. `render.sh` writes BOTH `out-6.9/<lang>` (1320×2868)
  and `out-6.3/<lang>` (1206×2622, the primary App Store slot);
  `render-play.sh` → `out-play/<lang>` (8 at 1080×1920; Play's max is 8, so
  money and utilities drop out). No Android capture session for 1.6.0: Play
  frames reuse the iOS captures, with `hero-play.png` (Whereabouts tile turned
  off for the shot) and `playPops` in `copy.js` (Google Calendar only).
  `casa-web.png` came from the web app (`npm run dev`, dev login) through
  headless Chrome over CDP at 1440×900 @2x. English captures only; pt/es copy
  is kept in step. `contact-sheet-*.png` are the overviews. The Play feature
  graphic (`store/play-feature-graphic.html` + `render-feature-graphic.sh`)
  is Roof-forward and uses the same captures. Temporary overrides used for the
  shots (then reverted): partly-sunny `sceneFor`, the AskSheet mic-error row
  hidden (the simulator mic always errors), the paired device's name shown as
  "Kitchen display". The demo account was switched to English and a home city
  for the shots, then put back (Portuguese, no city).
  **Tablets (2026-11-14): `slides-ipad.html` + `render-ipad.sh`** → `out-ipad13/<lang>`
  (10 at 2064×2752, App Store "iPad 13-inch display"), `out-play-tablet10/<lang>`
  (8 at 1600×2560) and `out-play-tablet7/<lang>` (same 8 at 1200×1920; no money /
  utilities, Play wording). Modo Casa is SLIDE 2 on tablets (owner: an iPad is
  the Modo Casa device) — the web hub full-screen on a landscape iPad (light
  theme, weather sky, 9:41 AM) + the phone's Home Mode screen. Captures in
  `shots-ipad/<lang>/` from the iPad Pro 13" (M5) simulator (real ≥760 pt
  layouts: Calendar Week, Lists, Money, Pets…); `hero-play.png` = hero with the
  Whereabouts tile painted out. `casa-hub.png` = headless Chrome over CDP at
  1376×1032 @2x with `casa.prefs` theme light/panel, `weather-home` set in
  localStorage, and a page-injected Date shim (9:41) + open-meteo stub (partly
  sunny) — nothing in the app code. Slide 6 crops the v3 "Snap a receipt"
  illustration (`app-store-v3/out/<lang>/03-ai.png`); its headline comes from
  `ipad` in `copy.js` (`ipadPops` / `ipadPlayPops` hold the tablet-only pop-outs).
  Same temporary overrides as the phone set (sunny `sceneFor`, mic row hidden,
  "Kitchen display"), reverted; the simulator's home city is per device
  (AsyncStorage), removed after. The dev client's floating "Tools" button is
  switched off in the dev menu for captures. Hardware-keyboard typing into the
  dev client: an "r" reloads JS — paste via `simctl pbcopy` + long-press Paste.
- **App Store "Header and Search Results" creative assets (1.6.0):
  `store/app-store-creative/`** — `creative.html?v=header|search|universal` +
  `render.sh` → `out/header-3840x1646.png` (21:9), `out/search-3840x2560.png`
  (3:2) and `out/universal-5244x2950.png` (16:9, one PNG for both; must be
  PNG). Apple's ART SAFE AREAS are small (header 1646×661 @1097,493; search
  2168×1030 @836,765; universal 1402×962 @1921,660 — App Store Connect Help ›
  Creative assets specifications): orb + "Hey Roof" + line + Modo Casa hub +
  phone are scaled into the safe area; outside it is only gradient, voice
  rings and soft app cards that may be cropped. `out/crop-check/` = the safe
  area outlined + the tightest crops that hold it. Check ASC's Preview before
  uploading.
- **`@/components/PhotoHero`** — the full-bleed, swipeable photo header used
  by Pet Care and Family (one page per pet / member; name + badge on the photo,
  side arrows with a tiny avatar of the neighbour, page dots, shrinks with a
  `collapse` 0→1 from the host's scroll). The host's `SafeAreaView` must drop
  the TOP edge — the photo runs under the status bar and the hero pads its own
  controls (and turns the status bar light while focused). An arrow tap glides
  the pager and selects only when the glide ARRIVES (onScroll + a timer):
  selecting first and letting the sync effect snap the page is what made it
  read as a jump, and `onMomentumScrollEnd` doesn't fire for programmatic
  scrolls on Android. Reuse it for any "one big picture per item" roster.
- **Theme** `@/theme/theme`: `useTheme()` → `{ dark, c }`; tokens `c` =
  bg/card/cardActive/surface/surface2/text/textMuted/textFaint/accent/accentSoft/
  income/expense/border (Warm Hearth, light+dark, follows system). Also `sp`,
  `radius`, `fonts` (Fraunces display + Hanken Grotesk UI, loaded in `_layout`).
  - **Glass skin (`theme/glass.tsx`, `GLASS` flag)** re-skins the app: a colour
    wash painted at the root, translucent cards, rounded Nunito titles. Set
    `GLASS = false` to get Warm Hearth back exactly.
  - **Colour schemes (`SCHEMES` in `glass.tsx` + `theme/scheme-pref.tsx`)** — the
    user picks one in Settings. A scheme repaints ONLY `accent`/`accentSoft` and
    the wash; neutrals, income green and expense red are shared, which is what
    keeps every scheme the same app. `glassTokens(dark, scheme)` composes it and
    `useTheme()` calls that — screens need no changes. Stored per DEVICE in
    AsyncStorage, mirroring `theme-pref` (appearance is per-device here;
    only language syncs to the account). Adding a scheme = one entry in `SCHEMES`
    (light + dark accent AND wash) plus `settings.scheme.<id>` in all 3 dicts.
    Two families: **branded** (warm tinted wash — the One Roof look) and
    **palettes** (near-neutral wash, accent does the work). A neutral wash needs
    ONE blob tinted with the scheme's hue or the glass dies — the effect comes
    from variation behind a translucent card, and flat grey gives it nothing to
    read through.
    **`WASH_INTENSITY` (in `glass.tsx`) is the one dial for how loud the wash
    reads** — blob opacities in `SCHEMES` are authored at full strength and
    scaled by it, so each scheme keeps its relative weighting and there's a
    single number to turn. It's below 1 because at full strength the background
    competed with the content: these screens carry a lot of information and a
    saturated wash behind all of it read as busy rather than warm. Light is cut
    hardest (saturated colour on pale paper); dark only lightly, since its blobs
    are already near-black on near-black and the same cut would flatten it to
    grey. Tune THIS, not the per-scheme opacities. Calming it also *raises* text
    contrast — cards are translucent white, so a paler page makes them paler too.
    Rules for a new accent: it must not read as the expense red (`#E4554A`) or
    the income green (`#1F9E68`) — the original `#E2683F` failed the first,
    painting primary buttons and negative amounts nearly alike. A neutral wash
    buys headroom here (that's how `field`/`slateGreen`/`slateRed` work: they sit
    far enough apart in LIGHTNESS, ~1.6–2.1 ratio, not just hue).
  - **Filled controls use `c.action` + `c.onAction`, not `accent`
    (2026-11).** `action` is the accent deepened until WHITE text clears
    4.5:1 (`actionFill` in `theme/contrast.ts`, derived per scheme and mode);
    `onAction` is always white. Bright accents with `onAccent` gave the
    primary button dark-ink-on-orange, which the user rejected. Use `accent`
    for text, icons, tints and borders; `action` for primary buttons,
    selected chips and badges. `onAccent` remains only for any remaining
    true accent fill.
  - **`c.onAccent` — text/icons on an accent-filled surface. NEVER hardcode
    `'#fff'` there.** `pickOnAccent()` (`theme/contrast.ts`, its own module to
    avoid a real import cycle with `theme.ts`) returns white or the ink
    `#1B1A18`, whichever wins, and `glassTokens` DERIVES it — a new scheme can't
    forget it. This was a live bug: white was hardcoded at 43 sites, fine for the
    dark accents of light mode but 2.2–3.0:1 for the light accents of dark mode,
    below AA even for large text. Worst case is now 4.65:1 across all 22
    accent/mode combos. When adding a scheme, check BOTH modes clear 4.5 against
    the better of white/ink; if neither reaches it (the old `#C2603F` was 4.17:1
    both ways — no foreground could save it), darken the accent ~6% instead.
    **Every `<GlassWash>` needs the `scheme` prop** — there are two (`_layout`
    and the `paywall` modal route); tsc catches a missed one.
  - **`card` vs `sheet` — the rule that keeps biting:** `card` is TRANSLUCENT so
    the wash reads through it on screens. Anything floating over something other
    than the wash — a `<Modal>` sheet (dim backdrop) or a panel on the
    Whereabouts map — MUST use `c.sheet` (opaque) or its content visibly mixes
    with the background. Rule of thumb: inside a `<Modal>`, use `c.sheet`.
    `sheet === card` outside the glass skin, so it's a no-op for Warm Hearth.
  - **`elevation` + a translucent fill = a smudge on Android.** Android draws
    the elevation shadow UNDER the view, so behind `c.card` (66% white) it
    shows through as a grey cast, with a lighter band wherever a child (a
    TextInput) sits — on every Android, never on iOS (whose shadow is outside
    only). Anything with `elevation` gets an opaque fill on Android:
    `Platform.OS === 'android' ? c.sheet : c.card` (Family, the Shopping add
    capsule and the Calendar segmented tab do this; 2026-11, seen on the S9+).
  - Under GLASS, `c.bg` is TRANSPARENT (that's how the wash shows). Never use it
    as a foreground/inverse colour — the toast's label did and vanished.
  - **Every stack screen paints its OWN wash** (`screenLayout` in `_layout`),
    on top of the root one. Transparent screens alone let the screen beneath
    show through: Android 13+'s default push keeps the old screen opaque,
    shifted −10%, under the new one for the whole 450 ms transition (and leaves
    it if the transition is cut short) — a tester saw Settings drawn over the
    Hub (2026-11). Don't drop the per-screen wash to "save a layer".
- **Collapsing headers: shrink something OUTSIDE the scroll view, never inside
  it.** `Screen` takes an `onScroll` (its scroller is an `Animated.ScrollView`,
  so a native-driven `Animated.event` attaches) and a `header`, which renders
  ABOVE the scroll area — that's where a shrinking element belongs. Animating
  the size of a box that's part of the scroll CONTENT changes `contentSize`
  mid-gesture, iOS clamps `contentOffset` to the new size, that feeds straight
  back into the driving `Animated.Value`, and the scroll locks up with the
  animation frozen half-way (real bug: the pet photo on `PetProfile`). Inside
  the content the only safe collapse is a `transform` (no layout, and it can run
  on the native driver); in the header slot a real height/width animation is
  fine, at the cost of `useNativeDriver: false`. `apps/pets/petIdentity.tsx` is
  the reference — note the state the header and the form share has to be lifted
  into a controller the HOST owns, since the two can't be siblings.
- **Push REGISTRATION** `@/lib/notifications`: `registerForPush()` (prompts) runs
  ONLY from the Settings notifications toggle — that's deliberate, a permission
  prompt shouldn't fire at launch with no context. So "no `expo_push_tokens` row"
  almost always just means the user never enabled notifications, NOT a bug.
  `refreshPushToken()` + `useSyncPushToken()` (mounted in `_layout.tsx`) repair a
  STALE token on launch — rotation, reinstall, or a lost row would otherwise
  leave someone silently unreachable with the toggle still reading "on". It bails
  unless permission is already granted, so it never prompts. Note push has TWO
  transports (native `expo_push_tokens` + web `push_subscriptions`); fan-outs
  send to both, so a PWA-only user can still be reachable with 0 Expo tokens.
- **Push presentation** `@/lib/backgroundNotifications`: a module-scope
  `Notifications.setNotificationHandler` decides what a push looks like when it
  lands while the app is FOREGROUNDED. **Without a handler expo-notifications
  presents nothing** — that's a silent failure, not a default: nudges looked
  like they'd stopped arriving because with the app open only the in-app
  Realtime banner (plus its high-priority `Vibration`) got through. Backgrounded
  delivery is unaffected either way, since iOS draws that from the APNs payload
  itself, so this only reproduces with the app open. Keep the handler at module
  scope (installed before any push lands, not on mount) and keep `SILENT_TYPES`
  in sync with the data-only pushes (`ack`/`petcare`/`live-wake`) — those carry
  `_contentAvailable` with no title/body, so presenting one shows an empty
  banner. `shouldShowAlert` is DEPRECATED in expo-notifications 56; use
  `shouldShowBanner` (heads-up) + `shouldShowList` (Notification Centre).
- **Auth** `@/lib/auth`: `useAuth()` → `{ session, profile, profiles, loading,
  signInWithApple, signInWithGoogle, devSignIn, signOut }`. `profiles` = members
  of the ACTIVE household (from `household_members`, migration 099);
  `profile.household_id` = the active household.
  - **`oneroof://auth-callback` must stay a real route** (`app/auth-callback.tsx`).
    Google sign-in and the Google Calendar connect both redirect there, and the
    platforms deliver that redirect DIFFERENTLY: iOS's
    ASWebAuthenticationSession swallows it and returns the URL to
    `openAuthSessionAsync` without reopening the app, so no route is involved —
    which is why the missing file went unnoticed for months. Android's Chrome
    Custom Tab fires an Intent instead, expo-router renders `/auth-callback`,
    and with no file there it showed "Unmatched Route" with the `?code=` on
    screen: **sign-in on Android could not complete at all.** Don't delete the
    route because "nothing links to it" — the OS does.
  - Both deliveries can fire for one redirect, so `completeOAuthRedirect`
    (`@/lib/oauthRedirect`) is idempotent per code: a PKCE code is single-use,
    and callers share one promise so the loser of the race still gets the
    session — including `provider_refresh_token`, which only exists on the
    session the one exchange returned (the Calendar connect needs it).
  - `devSignIn` (email/password) is `__DEV__`-gated in `components/Login.tsx`,
    so a RELEASE build has only Apple + Google. That's why an email/password
    demo account is useless to a Play reviewer — see `PLAY-STORE-RELEASE.md` §3.3.
- **Data fetching** `@/hooks/useCachedQuery`: stale-while-revalidate over an
  in-memory cache — returns the last value instantly, refetches in the
  background, re-renders only if the data actually changed. One query object per
  screen (one cache key); call the returned `revalidate()` after a mutation.
  **Three things go stale here and each has its own fix — know which you need:**
  - **Reopening the app.** iOS SUSPENDS the app instead of killing it, so
    reopening it days later re-renders the same tree: nothing re-mounts, focus
    doesn't fire, and a Realtime socket that died while suspended never replays
    what it missed. `useCachedQuery` now refetches on a real background→active
    transition itself, so every screen built on it is covered — do NOT add a
    second `AppState` listener next to one (that just fetches twice). A screen
    holding its own optimistic/Realtime state instead of a cached query
    (ShoppingList, NudgesBanner) subscribes with
    `useRevalidateOnForeground(load)`. (`inactive` is deliberately not a
    trigger: Control Centre, the notification shade and permission dialogs all
    fire it without ever backgrounding.)
  - **Returning to a screen a pushed child mutated.** expo-router keeps the
    parent MOUNTED underneath, so mount-only fetching never re-runs:
    `useFocusEffect(useCallback(() => { void load() }, [load]))`. This is what
    left a deleted household on the admin list, pre-edit totals on Months, and a
    renamed household still reading the old name on the Hub.
  - **The DATE moving under a mounted screen.** `const today = todayISO()` in a
    render body is frozen until something else re-renders — and a refetch
    deliberately doesn't when the rows are unchanged, which is exactly the case
    that goes wrong. Use `useToday()` (`@/hooks/useToday`) for any date that
    drives what's displayed; it advances on foreground and at midnight.
  - `invalidateCache(prefix)` drops keys another screen owns, so a delete
    doesn't flash the removed row while that screen's focus refetch lands.
  - This file has therefore DIVERGED from the PWA's `useCachedQuery` (it isn't a
    verbatim port any more) — the extra behaviour is native-only by nature.
- **Dismissing the keyboard**: iOS gives no global gesture for it, and this app
  deliberately has **no "Done" bar of any kind**. The way out is:
  - **A tap on anything inert.** Two mechanisms, both already wired:
    `keyboardShouldPersistTaps="handled"` on every scroller (a tap no child
    claimed dismisses; a tap on a button still lands), and `<DismissKeyboard>`
    from `@/components/ui` for the fixed chrome AROUND the scrollers — headers,
    backgrounds, and lists too full to leave a gap to tap. `Screen` wraps its
    HEADER in one (its scroller dismisses through `keyboardShouldPersistTaps`);
    ShoppingList wraps its header + list by hand because it doesn't use `Screen`.
    **Never wrap a scroller in it if you can avoid it, and it only claims a
    touch while the keyboard is up** — it used to be a Pressable that claimed
    every unclaimed touch, and around a ScrollView that swallowed every drag
    starting on plain text or a non-button card: Admin → household could only
    be scrolled from a text field (2026-10-11, iPhone). It can also BE a
    sheet panel rather than wrap one — pass the panel's own style and delete the
    `View` it replaces, which is how SafetyRadiusSheet, PresetEditor and the
    rename dialog in Months got covered (none of them has a scroller around
    their fields).
  - **Tapping the dimmed backdrop** in sheets that have one (EntryForm calls
    `Keyboard.dismiss()` there), plus the return key on ordinary text keyboards.
  - **Scrolling deliberately does NOT dismiss.** `keyboardDismissMode="on-drag"`
    was the mechanism from 2026-08-16 to 2026-08-20 and was removed: it made it
    impossible to scroll a form to see what you were typing, which is the main
    reason to scroll while a keyboard is up. Don't reintroduce it. (`interactive`
    is not an option either — it needs the scroll area to extend UNDER the
    keyboard, and the `KeyboardAvoidingView` guarantees it doesn't.)
  - **The keyboard's top edge is the bottom of the layout**, and that is what
    makes tap-to-dismiss sufficient: `KeyboardAvoidingView` with
    `behavior="padding"` (iOS) shrinks the page to the space above the keyboard,
    so every row is reachable by scrolling instead of by hiding the keyboard.
    **Android needs the SAME `padding` KAV** — under edge-to-edge
    `adjustResize` does NOT resize the window, so `Screen` leaving Android to
    the OS let the keyboard cover low fields (Nudges' "write your own",
    Settings' home city; fixed 2026-11, verified on the S9+). A field that is
    the LAST thing on a page also has to be scrolled into view once the page
    has shrunk — after `keyboardDidShow` plus a beat (see `app/pings.tsx`). A modal can't use KAV (it
    mis-measures — see `useKeyboardHeight`) and lifts itself instead.
  - **Number pads have no return key**, so a tap is the ONLY way out of one. Any
    new `decimal-pad`/`number-pad` field must sit inside a `Screen`, a
    `<DismissKeyboard>`, or a sheet whose backdrop dismisses.
  - **Do NOT add a Done button back.** Both mechanisms iOS offers were tried and
    rejected on this app:
    - `<InputAccessoryView>` **cannot work** under the New Architecture as a
      shared bar. `RCTInputAccessoryComponentView` binds to its TextInput in
      `didMoveToWindow` — a one-shot search of the window for a matching
      `inputAccessoryViewID` — so one mounted at the app root runs that search
      at launch, when no such input exists yet, and never again. It also binds
      to only the FIRST match, so one shared id could never serve a form with
      several fields. It shipped dead from 2026-07-18 to 2026-08-14.
    - RN's own `inputAccessoryViewButtonLabel` toolbar works, but **iOS 26
      renders it as a floating capsule on a transparent bar**, hovering over
      whatever is behind it — in a sheet that's the page showing through the
      gap below. It's a native `UIToolbar`; nothing about it is stylable from
      JS. Removed 2026-08-16 for that reason.
    - **A `returnKeyType` on a number pad summons that same capsule** with no
      accessory prop anywhere in sight — this is the way it comes back by
      accident. `setDefaultInputAccessoryView` builds the toolbar when the
      keyboard is a number/decimal/phone pad AND `returnKeyType` is any of
      done/go/next/search/send/join/route/google/yahoo/emergencyCall; the unset
      default is the one value NOT in that set. So never pair `returnKeyType`
      with `keyboardType="decimal-pad"|"number-pad"|"phone-pad"`: there is no
      return key for it to label, and the only visible effect is the capsule.
      (Audited 2026-08-19 — every `returnKeyType` in the app is on a text
      keyboard, and no number pad has one.)
    - **To check any of this you MUST turn off the simulator's hardware
      keyboard** (I/O → Keyboard → Connect Hardware Keyboard, or `defaults write
      com.apple.iphonesimulator ConnectHardwareKeyboard -bool false` then
      restart Simulator). With it on, no software keyboard is drawn and no
      accessory bar with it — the screen looks fixed whether it is or not. That
      false negative has cost two rounds of debugging.
    - Beware the second-order trap if you ever reintroduce either: setting
      `inputAccessoryViewID` makes RN skip its own number-pad toolbar
      (`setDefaultInputAccessoryView` returns early when the id is set), so a
      dead accessory view actively *removes* the Done button iOS would
      otherwise have drawn.
- **Clearing the system bar at the bottom — `@/hooks/useBottomGap`.** Anything
  docked to the bottom edge (a sheet's last row, a pinned CTA, a floating bar,
  a scroller's tail) MUST get its bottom padding from this hook. Never a
  constant, and never `insets.bottom` raw:
  - **Android's navigation bar is an OCCLUDER** — content under it is invisible
    and untappable — and its height is a per-USER setting, not a per-device
    one: 3-button ~48dp, gesture pill ~16–24, hidden 0. Under edge-to-edge
    (mandatory since Expo SDK 54) the app draws behind it regardless, so a
    fixed gap covers some users' CTAs and not others'. This is why "it looks
    fine on my phone" proves nothing.
  - **iOS's home indicator is an OVERLAY** — content may sit near it, and
    clearing the full 34pt floats a docked button off the screen's curve. So
    the hook takes HALF on iOS and ALL on Android.
  - `useBottomGap(min)` returns `max(clearance, min)`. Pass the constant the
    code used before and iOS stays pixel-identical while Android gains exactly
    what its bar needs. Applied to `Screen`'s scroll tail, `NewItemButton`, and
    every bottom sheet — if you add a sheet, use it there too.
  - Several sheets carry an old comment saying to use a plain gap and NOT the
    inset. That reasoning was iOS-only and is now inside the hook; don't take
    it as licence to hardcode.
- **Keeping the focused field VISIBLE**: `@/components/KeyboardScroll` — a
  ScrollView that measures the focused field against its content and scrolls it
  into the visible window. `<Field>` reports its own focus through that
  context, so a form gets the behaviour by swapping its `ScrollView` for
  `<KeyboardScroll>` — no per-field wiring, and the report is inert anywhere
  else. Use it for any tall form in a modal (`PetForm` is the reference).
  Two things it relies on:
  - **The host must put the sheet above the keyboard**, because KeyboardScroll
    treats its own layout height as the visible window. Use
    **`useSheetLift()`** (`@/hooks/useSheetLift`): `onRootLayout` on the modal's
    root, `marginBottom: lift` + `maxHeight: room * share` on the sheet.
    It measures (root height now vs. at rest) and makes up only what the
    platform didn't. Under edge-to-edge an Android modal's window does NOT
    shrink for the keyboard (verified on the S9+, 2026-10-31) and draws BEHIND
    the navigation bar, while RN reports only the keyboard height ABOVE that
    bar — so the lift is keyboard + nav bar there, and the sheet also sits
    above the nav bar with no keyboard. `CityPickerSheet` and the calendar
    `EventForm` use it. `PetForm` still has the older inline version, which
    lifts by the keyboard alone and so falls a nav bar short on Android.
  - **`Screen` already handles the plain-screen case** with its
    KeyboardAvoidingView; KeyboardScroll is for modals, where KAV mis-measures
    (same reason `useKeyboardHeight` exists).
- **Photo framing**: `@/components/PhotoCropper` — pinch/pan a picked image
  inside a CIRCLE (matching the round hero) and hand back a 512px square JPEG +
  base64, ready to upload. Used by `usePetIdentity`: picking no longer uploads
  straight away, it stages the asset in `picked` and `PetHero` renders the
  cropper over it. Reusable for any round avatar; the crop maths is in
  `cropRect` (source pixels, not screen), kept separate so it can be reasoned
  about without a device.
- **i18n** `@/hooks/useI18n`: `useI18n()` → `{ t, lang, setLang }`. Dicts in
  `@/lib/i18n` (en/es/pt) are the PWA dicts copied verbatim — add keys to all 3.
- **Pet Care shows ONE "Care" list for everything that repeats** (2026-11,
  `apps/pets/CareCards` `CareGrid`): interval routines (`pet_care_tasks`,
  Done records today) AND events carrying a `next_due` (`pet_events` — a
  check-up, a vaccine, a monthly pill; Done opens the event form prefilled).
  The data stays in its two tables (the digest, the widget and the server read
  both); only the screen is unified, and a name present in both shows once —
  the one due sooner. There is no "Coming up" any more. Below it, "Events"
  lists one row per event series (`eventSeries`), tap → its history sheet.
  The docked buttons add a vet visit or a vaccine through **`VisitForm`** (pet
  and type FIXED — you're on that pet's page and tapped that button): name in
  place with quick picks (vaccines by species, `visitPresets.ts`), date, next
  due as chips (or a date), notes. It also edits / logs again vet & vaccine
  events; other types (older meds, grooming) still open `EventForm`. A next
  due puts it in Care.
  Every Pet Care sheet (RoutineSheet + its task editor, OverdueSheet,
  EventForm, the series sheet, PetForm) shares one look: tracked uppercase
  label, display title with its state faded under it, rows on ONE rounded
  card with icon tiles tinted in the pet's / event type's colour, and the
  docked primary button following the screen curve — in the PET'S colour in
  the routine sheets (`TintButton`). Cadence copy is `careText.everyLabel`.
- **Pet event reminders are a SERIES per (pet, title)** — `latestPerKey` in
  `lib/petCare.ts`, and the same rule in `api/send-digest.ts` and
  `api/widget.ts`: the newest log of a treatment decides its next due, titles
  match ignoring case/whitespace, and TYPE is NOT in the key (one treatment got
  saved as a vaccine one year and a medication the next, which split it into two
  series and left the first reminder overdue forever). The digest must fetch
  ALL events, not just those with a `next_due` — a final dose logged with no
  next date is what ends a series. `__tests__/petCare.test.ts` pins this.
- **Routine TIME (migration 107, 2026-11-13).** `pet_care_tasks.at_time` is when a
  routine item happens and orders the day everywhere (`routineOrder` /
  `taskTime` in both `lib/petCare.ts` files, the iOS widget payload in
  `api/widget.ts`, Modo Casa): timed first, earliest first, untimed after in
  their manual order. The reminder is a separate switch under the time
  (`remind_at` = the same time when on, null when off). Rows show the time.
- **Pet routine reminders are LOCAL notifications** (migration 098, 2026-11;
  `lib/petReminders.ts` + the pure `lib/petReminderPlan.ts`, pinned by
  `__tests__/petReminders.test.ts`). A routine (`pet_care_tasks`, either kind)
  can carry `remind_at time` ("Morning food ~8:00", set in RoutineSheet's task
  editor via `ReminderCard` → `PickerSheet`). Each phone schedules DATE
  triggers at day + remind_at + `PET_REMINDER_GRACE_MIN` (45) in ITS OWN local
  time, for today + 2 days (`PET_REMINDER_DAYS`), max 40 (iOS drops anything
  past 64 pending), id `petrem:<task>:<day>`; interval routines only on due
  days. Skipped when a `pet_task_done` row exists for (task, day) or the time
  has passed — never fires late. No server cron: Vercel Hobby is daily-only.
  - `syncPetReminders()` recomputes everything and is the ONLY scheduler. It
    runs on login/foreground (`usePetReminders` in `_layout`), from
    `notifyPetCareChange()` (every mark/edit on this phone), on the silent
    `petcare` push (background task awaits it; foreground listener too), after
    the Settings toggle and after a Done. It also DISMISSES reminders already
    on screen whose task got marked — that's how the notification leaves the
    other phones. `api/widget.ts`'s petcare fan-out therefore now includes the
    SENDER's own devices (a tick on the iOS widget must cancel that phone's
    reminder). Silent pushes are best-effort on iOS (throttled, none after a
    force-quit): the next foreground is the backstop. Offline, or on a DB
    without 098, a sync leaves the schedule alone; signed out / toggle off /
    no permission clears it.
  - **Done button** = category `pet-reminder`, action `pet-done`,
    `opensAppToForeground: false`. It writes `pet_task_done` (upsert, ignore
    duplicates) with the member's own session — the Keychain session is
    AFTER_FIRST_UNLOCK, so it works from the lock screen. iOS delivers the tap
    as a response to a background-launched JS context, so the listener sits at
    MODULE scope in `backgroundNotifications.ts` (+ a "last response" check);
    Android hands it to the background notification task as a
    `NotificationResponse` (`'actionIdentifier' in data`). The tap is queued in
    AsyncStorage BEFORE the request and flushed by the next sync, in case the
    OS suspends the app mid-write. `routeFromNotification` ignores any
    non-default action so Done never navigates; a plain tap opens `/pets`.
  - Opt-in per member: `user_settings.notify_pets` (default true), Settings →
    Notifications → `PetRemindersToggle`. Permission is asked only from a
    gesture (`ensureReminderPermission`: a time saved, the toggle turned on),
    channels first; Android local notifications go to `ANDROID_CHANNEL.DEFAULT`.
  - Text is built at schedule time in the phone's saved language
    (`oneroof-lang`), so a language change shows on the next sync. Members in
    different time zones each get it at THEIR local ~8:45 — `remind_at` is a
    zone-less wall-clock time on purpose. The Done category is a runtime API
    (no new native module / config), but the response handling is only
    exercised on a real build — not verified on a device yet.
- **Pure logic copied from the PWA** lives in `@/lib/` (types, format, calendar,
  categories, petCare, stores, signedUrls, pings) — keep them in sync with the PWA
  or, post-cutover, treat these as the source of truth.
- **Home-Screen widgets** `@/lib/widget.ts` + `targets/widgets/`: the widget
  extension can't reach the app's JS/Supabase session, so app data crosses via
  the shared App Group (`ExtensionStorage`) — mirror new data the same way
  (JSON string via `.set(key, ...)`, scoped `ExtensionStorage.reloadWidget(kind)`,
  matching key names in the Swift loader). `useSyncNudgeWidget` (mounted in
  `_layout.tsx`) is the reference for "sync on login, not on screen visit."
  See `DOCUMENTATION.md` §3 for the full picture (confirmation-timeline
  mechanism, silent ack push).
  - **A widget CAN do its own networking** — no Supabase session needed. Three
    live examples: Nudges POSTs to `/api/widget-nudge`, Today pulls weather
    straight from Open-Meteo (public, keyless) plus its agenda from
    `/api/widget?action=today`, and PetCare reads `?action=petcare` / marks a
    task via `?action=petcare-done` — all authenticated with the per-device
    **widget token** (`widget_tokens`, migration 045) and all served by the same
    `api/widget.ts`. `petcare-done` (and the app-side `petcare-notify`) also
    fan a SILENT push (`{type:'petcare'}`) to every other member's device;
    `backgroundNotifications.ts` catches it and reloads their PetCare widgets —
    that's the cross-device "breakfast just got marked done" ASAP path. Prefer this over App-Group-only data for
    anything that GOES STALE: a mirrored snapshot only updates when someone opens
    the app, so a widget fed only by the App Group shows yesterday's data on a
    phone that wasn't opened. **Never bake a formatted date into a payload** —
    derive it in Swift from `Date()`, or it can't self-correct at midnight.
    `today_cfg` (see `syncTodayConfig`) is the reference for "mirror the config
    the widget needs to fetch for itself," and TodayWidget's `buildToday()` for
    "live → last-good cache → app snapshot, and only if it's still the same day."
  - **A configurable widget's `EntityQuery` must not depend on the App Group
    alone.** PetCare's picker read `loadPetCare()?.pets`, but that snapshot is
    written only by the Pet Care SCREEN and this widget's own timeline — so it
    can be empty exactly when iOS runs the picker. Two symptoms, and the second
    is the nasty one: the picker shows no pets, AND `entities(for:)` can't
    resolve an ALREADY-SAVED choice, so iOS drops the selection and the widget
    falls back to the first pet ("changing the pet doesn't stick"). Fix:
    `petsForPicker()` falls back to a live fetch and caches it. Nudges doesn't
    hit this only because `useSyncNudgeWidget` syncs its presets globally on
    login — if you add a configurable widget, do one or the other, never neither.
  - **A widget must colour itself from `appTheme()`, never from SwiftUI's
    semantic colours.** `.primary`/`.secondary`/`.fill.tertiary`/`Color.green`/
    `Color.accentColor` all follow the DEVICE's light/dark setting, but the app's
    theme is a manual choice mirrored into the App Group as `widget_theme` — so a
    semantic-coloured widget renders dark next to a light-themed app. This is
    what made the Budget tile "always black". `index.swift` declares the
    `WarmHearth` tokens (incl. `income` and `onAccent`) and `appTheme()`; use
    those, set `.containerBackground(appTheme().bg, for: .widget)`, and put an
    explicit `.foregroundStyle(theme.text)` on the root — anything without its
    own colour otherwise inherits `.primary` and goes white on a light card.
    All four widgets are clean as of this sweep — grep for
    `foregroundStyle(.secondary)|.fill.tertiary|Color.accentColor|Color.green`
    in `targets/widgets/` before shipping a widget change. (The one deliberate
    exception is PetCare's green "all done" card, which is a success colour, not
    a themed surface.)
  - **An interactive widget button fires on a press-and-hold that's too short to
    raise the system context menu** — so any `Button(intent:)` whose action is
    hard to take back is a hazard, and it's worse here because the tiles cover the
    whole widget surface (there's barely any non-interactive area to long-press).
    Nudges guards this with an **undo window**: `SendNudgeIntent` writes a
    `"pending"` status and schedules the upload with `earliestBeginDate` =
    `UNDO_HOLD` out, so the POST sits on-device as a staged file; `UndoNudgeIntent`
    cancels that task (`NudgeSender.cancel(path:)`, keyed on the staged file path
    stashed in `pending_nudge`). Undo must PREVENT the send, never delete after —
    a push can't be recalled. The upload is held slightly LONGER than the button is
    shown (`UNDO_HOLD > UNDO_SECONDS`) because the timeline's revert-to-list isn't
    punctual, and a stale Undo that silently no-ops is worse than none.
    **PetCare's `MarkTaskDoneIntent` has no such guard** — it's reversible in the
    app, so it was left alone; revisit if that stops being true.
- **A button whose `disabled` can change must use `@/components/Pressable`,
  never react-native's.** On Android (RN 0.85, New Architecture) a flip of
  `disabled` on an existing view can be lost — accessibilityState.disabled is
  what calls view.setEnabled() — so the button LOOKS enabled while the native
  view stays enabled=false and finger taps are dropped. It blocked every
  Android signup at Onboarding's Continue (2026-10-11, seen with
  `uiautomator dump` on a Galaxy S9+). The wrapper keys on `disabled`, so each
  flip mounts a fresh native view; `Btn` already uses it.
  `__tests__/pressable.test.tsx` fails if a file with a disabled Pressable
  imports react-native's.
- **Games (`/games`, hub app, migration 090, 2026-11).** Live family games,
  each player on their own phone. **The server runs the game**: clients only
  READ `game_sessions` (public state JSON) + `game_players` over Realtime, and
  every move is a security-definer RPC (`lib/games.ts` wraps them) that checks
  household, player and whose turn it is. Anything the other team must not see
  (the hangman word; later the battleship fleets and quiz answers) lives in
  `game_secrets`, which no client role can read — never put a secret in
  `state`. Shapes are documented at the top of the migration and in
  `lib/games.ts`. Shared live base: a room (`game_create` → host on team A,
  `game_join` balances teams), teams A/B ("Coral"/"Indigo", `apps/games/look`),
  "I'm ready", host starts when everyone else is ready and both teams have a
  player; turns rotate inside each team (`order`/`idx` in state); the host can
  skip someone away from the phone; leaving mid-game reseats the turn, an
  empty team ends the game. Rooms older than 3 h drop off the list.
  - **Hangman** (`apps/games/hangman/`): the setter picks a category (the hint)
    and a word — tapped suggestion, random, or typed (`words.ts`, pt/en/es;
    `validWord` mirrors the server rule). Accents fold on the server
    (`game_norm`). The drawing is the One Roof house going up, one piece per
    wrong guess (`art/HouseBuild`, 7 pieces = `HOUSE_PIECES` = server
    `max_wrong`). Solved → point to the guessers; house finished → point to the
    setters. Teams swap every round; rounds are even.
  - **Polish is part of the feature** (owner, 2026-11): original SVG art +
    Reanimated motion (`art/`), synthesised sounds (`scripts/make-game-sounds.py`
    → `assets/sounds/games/`), haptics via expo-haptics. `feedback.ts` loads
    expo-audio/expo-haptics lazily (guarded) and keeps a per-device mute.
    Feedback is driven by what CHANGED in shared state, so every phone reacts
    to every move. Layout adapts at ≥760 pt (board left, controls right) for
    iPad/Mac. Battleship and the buzzer quiz show as "coming soon" cards.
  - **Finding a room** (migration 091): an open room shows on the Home right
    under the ask bar (`apps/games/GamesBanner`, live via `useOpenGames`) for
    everyone, and creating one pushes "X opened a room" (DB trigger →
    `api/send-ping` action `game-invite`, one-shot on `game_sessions.pushed_at`,
    copy in the recipient's `user_settings.language`) to members whose
    `user_settings.notify_games` is on — the opt-out lives in Settings →
    Notifications (`GameInvitesToggle`). Turning it off never hides the Home card.
  - **Send a hangman** (migration 092, `hangman/SendHangman`, route
    `/games/send?to=`): pick people + word → one ONE-ROUND async session per
    recipient (mode 'async'), recipient notified (same insert trigger), sender
    told the result (`game-result`, sent even with notify_games off — it answers
    the sender's own action). The Hangman screen renders async sessions without
    teams/scores (sender ↔ guesser header) and its result offers "send one
    back". Listed in the Games hub ("Sent hangmans") and, when waiting for you,
    on the Home (`GamesBanner`). `useChallenges` loads the last 7 days.
  - **Battleship** (`apps/games/battleship/`, migration 093): same lobby and
    teams; phase `placing` (tap a ship in the tray, tap the sea; tap a placed
    ship to rotate/remove/move; Shuffle = `randomFleet`; teammates see changes
    via `state.rev` → refetch `battleship_my_fleet`), then `battle` (aim with a
    tap, then "Fire!" — two steps so a slip doesn't waste a shot; hit fires
    again). The enemy fleet NEVER reaches the phone; sunk ships are revealed in
    `state.sunk`. Phone shows one sea at a time (follows the turn, switchable);
    ≥760 pt shows both. `Board.tsx` draws the sea, ships (SVG hulls), hit/miss
    marks and the last shot's ripple/burst. Never use jsonb `@>` to match board
    cells: containment ignores order inside arrays, so [0,2] "contains" [2,0]
    (this bit the first version of the SQL).
  - **Buzzer quiz** (`apps/games/quiz/`, migrations 094–095): question on
    every phone, big `Buzzer` (team-coloured dome), first press the SERVER
    receives answers by voice (`useVoice`, same recogniser as the ask bar) or
    typing; wrong/slow → locked out of that question, reopened for the rest;
    reveal → +1 and auto-next. The server owns every clock: phones correct
    drift with `state.now` and call `quiz_tick` when their countdown ends (the
    server re-checks the deadline). Answers are matched tolerantly in SQL
    (`quiz_matches`). The bank is generated by `scripts/quiz-bank.py` (+ one
    file per category in `scripts/quiz_extra/`) → 095, ~1,400 questions
    (pt 511, en/es ~440), de-duplicated per language; add questions THERE
    (short answers, all fair variants, timeless facts, answer never inside the
    question). A household never sees a question twice until the bank runs
    out (`quiz_seen`, keyed by `qkey` = md5(lang|question), migration 097).
  - **Team identity is loud on purpose** (owner, 2026-11): teams are Orange (A)
    and Purple (B); every game screen shows "You're on Team X"
    (`MyTeamBanner`), a wash of your colour (`TeamWash`), your score tile marked
    YOU and the other team's faded. Round results are from YOUR side: your
    colours + confetti when your team scores, a grey card with a rain cloud
    when it doesn't; a "+1" flies into the scoring team's tile. The hangman
    house is the word team's: they see it BUILD, the guessers see it CRUMBLE
    (`HouseBuild` mode) — same `wrong` count. Motion is calm (timed fades, no
    wobbly springs) by request. The lobby's rules are the illustrated
    `HowToPlay`, not a paragraph.
  - **Rooms (migration 096):** ONE live room per host — `game_create` raises
    `has_room`, the app asks "close the other and open this?" and retries with
    `p_replace`. A live room idle 15 min closes (`state.ended = 'expired'`):
    `game_sweep()` runs when the room list loads and every minute inside a
    room (no cron); lobby moves bump `updated_at` via a `game_players` trigger.
    Leaving is the themed `LeaveSheet` (also on Android back), never an Alert.
  - **Buttons:** game actions use `GameBtn` (`GAME_ACTION`, cyan → blue) —
    never a team colour (orange/purple) and not the app's clay `action`.
  - **Pushes you're already looking at:** `lib/onScreen` — the Games screens
    mark `'games'` while focused and the foreground handler drops `/games`
    pushes then.
  - **Applause is a real CC0 recording** (BigSoundBank #0236, teens shouting
    and clapping), not synthesised — see the note at the end of
    `scripts/make-game-sounds.py`.
  - **Sounds:** quick UI sounds play from a small pool of players, each paused
    + rewound when it finishes. Pause FIRST: on Android a finished player is
    still "playing", so a bare seekTo(0) restarted it — an endless chime.
  - **Same moment on every phone (migration 109, 2026-11-13):** each question
    has `state.opens_at` — a "3, 2, 1" (`GetReady`) before the text shows and
    the buzzer opens; `quiz_buzz` refuses earlier presses. Question 1 waits
    (max 12 s) for every player's `quiz_ready` (sent when Quiz mounts), then
    opens 3 s later. Phones take their clock offset from a round trip to
    `game_server_now()` (best of 3), not from `state.now`, which arrives late on
    a slow phone. The spoken answer is sent once the words stop changing for
    1.3 s whatever state the recogniser reports (Android never left
    "starting"/never ended after stop()).
  - **Play again = one room (migration 110):** `game_rematch` — the first tap
    creates the room and stores it in the finished game's `state.rematch`;
    the others see "X wants to play again" on the results screen and join
    THAT room on their old team.
  - **Quiz UI:** `QuestionCard` (category header with its icon, question in
    large type — never `adjustsFontSizeToFit`, iOS shrank it unreadable), the
    mic opens by itself when you hold the buzzer (`AnswerPanel`), and every
    attempt flashes big on all phones (`AttemptFlash`).
  - Test the SQL before applying: the RPCs were exercised on PGlite
    (`@electric-sql/pglite` ≥0.5 — 0.3 crashes on RAISE) with stubbed
    `auth.jwt()`/`current_household()`.
- **Utilities (`/calc`, hub tile renamed from Calculator — slug, route and
  `app.calc.*` keys unchanged)** is a grid of tools, each its OWN route under
  `app/calc/` (native back gesture, real stack entry). Implementation in
  `apps/calc/`:
  - **Wizards** (`wizard.tsx` `WizardScreen`/`StepTitle`, controls in
    `steps.tsx`): one question per screen, progress bar, ONE primary button
    docked under a KeyboardAvoidingView so it rides on top of the decimal pad
    (no return key, no Done bar — that button IS the way forward). Header back
    and Android back walk the steps; the iOS swipe-back is off past step 1
    (`swipeBack` re-enables it on result screens) so a stray edge swipe can't
    drop a metered bill scan. The summary is also the editor: a row jumps to
    its step, and "Update summary" returns straight there.
  - **Money maths** is pure, in `splitMath.ts`, in whole cents with
    largest-remainder apportioning so shares always add up to the bill
    (`__tests__/splitMath.test.ts`). `shared.num()` reads a lone comma as a
    decimal comma — the iOS decimal pad types the device locale's separator.
  - **By-item split** keeps the owner rule: bill lines/tax come ONLY from the
    scan (`billScan.ts` → `/api/scan-bill`), read-only; people can drop a
    misread line or re-scan. The processing screen's stages are paced on a
    timer (the API is one request). Plus-gated in the hub AND on the route.
  - **Printable cards** (`printables/`): a template is data (inches, copies per
    sheet, fields, a card component with FIXED print colours) and
    `PrintableEditor` makes any template a full tool — live preview, colour,
    "fill in for" a member, per-device draft (AsyncStorage), Print, Save
    image. ONE artwork: the preview view is snapshotted with
    react-native-view-shot at 300 dpi; Print wraps that PNG in inch-sized HTML
    for expo-print, Save hands it to expo-sharing (iOS "Save Image" — needs
    `NSPhotoLibraryAddUsageDescription`, or iOS asks for FULL library access).
    All three modules are lazy-`require`d (`printing.ts`) — older binaries get
    a "please update" alert instead of a crash. No expo-media-library on
    purpose: its Android READ_MEDIA_* permissions draw Play policy review.
    New card = template + card component + route + hub tile.
  - **Photo frame** (`apps/calc/frame/`, 2026-11; routes `/calc/frame` =
    set-up, `/calc/frame-show` = the frame). Two sources, chosen PER DEVICE
    (`frameStore` settings in AsyncStorage, with the slideshow/night options):
    **this device's photos** (picked, resized and copied into
    `Paths.document/frame-device/` — never uploaded) and the **family album**
    (`frame_photos`, migration 100; bytes in `documents` at
    `<household>/frame/<uuid>.jpg`, resized to a 1600 px long side / JPEG 0.8
    before upload; delete own, owners any — the RLS decides, the app deletes
    the ROW first and only then the object). Limits: a BEFORE INSERT trigger
    on `household_is_plus` — free 30, Plus 500; `free_plan_frame_limit` → the
    app offers `/paywall`, `frame_photo_limit` = Plus is full;
    `frame_photo_quota()` feeds "12 of 30" (constants in `frameLogic` are UI
    only). **Egress rule: the slideshow plays ONLY local files.** Each album
    photo is downloaded once into `Paths.document/frame-cache/<id>.jpg`
    (`syncCache`, two at a time, half files deleted, pruned when a photo is
    gone); the uploader's own copy goes straight into its cache. The list
    refreshes from Realtime on `frame_photos` + foreground (`useFrameAlbum`);
    offline it falls back to the last list this device saw (manifest per
    household). The set-up grid uses the cached file, else a signed URL with
    expo-image `cacheKey: path` (a new token must not mean a new download).
    The frame: keep-awake via a GUARDED require (`keepAwake.ts`;
    expo-keep-awake comes with `expo`, now also declared), two layers — the
    incoming one revealed only on `onLoad` (4 s fallback), crossfade 1.8 s,
    Ken Burns per photo (`kenBurns(id)`), `fitFor` shows a photo whose shape
    fights the screen whole over a blurred copy; clock/date, "Added by Ana",
    next calendar event, pet care still due (`petsDue`), birthday pill; on a
    member's birthday their TAGGED photos lead and alternate (`buildDeck`).
    Night mode pauses the show and dims (clock stays) or blacks out between
    two hours — the screen stays lit (no brightness API in the binary). The
    app is portrait-locked on phones, so "Turn sideways" (`rotated`) draws the
    whole stage rotated 90°; iPad/Mac rotate natively and the layout follows
    `useWindowDimensions`. Pure maths in `frameLogic.ts`
    (`__tests__/frame.test.ts`).
  - **Every tool speaks the frame's language (2026-11-12).** One gradient +
    tint per tool in `apps/calc/look.ts` (`TOOL_LOOK`; the hub tiles read it
    too). `ToolHead.tsx`: `ToolHero` (36pt title, faded 22pt display subtitle,
    breathing `ToolHeroArt`), `SectionLabel`, `ChoiceChip` (selected = soft
    wash + 1.5 outline in the tint). `WizardScreen` takes `kind` (no `title`):
    round back + progress in the tool's tint + its mini art in one row, the
    docked primary is a `TintButton` in the tool's gradient, the secondary a
    tinted text button; the steps' controls read the look from
    `ToolLookContext`. Results are a gradient `ResultHero` (steps.tsx).
    Better deal: unit is a `SelectRow`; the shelf plays the verdict (winner
    rises on a glow with a gradient ribbon, the other dims/greys) and
    `DealVerdict` shows who wins with per-unit bars (shorter = cheaper),
    a stamp-landing headline and one sheen per NEW winner. All motion is
    Reanimated timing curves; Reduce Motion lands on the end state.
- **Documents: List or One at a time (2026-11, per device, `docs:view`).** The
  round button left of the lock flips it. `apps/docs/DocCards` pages through the
  same filtered/sorted docs, the page drawn large on white: the PREVIEW
  (`previewPathFor` → `<household>/previews/<uuid>.jpg`, 1240 px, written by
  `uploadThumb` with the thumb since 2026-11), else an image doc's own file,
  else the 320 px thumb with "open to read it all". Older PDFs have no
  preview (no PDF renderer on device). Deleting/replacing a doc removes all
  three objects.
- **Documents, 2026-11-13.** The lock screen is a vault door (`apps/docs/VaultDoor`
  + `VaultGate`): wheel turns, bolts draw back, the door swings on its hinge and
  the scene zooms into the documents (mounted underneath during `opening`);
  sounds from `scripts/make-vault-sounds.py` via `vaultFeedback.ts` (guarded
  expo-audio: check `requireOptionalNativeModule('ExpoAudio')` BEFORE requiring,
  or a binary without it shows a red box in dev). **PDF pictures are rendered by
  the server** (`api/send-digest?action=doc-thumb`, pdfjs + @napi-rs/canvas, as
  the CALLER under RLS): `DocumentVault` asks for any PDF whose thumb is missing
  (a few per visit, once per doc) — that also covers new uploads, since the list
  reloads after a save. Switching to (or opening in) one-at-a-time scrolls the
  card + "1 of n" into view (`fitPending`/`fitUntil`, the scroll deferred a beat).
- **Date/time pickers open in their own sheet, never inline in a form.**
  `@/components/PickerSheet` (iOS bottom sheet + Done; Android's native dialog)
  for times and one-off dates; Money's `DatePickerModal` and Pet Care's
  `DateField` are the same shape. An inline iOS spinner pushed Save down the
  page in the calendar event form (2026-10-11).
- Icons: `lucide-react-native`. Images: `expo-image` + `@/lib/signedUrls`. Dates:
  `@react-native-community/datetimepicker`. Camera/photos: `expo-image-picker` +
  `expo-image-manipulator`. Files: `expo-document-picker` + `expo-file-system`
  (SDK 56 `new File(uri).arrayBuffer()`). Face ID: `expo-local-authentication`.

## Module layout
`src/app/<route>.tsx` is the screen entry (replaces the old placeholders);
implementation lives in `src/apps/<id>/`. Nested routes use folders
(`src/app/budget/[budgetId]/[monthId].tsx`, `src/app/pets/[petId].tsx`).

## Whereabouts (family location) — Phase 1
Live family map (route `/location`, hub tile "Whereabouts"). **Native-only**: the
map (`@rnmapbox/maps`) and background location (`expo-location` +
`expo-task-manager`) need a dev build + Mapbox tokens — see `WHEREABOUTS-SETUP.md`.
- **OFF on Android for v1 (2026-10-11) — one switch, both layers.**
  `WHEREABOUTS_ON_ANDROID` in `app.config.js` strips the Android location
  permissions (`blockedPermissions`, which also removes Mapbox's and
  expo-location's library declarations) and expo-location's location
  foreground service (inline config plugin), and publishes
  `extra.whereaboutsAndroid`; `src/lib/features.ts` → `WHEREABOUTS_ENABLED`
  reads it back. JS gates: the hub registry (`APPS`), Hub's `SafetyBanner`, the
  `/location` route (redirects home), `useLocationSync`/`useGeofenceSync` (tear
  down leftovers from earlier builds instead of syncing), `useLiveResponder`,
  both task callbacks, `respondToLiveWake`, and `/location` push taps. A NEW
  Whereabouts entry point (a link from another screen, a new background hook)
  must check `WHEREABOUTS_ENABLED` too — `disabled.android.test.ts` covers the
  existing ones. Never gate on `Platform.OS` directly: the switch is what turns
  it back on. Play-side consequences and the re-enable checklist:
  `PLAY-STORE-RELEASE.md` §0b.
- `member_locations` (migration 065) — one row per member: latest fix + `sharing`
  / `paused_until`. Household-scoped RLS + Realtime. **Sharing is OFF by default
  (opt-in); we null coordinates on stop/pause so no stale location leaks.**
- `src/lib/location.ts` — data + logic: fetch/upsert my fix, `setSharing` /
  `pauseSharing` / `resumeSharing`, foreground `captureAndUpload`, Mapbox
  `driveEta`, `haversineMeters`, `formatDistance`/`formatEta`, nav deep-links.
  Keep `@rnmapbox/maps` imports OUT of here (screens only).
- `src/lib/locationTask.ts` — the background TASK (module-scope `defineTask`, same
  pattern as `backgroundNotifications.ts`). `startBackgroundUpdates` takes
  localized foreground-service labels.
- **Every background task is defined from `mobile/index.ts` (package.json
  `main`), NOT from `_layout`.** On Android a location fix, geofence crossing or
  data-only push that arrives after the process died boots a HEADLESS JS
  context: the entry runs, nothing renders — and Metro loads route files
  (`_layout` included) lazily, on first render. A task defined only via
  `_layout` is therefore missing there, and expo-task-manager then
  UNREGISTERS it (`TaskManager.ts`: "requested but looks like it is not
  defined"). Because `LocationTaskService` is `START_REDELIVER_INTENT`, the
  first Samsung process kill did exactly that: the S9+ stopped reporting for
  days (2026-09-26) while the UI still said "sharing". Expo's docs say "import
  it at the top of _layout" — that is not enough on Android. A NEW task module
  must be imported in `index.ts`; `__tests__/whereabouts/headless.test.ts`
  fails if it isn't.
- **expo-location refuses a `foregroundService` (re)start unless the app is
  foregrounded** (`ForegroundServiceStartNotAllowedException`, every Android
  version). So: background code (live-wake ramp, relax from a delivered fix)
  re-registers WITHOUT the service block via `reconfigureOptions()` — the
  running service is left alone — and `resumeBackgroundUpdatesIfSharing()`
  (every foreground, via `useLocationSync`) RE-APPLIES the full options on
  Android even when the task is already registered, because after an OS kill
  the task survives but its service doesn't. Never build task options without
  the `foregroundService` block from the foreground: re-registering without it
  there STOPS the running service. `storedLabels()` never returns null for that
  reason.
- **The background-notification task gets a different payload per platform.**
  iOS: `notification.request.content.data`. Android data-only FCM: the
  serialized RemoteMessage, our data as a JSON string in `data.body` /
  `data.dataString` (wrapped under `notification` on the JobScheduler path).
  Parse with `notificationTaskPayload()`; reading only the iOS shape is how
  every Android live-wake was ignored.
- **Android drops background location on termination and NEVER restarts it.**
  Expo 56's docs: *"A terminated app will not automatically restart when a
  location or geofencing event occurs due to platform limitations"* — iOS does
  relaunch. So a force-stop, a reboot, or an OEM battery optimiser killing the
  foreground service stops this device reporting for good. `useLocationSync`
  (`_layout`, sibling of `useGeofenceSync`) restarts it on launch and on every
  foreground when `member_locations.sharing` says it should be running, and
  primes a fresh fix when it had to. Symptom if this ever regresses: your own
  pin frozen while everyone else's moves, and no place crossings — so no
  arrival/departure alerts about you — while the UI still says sharing is on.
- **iOS `pausesUpdatesAutomatically` must stay FALSE in the saver profile
  (2026-11).** iOS pauses a still phone's stream and never resumes it for a
  backgrounded app — a member drove to the supermarket while the map showed
  her at home until she opened the app. The 60 m distance filter already keeps
  a still phone quiet. Belt and braces: the geofence task now uploads a FRESH
  fix on every place crossing and calls `kickBackgroundUpdates()` to restart
  the stream (a crossing recorded the event but never moved the pin).
- **Opening frame:** `framePoints` fits you + members within `NEARBY_FRAME_M`
  (30 km), never tighter than `MIN_FRAME_SPAN_M`, clearing the roster; the
  recenter button fits EVERYONE. Place labels hang BELOW their point (anchor
  y 0 + 28pt spacer, `pointerEvents="none"`) — centred, "Home" covered you.
- **`timeInterval` is ANDROID-ONLY and must be set.** With `distanceInterval`
  alone the fused provider picks its own cadence. `activityType`,
  `pausesUpdatesAutomatically` and `showsBackgroundLocationIndicator` are
  iOS-only; `deferredUpdatesInterval` applies to both and BATCHES delivery, so
  a saver-mode fix can arrive a cadence late by design.
- `src/apps/location/` — `Whereabouts` (map + bottom sheet, owns the data + one
  Realtime channel), `MemberDetailCard` (the EXPANDED roster card — **leads with
  drive-time ETA**, then distance/battery/where-they-are, navigate, nudge/call),
  `NavPicker` / `NudgePicker` (pick a map app / a nudge, from the map),
  `SharingControls` (toggle + pause), `locationUi` (card geometry, member
  colors, ringed avatar, battery chip, `WatchingChip`, `timeAgo`).
- **Prominent disclosure before the background prompt** —
  `src/apps/location/LocationDisclosure.tsx`, a full-screen explainer that names
  One Roof, states location is collected in the background even when the app is
  closed, says it's shared only with the household, and offers Continue / Not
  now. **Google Play requires it *before* `requestBackgroundPermissionsAsync`**
  and rejects builds without it (`PLAY-STORE-RELEASE.md` §3.1 has the flow, the
  full copy, and the demo-video shot list). Both entry points — the sharing
  toggle and Resume — go through `gate()` in `SharingControls`, which shows it
  and only then calls `ensureBackgroundPermission()`; it's skipped only when
  `hasBackgroundPermission()` is already true (no OS prompt would appear).
  Copy lives in `location.disclosure.*` (en/es/pt). Any new caller of
  `ensureBackgroundPermission()` MUST show this screen first.
- The detail card carries **three** actions — Navigate, Nudge, Call. Apple/
  Google/Waze used to be three separate buttons in that row, which left each one
  too narrow for a readable label, so the glyph carried the whole meaning. They
  moved behind `NavPicker`; the extra tap buys the remaining buttons enough
  width to be legible. Both pickers are Modals owned by `Whereabouts`, not the
  card — a card inside a horizontal scroller can't present a sheet. `NavPicker`
  offers all three apps unconditionally because `navUrl` builds universal HTTPS
  links: each opens the native app if installed and the web map if not.
- **Tapping a card or a pin expands that member IN PLACE and frames them on the
  map** (`select()` in `Whereabouts`); tapping the open one collapses it. There
  is deliberately no detail modal — a sheet covered the very map you'd just
  focused. Consequences worth knowing before you touch this:
  - **The expanded card is the same HEIGHT as a collapsed one, only wider**, so
    the roster never changes size and the map doesn't jump on every tap.
    `MemberDetailCard` documents its 168pt height budget; text rows carry
    explicit `lineHeight` so that budget survives font metrics.
  - **Scrolling the expanded card into view happens on ITS `onLayout`, not in
    the tap handler** (`onLaidOut` → `onExpandedLayout`, gated by a
    `focusPending` ref). At tap time the card is still 138pt and the scroll view
    still has its old content width, so any offset computed there is stale and
    gets clamped short — expanding the LAST card left it cut off by 146pt.
  - **The roster FLOATS on the map — there is no panel behind it.** Each card
    carries its own opaque fill + `FLOAT_SHADOW` instead. The fill MUST be
    `c.sheet`: `c.surface` is translucent under the glass skin (10% white in
    Dusk) and a card using it would all but disappear over the tiles — the same
    trap as `c.card`, one layer down. The scroll strip still swallows touches
    across its full width even though it looks like open map (a horizontal
    ScrollView has to claim the gesture), so it's kept to just the cards' height.
  - `ROSTER_HEIGHT` (= `CARD_H + ROSTER_CHROME`) is the single source for both
    the camera's `padding.paddingBottom` — without it a focused member is
    centred behind the card you just opened — and `MAP_CREDIT_BOTTOM`. Keep them
    DERIVED; a hand-typed offset is how the attribution ends up under a card.
  - Only ONE detail card is mounted at a time, which is why the ETA /
    reverse-geocode / `useWatchLive` hooks live inside it — a household of ten
    must not fire ten Directions requests. Live mode now starts on EXPAND and
    relaxes on collapse (it used to be tied to opening the sheet).
  - **Your own card is the exception: it never expands.** In place of everyone
    else's location line it shows your SHARING STATE — a coloured dot plus
    on / paused / off — with a settings gear in the corner opening
    `SharingControls` (still a modal: switches and pause presets, not detail).
    Deliberately absent: where you are (you know) and your battery (the phone
    shows one already). Tapping it frames you on the map and stops there, so
    `MemberDetailCard` has no `isMe` branch. The state line sits in the same
    slot as other cards' status line, with the button filling the bottom row —
    that's where the other cards put their battery/watching chips, so the card
    keeps the roster's rhythm.
  - The expanded card's ✕ is `alignSelf: 'flex-start'`. The header row's height
    comes from the 40pt avatar, so centring it put a 17pt glyph ~23pt down while
    every other element starts at the 12pt padding — it read as sagging.
- **Map styles** (`mapMode.ts` + `MapModePicker`): Map / Satellite / Terrain,
  from the layers button under the recenter control, remembered in AsyncStorage.
  - The picker is a row of option cards mirroring **Settings' Appearance
    picker** (bordered tile + preview + checked label). The previews are real
    Mapbox **static images centred on the map's own centre**, so you compare
    styles on ground you recognise — a hand-drawn mock can show you a colour
    scheme but can't show you what "terrain" does to your street. A real preview
    also can't lie: in a flat city, terrain genuinely looks close to the plain
    map, and the card says so.
  - They're requested with `logo=false&attribution=false` because baked-in credit
    is illegible at ~100pt wide; the picker prints "© Mapbox © OpenStreetMap"
    under the row instead, which is what makes that flag permissible. Don't drop
    that line.
  - `standard` previews as plain `streets-v11` even when a custom Studio style
    is configured: a custom style needn't be public, and a 404 tile is a worse
    preview than a representative one. Tiles fall back to `c.surface` when
    offline or before a fix is known.
  - `standard` still follows the theme AND `EXPO_PUBLIC_MAPBOX_STYLE_URL(_DARK)`
    — that's the house look. Satellite/terrain are imagery and look identical in
    either theme, because there's no dark version of a photo of the ground.
    Satellite uses satellite-STREETS: bare satellite has no labels, which makes
    "where is she exactly" harder rather than easier.
  - **Changing `styleURL` tears down the old style and everything added to it.**
    `onDidFinishLoadingStyle` bumps `styleEpoch`, which re-keys our `ShapeSource`
    so it's re-added AFTER the new style loads — without that the safety-radius
    circle can quietly vanish when you switch modes. Key any future source the
    same way. (`MarkerView` pins are plain React children and are unaffected.)
  - Helpers live in `mapMode.ts`, not in the picker file: exporting hooks
    alongside a component breaks Fast Refresh, which is what `react-refresh`
    flags. Same reason `Section` sits in `locationUi`.
  - The map is not mounted until the stored mode has been READ (`ready`).
    AsyncStorage is async, so otherwise a satellite user watches the plain map
    load and flip on every open — which reads as "it forgot my choice" even
    though it didn't. Because of that gate, the one-shot centring effect must
    check `cameraRef.current` BEFORE setting `centeredOnce` — claiming the shot
    against a null ref would leave the map parked on the fallback view.
- Native config lives in `app.config.js` (layered on `app.json`): Mapbox plugin
  (`RNMAPBOX_DOWNLOAD_TOKEN` build secret), expo-location background, iOS
  `UIBackgroundModes: ["location"]` + Always strings, `LSApplicationQueriesSchemes`
  (comgooglemaps/waze), Android location perms. Runtime map/Directions token is
  `EXPO_PUBLIC_MAPBOX_TOKEN`.
- **Live mode** (migration 066, `src/lib/liveLocation.ts`): opening a member's
  detail writes a `location_live_requests` row (heartbeated while open); the
  target device runs `useLiveResponder` (mounted in `_layout`) and, WHILE
  SHARING, ramps up to a high-accuracy `watchPositionAsync` burst so their pin
  moves near real-time, then relaxes when the request expires. Being watched
  never turns sharing on. The MemberSheet ETA/address refetch on a coarse ~100 m
  grid so live updates don't spam the Directions API.
  - **Background wake → RAMPED live mode**: a live request fires a SILENT push
    (`api/ack-ping.ts` `?action=live-wake`) ONLY when the target's
    `member_locations` row is stale (>30 s) or has null coords — iOS budgets
    silent pushes to a handful per hour, and pushing on every 20 s heartbeat
    trains the OS to drop them, including the one that matters (real bug: a
    watched member at the gym barely moved on the map while Find My streamed).
    Needs the Vercel API DEPLOYED + expo push tokens (migration 039). On the
    target, `backgroundNotifications.ts` routes a BACKGROUND wake to
    `locationTask.respondToLiveWake()`, which (1) RAMPS the already-running
    background task to streaming options (High accuracy, 10 m, no deferral,
    `pausesUpdatesAutomatically: false`) by re-calling
    `startLocationUpdatesAsync` — once ramped, the stream sustains itself
    through the location background mode, so ONE delivered push covers the
    whole watching session — and (2) spends the wake's ~30 s runtime on a
    high-accuracy `runLiveBurst` so the watcher's map moves immediately while
    the ramp warms up. Ramp state lives in AsyncStorage (`oneroof-live-until`;
    Android FGS labels under `oneroof-bg-location-labels`), is extended from
    `location_live_requests` by a 15 s tick (JS timers run — ramped updates
    keep the process alive) plus a check on every delivered fix (which also
    resurrects the tick after a process relaunch), and relaxes back to the
    battery-saver options when the window lapses. A FOREGROUND wake still takes
    just one quick fix (`captureLiveFixIfSharing`) — `useLiveResponder` handles
    the streaming there. A force-quit app can't be woken at all (iOS policy).
    Member pins GLIDE between fixes (`GlidingMarker`: 800 ms ease-out lerp,
    snaps on the first fix and >2 km jumps) instead of teleporting; places keep
    plain `MarkerView`.
- **Watching a place is PER-USER** (migration 070, `place_watchers`). Places are
  shared household furniture, but creating/sharing one subscribes NOBODY —
  each member opts in per place and picks whose crossings they want
  (`watched` empty = everyone). The push fan-out in `api/send-ping.ts`
  (`?action=place-event`) reads `place_watchers` with the service role, so a
  crossing only reaches people who asked for it. The old place-level
  `notify_arrivals`/`notify_departures` columns were DROPPED — they made one
  member's preference everyone's notification. Geofences are registered for
  EVERY place (the crossing is recorded regardless; the fan-out decides who hears).
- **Place search** — `lib/placeSearch.ts` `searchPlaces(query, near)` hits the
  **Mapbox SEARCH BOX API** (`/search/searchbox/v1/forward`) with the existing
  `EXPO_PUBLIC_MAPBOX_TOKEN` (no second provider/key), debounced 350 ms in
  `PlaceForm`, biased by the user's position. Deliberately the ONLY
  provider-specific code, so swapping to Google Places is a one-file rewrite.
  - **Do NOT move this back to `geocoding/v5/mapbox.places`.** That's a
    GEOCODER with no business listings: measured from downtown Tampa it
    returned ZERO actual Publix stores (just streets named "Publix Road", 28 mi
    out) and answered "LA Fitness" with "La Casa Condos". Search Box is the
    POI/brand index and returns real storefronts. This was a shipped bug.
  - Results are **re-sorted by true distance** client-side and each row shows
    it. `proximity` alone is only a relevance hint — a real response for "Tampa
    Elementary School" came back 2.0 / 12.4 / 1.1 / 11.1 mi. We fetch 10 and
    show 6 so the sort has a real pool to pick from.
  - The search origin in `PlaceForm` is state SEPARATE from the pin (`origin`
    vs `coords`) and is a dependency of the debounce effect on purpose: the GPS
    fix arrives asynchronously, so a query typed before it lands must re-run
    once it does, or it stays stuck with unbiased nationwide results. Biasing
    off `coords` would also anchor the next search to whatever result was last
    tapped instead of to the user.
  - `PlaceForm`'s **Location** section states exactly one thing, and the whole
    section keys off `hasPlace` (`picked || usingSaved` — a NAMED place, either
    searched or the saved one being edited):
    - `hasPlace` → its address + a bin to remove it, and **the search box is
      hidden** (the bin is the way to change it). Note an existing place counts:
      opening one used to show a search box next to an already-chosen location.
    - otherwise → your current location, or "no location chosen yet", with the
      search box shown.
    - The bin **clears the location outright** (coords → null, Save disabled)
      rather than restoring a previous spot. A trash icon that quietly undid
      something would be lying about what it does.
    - `usingSaved` is tracked separately from the coordinates because
      `savedLabel` describes the place's ORIGINAL spot — after re-pinning it must
      stop being shown, or the form describes the old location while saving the
      new one. Editing used to fall through to "Your current location", which
      described the phone rather than the place.
    - The current-location action reads "Switch to my current location" when a
      place is chosen and "Use my current location" when none is, and hides in
      the one case where it would change nothing (no place, already on the
      current location) so it can't be misread as a description of the state.
  - **`Field` sizes itself from its `fontSize`**, so the icon input's 22pt emoji
    made it taller than the name box beside it. Both are pinned to `FIELD_H`
    with `paddingVertical: 0` (plus `textAlignVertical` for Android, which
    doesn't centre a fixed-height single line on its own).
  - `Section` cards separate from the sheet by a **hairline border**, not by
    their fill: `c.surface` is a translucent overlay on `c.sheet` (10% white in
    Dusk), so fill alone barely reads as a distinct card. An edge reads at any
    opacity in either theme. Same trick if you add panels elsewhere in here.
  - Caveat: Search Box results are *temporary* by default and we persist the
    chosen coordinates — fine in practice, but a permanent entitlement is a
    paid Mapbox add-on if that ever needs to be airtight.
- **"At Home" status** — `placeAt(places, point)` in `lib/places.ts` resolves the
  place a member is inside (smallest radius wins on overlap); the roster card and
  the member sheet prefer it over a distance or a geocoded street address.
- **Watched places get a RING on the map**, drawn with the same `circlePolygon`
  the safety radius uses (Mapbox circle radii are in PIXELS, so a real
  geographic polygon is the only thing accurate at every zoom).
  - Only places **I subscribe to** are drawn. A ring says "this boundary is
    armed for me" — drawing unwatched places would promise alerts that never
    fire, and drawing another member's subscription would show a boundary that
    isn't mine.
  - Same styling as the safety radius (dashed accent) — an armed boundary looks
    the same wherever it came from. Drawn under the place labels.
  - Shown only while the subscription EXISTS: turning "notify me about this
    place" off removes the watcher row, and the ring goes with it.
  - Re-key each ring on `styleEpoch` — changing map style tears down every
    source added to it (same trap as the safety ring).
- **Places & geofences (Phase 2)** — migration 067 (`places` + `place_events`),
  `src/lib/places.ts` (CRUD + `recordPlaceEvent`) and `src/lib/placesTask.ts` (the
  module-scope geofence TASK + `syncGeofences`). Each member's device monitors the
  household's places via OS region monitoring (cheap on battery); crossing one is
  recorded by THAT device (RLS only allows recording your own crossings), which
  drives the Activity feed via Realtime and pushes "Emma arrived at School" via
  `api/send-ping.ts` (`?action=place-event`, respects the place's notify flags).
  UI: `PlacesSheet` (Places / Activity tabs) + `PlaceForm` from the Whereabouts
  header. Gotchas: **iOS caps monitored regions at 20** (`MAX_REGIONS`) and
  enforces a ~100 m radius floor. A new place pins to your CURRENT location (no
  map-drag picker yet). Push copy is English-only.
  - **Geofence registration is PER-DEVICE, but places are household-shared — so
    `syncGeofences()` must run globally, not on a screen.** It's mounted via
    `useGeofenceSync()` in `_layout.tsx` (login + every foreground), mirroring
    `useSyncNudgeWidget`. It used to be called ONLY from the Whereabouts screen,
    which meant a place one member added was never monitored on anyone else's
    phone until they personally opened that screen; since the crossing is
    recorded by the MOVER's device, their arrivals were never recorded and
    nobody was alerted. (Real report: "Home" fired for both members while two
    later-added places had literally zero `place_events`, ever.) If you add
    another sync trigger, keep the auth guard — signed out, `syncGeofences`
    reads a null `member_locations` row, treats it as "not sharing", and TEARS
    DOWN the regions.
  - **A crossing counts only when it CHANGES state**, and that decision lives in
    Postgres (`record_place_event`, migration 071), NOT in the client. Reason:
    **expo-location keeps each region's state in MEMORY**, re-seeds it to
    `Unknown` on every `startGeofencingAsync`, then calls `requestStateForRegion`
    — so every restart re-announces `Enter` for each place you're standing in
    (and `Exit` for the rest). The client cannot tell those from a real arrival.
    The old client-side "same event within 5 minutes" guard let one through
    every few minutes forever: production had **13 consecutive arrives at Home
    and no leave**, plus pairs 77 ms apart where the guard lost the check-then-
    insert race. The RPC compares against the last event for that person+place,
    takes an advisory lock, and returns null when nothing changed — no row, so
    `recordPlaceEvent` sends no push. It also drops a `leave` with no prior
    `arrive`, or a fresh registration would announce "left School" for a school
    they were never in. Never insert into `place_events` directly.
  - `syncGeofences` skips `startGeofencingAsync` when the region set is
    unchanged (fingerprint in AsyncStorage) so those phantom events aren't
    generated in the first place. That's the optimisation; migration 071 is the
    guarantee — expo re-registers the task on its own after a cold launch, which
    no client-side check can intercept.
- **Safety Radius / event mode (Phase 3, One Roof PLUS)** — migration 068
  (`safety_watches`, one row per owner), `src/lib/safetyRadius.ts` (CRUD +
  `isOutside` + `circlePolygon` + `alertBreach`) and `SafetyRadiusSheet`.
  Drop a circle centred on yourself, pick who to watch, get alerted when one
  crosses it — **in BOTH directions**: being told someone left and never told
  they're back is the worse half of the story. **Breach detection runs on the
  WATCHER's device** in `Whereabouts` against the live `member_locations` feed —
  no server job — and alerts via a LOCAL notification (the watcher detects it,
  so no push needed) AND a banner pinned above the roster that stays until the
  watcher dismisses it — this was a Toast, but a 3-second fade is wrong for the
  one alert in this app you can't afford to miss. The banner carries a `kind`
  (`left` / `entered`) so an all-clear doesn't wear the alarm's red.
  - One alert per CROSSING, driven by `breachedRef` (who is currently outside):
    a crossing only counts when `isOutside` differs from the remembered state.
    That's what keeps a stationary member quiet, and it's also why starting a
    watch on people already inside announces nothing — their state matches from
    the first evaluation.
  - **The first look at a member is NOT a crossing** (`seenRef`, per member —
    fixes arrive one at a time, so "first" is per person, not per watch). The
    remembered state starts empty on mount, so without this every visit to
    Whereabouts re-fired the notification for anyone standing outside the
    radius. Someone already outside still gets a BANNER, which is the honest
    way to state a situation: it's on screen and it doesn't buzz the phone. A
    notification is reserved for something that just happened. `seenRef` clears
    with the watch (keyed on `created_at`, so an edit to a running watch keeps
    its state and a genuinely new watch starts over).
  - One row per member, replaced on each crossing rather than stacked: "left" is
    stale the moment they're back, and showing both would say two contradictory
    things at once. It does NOT auto-clear — dismissing is the watcher's call.
  While a watch runs, watched members are kept in live mode (`requestLive`) so
  the boundary check has fresh positions. The circle is drawn as a real GeoJSON
  polygon (`circlePolygon`) because Mapbox circle radii are in PIXELS, not metres.
  Watches are household-readable on purpose (being inside someone's radius isn't
  a secret) and auto-expire after `WATCH_HOURS` (4h).
- **Free-plan limits (migration 072)** — both are BEFORE triggers on
  `household_is_plus`, the same shape as migration 047's budget limit, so a
  stale client can't bypass them and a LAPSED plan takes effect on its own.
  Existing rows are always grandfathered; a plan change never deletes anything.
  - **Places: one per free household.** `createPlace` throws
    `free_plan_place_limit` → `PlaceForm` routes to `/paywall`.
  - **Safety Radius: 30 MINUTES OF USE per rolling 24h** (migration 073) — a
    time budget, not one session. Stop after ten seconds and it costs ten
    seconds; the rest is still yours. Plus keeps 4h and no limit. Rolling 24h,
    not a calendar day, so there's no timezone question and no midnight to game.
    The trigger OVERWRITES `expires_at` for free users to exactly what's LEFT,
    which is why `startWatch` returns the server's row: both the countdown and
    the "your watch ended" notice key off the time the server actually chose.
  - `safety_watch_usage` (was `safety_watch_starts`) is the meter, and it needs
    real END times — `stopWatch` DELETES the watch row, so that table can't
    answer "how much did they use". Each row is booked optimistically as a full
    session and an **AFTER DELETE trigger corrects `ended_at` down to now()**;
    that correction IS the refund. Plus sessions write no row at all, so a lapse
    never inherits usage against the free budget.
  - `free_watch_remaining_seconds()` is the ONE source of truth: the trigger
    enforces with it and the client displays from it, so "12 min left" can never
    disagree with what you actually get.
  - An UPDATE while a watch is still running counts as an EDIT: it neither
    consumes the allowance nor extends the clock. Without that, re-saving the
    sheet would renew the time forever.
  - The header button no longer routes non-Plus users to the paywall — they
    have real time, so the sheet opens, says how much is left, and the paywall
    appears only once the budget is actually exhausted (`spent`, from
    `fetchFreeWatchRemaining`), rather than after they've configured a radius.
  - **The end of a free watch is announced.** `scheduleWatchEndedNotice` books
    an OS-level local notification for the server's expiry time — not an in-app
    timer, because the watch ends while the phone is in a pocket at the very
    event it was set up for. `stopWatch` cancels it, or it would later announce
    the end of something the user already ended.
- **UI gotchas (learned the hard way)**:
  - **Never render a second `<Modal>` as a SIBLING of an already-open one** — on
    iOS it silently fails to present and the button just looks dead. (Real bug:
    "Add a place" did nothing because `PlacesSheet` rendered `PlaceForm`'s Modal
    as a sibling.) Render the sub-panel INSIDE the open Modal — either as another
    `<Modal>` nested in its children (what `NudgeSettings` → `PresetEditor` does)
    or as an absolutely-positioned overlay (what `MemberSheet`'s nudge picker does).
  - The roster is a HORIZONTAL card scroller so the sheet's height is constant
    for any household size AND in either card state (see the expand note above);
    **your own card is the sharing-controls entry point** (hence no sharing
    button in the header).
  - Sheet/modal containers use **`c.sheet`, NEVER `c.card`** — the glass skin
    makes `card` translucent, so the map bleeds through the panel's own text.
    Same for labels drawn on top of the map (the place pills).
  - Radius pickers use `radiusPresets(min)` from `lib/location.ts`, which authors
    round labels **per unit system** (500 ft / ¼ mi vs 250 m) rather than
    converting metres — running 150 m through `formatDistance` gives a US user
    "492 ft", which reads as broken. Places passes a **100 m floor** (the iOS
    geofence minimum); Safety Radius has no floor because it's detected
    client-side. `nearestPreset()` keeps a chip highlighted when a saved value
    doesn't match the current unit system's presets.
  - Mapbox's logo AND the OSM attribution must stay visible — Mapbox ToS plus
    OpenStreetMap's **ODbL license** (removing attribution is a license breach,
    not just a ToS one). They sit **top-left**: the Live pill and recenter button
    are top-right and the roster floats along the bottom, so it's the one corner
    nothing else wants. Their SIZE can't be changed — `@rnmapbox/maps` exposes
    only `logoEnabled`/`logoPosition` and `attributionEnabled`/
    `attributionPosition`, so the (i) is already as small as it comes.
  - **Header (2026-11, Home style):** round back + big title + a "?" that
    reopens the intro, and the features as NAMED chips under it (`HeaderButton`
    = icon + label in the feature's own colour; a running Safety watch outlines
    its chip and pulses the glyph). Bare glyphs hid Places and the Safety radius
    from new users. **First visit shows `WhereaboutsIntro`** (four rows, one
    button; seen-state per device in `introSeen.ts`, bump its key to re-show) —
    never rendered alongside another sheet (sibling Modals). Member cards wash
    in the member's colour (same as their pin) over the opaque `c.sheet`.
  - **Roster cards are gradient cards in the member's colour**
    (`MemberCardShell`, white type from `onCard.ts`), collapsed and expanded;
    the expanded card's stats sit on the gradient split by thin vertical
    rules (NOT boxed — boxes read as buttons), the actions are pills. Heights
    are unchanged (CARD_H budget). Every Whereabouts sheet uses `sheetParts`
    (`SheetHead`, `FeatureButton`, `GroupLabel`) and its feature's colour
    from `FEATURE` (places orange, safety teal, sharing purple).
  - **`eas build --local` hits this too, and the on-disk fallback does NOT save
    you.** A local build copies the project to a temp dir the same way the
    uploader does, so the gitignored file is left behind — and the EAS secret is
    only materialised on EAS's own builders, so `process.env.GOOGLE_SERVICES_JSON`
    is unset. `googleServicesFile` resolves to `undefined`, the
    `com.google.gms:google-services` Gradle plugin is never applied, and the APK
    ships with NO Firebase config. It installs and runs fine; push is simply dead
    forever, because the app cannot register with FCM at all. Always pass the path
    explicitly:
    `GOOGLE_SERVICES_JSON=$PWD/google-services.json npx eas build -p android --profile preview --local`
    Verify before installing — the APK must contain the sender id:
    `unzip -p <apk> resources.arsc | strings | grep 190924216094`
    The symptom if you skip this: `adb logcat` shows "Default FirebaseApp failed
    to initialize", the server's Expo pushes all come back `DeviceNotRegistered`
    in the RECEIPT (the ticket says ok), and the app looks completely healthy
    because nudges still arrive over Realtime the moment it is opened. Diagnosed
    the hard way on 2026-08-30.
- **The leash (2026-11-13, `placesTask.ts` `LEASH_ID`).** The background
  location STREAM dies with the process (an app update, a reboot, a swipe-up)
  and iOS never restarts it — a member's pin sat 34 h old with sharing on. iOS
  DOES relaunch a terminated app on a region crossing, so `syncGeofences` adds
  one extra fence (300 m, exit-only, one of the 20 iOS slots) around my latest
  fix. Leaving it wakes the geofence task: fresh fix → upload → kick the stream
  → re-centre the leash (`recenterLeash`). Never recorded as a place event. The
  centre is rounded to ~100 m so small moves don't re-arm everything; a local
  per-place state map (`PLACE_STATE_KEY`) skips the RPC for the Enter/Exit
  every re-arm re-announces. Limits: after a REINSTALL the app must be opened
  once; a phone that doesn't move doesn't report (its pin is right anyway);
  Android doesn't relaunch on fences at all (Expo docs) — there it only helps
  while the process lives.
- **Watching a member follows them.** Opening a card arms `followRef` in
  Whereabouts and every position they report re-centres the camera (holding the
  watcher's zoom, offset by the roster height); a drag or pinch — detected via
  `onCameraChanged`'s `gestures.isGestureActive`, which programmatic setCamera
  calls do not set — releases it until a card is picked again. Both live and
  saver task options must carry an explicit `timeInterval`: without one Android's
  fused provider chooses its own cadence, so even a WATCHED member reported
  every minute or two and drove off the edge of the frame between fixes.
- **`canAskAgain` is NOT "the OS will refuse to prompt".** On Android it comes
  from `shouldShowRequestPermissionRationale()`, which is equally false for a
  permission that has never been requested — so `if (!canAskAgain) return false`
  before the request skips the dialog on a FRESH INSTALL. Verified 2026-09-04 on
  a Galaxy S9+: `dumpsys` showed all three location permissions denied with no
  USER_FIXED flag, location services on, and the logcat buffer covering the
  whole life of the install contained ZERO GrantPermissions entries — the system
  dialog was never launched while the user tapped Continue repeatedly. Just call
  request*PermissionsAsync(); when the OS genuinely will not prompt it resolves
  denied immediately. Only treat it as unaskable when status === 'denied' AND
  !canAskAgain together (that is what `canAskBackgroundPermission()` does).
- **Android's "the OS won't prompt" signals may only be trusted AFTER an
  attempt has failed — never as a pre-flight check.** Both halves of this were
  paid for with a real bug:
  - Once Android has stopped asking for background location (the user said no,
    or on 11+ where "Allow all the time" is only offered in Settings),
    `ensureBackgroundPermission()` returns false having displayed NOTHING — so
    an unconditional disclosure-then-prompt flow loops: accept, no dialog, the
    switch snaps back (2026-09-04).
  - But pre-checking `canAskBackgroundPermission()` BEFORE the first attempt
    killed sharing entirely on a fresh/revoked install (2026-09-22): Android
    reports `denied` + `!canAskAgain` for a permission a request WOULD happily
    prompt for — a Settings revoke resets to exactly that combo — so neither
    the disclosure nor the dialog ever appeared, only the Settings alert.
  `gate()` in SharingControls therefore always shows the disclosure and
  attempts the request on the FIRST try, and consults
  `canAskBackgroundPermission()` only when `permDenied` says an attempt
  already failed (the Settings hint is on screen by then, so skipping the
  disclosure can't hide the way forward). Don't "simplify" this in either
  direction.
- **A local notification's `channelId` goes on the TRIGGER, not the content.**
  `{ channelId }` on its own IS the deliver-immediately trigger
  (`ChannelAwareTriggerInput`); `trigger: null` also fires immediately but has
  nowhere to carry a channel. Omitting it sends the notification to the
  expo-notifications plugin's `defaultChannel`, and `ensureAndroidChannels()`
  DELETES retired channel ids on every launch — Android silently drops anything
  posted to a deleted channel. Every Safety Radius alert was lost this way on
  Android until 2026-09-04. Keep `defaultChannel` in app.json equal to
  `ANDROID_CHANNEL.DEFAULT`, and never let an id appear in both that field and
  `RETIRED_CHANNELS`.
- **Something must actually ASK for notification permission.** For a long time
  only the Settings "Reminders" toggle prompted, which was survivable on iOS
  hand-installs and fatal for Android 13+, where POST_NOTIFICATIONS is a runtime
  permission: a Play install that never visits Settings has no push token, and
  the server discards every nudge and place alert addressed to it while the app
  looks perfectly healthy. `ensurePushPermissionOnce()` (called from
  `useSyncPushToken`) asks once and records it, so a decline is never nagged.
- **Every push carries `data.url` and something has to read it.**
  `backgroundNotifications.ts` routes taps ('/pings', '/location') via both
  `addNotificationResponseReceivedListener` AND
  `getLastNotificationResponseAsync` — the latter is the ONLY way to see the tap
  that launched the app, since the listener is installed after that tap was
  delivered. Silent types are skipped.
- **A geofence registration does NOT survive what `hasStartedGeofencingAsync`
  claims it does.** Play Services drops every fence on reboot, on its own
  updates, and when an OEM battery manager sleeps the app — while
  expo-task-manager goes on reporting the task as started. `syncGeofences`
  therefore must NOT skip re-registering on the strength of the stored region
  signature alone: it re-arms once per cold launch (`armedThisProcess` in
  `lib/placesTask.ts`) and, **on Android, also whenever the last arm is older
  than an hour** (`ARMED_AT_KEY`/`rearmDue`) — checked on every foreground AND
  on every delivered background fix (`rearmGeofencesIfStale()`, called from
  `locationTask.ts`'s task callback). That last hook is the load-bearing one:
  cold-launch-only re-arming still left a phone that was out moving with the
  app never opened unprotected — the S9+ recorded near-zero crossings for
  three weeks (Aug 24–Sep 18, 2026) while `member_locations` kept updating, so
  the map looked healthy and only the place alerts were missing. Re-arming
  re-announces Enter for wherever you are standing; `record_place_event`
  (migration 071) drops those, which is what makes hourly re-arms safe.
- **Android geofences need a radius comfortably larger than the reported
  accuracy — and this is now ENFORCED at registration.** The battery-saver
  location profile reports ~100 m on Android, so a 100 m place is at the edge
  of what Play Services will call a crossing at all; iOS at ~10 m accuracy
  fires the same fence reliably (the household's 100 m Home was the other half
  of the S9+ three-week silence). `syncGeofences` clamps the REGISTERED radius
  to `ANDROID_MIN_FENCE_RADIUS_M` (200 m) on Android only — the stored
  `places.radius_m` is untouched (household-shared; iOS honors it precisely),
  so an Android alert can fire up to ~200 m out and the map ring still draws
  the stored radius. Don't "fix" this by editing the place's radius in data.
- **Bumping the version for a local Xcode archive: edit `app.json`, then
  PREBUILD.** `expo.version` + `expo.ios.buildNumber` are written into
  `ios/OneRoof/Info.plist` as LITERALS at prebuild time, so editing Xcode's
  General tab does nothing durable and editing `app.json` alone doesn't reach
  the archive. This already cost one confused archive that read 1.2.0 (3) while
  Xcode showed 1.2.1 (4).
  - **The incremental `expo prebuild -p ios` FAILS on this project** —
    `@bacons/apple-targets` can't update the existing `OneRoofWidgets` target
    (`Cannot read properties of undefined (reading 'removeFromProject')`). Use
    `--clean`, which regenerates `ios/` and reinstalls pods.
  - **Xcode's General tab lies about the build number.** It shows the app
    target's `CURRENT_PROJECT_VERSION`, which prebuild leaves at the template
    default of `1`; the number that actually ships is the literal in
    `Info.plist`. The WIDGET target is the opposite — it has
    `GENERATE_INFOPLIST_FILE = YES`, so ITS version really does come from
    `CURRENT_PROJECT_VERSION`/`MARKETING_VERSION` (prebuild sets both correctly).
    Patch the app target's two `CURRENT_PROJECT_VERSION` lines to match after a
    prebuild if you want the UI to agree; nothing ships differently either way.
  - `eas.json` sets `appVersionSource: "remote"`, so an EAS build takes its
    numbers from EAS, NOT from `app.json`. `app.json` governs local archives only.
- **`mobile/ios/` and `mobile/android/` get archived by EAS even though they are
  gitignored**, which is why a cloud build uploads ~1.5 GB and spends ~7 min doing
  it. They are generated (CNG) — deleting them locally costs only a `prebuild` to
  regenerate. A `.easignore` in `mobile/` did NOT change the archive size; don't
  reach for that without measuring.

## Android push (channels + FCM) — read before touching notifications
Android delivery differs from iOS in three ways that are easy to break silently.
Full Play-release context in `PLAY-STORE-RELEASE.md`.
- **Importance lives on the CHANNEL, not the message.** `ensureAndroidChannels()`
  in `lib/notifications.ts` creates `default` (DEFAULT importance) and `urgent`
  (MAX + vibration). A high-priority nudge sent into `default` arrives with no
  heads-up and no sound — the `high_priority` flag becomes cosmetic.
- **Channel ids are a CROSS-REPO CONTRACT.** `ANDROID_CHANNEL` here, the
  `channelId` unions in `api/send-ping.ts` + `api/send-digest.ts`, and
  `defaultChannel` in `app.json` must all agree. Renaming one silently dumps
  pushes into an OS-named channel the user can't find in Settings.
- **`ensureAndroidChannels()` must run BEFORE `requestPermissionsAsync` AND before
  every `getExpoPushTokenAsync`.** On Android 13+ the OS permission prompt does not
  appear until a channel exists, so the wrong order means the user is never asked.
  All three token call sites already do this — keep it that way if you add a fourth.
- **The notification icon must be a 96×96 all-white PNG with transparency**
  (`assets/images/notification-icon.png`, shared shape with the PWA's
  `public/roof-badge-96.png`). Android draws small icons as a silhouette from the
  alpha channel, so pointing the plugin at the full-colour `icon.png` renders a
  solid white square. This was a real shipped-config bug; don't reintroduce it.
- **FCM is conditional.** `app.config.js` sets `android.googleServicesFile` only if
  `mobile/google-services.json` exists (gitignored). Setting it unconditionally
  breaks `prebuild`/EAS for everyone without the file. Without FCM credentials
  uploaded to EAS, Android push is dead — every push feature, not just nudges.

## i18n Rule
All user-facing strings (labels, titles, placeholders, button text, alerts, error messages) **must** be
translated via `t()` keys. **Exception:** the app name "One Roof" only. No hardcoded English.
When adding new UI, add the keys to all 3 language files (en/es/pt) in `@/lib/i18n` first,
then import `useI18n` in the component and wrap strings: `{t('namespace.key')}` or 
`title={t('namespace.key', {param})}`.
**Copy that names an iOS-only thing (Face ID, Apple ID, Apple Calendar, the App
Store) needs an Android wording**: add `<key>Android` to all 3 dicts and render
`t(platformKey('<key>'))` (`@/lib/i18n`), which picks the variant on Android only.
The paywall, Settings' Plus list and restore alerts, and the vault lock use it.

## Coding standards

**Match the established pattern — don't invent a new one.** Before writing a new
`lib/` file or a data-fetching/auth flow, grep for how the existing files in the
same area already do it (`lib/auth.tsx`, `lib/googleCalendar.ts` are the
reference implementations for anything session/auth-related) and follow that,
even if a different approach would also technically work. Divergent one-off
patterns are exactly what caused the two bugs below — both were an agent
solving an already-solved problem a new way instead of matching what was
already there.

- **Reading the current user/session: always `supabase.auth.getSession()`,
  never `supabase.auth.getUser()`.** `getSession()` reads the cached local
  session (instant, no network). `getUser()` round-trips to the Auth server to
  revalidate the JWT — on any network hiccup it resolves with `user: null`
  instead of throwing, which silently masquerades as "not signed in" deep
  inside unrelated flows. (Real bug: `lib/appleCalendar.ts`'s `currentUser()`
  used `getUser()`, so a flaky connection made Apple Calendar connect fail
  with a generic "Couldn't connect" error — fixed by switching to
  `getSession()`, matching `auth.tsx` and `googleCalendar.ts`.) If a screen
  already has `useAuth()` in scope, prefer its `profile`/`session` over a
  fresh lookup at all.
- **Never define a component inside another component's render body.**
  `function Inner() {...}` (or a `const Inner = () =>`) written inside
  `function Outer() { ... return <Inner/> }` gets a *new function identity on
  every render of `Outer`* — React then unmounts + remounts `Inner` on every
  state change, which drops focus from any `TextInput` inside it and resets
  any local state. Hoist sub-components to module scope (outside and above the
  parent), passing data in as props. (Real bug: `BetterDeal.tsx`'s
  `OptionCard` was defined inside `BetterDeal`, so every keystroke into either
  price/amount field remounted both cards' inputs, dropping keyboard focus
  mid-type the moment the "better deal" winner calculation changed. Fixed by
  hoisting `OptionCard` above `BetterDeal`.) A plain function that *returns*
  JSX and is called directly (`{card('A', ...)}`, not `<Card/>`) is fine — it
  doesn't create a new component type, just inlines the tree.
- **Before shipping a fix for a reported bug, verify the actual root cause**
  against the DB (migrations, RLS, constraints via the Supabase MCP tools) and
  the client code path, not just the symptom. A generic error message (e.g.
  "Couldn't connect") can come from several unrelated causes — confirm which
  one before touching code.

## Don't
- Don't add ad/tracking SDKs (keeps ATT off + COPPA exposure low).
- Don't break the RLS tenancy model. Don't hardcode secrets (use EXPO_PUBLIC_* /
  EAS env). Don't claim device verification you didn't do.
- Don't hardcode user-facing strings — add them to i18n files and use `t()` in the component.
- Don't use `supabase.auth.getUser()` for session/current-user checks — use
  `supabase.auth.getSession()` (see Coding standards above).
- Don't define a component function inside another component's render body —
  hoist it to module scope (see Coding standards above).
- **Don't statically `import` a native module that might not be in the running
  binary.** Expo modules call `requireNativeModule(...)` at module scope, which
  THROWS on an older build — and the throw propagates up the whole import chain,
  so it doesn't merely disable that feature, it can take down the entire app.
  Use a guarded `require` inside try/catch that resolves to `null` when absent,
  and degrade gracefully. Two files already do this for exactly this reason:
  `lib/secureSessionStore.ts` (expo-secure-store → falls back to AsyncStorage)
  and `DocumentVault`'s `loadScanner()` (document scanner → falls back to the
  plain camera). This has bitten twice; adding a native dep needs a rebuild
  (`npx expo prebuild -p ios --clean`) and every already-installed build keeps
  running the old binary until then.

## Invite funnel (2026-11-15)

A household of one is how this app dies, so the invite is a first-class step:

- `lib/invite.ts` is the ONE place that builds the invite link, opens the share
  sheet and tracks it. Every surface goes through `shareInvite(t, code, source)`:
  the onboarding invite step, the Home banner, the family strip's "+" seat
  (owner only) and Settings' Family card.
- The link is `https://one-roof-app.vercel.app/join#CODE` → `public/join.html`
  (web project; code in the FRAGMENT so it never hits a server log) → store
  buttons + "I already have the app" → `oneroof://join?code=…` → `app/join.tsx`
  → the join step with the code filled in (`takePendingJoinCode`). Binaries
  older than this have no `/join` route; the page still shows the code to type.
- Onboarding has a third step after "Create household": the invite, before the
  Hub. It only appears when `get_join_code` answers.
- The Home banner SNOOZES on dismiss (3 days, up to 3 times) instead of hiding
  for good.
- Events: `household.created`, `household.joined` (`via: link|typed`),
  `invite.shown`, `invite.shared`, `invite.skipped` (`source`:
  onboarding|banner|strip|settings).

## Notes wall (migration 113, 2026-11-15)

Drawn notes no longer vanish after 24 h (they still leave the HOME then):
- `/notes` → `apps/pings/NotesWall`. The Nudges screen's big kraft "Recado à
  mão" card opens THIS page (owner, 2026-11-15), not the drawing sheet; it
  passes the picked recipients in `to`. First on the page: "Novo recado"
  (→ `/draw-note`), then the wall: sheets taped to a wall, filters all / received / sent / kept, tap →
  `NoteViewer`. Data in `lib/notes.ts` (`fetchWall`, `isFavorite`,
  `setFavorite`, `onNotesChange`). RLS (pings_select) decides what a member sees.
- A heart in `NoteViewer` (needs `pingId`) writes `note_favorites` — personal,
  one row per (note, member). Hidden against a server without 113.
- Housekeeping: `purgeOldNotes` in `api/send-digest.ts` (daily cron) deletes a
  note nobody hearted 30 days after it was sent, row + PNG, ONLY in households
  without Plus. Any failed lookup keeps the note.
- Modo Casa has a "Recados" widget page (`src/casa/NotesWall.tsx`, data in
  `src/casa/notes.ts`): only notes sent to the WHOLE household — enforced by the
  restrictive policy `pings_casa_notes`, not just the client filter.
- Not built yet: the Home-Screen widget showing the latest note.

## Android release builds are minified (R8) since 2026-11-15

Play flagged release 22 (1.6.0): "DEX code optimization is below our threshold —
Obfuscation (2%)", fix by Feb 2027. `withAndroidMinify` in `app.config.js` sets
`android.enableMinifyInReleaseBuilds=true` and appends keep rules to
`android/app/proguard-rules.pro` (`ANDROID_KEEP_RULES`). Resource shrinking is
OFF on purpose. A class Android loads BY NAME (manifest `<meta-data>`,
reflection) is invisible to R8: the first minified build ran fine in the
foreground while logging `ClassNotFoundException: …RNHeadlessAppLoader`, which
breaks background tasks. After adding a native library, install a RELEASE build
on a phone and scan the log before uploading:
`adb logcat -d | grep -E "FATAL EXCEPTION|ClassNotFoundException|NoSuchMethodError|NoSuchFieldError|UnsatisfiedLinkError"`
and add a keep rule for anything it names.

## Android widgets (react-native-android-widget, `src/widgets/android/`)

- Every `.tsx` there starts with `'use no memo'`. The app has the React
  Compiler on (`app.json` `experiments.reactCompiler`), and the library walks
  raw function components: a compiled one throws "Invalid Hook Call detected
  in Shell", and the widget lands on the Home screen INVISIBLE (still tappable,
  opens the app). Shipped that way in Play 1.6.0 (23); fixed in 24. A new
  widget file needs the directive too. Debug with `adb logcat | grep -i widget`.
