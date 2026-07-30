# PWA parity backlog

Things the **web PWA** (`src/`) is behind the **iOS app** (`mobile/`) on. iOS is
the priority, so features land there first; this list tracks what still needs to
be ported back to the web app "some other time."

The iOS implementation is the source of truth for each item — port its behavior,
adapting RN patterns to the web (Tailwind + the PWA's existing components).

**Status (2026-07-29, second pass).** Items 1–8 landed 2026-07-07. Items 10 and
11 (self-serve onboarding + owner invite code; Manage categories) landed
2026-07-29, along with **Pet Care routines** and a **web Whereabouts** — see
"Landed on the web" below. Item 9 is deliberately ON HOLD; read its note.

**How this list is now organised.** The previous "caught up" framing was wrong
and cost a re-derivation, so the remaining gap is written down explicitly, split
by whether the web *can* do it:

| Tier | Meaning |
|---|---|
| **A — portable** | Plain DB + UI. Should be ported; nothing blocks it. |
| **B — degraded** | Possible, but weaker on the web. Port with the limit stated IN THE UI. |
| **C — impossible** | Needs an OS capability or a purchase path the web lacks. Not a gap; don't file it as one. |

A quick way to re-measure the gap at any time (i18n keys are a good proxy for
feature surface, since both apps must translate every string):

```
python3 - <<'EOF'
import re
kv=lambda p: set(re.findall(r"^\s*'([\w.]+)':", open(p).read(), re.M))
m,w = kv('mobile/src/lib/i18n/en.ts'), kv('src/lib/i18n/en.ts')
from collections import Counter
print(len(m-w), 'iOS keys missing from the PWA')
for n,c in Counter(k.split('.')[0] for k in m-w).most_common(): print(f'{n:14} {c}')
EOF
```
At the time of writing that reports **372 missing keys**, of which ~235 are
tier C (`location.*` extras, `settings.*` native, `paywall.*`, `admin.*`).

---

# Landed on the web (2026-07-29)

- **Self-serve onboarding + owner invite code** — item 10 below.
- **Manage categories** (custom + built-in overrides) — item 11 below.
- **Pet Care routines** (migration 069): daily checklist with day-browsing and
  who-ticked-it, interval routines with due state, weight log, per-group routine
  editor with species-template seeding. `src/lib/petCare.ts` now carries the same
  routine math as `mobile/src/lib/petCare.ts` — **keep the two in sync**, they
  decide due dates and must not disagree.
  - These sit ABOVE the existing calendar + reminders instead of replacing them.
    iOS dropped its calendar in the redesign; the web kept it deliberately.
- **Whereabouts** (`/location`, `src/apps/location/`) — tier B, see below.
- **Weather advisory** on the Hub's Today card (`fetchDayAlert`, thresholds
  copied verbatim from iOS).
- **Family → "Your name"** via the `set_display_name` RPC (057).

# Tier A — portable, still outstanding

Ordered by how much a household would notice.

1. **Nudges history** (`pings.tabPast`, `filterAll/Received/Sent`, `today`,
   `yesterday`, `empty`): iOS has a Past-nudges tab with All/Received/Sent
   filters. The web only has the composer + live banner, so a nudge you missed is
   simply gone. Pure query over `pings` + `ping_acks`.
2. **Period options in Months** (`months.periodOptions`, `prevPeriod`,
   `nextPeriod`, `deletePeriod`, `renameFailed`): rename a budget, delete a
   period, and step between periods. The web can only create.
3. **Shopping store management** (`shopping.editStore`, `deleteStore`, `color`)
   and **suggested stores** (`shopping.suggested`, served by the existing
   `api/suggest-stores` — metered by `ai_light_allowed`, no new endpoint needed).
4. **Documents: owner + type fields** (`docs.owner`, `docs.type`) — iOS shows and
   filters on both.
5. **Family extras** (9 keys): blood donor/recipient matrix (`donateTo`,
   `receiveFrom`, `universalDonor`, `universalRecipient`) and men's/women's shoe
   conversion (`shoeMen`, `shoeWomen`, `convertApprox`).
