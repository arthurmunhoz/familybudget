# Phase 0 — AI Cost Fix & Per-Household Metering (engineering spec)

**Status:** IMPLEMENTED (DB + functions), verified, **pending prod deploy**
**Owner:** Arthur (solo)

> **SUPERSEDED (2026-07): the Opus fallback described below was REMOVED.** Owner
> rule: every AI call in the app uses **Haiku only** — never Opus or a pricier
> model. Unreadable photos fail with "try a clearer photo" instead of
> escalating. Do not reintroduce the fallback from this doc; the metering /
> kill-switch parts remain accurate.

> **As-built note (differs from the original sketch below):** the metering RPCs were
> hardened to be **service-role-only** instead of user-JWT-callable. The scan functions now
> resolve the caller's household server-side (`email → allowed_users.household_id`, same pattern as
> `api/send-ping.ts`) and call `ai_scan_allowed(p_household)` / `ai_scan_record(p_household, kind, cost)`
> with the **service role**, so a signed-in user can't POST to the record RPC to grief the global
> kill-switch. `ai_scan_record` also clamps each cost to ≤ $0.50. Shipped as migrations
> **032 (tables + RPCs) → 033 (parameterize + service-role) → 034 (revoke anon/auth execute)**.
> No new Vercel env var needed — `SUPABASE_SERVICE_ROLE_KEY` is already set project-wide
> (used by send-digest / send-ping). The §3/§4 SQL and TS below show the original user-JWT sketch;
> the live versions are in `supabase/migration-032..034-*.sql` and `api/scan-*.ts`.
**Why this is Phase 0:** It is the #1 unit-economics blocker for monetizing One Roof
(see `../ONE-ROOF-iOS-STRATEGY.md`). It is **backend-only** — `api/*.ts` + Supabase — so it is
**stack-independent**: it ships to the current PWA today and is reused verbatim by the future
React Native client (RN hits the same `/api` endpoints and the same Supabase backend). Do this
**before** any RN work.

**Scope:** Move the receipt/bill scanners off Opus 4.8 + adaptive thinking to Haiku 4.5, add
per-household monthly scan metering with caps, and add a global daily-spend kill-switch + alerts.
Optional secondary item (same phase, lower priority): localize the daily push digest copy.

**Non-goals (later phases):** the paywall / IAP (Phase 2), the shared calendar (Phase 2), the RN
rewrite (Phase 1). This spec only stops the owner-subsidized AI bleed and installs the metering rails
the paywall will later flip on.

---

## 1. The problem (current state, verified in code)

`api/scan-receipt.ts` and `api/scan-bill.ts` both:

- call **`claude-opus-4-8`** with **`thinking: { type: 'adaptive' }`** and `max_tokens: 4096`
  (`scan-receipt.ts:106-110`, `scan-bill.ts:79-85`);
- authenticate the caller's Supabase JWT but **do not resolve or check the household** — there is no
  per-household limit and no global spend ceiling;
- bill **Arthur's personal Anthropic key** (`ANTHROPIC_API_KEY` in Vercel) for **every household's**
  scans.

**Cost impact (confirmed pricing, per 1M tokens):**

| Model | Input | Output | Rel. cost |
|---|---|---|---|
| `claude-opus-4-8` (current) | $5.00 | $25.00 | 1× |
| `claude-haiku-4-5` (target) | $1.00 | $5.00 | **1/5×** on identical config |

Haiku 4.5 is exactly **5× cheaper** on input and output. Dropping adaptive thinking (Haiku is a
4.5-tier model — adaptive thinking is a 4.6+ feature and does not apply) removes the thinking output
tokens too, pushing the realized saving toward **~8-10×** for these small structured-extraction calls.

**Rough per-scan cost** (resized image ≈ 1.5K input tokens + ~250 prompt tokens; ~120 output tokens):

- Opus 4.8 + thinking (today): **~$0.02-0.03 / scan**
- Haiku 4.5, no thinking (target): **~$0.002-0.006 / scan**

At ~15 scans/active household/month, the AI line at 8,000 households drops from a business-killing
**~$2,400-4,300/mo** to **~$480/mo**. A single $39.99/yr paying household ($34 net) then funds
**thousands** of Haiku scans — i.e. paid AI becomes strongly gross-margin-positive once gated.

---

## 2. Design overview

Three mechanisms, layered:

