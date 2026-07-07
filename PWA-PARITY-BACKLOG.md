# PWA parity backlog

Things the **web PWA** (`src/`) is behind the **iOS app** (`mobile/`) on. iOS is
the priority, so features land there first; this list tracks what still needs to
be ported back to the web app "some other time."

The iOS implementation is the source of truth for each item — port its behavior,
adapting RN patterns to the web (Tailwind + the PWA's existing components).

**Status: caught up as of 2026-07-07.** Items 1–8 below (budget card v2, Today
section + weather, free-plan limits, Nudges sent-banner CTAs, Family accordion,
Pet Care per-pet redesign, Nudges editable presets + high-priority flag, Discount
calculator redesign) have all been ported. Nothing outstanding right now — add
new entries here as the iOS app pulls ahead again.

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

## 9. Document Vault: Face ID lock is now the Plus gate (2026-07-07)

Product change (both apps): the Document Vault is FREE to use; only the opt-in
**Face ID lock** is One Roof Plus. iOS `mobile/src/apps/docs/DocumentVault.tsx`
now: uploads are ungated, and `toggleLock` routes to the paywall when a non-Plus
user tries to enable the lock. The PWA vault is already free to use, but its
Face ID lock (`src/components/VaultGate.tsx` / `lib/biometric.ts` opt-in) is NOT
Plus-gated yet — gate enabling the lock on `current_household_is_plus`. Also
reword any "Document Vault" Plus copy to "Face ID lock for the Document Vault".
