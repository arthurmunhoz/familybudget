# Comparison pages (EN): getoneroof.app/vs/<slug>/ — owner asked for them
# 2026-11-18 to rank for "family app" / "<competitor> alternative".
# Rules: One Roof claims trace to marketing/fact-sheet.md + the landing copy.
# Competitor claims come ONLY from the competitor's own site, checked on
# CHECKED; anything their site doesn't list is "Not listed on <their> site",
# never "doesn't have". Say where they're stronger (meal planning, chat, Android
# location) — an honest page is the one people and AI overviews quote.
CHECKED = 'November 2026'

COZI = dict(
  slug='cozi', name='Cozi',
  title='One Roof vs Cozi: Family App Comparison (2026)',
  description='One Roof vs Cozi, side by side: shared calendar, Google Calendar sync, lists, budget, voice assistant, pet care, ads and price. Which family app fits your household?',
  h1='One Roof vs Cozi',
  lead='Cozi is a long-standing family calendar and list app. One Roof covers the calendar and lists too, and adds a household budget with receipt scanning, pet care, documents and Roof, a voice assistant — with no ads on any plan.',
  sources=[('Cozi home page', 'https://www.cozi.com/'), ('Cozi Gold', 'https://www.cozi.com/cozi-gold/'), ('Using Cozi with other calendars', 'https://cozi.com/?p=12796')],
  # (icon, feature, (Cozi state, note), (One Roof state, note)); y / p (partly) / n (not listed)
  rows=[
    ('📅', 'Shared family calendar', ('y', ''), ('y', 'Day, week & month')),
    ('🔄', 'Google Calendar sync', ('p', 'Read-only feeds, up to 24–48 h'), ('y', 'Two-way · Plus')),
    ('📱', 'Apple Calendar', ('p', 'Read-only feeds'), ('y', 'On iPhone')),
    ('🛒', 'Shopping & grocery lists', ('y', ''), ('y', 'By store, works offline')),
    ('✓✓', 'To-dos & chores', ('y', ''), ('p', 'Lists for anything, no chore charts')),
    ('🍽', 'Meal planner & recipes', ('y', ''), ('n', '')),
    ('💰', 'Household budget', ('n', ''), ('y', 'Month, week or day')),
    ('🧾', 'AI receipt scanning', ('n', ''), ('y', 'Fills in the entry')),
    ('🎙', 'Voice assistant', ('n', ''), ('y', '"Hey Roof"')),
    ('🐾', 'Pet care & vaccine reminders', ('n', ''), ('y', '')),
    ('📍', 'Family location map', ('n', ''), ('p', 'iPhone, opt-in')),
    ('🗂', 'Documents', ('n', ''), ('y', 'With a lock on Plus')),
    ('📺', 'Family screen at home', ('n', ''), ('y', 'Any tablet or laptop')),
    ('🎲', 'Family games', ('n', ''), ('y', '')),
    ('🛡', 'No ads', ('p', 'With Cozi Gold'), ('y', 'On every plan')),
  ],
  price=('Free; Cozi Gold is $39 a year', 'Free to download; 30 days of Plus included, then an optional Plus subscription for the whole household'),
  pick_them='Meal planning and recipes are the center of how your family runs, and you want a calendar plus lists and nothing else.',
  pick_us='You also want the money, the pets and the paperwork in the same app, a two-way Google Calendar, a voice assistant, and no ads.',
  faq=[
    ('Is One Roof a good Cozi alternative?', 'Yes, if your family uses Cozi for its shared calendar and lists. One Roof has both, and adds a household budget with receipt scanning, pet care, documents, nudges and Roof, a voice assistant. One Roof has no meal planner, so if you plan meals in Cozi, keep that in mind.'),
    ('Does One Roof sync with Google Calendar both ways?', 'Yes. On One Roof Plus, events sync two ways with Google Calendar. On iPhone it also syncs with Apple Calendar.'),
    ('Does One Roof have ads?', 'No. One Roof has no ads and no tracking on any plan, and does not sell data.'),
    ('Does One Roof work on Android?', 'Yes. One Roof is on the App Store and Google Play, with Home Screen widgets on both. Two features are iPhone-only for now: Whereabouts (the family map) and Apple Calendar sync.'),
  ],
)

FAMILYWALL = dict(
  slug='familywall', name='FamilyWall',
  title='One Roof vs FamilyWall: Family App Comparison (2026)',
  description='One Roof vs FamilyWall, side by side: calendar, lists, budget, receipt scanning, voice assistant, pet care, location and price. Which family organizer fits your household?',
  h1='One Roof vs FamilyWall',
  lead='FamilyWall and One Roof are both all-in-one family organizers: calendar, lists, budget, location and documents. One Roof adds Roof, a voice assistant, receipt scanning, pet care, family games and a family screen for any tablet or laptop.',
  sources=[('FamilyWall Premium', 'https://www.familywall.com/premium.html')],
  rows=[
    ('📅', 'Shared family calendar', ('y', ''), ('y', 'Day, week & month')),
    ('🔄', 'Google Calendar sync', ('y', 'Google & Outlook.com'), ('y', 'Two-way · Plus')),
    ('🛒', 'Shopping & grocery lists', ('y', 'Plus to-do lists'), ('y', 'By store, works offline')),
    ('🍽', 'Meal planner & recipes', ('y', ''), ('n', '')),
    ('💰', 'Household budget', ('y', ''), ('y', 'Month, week or day')),
    ('🧾', 'AI receipt scanning', ('n', ''), ('y', 'Fills in the entry')),
    ('🎙', 'Voice assistant', ('n', ''), ('y', '"Hey Roof"')),
    ('🐾', 'Pet care & vaccine reminders', ('n', ''), ('y', '')),
    ('📍', 'Family location map', ('y', 'With place alerts'), ('p', 'iPhone only for now')),
    ('📣', 'Family messages', ('y', 'Messenger'), ('p', 'One-tap nudges, no chat')),
    ('🗂', 'Documents', ('y', ''), ('y', 'With a lock on Plus')),
    ('🎲', 'Family games', ('n', ''), ('y', '')),
    ('📺', 'Family screen at home', ('n', ''), ('y', 'Any tablet or laptop')),
    ('✏', 'Hand-drawn notes', ('n', ''), ('y', '')),
  ],
  price=('Premium is $4.99 a month or $44.99 a year, with a 30-day trial', 'Free to download; 30 days of Plus included, no card needed, then an optional Plus subscription for the whole household'),
  pick_them='You want a family chat inside the organizer, a meal planner, or location sharing on Android.',
  pick_us='You want a voice assistant that does things for you, receipts that fill in your budget, pet care, family games and a family screen on a tablet you already have.',
  faq=[
    ('Is One Roof a good FamilyWall alternative?', 'Yes. Like FamilyWall, One Roof keeps the family calendar, lists, budget, location and documents in one app, and it adds Roof (a voice assistant), receipt scanning, pet care, family games and Home Mode. One Roof has no meal planner and no family chat, so keep that in mind if you use those in FamilyWall.'),
    ('Does One Roof have a family locator?', 'Yes, on iPhone: Whereabouts is a private family map with live locations and arrive/leave alerts for places you choose. It is off by default and visible only to your household. It is not available on Android yet.'),
    ('How much does One Roof cost?', 'One Roof is free to download and use, and every new household gets 30 days of One Roof Plus included, with no card needed. After that, Plus is an optional subscription that covers the whole household, never per person.'),
    ('Does One Roof have ads?', 'No. One Roof has no ads and no tracking, and does not sell data.'),
  ],
)

PAGES = [COZI, FAMILYWALL]