1. **Cheaper model with a quality fallback.** Try Haiku 4.5 (no thinking). If the result fails to
   parse or is implausible, retry **once** with Opus 4.8 + adaptive thinking (today's behavior). Most
   scans hit cheap Haiku; only hard images escalate.
2. **Per-household monthly metering.** Count successful scans per household per calendar month in
   Postgres. Enforce a configurable monthly cap. (Phase 0 sets a *generous* default cap since today's
   users are friends/family; the paywall later tightens the free cap and gates "unlimited" behind Plus.)
3. **Global daily-spend kill-switch.** Accumulate estimated $ spend per day; a master `scanning_enabled`
   flag + a daily $ ceiling let any runaway usage be halted instantly without a redeploy.

Household resolution is **server-trusted**: the scan function calls a `security definer` Postgres RPC
with the caller's JWT; the RPC derives the household via `public.current_household()` (same function the
RLS uses), so the client never passes — and cannot forge — a `household_id`.

---

## 3. Database changes — migration `032-ai-metering.sql`

Apply via the Supabase MCP `apply_migration`, then mirror into
`supabase/migration-032-ai-metering.sql` and append to the ordered list in `schema.sql`
(per `CLAUDE.md` → "Change the database").

```sql
-- 032-ai-metering.sql — per-household AI scan metering + global spend kill-switch

-- 1) Per-household monthly usage counter (one row per household × month × kind)
create table public.ai_usage (
  household_id uuid not null default public.current_household()
    references public.households(id) on delete cascade,
  period       text not null,                 -- 'YYYY-MM' in UTC
  kind         text not null,                 -- 'receipt' | 'bill'
  count        integer not null default 0,
  est_cost_usd numeric(12,4) not null default 0,
  updated_at   timestamptz not null default now(),
  primary key (household_id, period, kind)
);
alter table public.ai_usage enable row level security;
-- Members may READ their own household's usage (for an in-app meter). Writes only via the RPCs below.
create policy ai_usage_select on public.ai_usage
  for select using (household_id = public.current_household());

-- 2) Single-row global config: master switch, free monthly cap, daily $ ceiling
create table public.ai_config (
  id                  boolean primary key default true check (id),  -- enforces a single row
  scanning_enabled    boolean       not null default true,
  free_monthly_cap    integer       not null default 100,    -- per household; tighten to 10-20 at paywall
  daily_spend_cap_usd numeric(10,2) not null default 10.00
);
insert into public.ai_config (id) values (true) on conflict (id) do nothing;
alter table public.ai_config enable row level security;
create policy ai_config_admin on public.ai_config for select using (public.is_admin());

-- 3) Global daily spend accumulator (drives the kill-switch)
create table public.ai_daily_spend (
  day          date primary key,
  est_cost_usd numeric(12,4) not null default 0
);
alter table public.ai_daily_spend enable row level security;
create policy ai_daily_admin on public.ai_daily_spend for select using (public.is_admin());

-- 4) Pre-flight check (read-only): may the caller's household scan right now?
create or replace function public.ai_scan_allowed()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  hh uuid := public.current_household();
  cfg public.ai_config;
  used int;
  today_spend numeric;
begin
  if hh is null then
    return jsonb_build_object('allowed', false, 'reason', 'no_household');
  end if;
  select * into cfg from public.ai_config where id;
  if not cfg.scanning_enabled then
    return jsonb_build_object('allowed', false, 'reason', 'disabled');
  end if;
  select coalesce(est_cost_usd, 0) into today_spend
    from public.ai_daily_spend where day = (now() at time zone 'utc')::date;
  if coalesce(today_spend, 0) >= cfg.daily_spend_cap_usd then
    return jsonb_build_object('allowed', false, 'reason', 'daily_cap');
  end if;
  select coalesce(sum(count), 0) into used
    from public.ai_usage
    where household_id = hh and period = to_char(now() at time zone 'utc', 'YYYY-MM');
  if used >= cfg.free_monthly_cap then
    return jsonb_build_object('allowed', false, 'reason', 'monthly_cap',
                              'used', used, 'cap', cfg.free_monthly_cap);
  end if;
  return jsonb_build_object('allowed', true, 'used', used, 'cap', cfg.free_monthly_cap);
end $$;

-- 5) Record a SUCCESSFUL scan (atomic upsert + daily accumulator)
create or replace function public.ai_scan_record(p_kind text, p_cost numeric)
returns void language plpgsql security definer set search_path = public as $$
declare hh uuid := public.current_household();
begin
  if hh is null then return; end if;
  insert into public.ai_usage (household_id, period, kind, count, est_cost_usd, updated_at)
  values (hh, to_char(now() at time zone 'utc', 'YYYY-MM'), p_kind, 1, coalesce(p_cost, 0), now())
  on conflict (household_id, period, kind) do update
    set count        = ai_usage.count + 1,
        est_cost_usd = ai_usage.est_cost_usd + coalesce(p_cost, 0),
        updated_at   = now();
  insert into public.ai_daily_spend (day, est_cost_usd)
  values ((now() at time zone 'utc')::date, coalesce(p_cost, 0))
  on conflict (day) do update
    set est_cost_usd = ai_daily_spend.est_cost_usd + coalesce(p_cost, 0);
end $$;

grant execute on function public.ai_scan_allowed()            to authenticated;
grant execute on function public.ai_scan_record(text, numeric) to authenticated;
```

