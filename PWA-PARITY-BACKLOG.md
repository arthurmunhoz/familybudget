# PWA parity backlog

Things the **web PWA** (`src/`) is behind the **iOS app** (`mobile/`) on. iOS is
the priority, so features land there first; this list tracks what still needs to
be ported back to the web app "some other time."

The iOS implementation is the source of truth for each item — port its behavior,
adapting RN patterns to the web (Tailwind + the PWA's existing components).

**Status (2026-07-29):** items 1–8 (budget card v2, Today section + weather,
free-plan limits, Nudges sent-banner CTAs, Family accordion, Pet Care per-pet
redesign, Nudges editable presets + high-priority flag, Discount calculator
redesign) were ported 2026-07-07. **Items 10 and 11 are now DONE too** (self-serve
onboarding + owner invite code; Manage categories incl. built-in overrides) — see
each section below for what shipped. **Item 9 is deliberately NOT done** — read
its note before "finishing" it.

Android is now the PWA's main audience (no Play Store listing yet), so
Android-specific PWA quality is tracked in "Android/PWA platform work" at the
bottom rather than as a parity gap.

The iOS app is still far ahead on things that are **native-only by nature** and
are NOT parity gaps: Whereabouts (Mapbox + background location), Home-Screen
widgets, Apple/Google IAP + the paywall, Face ID via `expo-local-authentication`,
the VisionKit document scanner, and Apple Calendar sync. Don't add these here.

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
