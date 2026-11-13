// "Export family data" (Settings, owner 2026-11-13: any member, spreadsheets
// + the vault's documents, no photos, export only). One .zip:
//   money.csv, lists.csv, calendar.csv, pets.csv, pet-history.csv,
//   pet-routine.csv, family.csv, documents.csv  (names in the app language)
//   documents/<title>.<ext>   — only when asked, after Face ID
// Everything is read with the member's own session, so RLS decides: other
// people's private budgets and anything this member can't see stay out.
// Location is never exported. CSVs carry a UTF-8 BOM so Excel opens accents
// right. The zip is written to the cache and handed to the share sheet.
/* eslint-disable @typescript-eslint/no-require-imports -- expo-sharing loaded lazily (older binaries) */
import { File, Paths } from 'expo-file-system'

import { categoryById } from '@/lib/categories'
import type { TKey } from '@/lib/i18n'
import { getSignedUrl } from '@/lib/signedUrls'
import { supabase } from '@/lib/supabase'
import type {
  Budget,
  CalendarEvent,
  CategoryOverride,
  CustomCategory,
  Entry,
  FamilyDocument,
  MemberProfile,
  Month,
  Pet,
  PetCareTask,
  PetEvent,
  Profile,
  ShoppingItem,
  ShoppingStore,
} from '@/lib/types'
import { makeZip, utf8, type ZipEntry } from '@/lib/zip'

type T = (key: TKey, params?: Record<string, string | number>) => string

export interface ExportProgress {
  step: 'data' | 'docs' | 'zip'
  done: number
  total: number
}

/** How many vault documents this member can see, and their total size. */
export async function docsSummary(): Promise<{ count: number; bytes: number }> {
  const { data } = await supabase.from('documents').select('size_bytes')
  const rows = (data ?? []) as { size_bytes: number | null }[]
  return { count: rows.length, bytes: rows.reduce((n, r) => n + (Number(r.size_bytes) || 0), 0) }
}

function cell(v: unknown): string {
  if (v === null || v === undefined) return ''
  const s = typeof v === 'boolean' ? (v ? '✓' : '') : String(v)
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function csv(header: string[], rows: unknown[][]): Uint8Array {
  const lines = [header, ...rows].map((r) => r.map(cell).join(','))
  return utf8('﻿' + lines.join('\r\n') + '\r\n')
}

/** A file name that works on every OS, kept readable. */
function safeName(s: string): string {
  return (
    s
      // eslint-disable-next-line no-control-regex -- control characters are exactly what's stripped
      .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80) || 'documento'
  )
}

