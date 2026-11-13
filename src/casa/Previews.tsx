// Modo Casa — the live previews shared by the Painel cards and the Widgets
// carousel: the calendar's rest-of-today + tomorrow, every list with its first
// open items (tick right there), the pets' routine for today (tick right
// there), and the locked Money page. `big` = the roomier widget layout.
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Check, ChevronRight, KeyRound, Lock, PawPrint, Wallet, type LucideIcon } from 'lucide-react'
import { useI18n } from '../hooks/useI18n'
import { addDays, KIND_EMOJI, type Occurrence } from '../lib/calendar'
import { dailyChecklist, overdueEvents, routineStatus, taskTime } from '../lib/petCare'
import type { PetTaskDone, ShoppingItem } from '../lib/types'
import { CARE_ICONS } from '../apps/pets/careIcons'
import StoreLogo from '../apps/shopping/StoreLogo'
import { agenda, minutesOf, petTaskDone, setChecked, type HubData, type Member } from './data'
import { tick } from './sound'
import { Avatar, IconChip, PlusTag } from './ui'
import { GRAD, LOCALE, grad } from './util'

// ── frame ────────────────────────────────────────────────────────────────────

/** A preview card: the header (chip · title · sub · chevron) opens the full
 *  panel; the body holds tappable rows and fades out at the bottom. */
export function PreviewCard({
  i,
  icon,
  g,
  title,
  sub,
  onOpen,
  children,
  className = '',
  plain = false,
}: {
  i: number
  icon: LucideIcon
  g: readonly string[]
  title: string
  sub?: string
  onOpen: (el: HTMLElement) => void
  children: ReactNode
  className?: string
  /** No card chrome (inside a widget page that has its own). */
  plain?: boolean
}) {
  return (
    <section
      className={`${plain ? 'h-full' : 'casa-liquid casa-rise rounded-[28px]'} flex min-h-0 flex-col overflow-hidden ${className}`}
      style={{ ['--i' as string]: i }}
    >
      <button onClick={(e) => onOpen(e.currentTarget)} className="casa-press flex shrink-0 items-center gap-3 px-4 pt-4 pb-2.5 text-left">
        <IconChip icon={icon} g={g} size={plain ? 46 : 38} />
        <span className="min-w-0 flex-1">
          <span className={`font-display block truncate leading-tight ${plain ? 'text-[1.7rem]' : 'text-[1.3rem]'}`}>{title}</span>
          {sub ? <span className="block truncate text-[0.92rem] text-(--text-muted)">{sub}</span> : null}
        </span>
        <ChevronRight size={22} className="shrink-0 text-(--text-faint)" aria-hidden />
      </button>
      {/* Scrolls (wheel, finger, mouse drag — see dragScroll.ts) with a soft
          fade at the foot; owner, 2026-11-13: the pets / lists cards had more
          than they showed and nothing moved. */}
      <div className="casa-fadeout relative min-h-0 flex-1">
        <div className="casa-scroll h-full px-2 pb-6">{children}</div>
      </div>
    </section>
  )
}

function Round({ on, g, disabled }: { on: boolean; g: readonly string[]; disabled?: boolean }) {
  return (
    <span
      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-[2.5px]"
      style={{
        borderColor: on ? 'transparent' : disabled ? 'var(--surface)' : 'var(--surface-2)',
        background: on ? grad(g) : 'transparent',
        transition: 'background .25s, border-color .25s',
      }}
    >
      {on ? <Check size={17} strokeWidth={3.2} color="#fff" className="casa-pop" aria-hidden /> : null}
    </span>
  )
}

function Quiet({ children }: { children: ReactNode }) {
  return <p className="px-3 py-2 text-[1rem] text-(--text-muted)">{children}</p>
}

// ── calendar ─────────────────────────────────────────────────────────────────

function Who({ email, members }: { email: string | null; members: Member[] }) {
  const m = email ? members.find((x) => x.email === email) : null
  if (!m) return null
  return <Avatar m={m} size={28} />
}