Notes:
- `current_household()` resolves under a user JWT (it's how RLS already stamps inserts), so the RPCs
  must be called **with the caller's token**, not the service role.
- **Concurrency:** check-then-record has a tiny race (two simultaneous scans could each pass the check
  and both record, going 1 over the cap). Acceptable for a soft cap. If hard enforcement is ever
  needed, fold check+increment into one RPC and refund on failure.

---

## 4. Serverless function changes (`api/scan-receipt.ts`, `api/scan-bill.ts`)

Both functions get the same shape change. Keep the existing JWT verification and the existing
`output_config.format` structured-output schemas — only the model/thinking and the metering wrapper change.

### 4.1 Constants

```ts
const HAIKU = 'claude-haiku-4-5'   // primary: $1/$5 per 1M; no thinking
const OPUS  = 'claude-opus-4-8'    // fallback: $5/$25 per 1M; adaptive thinking

// $ per token (input, output) — keep in sync with the pricing table above
const RATES: Record<string, { in: number; out: number }> = {
  [HAIKU]: { in: 1 / 1e6,  out: 5 / 1e6 },
  [OPUS]:  { in: 5 / 1e6,  out: 25 / 1e6 },
}
const estCost = (model: string, u: { input_tokens: number; output_tokens: number }) =>
  u.input_tokens * RATES[model].in + u.output_tokens * RATES[model].out
```

### 4.2 Pre-flight check (after JWT verify, before any Anthropic call)

```ts
const rpc = (fn: string, body: unknown) =>
  fetch(`${supabaseUrl}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: anonKey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  })

const gate = await rpc('ai_scan_allowed', {})
const verdict = gate.ok ? await gate.json() : { allowed: false, reason: 'gate_error' }
if (!verdict.allowed) {
  const msg = {
    disabled:    'Scanning is temporarily paused. Try again later.',
    daily_cap:   'Scanning is paused for today (daily limit reached). Try again tomorrow.',
    monthly_cap: `You've used all ${verdict.cap} free scans this month.`,  // becomes "upgrade to Plus" copy later
    no_household:'Could not find your household.',
    gate_error:  'Scanning is unavailable right now.',
  }[verdict.reason] ?? 'Scanning is unavailable right now.'
  return res.status(429).json({ error: msg, reason: verdict.reason })
}
```

### 4.3 Model call with Haiku-first + Opus fallback

```ts
async function extract(model: string) {
  const resp = await client.messages.create({
    model,
    max_tokens: 1024,                                   // receipts; use 2048 for bills (more line items)
    ...(model === OPUS ? { thinking: { type: 'adaptive' } } : {}),  // NO thinking on Haiku
    messages: [/* unchanged: image block + text prompt */],
    output_config: { format: { type: 'json_schema', schema: RECEIPT_SCHEMA } },  // unchanged
  })
  const text = resp.content.find((b) => b.type === 'text')
  if (!text || text.type !== 'text') throw new Error('no_text')
  return { parsed: JSON.parse(text.text), usage: resp.usage, model }
}