6. **Calculator** (`calc.perUnit`, `calc.unitNote`): the Better-deal unit label.
7. **Small copy alignment**: `pets.savedToast`, `pets.speciesPlaceholder`,
   `manageCats.deleteTitle`/`deleteBody` (iOS splits the confirm into title+body;
   the web uses one `confirm()` string), `common.done`/`notNow`/`openName`.

# Tier B — degraded on the web (state the limit in the UI)

- **Whereabouts** — SHIPPED at this tier. What the browser gives us and what it
  can't is documented at the top of `src/lib/location.ts`; the short version:
  - Reading positions / places / activity feed: full parity.
  - Sharing MY position: **foreground only.** `navigator.geolocation` stops when
    the tab is backgrounded and no PWA has a background-location API.
  - **Geofence crossings and Safety-Radius alerts are impossible** (tier C
    within a tier-B feature): both need the OS to wake the app at a boundary.
    `place_events` are therefore READ-ONLY on the web — never insert them here;
    migration 071 routes every insert through `record_place_event()` for
    state-transition dedupe, and a browser can't observe the crossing anyway.
    Place pins get no radius ring for the same reason: on iOS a ring means "armed
    for me", so drawing one would promise alerts that never fire.
  - The map needs **`VITE_MAPBOX_TOKEN`** in Vercel (not set as of this writing,
    so production shows the map-less roster — which is the useful half). Reusing
    the iOS `pk.` token works technically but moves web tile loads onto the same
    Mapbox bill; that's Arthur's call.
  - Map tiles are **unverified by any agent run**: `api.mapbox.com` is
    unreachable from the preview sandbox (open-meteo answers 200 there, so it
    isn't a blanket egress block). Needs one real-browser check.
- **Document scanning**: iOS uses VisionKit (edge detection, auto-crop,
  multi-page → one PDF). The web can get *part* of the way with
  `<input type="file" accept="image/*" capture="environment">` plus `pdf-lib`
  (pure JS, already a dependency on the iOS side) for the multi-page PDF. No edge
  detection or perspective correction — don't call it "scanning" in the UI.

# Tier C — not gaps; do NOT file these as parity work

- **Whereabouts internals** (~139 `location.*` keys): background location, live
  mode + silent-push wake, geofencing, Safety Radius, Mapbox Search Box place
  picker, map-style picker. All need native capabilities.
- **Home-Screen widgets** (Nudges / Today / Budget / PetCare) and everything in
  `mobile/targets/widgets/`.
- **Paywall + subscriptions** (`paywall.*`, `settings.manageSubscription`, ~30+
  keys): Plus is sold through Apple IAP; **there is no web checkout.** This is
  also why item 9 is on hold and why **`budget.*` private-budget management
  (22 keys) is only half-portable** — the DB trigger blocks a free household from
  making a budget private, so porting the management UI would ship an unusable
  screen. Viewing is already correct: RLS hides other people's private budgets,
  so the web simply doesn't show them (no crash, no leak).
- **Apple Calendar sync** (`calendar.apple*`): EventKit, on-device.
- **Face ID** via `expo-local-authentication` — the web has WebAuthn instead,
  which is what `lib/biometric.ts` already uses.
- **`settings.*` natives**: colour schemes / glass skin, "Manage in iOS
  Settings", widget instructions, native push registration.
- **`admin.*` (34 keys)**: the iOS admin panel is ahead, but only Arthur uses it
  and the web admin screens work. Low value.

---

## Gotcha: don't inline a sub-component in Better Deal (or similar forms)

Not a parity gap — a bug fixed on iOS that's worth guarding against here too.
`mobile/src/apps/calc/BetterDeal.tsx` defined its `OptionCard` (the per-option
price/amount card) as a function *inside* `BetterDeal`'s render body. Every
keystroke changed state → re-rendered `BetterDeal` → gave React a brand-new
`OptionCard` component type → remounted the `TextInput`s → dropped keyboard
focus mid-type (most noticeable right as the "Better deal" winner badge first
appeared, since that's when both `TextInput`s' surrounding JSX changed). Fixed
by hoisting `OptionCard` to a stable top-level component.

The PWA's `BetterDeal` (`src/apps/calc/Calculator.tsx`) does **not** have this
bug — its `card(...)` is a plain function returning JSX inline (called
directly, not rendered as `<Card/>`), so React never sees a new component
type. No fix needed here, but if `Calculator.tsx` is ever refactored to
extract `card` into a real `function OptionCard(...)` / `<OptionCard/>`
component, hoist it to module scope (outside `BetterDeal`) rather than
defining it inside — same trap.

## 9. Document Vault: Face ID lock is now the Plus gate (2026-07-07) — ON HOLD

**Deliberately not ported (2026-07-29). Don't "fix" this without asking Arthur.**
The PWA has no purchase path: One Roof Plus is sold through Apple IAP in the iOS
app, and there is no web checkout. Adding this gate would take a feature that
currently WORKS for web users and put it behind something they cannot buy —
worst of all for the Android users who only have the PWA. It's a product
decision (add web billing? leave the web lock free? something else?), not a
mechanical port. The description below is still accurate for iOS.



Product change (both apps): the Document Vault is FREE to use; only the opt-in
**Face ID lock** is One Roof Plus. iOS `mobile/src/apps/docs/DocumentVault.tsx`
now: uploads are ungated, and `toggleLock` routes to the paywall when a non-Plus
user tries to enable the lock. The PWA vault is already free to use, but its
Face ID lock (`src/components/VaultGate.tsx` / `lib/biometric.ts` opt-in) is NOT
Plus-gated yet — gate enabling the lock on `current_household_is_plus`. Also
reword any "Document Vault" Plus copy to "Face ID lock for the Document Vault".

## 10. Self-serve household onboarding (create / join by code) — DONE 2026-07-29

New feature, iOS-first. The DB layer is already live & shared by both apps
(`supabase/migration-051-self-serve-onboarding.sql`): `allowed_users.role`
(`owner`/`member`, **distinct from the global `is_admin`** — never conflate),
`household_join_codes` (RLS-locked, definer-only), and SECURITY DEFINER RPCs
`create_household(name)`, `join_household(code)`, `get_join_code()`,
`rotate_join_code()`, `remove_member(email)`. Open signup: a first-login user
with no `allowed_users` row lands on onboarding (create → becomes owner, or join
by an 8-char code). Owner-only surfaces show/rotate the code and remove members.

The PWA needs the CLIENT work once the iOS version exists (source of truth):
`useAuth` must expose a "signed in but no household" state (currently a session
with `profile === null` just falls into a broken Hub) + a `refreshProfile()`;
an Onboarding gate/screen (create or join); and an owner-only Invite/manage
section (share code, rotate, remove member). Reuse the RPCs above — no new DB
work. See the iOS onboarding screen + gate for exact behavior.

**Shipped on the web as:** `src/pages/Onboarding.tsx` (name step → create/join,
gated in `App.tsx` where the old "Not authorized" dead end used to be) and
`src/components/HouseholdSection.tsx` in the settings Drawer (members + OWNER
badge + remove, and for the owner the invite code with copy / Web-Share /
rotate). `useAuth` gained `profile.role`, a derived `profileLoaded`, and
`refreshProfile()`. Web-only difference: the share message includes the app URL,
since a web invitee has no App Store link to follow.

## 11. Manage categories — edit/delete custom budget categories — DONE 2026-07-29

New feature, iOS-first. DB is live & shared: `delete_custom_category(p_id)`
(migration 054) removes a household custom category and reassigns its entries +
keyword rules to the built-in `other` (atomic, household-guarded). iOS added a
`ManageCategoriesSheet` (`mobile/src/apps/budget/`) — a scrollable list of the
household's custom categories, tap-to-edit emoji+name inline (plain
`custom_categories` UPDATE), 🗑 delete (the RPC), and an "Add category" row —
opened from a "Manage categories" button under the entry form's "All" category
grid. The PWA needs the CLIENT equivalent (its budget entry form / category
picker); reuse the RPCs/tables, no new DB work.

