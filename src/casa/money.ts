// Modo Casa — Money: the same maths as src/apps/budget/Budgets.tsx (received /
// spent up to today in each budget's CURRENT period, else its latest one) and
// a minimal "new expense" write that mirrors the phone's addMoney.
import { suggestCategory } from '../lib/categories'
import { currentPeriodStart, periodEndISO, todayISO } from '../lib/format'
import { supabase } from '../lib/supabase'
import type { Budget, CategoryOverride, CategoryRule, CustomCategory, Entry, Month } from '../lib/types'
import { norm, sha256Hex } from './util'

export interface BudgetSummary {
  budget: Budget
  month: Month | null
  income: number
  spent: number
  balance: number
  /** Balance after the dated-in-the-future entries of this period land. */
  expected: number
  hasUpcoming: boolean
  latest: Entry[]
}

/** Is there a PIN, and does `pin` match it? */
export async function pinState(householdId: string): Promise<{ hash: string | null; error: boolean }> {
  const { data, error } = await supabase.from('home_settings').select('pin_hash').eq('household_id', householdId).maybeSingle()
  if (error) return { hash: null, error: true }
  return { hash: (data as { pin_hash?: string | null } | null)?.pin_hash ?? null, error: false }
}

export async function pinMatches(householdId: string, pin: string, hash: string): Promise<boolean> {
  return (await sha256Hex(`${householdId}:${pin}`)) === hash.toLowerCase()
}

export async function loadMoney(): Promise<BudgetSummary[]> {
  const [b, m] = await Promise.all([
    supabase.from('budgets').select('*').order('created_at'),
    supabase.from('months').select('*').order('start_date', { ascending: false }),
  ])
  const budgets = (b.data ?? []) as Budget[]
  const months = (m.data ?? []) as Month[]
  const today = todayISO()
  const picks = budgets.map((budget) => {
    const own = months.filter((x) => x.budget_id === budget.id)
    const cur = own.find((x) => x.start_date <= today && today <= periodEndISO(budget.period, x.start_date))
    return { budget, month: cur ?? own[0] ?? null }
  })
  const ids = picks.map((p) => p.month?.id).filter(Boolean) as string[]
  const { data: e } = ids.length
    ? await supabase.from('entries').select('*').in('month_id', ids).order('entry_date', { ascending: false }).order('created_at', { ascending: false })
    : { data: [] }
  const entries = (e ?? []) as Entry[]
  return picks.map(({ budget, month }) => {
    let income = 0
    let spent = 0
    let comingIn = 0
    let due = 0
    const mine = month ? entries.filter((x) => x.month_id === month.id) : []
    for (const x of mine) {
      const amount = Number(x.amount)
      if (x.entry_date > today) {
        if (x.type === 'income') comingIn += amount
        else due += amount
      } else if (x.type === 'income') income += amount
      else spent += amount
    }
    const balance = income - spent
    return {
      budget,
      month,
      income,
      spent,
      balance,
      expected: balance + comingIn - due,
      hasUpcoming: comingIn > 0 || due > 0,
      latest: mine.filter((x) => x.entry_date <= today).slice(0, 6),
    }
  })
}

export function pickBudget(budgets: Budget[], name: string): Budget | null {
  const n = norm(name)
  if (n) {
    const hit = budgets.find((b) => norm(b.name) === n) ?? budgets.find((b) => norm(b.name).includes(n) || n.includes(norm(b.name)))
    if (hit) return hit
  }
  return budgets.length === 1 ? budgets[0] : null
}

export async function listBudgets(): Promise<Budget[]> {
  const { data } = await supabase.from('budgets').select('*').order('created_at')
  return (data ?? []) as Budget[]
}

/** Record an entry in `budget`'s period that holds `date` — opening the
 *  current period if it isn't there yet (the phone does the same when you
 *  add to a new month). Returns the new entry's id. */
export async function addEntry(input: {
  budget: Budget
  type: 'expense' | 'income'
  amount: number
  label: string
  person: string
  date?: string
}): Promise<{ id: string; createdMonth: string | null }> {
  const date = input.date ?? todayISO()
  const { data: rows } = await supabase.from('months').select('*').eq('budget_id', input.budget.id).order('start_date', { ascending: false })
  const months = (rows ?? []) as Month[]
  let month = months.find((x) => x.start_date <= date && date <= periodEndISO(input.budget.period, x.start_date)) ?? null
  let createdMonth: string | null = null
  if (!month) {
    const start = currentPeriodStart(input.budget.period)
    const { data: created } = await supabase.from('months').insert({ budget_id: input.budget.id, start_date: start }).select('*').single()
    createdMonth = (created as Month | null)?.id ?? null
    month = (created as Month | null) ?? months[0] ?? null
  }
  if (!month) throw new Error('no_period')
  const { data: rules } = await supabase.from('category_rules').select('*')
  const label = input.label.trim() || (input.type === 'income' ? 'Income' : 'Expense')
  const category = input.type === 'income' ? 'salary' : suggestCategory(label, (rules ?? []) as CategoryRule[])
  const end = periodEndISO(input.budget.period, month.start_date)
  const entryDate = date < month.start_date ? month.start_date : date > end ? end : date
  const { data, error } = await supabase
    .from('entries')
    .insert({
      month_id: month.id,
      type: input.type,
      label,
      amount: input.amount,
      category,
      subcategory: null,
      entry_date: entryDate,
      person_email: input.person,
      recurring: false,
    })
    .select('id')
    .single()
  if (error) throw error
  return { id: (data as { id: string }).id, createdMonth }
}

/** Remove an entry — and the period we opened for it, when it's empty again. */
export async function deleteEntry(id: string, createdMonth?: string | null): Promise<void> {
  await supabase.from('entries').delete().eq('id', id)
  if (createdMonth) {
    const { count } = await supabase.from('entries').select('id', { count: 'exact', head: true }).eq('month_id', createdMonth)
    if (!count) await supabase.from('months').delete().eq('id', createdMonth)
  }
}

// ── history (the wide Money board) ────────────────────────────────────────────

export interface PeriodData {
  month: Month
  entries: Entry[]
}

export interface MoneyHistory {
  /** Newest first, at most `limit`. */
  periods: PeriodData[]
  custom: CustomCategory[]
  overrides: CategoryOverride[]
}

/** A budget's latest periods with their entries, for the history chart, the
 *  category breakdown and the entry list. */
export async function loadHistory(budget: Budget, limit = 12): Promise<MoneyHistory> {
  const [m, cc, co] = await Promise.all([
    supabase.from('months').select('*').eq('budget_id', budget.id).order('start_date', { ascending: false }).limit(limit),
    supabase.from('custom_categories').select('*'),
    supabase.from('category_overrides').select('*'),
  ])
  const months = (m.data ?? []) as Month[]
  const ids = months.map((x) => x.id)
  const { data: e } = ids.length
    ? await supabase.from('entries').select('*').in('month_id', ids).order('entry_date', { ascending: false }).order('created_at', { ascending: false })
    : { data: [] }
  const entries = (e ?? []) as Entry[]
  return {
    periods: months.map((month) => ({ month, entries: entries.filter((x) => x.month_id === month.id) })),
    custom: (cc.data ?? []) as CustomCategory[],
    overrides: (co.data ?? []) as CategoryOverride[],
  }
}