let result
try {
  result = await extract(HAIKU)
  if (!isPlausible(result.parsed)) throw new Error('implausible')   // see 4.4
} catch {
  result = await extract(OPUS)                                       // one fallback attempt
}
```

### 4.4 Plausibility gate (decides whether to escalate to Opus)

- **Receipt:** `amount` is a finite number > 0; `category` is in the `CATEGORIES` enum; `date` parses
  via the existing `normalizeDate` (null is acceptable). Reject (escalate) if `amount` is missing/NaN.
- **Bill:** `items` is a non-empty array of `{name, price}` with finite prices (reuse the existing
  defensive filter in `scan-bill.ts:122-128`). Escalate if `items` ends up empty.

Apply the existing post-processing (`normalizeDate`, subcategory trim, bill item/tax/tip coercion)
to whichever result wins.

### 4.5 Record on success (after a 200 is assembled)

```ts
const cost = estCost(result.model, result.usage)
await rpc('ai_scan_record', { p_kind: 'receipt', p_cost: cost })   // 'bill' in scan-bill.ts
return res.status(200).json(result.parsed)
```

Record only on success, so failed/Anthropic-errored scans never burn a household's quota.
Keep the existing `Anthropic.APIError` handling (credit-balance / 401 / 429 → friendly messages).

---

## 5. Kill-switch & alerts (operational)

- **Master switch:** `update public.ai_config set scanning_enabled = false;` halts all scanning
  instantly (the `ai_scan_allowed` RPC returns `disabled`) with no redeploy.
- **Daily ceiling:** `daily_spend_cap_usd` (default $10) auto-pauses scanning once the day's estimated
  spend crosses it; resets at UTC midnight. Tune for expected volume.
- **Backstop alerts (defense in depth):** set a **usage/spend limit + email alert on the Anthropic
  account** (console.anthropic.com) so an estimate drift in `est_cost_usd` can't silently overrun the
  real bill. The DB accumulator is the fast in-app guard; the Anthropic limit is the hard backstop.
- **Optional Slack/email ping:** in `ai_scan_record`, when a day crosses (say) 80% of the cap, fire a
  webhook. Cheap to add later; not required for Phase 0.

---

## 6. (Secondary, same phase) Localize the daily digest

Lower priority than the cost fix but stack-independent and part of Phase 0 in the strategy. Today
`api/send-digest.ts` builds English copy for everyone. To localize:

- join each subscription's owner to `user_settings.language` (EN/ES/PT-BR);
- move the digest's user-facing strings into the existing `src/lib/i18n` dicts (or a server-side copy)
  keyed by language;
- build each push payload in the recipient's language.

This matters because the Hispanic/Brazilian market is a positioning wedge — server-sent notifications
shouldn't be English-only when the app already is tri-lingual.

---

## 7. Rollout & verification

1. Apply migration 032; confirm `ai_config` has its single row and the two RPCs exist
   (`select public.ai_scan_allowed();` as a logged-in user returns `allowed:true`).
2. Update both `api/scan-*.ts`; `npm run build` (the only gate — `tsc -b && vite build`).
3. Deploy: `npx vercel deploy --prod --yes`.
4. **Verify cost path:** scan a clear receipt → confirm a 200 and that `ai_usage.count` incremented
   and `est_cost_usd` is in the **~$0.002-0.006** range (Haiku path), not ~$0.02+ (would mean it fell
   back to Opus — check why).
5. **Verify fallback:** scan a deliberately hard/blurry receipt → confirm it still returns a correct
   result (Opus fallback) and `est_cost_usd` reflects the Opus rate.
6. **Verify cap:** temporarily set `free_monthly_cap = 1`, scan twice → second call returns HTTP 429
   `monthly_cap`. Reset the cap.
7. **Verify kill-switch:** set `scanning_enabled = false`, scan → 429 `disabled`. Re-enable.
8. Spot-check a real iPhone (camera + PWA) since the preview browser can't fully exercise capture.

**Quality watch:** Haiku is less capable than Opus at reading cramped/odd receipts. The fallback covers
hard cases, but monitor the **Opus-fallback rate** for the first week (high fallback rate = Haiku
struggling → consider a small Haiku thinking budget on bills, or tune the prompt). If receipt accuracy
regresses noticeably, the fallback threshold (`isPlausible`) is the tuning knob.

---

## 8. Risks

- **Accuracy regression on Haiku** — mitigated by the Opus fallback + plausibility gate; monitor
  fallback rate.
- **Cost-estimate drift** — `est_cost_usd` is a model of the bill, not the bill. The Anthropic
  account-level spend alert is the hard backstop.
- **`current_household()` returns null in the function context** — would block scans with
  `no_household`. Mitigation: the RPCs are called with the user JWT (not service role); this is the same
  context RLS uses for inserts, so it resolves. If ever not, fall back to resolving household via the
  `/auth/v1/user` email → `allowed_users`/profile lookup and pass it explicitly to service-role RPCs.
- **Concurrency over-count** — benign for a soft cap (see §3).