Built-ins are ALSO editable now (migration 056 `category_overrides`): a
per-household override of a preset's name and/or icon (both nullable — override
just the icon and keep the localized name). `categoryById(id, custom, overrides)`
gained an optional 3rd arg (backward-compatible; old app builds pass nothing and
see the defaults). The Manage sheet shows a "Defaults" section (edit → upsert
override, ↺ reset → delete override) + a "Yours" section (custom). On the PWA,
thread `overrides` through its `categoryById` call sites + load
`category_overrides` alongside `custom_categories`.

**Shipped on the web as:** `src/apps/budget/ManageCategoriesSheet.tsx`, opened
from a "Manage categories" link under the entry form's "All" grid.
`src/lib/categories.ts` gained `withOverride`, `builtinCategories(overrides)` and
`overriddenName(id, overrides)`, plus the optional 3rd `overrides` arg on
`categoryById`. `MonthDetail` loads `category_overrides` into its cached query as
`catOverrides` and threads it to `SummaryChart`, `EntryColumn`/`EntryRow`, and
`EntryForm`. Two gotchas worth keeping:
- **`overriddenName()` exists because built-in names are LOCALIZED.** Rendering a
  built-in's label is `overriddenName(id, overrides) ?? t('cat.<id>')` — reading
  `category.name` would print the untranslated English default. Same reason
  `saveBuiltin` stores `name: null` when the typed name equals the current
  translation: that's "no override", not "override to the English word".
