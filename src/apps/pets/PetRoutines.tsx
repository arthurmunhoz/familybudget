// Routine-first Pet Care sections for the selected pet — the web port of the
// iOS redesign (migration 069). Three cards:
//   • Daily routine — a checklist that resets each day; ← → browse past days.
//   • Care routines — interval tasks (bath every 21d…) with their due state.
//   • Weight log — a simple per-pet weight history.
//
// Self-contained on purpose: it owns its own cached query keyed on the pet, so
// the (large, calendar-first) PetCare screen only has to render <PetRoutines/>.
// The iOS screen replaced its calendar with these; here they sit ABOVE the
// existing calendar + reminders, which the web has and iOS dropped.
import { useMemo, useState } from 'react'
import { Check, ChevronLeft, ChevronRight, Pencil, Plus, Scale, Trash2 } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { useCachedQuery } from '../../hooks/useCachedQuery'
import { useI18n } from '../../hooks/useI18n'
import { addDaysISO, formatDay, shortName, todayISO } from '../../lib/format'
import { dailyChecklist, routineStatus } from '../../lib/petCare'
import { supabase } from '../../lib/supabase'
import type { Pet, PetCareTask, PetTaskDone, PetWeight } from '../../lib/types'
import { CARE_ICONS } from './careIcons'
import RoutineSheet from './RoutineSheet'

type Data = { tasks: PetCareTask[]; done: PetTaskDone[]; weights: PetWeight[] }
const EMPTY: Data = { tasks: [], done: [], weights: [] }

