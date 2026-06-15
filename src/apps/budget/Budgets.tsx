import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Backdrop from '../../components/Backdrop'
import { useBack } from '../../hooks/useBack'
import { useCachedQuery } from '../../hooks/useCachedQuery'
import { useScrollLock } from '../../hooks/useScrollLock'
import { useI18n } from '../../hooks/useI18n'
import { supabase } from '../../lib/supabase'
import type { Budget, Period } from '../../lib/types'

const PERIOD_IDS: Period[] = ['monthly', 'weekly', 'daily']

export default function Budgets() {
  const navigate = useNavigate()
  const back = useBack()
  const { t } = useI18n()
  // Cached: the budgets list renders instantly on return, revalidates quietly.
  const { data: budgets = [], loading, revalidate } = useCachedQuery<Budget[]>(
    'budgets:list',
    async () => {
      const { data } = await supabase.from('budgets').select('*').order('created_at')
      return data ?? []
    },
  )

  const [createOpen, setCreateOpen] = useState(false)
  const [name, setName] = useState('')
  const [period, setPeriod] = useState<Period>('monthly')
  const [saving, setSaving] = useState(false)
  useScrollLock(createOpen)

  async function create() {
    const trimmed = name.trim()
    if (!trimmed) return
    setSaving(true)
    await supabase.from('budgets').insert({ name: trimmed, period })
    setSaving(false)
    setCreateOpen(false)
    setName('')
    setPeriod('monthly')
    revalidate()
  }

  return (
    <div className="mx-auto min-h-dvh max-w-md px-4 pb-28">
      <Backdrop />
      <header className="sticky top-0 z-10 -mx-4 -mt-[env(safe-area-inset-top)] flex items-center gap-2 bg-(--bg) px-4 pt-[calc(env(safe-area-inset-top)+1.5rem)] pb-4">
        <button
          onClick={() => back('/')}
          className="rounded-lg px-2 py-1 text-xl text-(--text-muted) active:text-(--text)"
        >
          ‹
        </button>
        <h1 className="text-2xl font-bold text-(--text)">💰 {t('budget.title')}</h1>
      </header>

      {loading ? (
        <p className="mt-12 text-center text-(--text-faint) animate-pulse">{t('common.loading')}</p>
      ) : budgets.length === 0 ? (
        <div className="mt-16 text-center text-(--text-muted)">
          <div className="text-5xl">💼</div>
          <p className="mt-4">{t('budget.empty')}</p>
          <p className="text-sm text-(--text-faint)">{t('budget.emptyHint')}</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {budgets.map((b) => {
            const periodName = t(`budget.${b.period}` as const)
            return (
              <li key={b.id}>
                <button
                  onClick={() => navigate(`/budget/${b.id}`)}
                  className="flex w-full items-center justify-between gap-2 rounded-2xl bg-(--card) px-5 py-4 active:bg-(--card-active) transition-colors"
                >
                  <div className="min-w-0 text-left">
                    <div className="truncate text-lg font-bold text-(--text)">
                      {b.name}
                    </div>
                    <div className="text-xs text-(--text-faint)">{periodName}</div>
                  </div>
                  <span className="shrink-0 text-(--text-faint)">›</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}

      <div
        className="fixed inset-x-0 bottom-0 mx-auto max-w-md px-4 pt-3"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 1rem)' }}
      >
        <button
          onClick={() => {
            setName('')
            setPeriod('monthly')
            setCreateOpen(true)
          }}
          disabled={loading}
          className="w-full rounded-2xl border border-white/30 bg-(--accent) py-4 text-lg font-bold text-white shadow-lg active:scale-[0.98] transition-transform disabled:opacity-50"
        >
          {t('budget.new')}
        </button>
      </div>

      {createOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6">
          <div className="w-full max-w-sm rounded-2xl bg-(--card) p-6">
            <h2 className="text-lg font-bold text-(--text)">{t('budget.newTitle')}</h2>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('budget.namePlaceholder')}
              autoFocus
              className="mt-4 w-full rounded-xl bg-(--surface) px-4 py-3 text-(--text) outline-none focus:ring-2 focus:ring-(--accent)"
            />
            <div className="mt-4">
              <span className="text-sm text-(--text-muted)">{t('budget.groupedBy')}</span>
              <div className="mt-2 grid grid-cols-3 gap-2 rounded-xl bg-(--surface) p-1">
                {PERIOD_IDS.map((p) => (
                  <button
                    key={p}
                    onClick={() => setPeriod(p)}
                    className={`rounded-lg py-2 text-sm font-semibold transition-colors ${
                      period === p ? 'bg-(--accent) text-white' : 'text-(--text-muted)'
                    }`}
                  >
                    {t(`budget.${p}` as const)}
                  </button>
                ))}
              </div>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <button
                onClick={() => {
                  setCreateOpen(false)
                  setName('')
                }}
                className="rounded-xl bg-(--surface) py-3 font-semibold text-(--text)"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={create}
                disabled={saving || !name.trim()}
                className="rounded-xl bg-(--accent) py-3 font-semibold text-white disabled:opacity-50"
              >
                {t('common.create')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