function EventRow({ o, members, now, isToday, label }: { o: Occurrence; members: Member[]; now?: number; isToday: boolean; label?: string }) {
  const { t } = useI18n()
  const ev = o.event
  const live = isToday && !ev.all_day && now != null && minutesOf(ev.start_time) <= now && minutesOf(ev.end_time ?? ev.start_time) > now
  return (
    <li className="flex items-center gap-3 rounded-[16px] px-3 py-2" style={live ? { background: `${GRAD.calendar[0]}1A` } : undefined}>
      <span className="w-[3.8rem] shrink-0 text-[1rem] font-semibold tabular-nums" style={{ color: isToday ? GRAD.calendar[1] : 'var(--text-muted)' }}>
        {label ?? (ev.all_day ? t('casa.cal.allDayShort') : ev.start_time?.slice(0, 5))}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[1.05rem] leading-snug">
          {KIND_EMOJI[ev.kind] ? `${KIND_EMOJI[ev.kind]} ` : ''}
          {ev.title}
        </span>
        {live || ev.location ? (
          <span className="block truncate text-[0.85rem] text-(--text-muted)">
            {live ? <span className="font-semibold" style={{ color: GRAD.calendar[1] }}>{t('casa.cal.nowCap')}</span> : null}
            {live && ev.location ? ' · ' : ''}
            {ev.location}
          </span>
        ) : null}
      </span>
      <Who email={ev.owner_email} members={members} />
    </li>
  )
}

export function CalendarPreview({ data, today, now, big = false }: { data: HubData; today: string; now: Date; big?: boolean }) {
  const { t, lang } = useI18n()
  const mins = now.getHours() * 60 + now.getMinutes()
  const days = useMemo(() => agenda(data.events, today, 15), [data.events, today])
  const rest = (days.get(today) ?? []).filter((o) => o.event.all_day || minutesOf(o.event.end_time ?? o.event.start_time) > mins)
  const tmr = days.get(addDays(today, 1)) ?? []
  const later = !tmr.length ? [...days.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).find(([d, l]) => d > addDays(today, 1) && l.length) : undefined
  const after = big
    ? [...days.entries()]
        .filter(([d]) => d > addDays(today, 1))
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .flatMap(([d, l]) => l.map((o) => ({ d, o })))
        .slice(0, 8)
    : []
  const head = (label: string) => <p className="px-3 pt-2 pb-1 text-[0.8rem] font-semibold uppercase tracking-[0.14em] text-(--text-faint)">{label}</p>
  return (
    <>
      {head(t('casa.when.todayCap'))}
      {rest.length ? (
        <ul>
          {rest.slice(0, big ? 8 : 5).map((o) => (
            <EventRow key={`${o.event.id}-${o.start}`} o={o} members={data.members} now={mins} isToday />
          ))}
        </ul>
      ) : (
        <Quiet>{t('casa.cal.nothingMore')}</Quiet>
      )}
      {head(t('casa.when.tomorrowCap'))}
      {tmr.length ? (
        <ul>
          {tmr.slice(0, big ? 6 : 3).map((o) => (
            <EventRow key={`${o.event.id}-${o.start}`} o={o} members={data.members} isToday={false} />
          ))}
        </ul>
      ) : (
        <Quiet>
          {later
            ? t('casa.cal.nextOn', {
                title: later[1][0].event.title,
                day: new Date(later[0] + 'T12:00').toLocaleDateString(LOCALE[lang], { weekday: 'long', day: 'numeric' }),
              })
            : t('casa.cal.freeTomorrowCap')}
        </Quiet>
      )}
      {after.length && tmr.length ? (
        <>
          {head(t('casa.cal.nextDays'))}
          <ul>
            {after.map(({ d, o }) => (
              <EventRow
                key={`${o.event.id}-${d}`}
                o={o}
                members={data.members}
                isToday={false}
                label={`${new Date(d + 'T12:00').toLocaleDateString(LOCALE[lang], { weekday: 'short' }).replace('.', '')} ${Number(d.slice(8))}`}
              />
            ))}
          </ul>
        </>
      ) : null}
    </>
  )
}

export function calendarSub(data: HubData, today: string, now: Date, t: ReturnType<typeof useI18n>['t']): string {
  const mins = now.getHours() * 60 + now.getMinutes()
  const n = (agenda(data.events, today, 1).get(today) ?? []).filter((o) => o.event.all_day || minutesOf(o.event.end_time ?? o.event.start_time) > mins).length
  return n ? t('casa.cal.leftToday', { count: n }) : t('casa.cal.nothingMore')
}

// ── lists ────────────────────────────────────────────────────────────────────