export default function PetRoutines({ pet }: { pet: Pet }) {
  const { t } = useI18n()
  const { profiles } = useAuth()
  const today = todayISO()
  const [day, setDay] = useState(today)
  const [routineOpen, setRoutineOpen] = useState<'daily' | 'interval' | null>(null)
  // Optimistic overlay for checklist taps, keyed by task id, so a tick responds
  // instantly instead of waiting on the round-trip + refetch.
  const [overlay, setOverlay] = useState<Record<string, boolean>>({})
  const [weightOpen, setWeightOpen] = useState(false)
  const [weightVal, setWeightVal] = useState('')
  const [busy, setBusy] = useState(false)

  const { data = EMPTY, revalidate } = useCachedQuery<Data>(`petRoutines:${pet.id}`, async () => {
    const [tasksRes, doneRes, weightsRes] = await Promise.all([
      supabase.from('pet_care_tasks').select('*').eq('pet_id', pet.id).order('sort_order'),
      // 370d back covers the longest sane interval (yearly) for the due math.
      supabase
        .from('pet_task_done')
        .select('*')
        .gte('done_on', addDaysISO(todayISO(), -370)),
      supabase
        .from('pet_weights')
        .select('*')
        .eq('pet_id', pet.id)
        .order('measured_on', { ascending: false }),
    ])
    return {
      tasks: (tasksRes.data ?? []) as PetCareTask[],
      done: (doneRes.data ?? []) as PetTaskDone[],
      weights: (weightsRes.data ?? []) as PetWeight[],
    }
  })

  const checklist = useMemo(
    () => dailyChecklist(data.tasks, data.done, pet.id, day),
    [data.tasks, data.done, pet.id, day],
  )
  const routines = useMemo(
    () => routineStatus(data.tasks, data.done, pet.id, today),
    [data.tasks, data.done, pet.id, today],
  )

  const nameFor = (email: string) =>
    shortName(profiles.find((p) => p.email === email)?.display_name ?? email)

  /** Tick / untick one task for the shown day. unique(task_id, done_on) makes the
   *  insert idempotent and lets undo be a plain delete. */
  async function toggle(task: PetCareTask, done: PetTaskDone | null) {
    const next = !(overlay[task.id] ?? Boolean(done))
    setOverlay((prev) => ({ ...prev, [task.id]: next }))
    if (next) {
      await supabase.from('pet_task_done').insert({ task_id: task.id, done_on: day })
    } else {
      await supabase.from('pet_task_done').delete().eq('task_id', task.id).eq('done_on', day)
    }
    await revalidate()
    // Drop this task's optimistic entry now that real data has landed.
    setOverlay((prev) => {
      if (!(task.id in prev)) return prev
      const next = { ...prev }
      delete next[task.id]
      return next
    })
  }

  /** Log an interval routine as done TODAY — that rolls its next due date. */
  async function logRoutine(task: PetCareTask) {
    if (busy) return
    setBusy(true)
    await supabase.from('pet_task_done').insert({ task_id: task.id, done_on: today })
    setBusy(false)
    await revalidate()
  }

  async function addWeight() {
    const w = parseFloat(weightVal.replace(',', '.'))
    if (!Number.isFinite(w) || w <= 0 || busy) return
    setBusy(true)
    await supabase.from('pet_weights').insert({ pet_id: pet.id, weight: w, measured_on: today })
    setBusy(false)
    setWeightVal('')
    setWeightOpen(false)
    await revalidate()
  }

  async function removeWeight(id: string) {
    if (busy) return
    setBusy(true)
    await supabase.from('pet_weights').delete().eq('id', id)
    setBusy(false)
    await revalidate()
  }

  const doneCount = checklist.filter((c) => overlay[c.task.id] ?? Boolean(c.done)).length
  const allDone = checklist.length > 0 && doneCount === checklist.length

  return (
    <>
      {/* ── Daily routine ─────────────────────────────────────────────────── */}
      <section className="mt-4 rounded-2xl bg-(--card) p-4">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-base font-bold text-(--text)">
            {t('petcare.dailyRoutine')}
          </h3>
          <button
            onClick={() => setRoutineOpen('daily')}
            aria-label={t('petcare.editRoutine')}
            className="p-1 text-(--text-muted) active:text-(--text)"
          >
            <Pencil size={16} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>

        {/* Day browser — today by default, chevrons walk backwards. */}
        <div className="mt-2 flex items-center justify-between rounded-xl bg-(--surface) px-2 py-1.5">
          <button
            onClick={() => setDay((d) => addDaysISO(d, -1))}
            aria-label={t('petcare.prevDay')}
            className="p-1 text-(--text-muted) active:text-(--text)"
          >
            <ChevronLeft size={18} strokeWidth={2} aria-hidden="true" />
          </button>
          <span className="text-sm font-semibold text-(--text)">
            {day === today ? t('petcare.today') : formatDay(day)}
          </span>
          <button
            onClick={() => setDay((d) => addDaysISO(d, 1))}
            disabled={day >= today}
            aria-label={t('petcare.nextDay')}
            className="p-1 text-(--text-muted) active:text-(--text) disabled:opacity-30"
          >
            <ChevronRight size={18} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>

        {checklist.length === 0 ? (
          <div className="mt-3 text-center">
            <p className="text-sm text-(--text-muted)">{t('petcare.noDaily')}</p>
            <button
              onClick={() => setRoutineOpen('daily')}
              className="mt-2 rounded-xl bg-(--surface) px-4 py-2 text-sm font-semibold text-(--text)"
            >
              {t('petcare.editRoutine')}
            </button>
          </div>
        ) : (
          <>
            {allDone && (
              <p className="mt-3 rounded-xl bg-(--income)/15 px-3 py-2 text-center text-sm font-semibold text-(--income)">
                {t('petcare.allDoneToday')}
              </p>
            )}
            <ul className="mt-2 space-y-1.5">
              {checklist.map(({ task, done }) => {
                const on = overlay[task.id] ?? Boolean(done)
                const Glyph = CARE_ICONS[task.icon] ?? CARE_ICONS.paw
                return (
                  <li key={task.id}>
                    <button
                      onClick={() => void toggle(task, done)}
                      className="flex w-full items-center gap-2.5 rounded-xl bg-(--surface) px-3 py-2.5 text-left"
                    >
                      <span
                        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
                          on ? 'bg-(--income) text-white' : 'bg-(--card) text-(--text-muted)'
                        }`}
                      >
                        {on ? (
                          <Check size={15} strokeWidth={3} aria-hidden="true" />
                        ) : (
                          <Glyph size={15} strokeWidth={2} aria-hidden="true" />
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span
                          className={`block truncate text-sm font-medium ${
                            on ? 'text-(--text-faint) line-through' : 'text-(--text)'
                          }`}
                        >
                          {task.title}
                        </span>
                        {/* Who fed the dog — the point of a shared checklist. */}
                        {on && done && (
                          <span className="block text-[11px] text-(--text-faint)">
                            {nameFor(done.done_by)}
                          </span>
                        )}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </>
        )}
      </section>

      {/* ── Care routines (interval) ──────────────────────────────────────── */}
      <section className="mt-3 rounded-2xl bg-(--card) p-4">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-base font-bold text-(--text)">
            {t('petcare.routines')}
          </h3>
          <button
            onClick={() => setRoutineOpen('interval')}
            aria-label={t('petcare.editRoutine')}
            className="p-1 text-(--text-muted) active:text-(--text)"
          >
            <Pencil size={16} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>

        {routines.length === 0 ? (
          <div className="mt-3 text-center">
            <p className="text-sm text-(--text-muted)">{t('petcare.noRoutines')}</p>
            <button
              onClick={() => setRoutineOpen('interval')}
              className="mt-2 rounded-xl bg-(--surface) px-4 py-2 text-sm font-semibold text-(--text)"
            >
              {t('petcare.editRoutine')}
            </button>
          </div>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {routines.map(({ task, lastDone, dueIn }) => {
              const Glyph = CARE_ICONS[task.icon] ?? CARE_ICONS.paw
              const overdue = dueIn <= 0
              return (
                <li
                  key={task.id}
                  className="flex items-center gap-2.5 rounded-xl bg-(--surface) px-3 py-2.5"
                >
                  <span
                    className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
                      overdue ? 'bg-(--expense)/15 text-(--expense)' : 'bg-(--card) text-(--text-muted)'
                    }`}
                  >
                    <Glyph size={15} strokeWidth={2} aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-(--text)">
                      {task.title}
                    </span>
                    <span className="block text-[11px] text-(--text-faint)">
                      {t('petcare.every', { days: task.interval_days ?? 0 })}
                      {lastDone ? ` · ${formatDay(lastDone)}` : ''}
                    </span>
                  </span>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                      overdue
                        ? 'bg-(--expense) text-white'
                        : 'bg-(--card) text-(--text-muted)'
                    }`}
                  >
                    {overdue ? t('petcare.dueNow') : t('petcare.inDays', { days: dueIn })}
                  </span>
                  <button
                    onClick={() => void logRoutine(task)}
                    disabled={busy}
                    aria-label={t('petcare.markDone')}
                    className="shrink-0 rounded-full bg-(--accent) p-1.5 text-white disabled:opacity-50"
                  >
                    <Check size={13} strokeWidth={3} aria-hidden="true" />
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {/* ── Weight log ────────────────────────────────────────────────────── */}
      <section className="mt-3 rounded-2xl bg-(--card) p-4">
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-1.5 font-display text-base font-bold text-(--text)">
            <Scale size={15} strokeWidth={2} aria-hidden="true" />
            {t('petcare.weightLog')}
          </h3>
          <button
            onClick={() => setWeightOpen((o) => !o)}
            aria-label={t('petcare.addWeight')}
            className="p-1 text-(--text-muted) active:text-(--text)"
          >
            <Plus size={16} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>

        {weightOpen && (
          <div className="mt-2 flex gap-2">
            <input
              value={weightVal}
              onChange={(e) => setWeightVal(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void addWeight()}
              placeholder={t('petcare.weightHint')}
              inputMode="decimal"
              autoFocus
              className="min-w-0 flex-1 rounded-xl bg-(--surface) px-3 py-2.5 text-base text-(--text) outline-none focus:ring-2 focus:ring-(--accent)"
            />
            <button
              onClick={() => void addWeight()}
              disabled={busy || !weightVal.trim()}
              className="rounded-xl bg-(--accent) px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
            >
              {t('common.add')}
            </button>
          </div>
        )}

        {data.weights.length === 0 ? (
          <p className="mt-2 text-sm text-(--text-faint)">{t('petcare.noWeights')}</p>
        ) : (
          <ul className="mt-2 space-y-1">
            {data.weights.slice(0, 6).map((w) => (
              <li
                key={w.id}
                className="flex items-center gap-2 rounded-lg bg-(--surface) px-3 py-2 text-sm"
              >
                <span className="font-semibold text-(--text)">{w.weight}</span>
                <span className="flex-1 text-xs text-(--text-faint)">
                  {formatDay(w.measured_on)} · {nameFor(w.added_by)}
                </span>
                <button
                  onClick={() => void removeWeight(w.id)}
                  disabled={busy}
                  aria-label={t('common.remove')}
                  className="p-0.5 text-(--text-faint) active:text-(--expense) disabled:opacity-50"
                >
                  <Trash2 size={14} strokeWidth={2} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {routineOpen && (
        <RoutineSheet
          pet={pet}
          kind={routineOpen}
          tasks={data.tasks}
          onClose={() => setRoutineOpen(null)}
          onChanged={() => void revalidate()}
        />
      )}
    </>
  )
}
