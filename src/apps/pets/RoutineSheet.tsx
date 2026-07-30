// Routine editor for one pet — the web port of the iOS RoutineSheet
// (mobile/src/apps/pets/RoutineSheet.tsx). Same tables (migration 069), same
// species-template seeding, same semantics.
//
// Opened per GROUP: the Daily-routine pencil edits kind='daily', the Care-routines
// pencil edits kind='interval'. `sort_order` drives daily order (and, on iOS, the
// widget's "next undone task"), so reorder writes it back for every row.
import { useMemo, useState } from 'react'
import { ChevronDown, ChevronUp, Plus, Trash2, X } from 'lucide-react'
import { useI18n } from '../../hooks/useI18n'
import { useScrollLock } from '../../hooks/useScrollLock'
import { templateTasks } from '../../lib/petCare'
import { supabase } from '../../lib/supabase'
import type { Pet, PetCareTask, PetTaskIcon } from '../../lib/types'
import type { TKey } from '../../lib/i18n'
import { CARE_ICON_IDS, CARE_ICONS } from './careIcons'

export default function RoutineSheet({
  pet,
  kind,
  tasks,
  onClose,
  onChanged,
}: {
  pet: Pet
  /** Which group this sheet edits — each pencil opens only its own. */
  kind: 'daily' | 'interval'
  /** All tasks for this pet (both kinds); we filter to `kind` here. */
  tasks: PetCareTask[]
  onClose: () => void
  onChanged: () => void
}) {
  const { t } = useI18n()
  useScrollLock(true)
  const [editing, setEditing] = useState<PetCareTask | 'new' | null>(null)
  const [title, setTitle] = useState('')
  const [icon, setIcon] = useState<PetTaskIcon>('paw')
  const [intervalDays, setIntervalDays] = useState('7')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const mine = useMemo(
    () =>
      tasks
        .filter((tk) => tk.pet_id === pet.id && tk.kind === kind)
        .sort((a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at)),
    [tasks, pet.id, kind],
  )

  function openNew() {
    setEditing('new')
    setTitle('')
    setIcon(kind === 'daily' ? 'bowl' : 'pill')
    setIntervalDays('7')
    setError(null)
  }

  function openEdit(task: PetCareTask) {
    setEditing(task)
    setTitle(task.title)
    setIcon(task.icon)
    setIntervalDays(String(task.interval_days ?? 7))
    setError(null)
  }

  async function save() {
    const name = title.trim()
    if (!name || busy) return
    const days = Math.max(1, parseInt(intervalDays, 10) || 7)
    setBusy(true)
    setError(null)
    const fields = {
      title: name,
      icon,
      kind,
      interval_days: kind === 'interval' ? days : null,
    }
    const { error: err } =
      editing === 'new'
        ? await supabase
            .from('pet_care_tasks')
            .insert({ ...fields, pet_id: pet.id, sort_order: mine.length })
        : await supabase
            .from('pet_care_tasks')
            .update(fields)
            .eq('id', (editing as PetCareTask).id)
    setBusy(false)
    if (err) {
      setError(t('petcare.saveTaskFailed'))
      return
    }
    setEditing(null)
    onChanged()
  }

  async function remove(task: PetCareTask) {
    if (!confirm(t('petcare.deleteTaskConfirm', { title: task.title })) || busy) return
    setBusy(true)
    const { error: err } = await supabase.from('pet_care_tasks').delete().eq('id', task.id)
    setBusy(false)
    if (err) {
      setError(t('petcare.saveTaskFailed'))
      return
    }
    onChanged()
  }

  /** Move one row and renumber every sibling — sort_order has to stay dense. */
  async function move(index: number, delta: number) {
    const next = [...mine]
    const target = index + delta
    if (target < 0 || target >= next.length || busy) return
    const [row] = next.splice(index, 1)
    next.splice(target, 0, row)
    setBusy(true)
    await Promise.all(
      next.map((tk, i) => supabase.from('pet_care_tasks').update({ sort_order: i }).eq('id', tk.id)),
    )
    setBusy(false)
    onChanged()
  }

  /** Seed the species template. Titles are i18n keys, resolved before insert. */
  async function seedTemplate() {
    if (busy) return
    setBusy(true)
    setError(null)
    const rows = templateTasks(pet.species)
      .filter((tpl) => tpl.kind === kind)
      .map((tpl, i) => ({
        pet_id: pet.id,
        kind: tpl.kind,
        title: t(`petcare.tpl.${tpl.key}` as TKey),
        icon: tpl.icon,
        interval_days: tpl.interval_days,
        sort_order: mine.length + i,
      }))
    const { error: err } = await supabase.from('pet_care_tasks').insert(rows)
    setBusy(false)
    if (err) {
      setError(t('petcare.saveTaskFailed'))
      return
    }
    onChanged()
  }

  return (
    <div className="fixed inset-0 z-[60] flex flex-col justify-end">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div
        className="relative max-h-[85dvh] overflow-y-auto overscroll-contain rounded-t-3xl bg-(--card) px-5 pt-5"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 1.5rem)' }}
      >
        <div className="mb-1 flex items-center justify-between">
          <h2 className="font-display text-xl font-bold text-(--text)">
            {kind === 'daily' ? t('petcare.dailyRoutine') : t('petcare.routines')}
          </h2>
          <button onClick={onClose} className="p-1 text-(--text-muted)" aria-label={t('common.close')}>
            <X size={20} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>
        <p className="mb-4 text-xs text-(--text-faint)">{pet.name}</p>

        {error && (
          <p className="mb-3 rounded-xl bg-(--surface) px-3 py-2 text-sm font-medium text-(--expense)">
            {error}
          </p>
        )}

        <div className="space-y-1.5">
          {mine.map((task, i) =>
            editing !== 'new' && editing?.id === task.id ? (
              <TaskEditor
                key={task.id}
                kind={kind}
                title={title}
                setTitle={setTitle}
                icon={icon}
                setIcon={setIcon}
                intervalDays={intervalDays}
                setIntervalDays={setIntervalDays}
                busy={busy}
                onSave={save}
                onCancel={() => setEditing(null)}
                t={t}
              />
            ) : (
              <div key={task.id} className="flex items-center gap-2 rounded-xl bg-(--surface) px-3 py-2.5">
                <button
                  onClick={() => openEdit(task)}
                  className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                >
                  <CareGlyph icon={task.icon} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-(--text)">
                      {task.title}
                    </span>
                    {kind === 'interval' && (
                      <span className="block text-[11px] text-(--text-faint)">
                        {t('petcare.every', { days: task.interval_days ?? 0 })}
                      </span>
                    )}
                  </span>
                </button>
                {kind === 'daily' && (
                  <span className="flex shrink-0 flex-col">
                    <button
                      onClick={() => void move(i, -1)}
                      disabled={i === 0 || busy}
                      aria-label={t('petcare.moveUp')}
                      className="px-1 text-(--text-faint) active:text-(--text) disabled:opacity-30"
                    >
                      <ChevronUp size={14} strokeWidth={2.5} aria-hidden="true" />
                    </button>
                    <button
                      onClick={() => void move(i, 1)}
                      disabled={i === mine.length - 1 || busy}
                      aria-label={t('petcare.moveDown')}
                      className="px-1 text-(--text-faint) active:text-(--text) disabled:opacity-30"
                    >
                      <ChevronDown size={14} strokeWidth={2.5} aria-hidden="true" />
                    </button>
                  </span>
                )}
                <button
                  onClick={() => void remove(task)}
                  disabled={busy}
                  aria-label={t('petcare.deleteTask')}
                  className="shrink-0 p-1 text-(--text-faint) active:text-(--expense) disabled:opacity-50"
                >
                  <Trash2 size={16} strokeWidth={2} aria-hidden="true" />
                </button>
              </div>
            ),
          )}

          {editing === 'new' && (
            <TaskEditor
              kind={kind}
              title={title}
              setTitle={setTitle}
              icon={icon}
              setIcon={setIcon}
              intervalDays={intervalDays}
              setIntervalDays={setIntervalDays}
              busy={busy}
              onSave={save}
              onCancel={() => setEditing(null)}
              t={t}
            />
          )}
        </div>

        {editing === null && (
          <>
            <button
              onClick={openNew}
              className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-(--text-faint) py-2.5 text-sm font-semibold text-(--text-muted)"
            >
              <Plus size={16} strokeWidth={2} aria-hidden="true" />
              {t('petcare.newTask')}
            </button>
            {mine.length === 0 && (
              <button
                onClick={() => void seedTemplate()}
                disabled={busy}
                className="mt-2 w-full rounded-xl bg-(--accent) py-2.5 text-sm font-bold text-white disabled:opacity-50"
              >
                {t('petcare.useTemplate')}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function CareGlyph({ icon }: { icon: PetTaskIcon }) {
  const Glyph = CARE_ICONS[icon] ?? CARE_ICONS.paw
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-(--accent-soft) text-(--accent)">
      <Glyph size={16} strokeWidth={2} aria-hidden="true" />
    </span>
  )
}

// Hoisted so React keeps one component type across renders — defined inline it
// would remount the title input on every keystroke and drop focus.
function TaskEditor({
  kind,
  title,
  setTitle,
  icon,
  setIcon,
  intervalDays,
  setIntervalDays,
  busy,
  onSave,
  onCancel,
  t,
}: {
  kind: 'daily' | 'interval'
  title: string
  setTitle: (v: string) => void
  icon: PetTaskIcon
  setIcon: (v: PetTaskIcon) => void
  intervalDays: string
  setIntervalDays: (v: string) => void
  busy: boolean
  onSave: () => void
  onCancel: () => void
  t: (k: TKey, vars?: Record<string, string | number>) => string
}) {
  return (
    <div className="rounded-xl bg-(--surface) p-3">
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && onSave()}
        placeholder={t('petcare.taskTitleHint')}
        maxLength={60}
        autoFocus
        className="w-full rounded-lg bg-(--card) px-3 py-2.5 text-base text-(--text) outline-none focus:ring-2 focus:ring-(--accent)"
      />
      <div className="mt-2 flex flex-wrap gap-1.5">
        {CARE_ICON_IDS.map((id) => {
          const Glyph = CARE_ICONS[id]
          const on = icon === id
          return (
            <button
              key={id}
              onClick={() => setIcon(id)}
              aria-label={id}
              aria-pressed={on}
              className={`flex h-9 w-9 items-center justify-center rounded-full ${
                on ? 'bg-(--accent) text-white' : 'bg-(--card) text-(--text-muted)'
              }`}
            >
              <Glyph size={16} strokeWidth={2} aria-hidden="true" />
            </button>
          )
        })}
      </div>
      {kind === 'interval' && (
        <label className="mt-2 block text-xs text-(--text-muted)">
          {t('petcare.intervalDays')}
          <input
            value={intervalDays}
            onChange={(e) => setIntervalDays(e.target.value.replace(/[^0-9]/g, ''))}
            inputMode="numeric"
            maxLength={4}
            className="mt-1 w-full rounded-lg bg-(--card) px-3 py-2.5 text-base text-(--text) outline-none focus:ring-2 focus:ring-(--accent)"
          />
        </label>
      )}
      <div className="mt-2.5 flex gap-2">
        <button
          onClick={onSave}
          disabled={busy || !title.trim()}
          className="flex-1 rounded-lg bg-(--accent) py-2.5 text-sm font-bold text-white disabled:opacity-50"
        >
          {t('common.save')}
        </button>
        <button
          onClick={onCancel}
          className="rounded-lg bg-(--card) px-4 py-2.5 text-sm font-semibold text-(--text-muted)"
        >
          {t('common.cancel')}
        </button>
      </div>
    </div>
  )
}