export function ListsPreview({ data, full, refresh, big = false }: { data: HubData; full: boolean; refresh: () => void; big?: boolean }) {
  const { t } = useI18n()
  const [gone, setGone] = useState<Set<string>>(new Set())
  const [ticking, setTicking] = useState<Set<string>>(new Set())
  // Server truth wins once it lands.
  useEffect(() => setGone(new Set()), [data.open])
  const open = data.open.filter((i) => !gone.has(i.id))
  const valid = new Set(data.stores.map((s) => s.id))
  const groups: { id: string; name: string; slug: string | null; items: ShoppingItem[] }[] = []
  const general = open.filter((i) => !i.store_id || !valid.has(i.store_id))
  if (general.length) groups.push({ id: 'general', name: t('casa.list.general'), slug: null, items: general })
  for (const s of data.stores) {
    const items = open.filter((i) => i.store_id === s.id)
    if (items.length) groups.push({ id: s.id, name: s.name, slug: s.slug, items })
  }
  const per = big ? 6 : groups.length > 2 ? 2 : 3

  async function toggle(item: ShoppingItem) {
    if (!full || ticking.has(item.id)) return
    tick()
    setTicking((s) => new Set(s).add(item.id))
    await new Promise((r) => setTimeout(r, 480))
    setGone((s) => new Set(s).add(item.id))
    setTicking((s) => {
      const n = new Set(s)
      n.delete(item.id)
      return n
    })
    try {
      await setChecked([item.id], true)
    } finally {
      refresh()
    }
  }

  if (!groups.length) return <Quiet>{t('casa.lists.allDone')} ✓</Quiet>
  return (
    <div className={big ? 'grid gap-x-3 landscape:grid-cols-2' : ''}>
      {groups.slice(0, big ? 12 : 3).map((g) => (
        <div key={g.id} className="mb-1">
          <p className="flex items-center gap-2 px-3 pt-2 pb-0.5">
            <StoreLogo slug={g.slug} name={g.name} size={22} />
            <span className="min-w-0 truncate text-[0.82rem] font-semibold uppercase tracking-[0.12em] text-(--text-muted)">{g.name}</span>
            <span className="shrink-0 rounded-full bg-(--surface) px-1.5 text-[0.78rem] font-semibold text-(--text-muted)">{g.items.length}</span>
          </p>
          <ul>
            {g.items.slice(0, per).map((it) => {
              const on = ticking.has(it.id)
              return (
                <li key={it.id}>
                  <button
                    onClick={() => void toggle(it)}
                    disabled={!full}
                    data-noswipe
                    className="casa-press flex w-full items-center gap-3 rounded-[14px] px-3 py-1.5 text-left disabled:cursor-default"
                  >
                    <Round on={on} g={GRAD.lists} disabled={!full} />
                    <span
                      className={`casa-strike min-w-0 flex-1 truncate text-[1.05rem] ${on ? 'text-(--text-muted)' : ''}`}
                      style={{ backgroundSize: on ? '100% 2px' : '0% 2px' }}
                    >
                      {it.label}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
          {g.items.length > per ? <p className="px-3 pb-1 pl-[3.55rem] text-[0.88rem] text-(--text-faint)">{t('casa.more', { count: g.items.length - per })}</p> : null}
        </div>
      ))}
    </div>
  )
}

// ── pets ─────────────────────────────────────────────────────────────────────
// Grouped BY PET: today's work first — the daily routine in time order
// (migration 107), then routines / reminders due today — and THEN, under a
// faint rule and a red "Overdue" title, what's late, each with its days late
// (owner, 2026-11-13: the late items were mixed in above the routine). The layout follows the number of pets:
// 1 → the full list; 2–3 → a section per pet (columns in the big widget);
// 4+ → a compact card per pet (progress + the next thing to do), tap to open.

interface PetRow {
  key: string
  title: string
  sub?: string
  late?: boolean
  taskId?: string
  icon?: string
  /** "08:00" — a routine item's time of day. */
  time?: string
  done: boolean
}

export interface PetGroup {
  pet: HubData['pets'][number]
  /** Today's work, in order. */
  rows: PetRow[]
  /** Late things, shown apart under "Overdue". */
  late: PetRow[]
  doneCount: number
  total: number
}

export function petGroups(data: HubData, done: PetTaskDone[], today: string, t: ReturnType<typeof useI18n>['t']): PetGroup[] {
  const doneToday = new Set(done.filter((d) => d.done_on === today).map((d) => d.task_id))
  return data.pets.map((pet) => {
    const late: PetRow[] = []
    const daily: PetRow[] = []
    const dueToday: PetRow[] = []
    for (const e of overdueEvents(data.petEvents, today).filter((x) => x.pet_id === pet.id)) {
      const days = daysLate(e.next_due as string, today)
      const isLate = days > 0
      ;(isLate ? late : dueToday).push({ key: `e-${e.id}`, title: `🩺 ${e.title}`, sub: isLate ? t('casa.pets.late', { count: days }) : t('casa.pets.dueToday'), late: isLate, done: false })
    }
    for (const r of routineStatus(data.tasks, data.done, pet.id, today)) {
      if (!r.lastDone || r.dueIn > 0) continue
      const row: PetRow = {
        key: `i-${r.task.id}`,
        title: r.task.title,
        sub: r.dueIn < 0 ? t('casa.pets.late', { count: -r.dueIn }) : t('casa.pets.dueToday'),
        late: r.dueIn < 0,
        taskId: r.task.id,
        icon: r.task.icon,
        done: doneToday.has(r.task.id),
      }
      ;(r.dueIn < 0 ? late : dueToday).push(row)
    }
    for (const r of dailyChecklist(data.tasks, done, pet.id, today)) {
      daily.push({ key: `d-${r.task.id}`, title: r.task.title, taskId: r.task.id, icon: r.task.icon, time: taskTime(r.task) ?? undefined, done: !!r.done })
    }
    const rows = [...daily, ...dueToday]
    const counted = [...rows, ...late].filter((r) => r.taskId)
    return { pet, rows, late, doneCount: counted.filter((r) => r.done).length, total: counted.length }
  })
}

/** Everything still to do today, across pets (the hub's subtitle). */
export function petsLeftCount(data: HubData, today: string, t: ReturnType<typeof useI18n>['t']): number {
  return petGroups(data, data.done, today, t).reduce((n, g) => n + [...g.rows, ...g.late].filter((r) => !r.done).length, 0)
}

function PetFace({ pet, size = 36 }: { pet: HubData['pets'][number]; size?: number }) {
  const tint = pet.tag_color ?? GRAD.pets[0]
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full"
      style={{ width: `${size / 16}rem`, height: `${size / 16}rem`, fontSize: `${(size * 0.5) / 16}rem`, background: pet.photo ? undefined : `${tint}2E`, boxShadow: `0 0 0 2px ${tint}` }}
    >
      {pet.photo ? <img src={pet.photo} alt="" className="h-full w-full object-cover" draggable={false} /> : pet.emoji}
    </span>
  )
}

function Progress({ done, total }: { done: number; total: number }) {
  const pct = total ? (done / total) * 100 : 100
  return (
    <span className="block h-1.5 w-full overflow-hidden rounded-full bg-(--surface-2)">
      <span className="block h-full rounded-full" style={{ width: `${pct}%`, background: grad(GRAD.pets), transition: 'width .5s cubic-bezier(.2,.8,.2,1)' }} />
    </span>
  )
}

function PetHead({ g }: { g: PetGroup }) {
  const { t } = useI18n()
  return (
    <div className="flex items-center gap-3 px-3 pt-2 pb-1.5">
      <PetFace pet={g.pet} />
      <span className="min-w-0 flex-1">
        <span className="font-display block truncate text-[1.15rem] leading-tight">{g.pet.name}</span>
        {g.total ? (
          <span className="mt-1 flex items-center gap-2">
            <span className="w-16 shrink-0">
              <Progress done={g.doneCount} total={g.total} />
            </span>
            <span className="truncate text-[0.85rem] text-(--text-muted)">{t('casa.pets.progress', { done: g.doneCount, total: g.total })}</span>
          </span>
        ) : null}
      </span>
    </div>
  )
}

function PetRowButton({ r, full, onToggle }: { r: PetRow; full: boolean; onToggle: (r: PetRow) => void }) {
  const Icon = (r.icon && CARE_ICONS[r.icon as keyof typeof CARE_ICONS]) || PawPrint
  return (
    <li>
      <button
        onClick={() => onToggle(r)}
        disabled={!full || !r.taskId}
        data-noswipe
        className="casa-press flex min-h-11 w-full items-center gap-3 rounded-[14px] px-3 py-1 text-left disabled:cursor-default"
        style={r.late && !r.done ? { background: 'color-mix(in srgb, var(--expense) 9%, transparent)' } : undefined}
      >
        <span className="inline-flex w-6 shrink-0 justify-center text-(--text-muted)">
          <Icon size={20} strokeWidth={2} aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className={`block truncate text-[1.02rem] ${r.done ? 'text-(--text-muted) line-through decoration-2' : ''}`}>{r.title}</span>
          {r.sub ? <span className={`block truncate text-[0.85rem] ${r.late ? 'font-semibold text-(--expense)' : 'text-(--text-faint)'}`}>{r.sub}</span> : null}
        </span>
        {r.time ? <span className={`shrink-0 text-[0.92rem] font-semibold tabular-nums ${r.done ? 'text-(--text-faint)' : 'text-(--text-muted)'}`}>{r.time}</span> : null}
        {r.taskId ? <Round on={r.done} g={GRAD.pets} disabled={!full} /> : null}
      </button>
    </li>
  )
}

/** Days from a due date to today (0 = due today). */
function daysLate(due: string, today: string): number {
  const [ay, am, ad] = due.split('-').map(Number)
  const [by, bm, bd] = today.split('-').map(Number)
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000)
}

/** The faint rule + red "Overdue" title, then the late rows. */
function LateBlock({ rows, full, onToggle, cols }: { rows: PetRow[]; full: boolean; onToggle: (r: PetRow) => void; cols?: string }) {
  const { t } = useI18n()
  if (!rows.length) return null
  return (
    <>
      <div className="mx-3 mt-2 mb-1 h-px bg-(--border) opacity-70" aria-hidden />
      <p className="px-3 pt-1 pb-0.5 text-[0.78rem] font-semibold tracking-[0.14em] text-(--expense) uppercase">{t('casa.pets.lateTitle')}</p>
      <ul className={cols ?? ''}>
        {rows.map((r) => (
          <PetRowButton key={r.key} r={r} full={full} onToggle={onToggle} />
        ))}
      </ul>
    </>
  )
}

export function PetsPreview({
  data,
  today,
  full,
  refresh,
  big = false,
  onOpen,
}: {
  data: HubData
  today: string
  full: boolean
  refresh: () => void
  big?: boolean
  /** Tap a compact pet card (4+ pets) → the Pets panel. */
  onOpen?: (el: HTMLElement) => void
}) {
  const { t } = useI18n()
  const [done, setDone] = useState<PetTaskDone[]>(data.done)
  useEffect(() => setDone(data.done), [data.done])
  const groups = petGroups(data, done, today, t)

  async function toggle(r: PetRow) {
    if (!full || !r.taskId) return
    tick()
    const id = r.taskId
    setDone((l) =>
      r.done
        ? l.filter((d) => !(d.task_id === id && d.done_on === today))
        : [{ id: `tmp-${id}`, task_id: id, done_on: today, done_by: '', created_at: new Date().toISOString() }, ...l],
    )
    try {
      await petTaskDone(id, today, !r.done)
    } finally {
      refresh()
    }
  }

  if (!data.pets.length) return <Quiet>{t('casa.pets.none')}</Quiet>
  const n = groups.length

  // 4+ pets: a compact card each — face, name, progress, the next thing to do.
  if (n >= 4) {
    return (
      <ul className="grid gap-2 px-1 pt-1 [grid-template-columns:repeat(auto-fill,minmax(min(13rem,100%),1fr))]">
        {groups.map((g) => {
          // The big widget has room for the next few; a card shows the next one.
          const todo = [...g.rows, ...g.late].filter((r) => !r.done).slice(0, big ? 3 : 1)
          const next = todo[0]
          return (
            <li key={g.pet.id} className="rounded-[18px] bg-(--surface)/70">
              <button onClick={(e) => onOpen?.(e.currentTarget)} data-noswipe className="casa-press flex w-full items-center gap-3 px-3 pt-2.5 pb-1 text-left">
                <PetFace pet={g.pet} size={34} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-2">
                    <span className="font-display min-w-0 flex-1 truncate text-[1.08rem]">{g.pet.name}</span>
                    {g.total ? <span className="shrink-0 text-[0.85rem] font-semibold text-(--text-muted) tabular-nums">{g.doneCount}/{g.total}</span> : null}
                  </span>
                  <span className="mt-1 block">
                    <Progress done={g.doneCount} total={g.total} />
                  </span>
                </span>
              </button>
              {next ? (
                <ul className="px-0.5 pb-1">
                  {todo.map((r, k) => (
                    <PetRowButton key={r.key} r={k ? r : { ...r, title: t('casa.pets.next', { title: r.title }) }} full={full} onToggle={() => void toggle(r)} />
                  ))}
                </ul>
              ) : (
                <p className="px-3 pb-2.5 text-[0.9rem] text-(--text-muted)">✓ {t('casa.pets.allDoneShort')}</p>
              )}
            </li>
          )
        })}
      </ul>
    )
  }

  // 1–3 pets: a section per pet with its rows (side by side in the big widget).
  const cols = big && n > 1 ? (n === 2 ? 'landscape:grid-cols-2' : 'landscape:grid-cols-3') : ''
  return (
    <div className={`grid gap-x-4 gap-y-1 ${cols}`}>
      {groups.map((g) => (
        <section key={g.pet.id} className="min-w-0">
          <PetHead g={g} />
          {g.rows.length ? (
            <ul className={big && n === 1 ? 'grid gap-x-3 landscape:grid-cols-2' : ''}>
              {g.rows.map((r) => (
                <PetRowButton key={r.key} r={r} full={full} onToggle={(x) => void toggle(x)} />
              ))}
            </ul>
          ) : g.late.length ? null : (
            <Quiet>{t('casa.pets.nothing')}</Quiet>
          )}
          <LateBlock rows={g.late} full={full} onToggle={(x) => void toggle(x)} cols={big && n === 1 ? 'grid gap-x-3 landscape:grid-cols-2' : undefined} />
        </section>
      ))}
    </div>
  )
}

// ── money (widget page) ──────────────────────────────────────────────────────

export function MoneyWidget({ state, onOpen }: { state: 'plus' | 'pin' | 'open'; onOpen: (el: HTMLElement) => void }) {
  const { t } = useI18n()
  return (
    <div className="casa-scroll h-full">
    <div className="casa-fade flex min-h-full flex-col items-center justify-center px-6 py-3 text-center">
      <span className="relative inline-flex h-[clamp(4.5rem,15dvh,7rem)] w-[clamp(4.5rem,15dvh,7rem)] shrink-0 items-center justify-center rounded-[30%]" style={{ background: grad(GRAD.money), boxShadow: `0 24px 60px -24px ${GRAD.money[1]}` }}>
        <Wallet className="h-1/2 w-1/2" color="#fff" strokeWidth={1.9} aria-hidden />
        {state !== 'open' ? (
          <span className="absolute -right-2 -bottom-2 inline-flex h-11 w-11 items-center justify-center rounded-full bg-(--card) shadow-lg">
            <Lock size={20} strokeWidth={2.6} className="text-(--text-muted)" aria-hidden />
          </span>
        ) : null}
      </span>
      <p className="font-display mt-[clamp(10px,3dvh,28px)] text-[clamp(1.6rem,5dvh,2.2rem)] leading-tight">{t('app.budget.name')}</p>
      <p className="mt-2 max-w-[36ch] text-[1.05rem] text-(--text-muted)">
        {state === 'plus' ? t('casa.plan.noPlus') : state === 'pin' ? t('casa.money.pinSub') : t('casa.money.thisPeriod')}
      </p>
      {state === 'plus' ? (
        <span className="mt-[clamp(8px,2.4dvh,24px)]">
          <PlusTag label="Plus" />
        </span>
      ) : null}
      <button
        onClick={(e) => onOpen(e.currentTarget)}
        data-noswipe
        className="casa-press mt-[clamp(10px,3dvh,28px)] inline-flex h-14 shrink-0 items-center gap-3 rounded-full px-7 text-[1.15rem] sm:h-16 font-semibold text-white"
        style={{ background: grad(GRAD.money) }}
      >
        {state === 'pin' ? <KeyRound size={22} aria-hidden /> : null}
        {state === 'pin' ? t('casa.money.unlock') : state === 'plus' ? t('casa.plan.see') : t('casa.money.open')}
      </button>
    </div>
    </div>
  )
}
