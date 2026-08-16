# One Roof — marketing fact sheet

Every public claim (Reddit reply, landing copy, App Store text) must trace to
this sheet. If a draft needs something not listed here, ASK ARTHUR — never
invent features, stats, or anecdotes.

## The true story (from Arthur, 2026-08-16)

- Household: Arthur + wife + two dogs, one with allergies (constant care, vet
  visits). NO kids — never use dad/parent framing.
- Arthur: software developer for a decade, loves mobile; past work includes
  digital wallets and real-estate virtual touring.
- Origin pains (each maps to a feature):
  - Groceries: a shared paper notebook + pen on the kitchen counter.
  - Pets: exam/vaccine history lived in bank receipts and vet emails; daily
    "did you feed the dogs?" problem.
  - Nudges: wife out alone can ask for help with one tap (widget).
  - Whereabouts: Arthur sees when she leaves work/classes → knows when to
    expect her home.
  - Calendar: no single shared place for work events / class schedules.
  - Money: "save X per month" goal was unverifiable; other apps didn't fit;
    real spend/savings vs income was lost.
  - Documents: trips needed doc numbers/due dates buried in screenshots/emails.
  - Calculator: dinner splits, outlet discounts, grocery price math.

## Interview answers (Arthur, 2026-08-16) — the ONLY source for narrative

- **Trigger for building the app:** no single last-straw — everything
  together: checking whether they'd ripped out the notebook page and brought
  it to the store; asking the other to dig through email for a vet visit date
  or a vaccine about to be due.
- **How the notebook failed:** they'd have to ask each other "did you take
  the note, or is it at home?"; items scratched down manually; sometimes the
  page was just empty.
- **The dogs:** nothing ever actually went wrong (no missed vaccine) — the
  pain was the BURDEN: checking emails and old messages to know what medicine
  was given, when, and when the next dose/vaccine was due. Don't dramatize
  it into a near-miss.
- **Money, before:** they used third-party apps to track expenses
  INDIVIDUALLY — they knew what was spent, but couldn't add incomes, edit
  categories, or keep multiple months; when a month ended, it was settled
  and gone. Now: a running record across months, savings per month, and they
  can look back. Currently in their THIRD month of tracking everything, with
  AI receipt scanning making it "so much easier."
- **Nudges/Whereabouts:** no dramatic story — it's everyday life. Wife
  leaves for classes/work/work events; Arthur knows when she leaves work and
  when to expect her home. Nudges = one tap on the iPhone home-screen widget
  to say she's coming home or ask for help.
- **Daily use today:** yes, daily. Shopping list is the most used (checking
  off and adding every day); Money is next (third month of full tracking);
  plus shared calendars, nudges, pet routines, and documents kept current
  (car registration, driver's license renewals).

## Verified claims — safe to say

- Shared shopping list: live sync between phones, per-store sections, WORKS
  OFFLINE on iOS (verified in code 2026-08-16).
- Money: shared budgets, categories, monthly/weekly periods, AI receipt scan
  (photo → entry), tracks spend and savings.
- Pet care: shared daily routine checklist (feeding marked once for everyone),
  interval routines (meds), weight log, event history + next-due reminders
  (e.g. vaccines).
- Calendar: shared family calendar; TWO-WAY sync with Google Calendar and
  (on-device) Apple Calendar (both verified in code).
- Nudges: one-tap pings, editable presets, recipients see them instantly,
  sender sees "seen by" acks (read receipts); iOS home-screen widget can send
  without opening the app.
- Whereabouts: private family map, live locations (opt-in, off by default),
  arrive/leave alerts for chosen places (per-user opt-in), safety radius.
- Documents: scan (VisionKit) or upload, organized, signed access, Face ID lock.
- Calculator: split a bill evenly or by item from a photo, unit-price
  comparison, discount math.
- Privacy: no ads, no tracking SDKs, no selling data. Per-household isolation
  enforced at the database level (RLS).
- Platform: iOS App Store. Languages: English, Spanish, Portuguese.

## Do NOT claim (real gaps / rules)

- NO general task manager: no assignable to-dos, no chore charts, no notes.
- NO price-history tracking on groceries (unit-price compare ≠ price tracker).
- NO meal planning.
- NO location history / breadcrumb trails (live + last position only).
- NO Android app yet — say "Android coming soon"; NEVER mention or link the
  PWA in public.
- Don't quote free-vs-Plus limits or prices without checking with Arthur.
- Never invent usage stats ("cut our texts by 80%"), trial anecdotes ("Notion
  lasted three weeks for us"), or experiences Arthur didn't describe.
- Never ascribe a feeling, motive, or failure story to Arthur/his household
  ("that person burned out") that he hasn't stated. The facts above say WHAT
  their old systems were, not WHY they failed or HOW it felt — for anything
  narrative, interview Arthur first and quote his answers.
