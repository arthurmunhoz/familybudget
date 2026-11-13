// Pets on the home device: each pet's checklist for today (tap to tick or
// untick), the interval routines that are due, and vet/vaccine reminders.
import { useEffect, useState } from 'react'
import { Check, PawPrint } from 'lucide-react'
import { useI18n } from '../../hooks/useI18n'
import { dailyChecklist, overdueEvents, routineStatus } from '../../lib/petCare'
import type { PetTaskDone } from '../../lib/types'
import { CARE_ICONS } from '../../apps/pets/careIcons'
import { petTaskDone, petsDue, type HubData } from '../data'
import { tick } from '../sound'
import { PlusTag } from '../ui'
import { GRAD, grad } from '../util'
import { PanelHeader } from './Shell'

export default function PetsPanel({
  data,
  today,
  full,
  refresh,
  onClose,
}: {
  data: HubData
  today: string
  full: boolean
  refresh: () => void
  onClose: () => void
}) {
  const { t } = useI18n()
  const [done, setDone] = useState<PetTaskDone[]>(data.done)
  useEffect(() => setDone(data.done), [data.done])
  const due = petsDue({ ...data, done }, today).length

  async function toggle(taskId: string, isDone: boolean) {
    if (!full) return
    tick()
    setDone((l) =>
      isDone
        ? l.filter((d) => !(d.task_id === taskId && d.done_on === today))
        : [{ id: `tmp-${taskId}`, task_id: taskId, done_on: today, done_by: '', created_at: new Date().toISOString() }, ...l],
    )
    try {
      await petTaskDone(taskId, today, !isDone)
    } finally {
      refresh()
    }
  }

  return (
    <div className="flex h-full flex-col bg-(--bg)">
      <PanelHeader
        icon={PawPrint}
        g={GRAD.pets}
        title={t('casa.pets.title')}
        sub={due ? t('casa.pets.dueCount', { count: due }) : t('casa.pets.allDone')}
        onClose={onClose}
        closeLabel={t('casa.close')}
        right={full ? undefined : <PlusTag label="Plus" />}
      />
      <div className="casa-scroll flex-1 px-6 pb-10">
        {data.pets.length === 0 ? (
          <div className="casa-fade py-16 text-center">
            <p className="text-[3rem]" aria-hidden>
              🐾
            </p>
            <p className="font-display mt-2 text-[1.5rem]">{t('casa.pets.none')}</p>
          </div>
        ) : (
          <div className="grid gap-5 landscape:grid-cols-2">
            {data.pets.map((pet, pi) => {
              const daily = dailyChecklist(data.tasks, done, pet.id, today)
              const routines = routineStatus(data.tasks, data.done, pet.id, today).filter((r) => r.lastDone && r.dueIn <= 0)
              const doneToday = new Set(done.filter((d) => d.done_on === today).map((d) => d.task_id))
              const reminders = overdueEvents(data.petEvents, today).filter((e) => e.pet_id === pet.id)
              const tint = pet.tag_color ?? GRAD.pets[0]
              return (
                <section key={pet.id} className="casa-card casa-rise rounded-[30px] p-6" style={{ ['--i' as string]: pi }}>
                  <header className="mb-4 flex items-center gap-4">
                    <span
                      className="inline-flex h-12 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full text-[1.5rem]"
                      style={{ background: pet.photo ? undefined : `${tint}33`, boxShadow: `0 0 0 3px var(--card), 0 0 0 5px ${tint}` }}
                    >
                      {pet.photo ? <img src={pet.photo} alt="" className="h-full w-full object-cover" draggable={false} /> : pet.emoji}
                    </span>
                    <h3 className="font-display text-[1.5rem] leading-none">{pet.name}</h3>
                  </header>
                  {daily.length === 0 && routines.length === 0 && reminders.length === 0 ? (
                    <p className="text-[0.95rem] text-(--text-muted)">{t('casa.pets.nothing')}</p>
                  ) : null}
                  <ul className="space-y-2.5">
                    {daily.map(({ task, done: d }) => {
                      const Icon = CARE_ICONS[task.icon] ?? PawPrint
                      return (
                        <li key={task.id}>
                          <TaskButton label={task.title} Icon={Icon} on={!!d} disabled={!full} onClick={() => void toggle(task.id, !!d)} />
                        </li>
                      )
                    })}
                    {routines.map(({ task, dueIn }) => {
                      const Icon = CARE_ICONS[task.icon] ?? PawPrint
                      const on = doneToday.has(task.id)
                      return (
                        <li key={task.id}>
                          <TaskButton
                            label={task.title}
                            sub={dueIn < 0 ? t('casa.pets.late', { count: -dueIn }) : t('casa.pets.dueToday')}
                            Icon={Icon}
                            on={on}
                            disabled={!full}
                            onClick={() => void toggle(task.id, on)}
                          />
                        </li>
                      )
                    })}
                    {reminders.map((e) => (
                      <li key={e.id} className="flex items-center gap-3 rounded-[20px] bg-(--surface) px-4 py-3 text-[0.95rem]">
                        <span aria-hidden>🩺</span>
                        <span className="flex-1 font-medium">{e.title}</span>
                        <span className="text-[0.95rem] font-semibold text-(--expense)">
                          {e.next_due === today ? t('casa.pets.dueToday') : t('casa.pets.overdue')}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function TaskButton({
  label,
  sub,
  Icon,
  on,
  disabled,
  onClick,
}: {
  label: string
  sub?: string
  Icon: React.ComponentType<{ size?: number; strokeWidth?: number; 'aria-hidden'?: boolean }>
  on: boolean
  disabled: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="casa-press flex min-h-[64px] w-full items-center gap-4 rounded-[20px] px-4 py-2.5 text-left disabled:cursor-default"
      style={{ background: on ? `${GRAD.pets[0]}22` : 'var(--surface)', transition: 'background .3s' }}
    >
      <span className="text-(--text-muted)">
        <Icon size={24} strokeWidth={2} aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className={`block truncate text-[1.05rem] font-medium ${on ? 'text-(--text-muted) line-through decoration-2' : ''}`}>{label}</span>
        {sub ? <span className="block text-[0.95rem] text-(--text-faint)">{sub}</span> : null}
      </span>
      <span
        className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-[3px]"
        style={{ borderColor: on ? 'transparent' : 'var(--surface-2)', background: on ? grad(GRAD.pets) : 'var(--card)', transition: 'all .25s' }}
      >
        {on ? <Check size={22} strokeWidth={3} color="#fff" className="casa-pop" aria-hidden /> : null}
      </span>
    </button>
  )
}