export async function exportFamily({
  t,
  profiles,
  familyName,
  includeDocs,
  onProgress,
}: {
  t: T
  profiles: Profile[]
  familyName: string
  includeDocs: boolean
  onProgress?: (p: ExportProgress) => void
}): Promise<{ uri: string; name: string; files: number }> {
  onProgress?.({ step: 'data', done: 0, total: 1 })
  const [b, m, e, cc, co, st, it, ev, pt, pe, tk, mp, dc] = await Promise.all([
    supabase.from('budgets').select('*').order('created_at'),
    supabase.from('months').select('*'),
    supabase.from('entries').select('*').order('entry_date', { ascending: false }),
    supabase.from('custom_categories').select('*'),
    supabase.from('category_overrides').select('*'),
    supabase.from('shopping_stores').select('*'),
    supabase.from('shopping_items').select('*').order('created_at'),
    supabase.from('calendar_events').select('*').order('start_date'),
    supabase.from('pets').select('*').order('name'),
    supabase.from('pet_events').select('*').order('event_date', { ascending: false }),
    supabase.from('pet_care_tasks').select('*').order('sort_order'),
    supabase.from('member_profiles').select('*'),
    supabase.from('documents').select('*').order('created_at'),
  ])
  const budgets = (b.data ?? []) as Budget[]
  const months = (m.data ?? []) as Month[]
  const entries = (e.data ?? []) as Entry[]
  const custom = (cc.data ?? []) as CustomCategory[]
  const overrides = (co.data ?? []) as CategoryOverride[]
  const stores = (st.data ?? []) as ShoppingStore[]
  const items = (it.data ?? []) as ShoppingItem[]
  const events = (ev.data ?? []) as CalendarEvent[]
  const pets = (pt.data ?? []) as Pet[]
  const petEvents = (pe.data ?? []) as PetEvent[]
  const tasks = (tk.data ?? []) as PetCareTask[]
  const memberProfiles = (mp.data ?? []) as MemberProfile[]
  const docs = (dc.data ?? []) as FamilyDocument[]

  const who = (email: string | null | undefined) =>
    email ? (profiles.find((p) => p.email === email)?.display_name ?? email) : t('export.everyone')
  const catName = (id: string) => {
    const c = categoryById(id, custom, overrides)
    const isCustom = custom.some((x) => x.id === id)
    return isCustom ? c.name : (overrides.find((o) => o.base_id === c.id)?.name ?? t(`cat.${c.id}` as TKey))
  }
  const h = (k: string) => t(`export.h.${k}` as TKey)
  const out: ZipEntry[] = []
  const file = (k: string) => `${t(`export.f.${k}` as TKey)}.csv`

  // money
  const monthOf = new Map(months.map((x) => [x.id, x]))
  const budgetOf = new Map(budgets.map((x) => [x.id, x]))
  out.push({
    name: file('money'),
    data: csv(
      ['budget', 'period', 'date', 'type', 'description', 'category', 'subcategory', 'amount', 'person'].map(h),
      entries.map((x) => {
        const mo = monthOf.get(x.month_id)
        const bu = mo ? budgetOf.get(mo.budget_id) : undefined
        return [
          bu?.name ?? '',
          mo?.start_date ?? '',
          x.entry_date,
          x.type === 'income' ? t('export.income') : t('export.expense'),
          x.label,
          catName(x.category),
          x.subcategory ?? '',
          Number(x.amount).toFixed(2),
          who(x.person_email),
        ]
      }),
    ),
  })

  // lists
  const storeName = new Map(stores.map((s) => [s.id, s.name]))
  out.push({
    name: file('lists'),
    data: csv(
      ['list', 'item', 'done', 'addedBy', 'addedOn'].map(h),
      items.map((x) => [x.store_id ? (storeName.get(x.store_id) ?? '') : t('export.generalList'), x.label, x.checked, who(x.added_by), x.created_at.slice(0, 10)]),
    ),
  })

  // calendar
  out.push({
    name: file('calendar'),
    data: csv(
      ['title', 'kind', 'start', 'end', 'allDay', 'startTime', 'endTime', 'repeat', 'location', 'notes', 'who'].map(h),
      events.map((x) => [
        x.title,
        t(`export.kind.${x.kind}` as TKey),
        x.start_date,
        x.end_date,
        x.all_day,
        x.start_time?.slice(0, 5) ?? '',
        x.end_time?.slice(0, 5) ?? '',
        t(`export.rec.${x.recurrence}` as TKey),
        x.location ?? '',
        x.notes ?? '',
        who(x.owner_email),
      ]),
    ),
  })

  // pets
  const petName = new Map(pets.map((p) => [p.id, p.name]))
  out.push({
    name: file('pets'),
    data: csv(
      ['name', 'species', 'breed', 'birthday', 'weight', 'microchip', 'notes'].map(h),
      pets.map((p) => [p.name, p.species ?? '', p.breed ?? '', p.birthday ?? '', p.weight ?? '', p.microchip ?? '', p.notes ?? '']),
    ),
  })
  out.push({
    name: file('petHistory'),
    data: csv(
      ['pet', 'type', 'title', 'date', 'nextDue', 'notes'].map(h),
      petEvents.map((x) => [petName.get(x.pet_id) ?? '', t(`export.petType.${x.type}` as TKey), x.title, x.event_date, x.next_due ?? '', x.notes ?? '']),
    ),
  })
  out.push({
    name: file('petRoutine'),
    data: csv(
      ['pet', 'kind', 'title', 'everyDays', 'time'].map(h),
      tasks.map((x) => [
        petName.get(x.pet_id) ?? '',
        x.kind === 'daily' ? t('export.daily') : t('export.repeats'),
        x.title,
        x.interval_days ?? '',
        (x.at_time ?? x.remind_at)?.slice(0, 5) ?? '',
      ]),
    ),
  })

  // family
  out.push({
    name: file('family'),
    data: csv(
      ['name', 'email', 'birthday', 'phone', 'bloodType', 'height', 'weight', 'shoe', 'pants', 'shirt', 'allergies', 'notes'].map(h),
      profiles.map((p) => {
        const d = memberProfiles.find((x) => x.email === p.email)
        return [p.display_name, p.email, d?.birthday ?? '', d?.phone ?? '', d?.blood_type ?? '', d?.height ?? '', d?.weight ?? '', d?.shoe_size ?? '', d?.pants_size ?? '', d?.shirt_size ?? '', d?.allergies ?? '', d?.notes ?? '']
      }),
    ),
  })

  // documents: the list always; the files when asked
  const folder = t('export.f.docsFolder')
  const used = new Set<string>()
  const docFile = new Map<string, string>()
  for (const d of docs) {
    const ext = (d.file_path.match(/\.[a-z0-9]+$/i)?.[0] ?? '').toLowerCase()
    let base = safeName(d.title)
    let n = 2
    while (used.has(base.toLowerCase() + ext)) base = `${safeName(d.title)} (${n++})`
    used.add(base.toLowerCase() + ext)
    docFile.set(d.id, `${base}${ext}`)
  }
  out.push({
    name: file('documents'),
    data: csv(
      ['title', 'category', 'owner', 'addedOn', 'file'].map(h),
      docs.map((d) => [d.title, t(`docCat.${d.category}` as TKey), who(d.owner_email), d.created_at.slice(0, 10), includeDocs ? `${folder}/${docFile.get(d.id)}` : '']),
    ),
  })

  let files = out.length
  if (includeDocs) {
    for (let i = 0; i < docs.length; i++) {
      onProgress?.({ step: 'docs', done: i, total: docs.length })
      const d = docs[i]
      try {
        const url = await getSignedUrl(d.file_path)
        if (!url) continue
        const res = await fetch(url)
        if (!res.ok) continue
        out.push({ name: `${folder}/${docFile.get(d.id)}`, data: new Uint8Array(await res.arrayBuffer()) })
        files++
      } catch {
        // one unreadable file never sinks the export
      }
    }
  }

  onProgress?.({ step: 'zip', done: 0, total: 1 })
  const day = new Date().toISOString().slice(0, 10)
  const name = `One Roof - ${safeName(familyName || 'Família')} - ${day}.zip`
  const target = new File(Paths.cache, name)
  if (target.exists) target.delete()
  target.create()
  target.write(makeZip(out))
  return { uri: target.uri, name, files }
}

/** Hand the zip to the share sheet (Save to Files, AirDrop, mail…). False
 *  on a binary without expo-sharing. */
export async function shareExport(uri: string, title: string): Promise<boolean> {
  let sharing: typeof import('expo-sharing')
  try {
    sharing = require('expo-sharing') as typeof import('expo-sharing')
  } catch {
    return false
  }
  if (!(await sharing.isAvailableAsync())) return false
  await sharing.shareAsync(uri, { mimeType: 'application/zip', UTI: 'public.zip-archive', dialogTitle: title })
  return true
}