- **EntryForm's `localCats` is DERIVED** (`customCategories` + any
  just-created category, deduped by id), not a `useState` copy of the prop. The
  Manage sheet edits and deletes categories while the form is open, so a snapshot
  taken at mount would keep showing stale names — an earlier version of this port
  had to sync it back with an effect, which is worse.

---

# Android/PWA platform work

Not parity gaps — the PWA is the ONLY build Android users have until there's a
Play Store listing, so its install/OS integration is its own concern.

**Done 2026-07-29:**
- **Maskable icons.** `roof-icon-maskable-{192,512}.png` + `purpose` on every
  manifest icon. Android crops icons to the launcher's shape (circle, squircle,
  teardrop); the original full-bleed glyph lost its corners. The generator that
  made them (lifts the glyph's alpha out of `roof-icon-512.png`, re-composites it
  inside the 80% safe circle over the same clay gradient, pure-Node PNG via zlib)
  is NOT in the repo — it was a one-off; regenerate by hand if the brand icon
  changes, keeping the glyph inside the safe circle.
- **192px icon** (`roof-icon-192.png`) — the size Android actually asks for.
- **Monochrome notification badge** (`roof-badge-96.png`, white glyph on
  transparent). Android renders `badge` as a silhouette from the ALPHA channel,
  so the full-colour icon `sw.js` used showed up as a blob in the status bar.
- **Manifest**: `id`, `scope`, `orientation`, `lang`, `dir`, `categories`, and
  four `shortcuts` (Money / Shopping / Nudges / Calendar) for the launcher's
  long-press menu.
- **`theme-color` fix** — `useTheme` was writing `#0c0a09`/`#f5f5f4`, cold greys
  left over from before "Warm Hearth". Android paints the standalone status bar
  with it, so it read as a seam. Now tracks `--bg`; **keep `BG` in `useTheme.tsx`
  in sync with `index.css`.**
- **`CACHE` bumped to `one-roof-shell-v4`** — `sw.js` serves the manifest and
  icons cache-first, so icon/manifest work does NOT reach installed users without
  a bump. Remember this for any future manifest change.
- **Install prompt** (`src/lib/install.ts` + `src/components/InstallPrompt.tsx`,
  on the Hub). Chrome fires `beforeinstallprompt` ONCE, before React mounts —
  hence `watchInstallPrompt()` at module scope in `main.tsx`, stashing the event
  so our own card can call `.prompt()` from a real user gesture. iOS Safari never
  fires it, so that branch shows the Share → "Add to Home Screen" wording
  instead; browsers with neither path render nothing.

**Not done / worth considering:** `screenshots` in the manifest (richer Android
install dialog); Play Store listing via a Trusted Web Activity / Bubblewrap;
localized manifest name; a monochrome `maskable` Android adaptive-icon layer.
