// Listas on the home device: every list's open items in big rows, tap to mark
// "feito", add an item to the list on show, and the recently done ones below.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ListChecks, Plus, RotateCcw } from 'lucide-react'
import { useI18n } from '../../hooks/useI18n'
import type { ShoppingItem } from '../../lib/types'
import { addItem, setChecked, type HubData } from '../data'
import { tick } from '../sound'
import StoreLogo from '../../apps/shopping/StoreLogo'
import { PlusTag } from '../ui'
import { GRAD, grad, norm } from '../util'
import { PanelHeader } from './Shell'

type Filter = 'all' | 'general' | string

export default function ListsPanel({
  data,
  full,
  me,
  refresh,
  onClose,
}: {
  data: HubData
  full: boolean
  me: string
  refresh: () => void
  onClose: () => void
}) {
  const { t } = useI18n()
  const [open, setOpen] = useState<ShoppingItem[]>(data.open)
  const [done, setDone] = useState<ShoppingItem[]>(data.checked)
  const [ticking, setTicking] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState<Filter>('all')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  // A tick can be a slip (owner, 2026-11-13): "Undo" for 3 s, top centre.
  const [undo, setUndo] = useState<ShoppingItem | null>(null)
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => {
    if (undoTimer.current) clearTimeout(undoTimer.current)
  }, [])
  const offerUndo = (item: ShoppingItem) => {
    if (undoTimer.current) clearTimeout(undoTimer.current)
    setUndo(item)
    undoTimer.current = setTimeout(() => setUndo(null), 3000)
  }

  // Fresh data from the server (Realtime) wins unless we're mid-animation.
  useEffect(() => {
    if (ticking.size) return
    setOpen(data.open)
    setDone(data.checked)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.open, data.checked])

  const valid = useMemo(() => new Set(data.stores.map((s) => s.id)), [data.stores])
  const inGeneral = (i: ShoppingItem) => !i.store_id || !valid.has(i.store_id)
  // Lists with something in them first, A–Z; then the empty ones, A–Z
  // (owner, 2026-11-13). The same order for the chips and the sections.
  const lists = useMemo(() => {
    const all: { id: string; label: string; slug: string | null; count: number }[] = [
      { id: 'general', label: t('casa.list.general'), slug: null, count: open.filter(inGeneral).length },
      ...data.stores.map((s) => ({ id: s.id, label: s.name, slug: s.slug, count: open.filter((i) => i.store_id === s.id).length })),
    ]
    const byName = (a: { label: string }, b: { label: string }) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' })
    return [...all.filter((x) => x.count > 0).sort(byName), ...all.filter((x) => x.count === 0).sort(byName)]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, data.stores, t])
  const chips = useMemo(() => {
    const out: { id: Filter; label: string; count: number; slug?: string | null; logo: boolean }[] = [
      { id: 'all', label: t('casa.lists.all'), count: open.length, logo: false },
    ]
    for (const l of lists) out.push({ id: l.id, label: l.label, count: l.count, slug: l.slug, logo: true })
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, lists, t])

  const shown = open.filter((i) => (filter === 'all' ? true : filter === 'general' ? inGeneral(i) : i.store_id === filter))
  const shownDone = done.filter((i) => (filter === 'all' ? true : filter === 'general' ? inGeneral(i) : i.store_id === filter)).slice(0, 12)
  const storeName = (id: string | null) => data.stores.find((s) => s.id === id)?.name ?? t('casa.list.general')
  const targetName = filter === 'all' || filter === 'general' ? t('casa.list.general') : storeName(filter)

  async function toggle(item: ShoppingItem) {
    if (!full) return
    tick()
    setTicking((s) => new Set(s).add(item.id))
    await new Promise((r) => setTimeout(r, 520))
    setOpen((l) => l.filter((x) => x.id !== item.id))
    setDone((l) => [{ ...item, checked: true, checked_at: new Date().toISOString() }, ...l])
    setTicking((s) => {
      const n = new Set(s)
      n.delete(item.id)
      return n
    })
    offerUndo(item)
    try {
      await setChecked([item.id], true)
    } finally {
      refresh()
    }
  }

  async function untick(item: ShoppingItem) {
    if (!full) return
    setDone((l) => l.filter((x) => x.id !== item.id))
    setOpen((l) => [...l, { ...item, checked: false, checked_at: null }])
    try {
      await setChecked([item.id], false)
    } finally {
      refresh()
    }
  }

  async function add() {
    const label = text.trim()
    if (!label || !full || busy) return
    if (open.some((i) => norm(i.label) === norm(label) && (filter === 'all' || filter === 'general' ? inGeneral(i) : i.store_id === filter))) {
      setText('')
      return
    }
    setBusy(true)
    try {
      const storeId = filter === 'all' || filter === 'general' ? null : filter
      const row = await addItem(label, storeId, me)
      if (row) setOpen((l) => [...l, row])
      setText('')
      tick()
    } finally {
      setBusy(false)
      refresh()
    }
  }

  const sections: { id: string; name: string; slug: string | null; items: ShoppingItem[] }[] =
    filter === 'all'
      ? lists
          .map((l) => ({ id: l.id, name: l.label, slug: l.slug, items: shown.filter((i) => (l.id === 'general' ? inGeneral(i) : i.store_id === l.id)) }))
          .filter((x) => x.items.length)
      : [{ id: filter, name: targetName, slug: null, items: shown }]

  const itemRow = (item: ShoppingItem) => {
    const going = ticking.has(item.id)
    return (
      <li key={item.id}>
        <button
          onClick={() => void toggle(item)}
          disabled={!full}
          className="casa-press casa-card flex min-h-[52px] w-full items-center gap-3 rounded-[16px] px-3.5 py-2 text-left disabled:cursor-default"
          style={{ opacity: going ? 0.55 : 1, transition: 'opacity .4s' }}
        >
          <span
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2"
            style={{
              borderColor: going ? 'transparent' : 'var(--surface-2)',
              background: going ? grad(GRAD.lists) : 'transparent',
              transition: 'all .25s',
            }}
          >
            {going ? <Check size={16} strokeWidth={3.2} color="#3b2400" className="casa-pop" aria-hidden /> : null}
          </span>
          <span className="casa-strike min-w-0 flex-1 truncate text-[1.08rem] font-medium" style={{ backgroundSize: going ? '100% 2px' : '0% 2px' }}>
            {item.label}
          </span>
        </button>
      </li>
    )
  }

  return (
    <div className="relative flex h-full flex-col bg-(--bg)">
      {undo ? (
        <div className="pointer-events-none absolute inset-x-0 top-[clamp(70px,11dvh,104px)] z-20 flex justify-center">
          <button
            key={undo.id}
            onClick={() => {
              if (undoTimer.current) clearTimeout(undoTimer.current)
              const item = undo
              setUndo(null)
              tick()
              void untick(item)
            }}
            className="casa-pop casa-press pointer-events-auto inline-flex h-12 items-center gap-2.5 rounded-full px-5 text-[1rem] font-semibold shadow-xl"
            style={{ background: 'var(--text)', color: 'var(--bg)' }}
          >
            <RotateCcw size={18} strokeWidth={2.6} aria-hidden />
            <span className="max-w-[16ch] truncate">{t('casa.roof.undo')}</span>
            <span className="max-w-[18ch] truncate font-normal opacity-70">· {undo.label}</span>
          </button>
        </div>
      ) : null}
      <PanelHeader
        icon={ListChecks}
        g={GRAD.lists}
        title={t('casa.lists.title')}
        sub={t('casa.lists.openCount', { count: open.length })}
        onClose={onClose}
        closeLabel={t('casa.close')}
      />
      <div className="casa-scroll flex shrink-0 gap-2 overflow-x-auto px-4 pb-3 sm:px-6">
        {chips.map((c) => {
          const on = filter === c.id
          return (
            <button
              key={c.id}
              onClick={() => setFilter(c.id)}
              className="casa-press inline-flex h-11 shrink-0 items-center gap-2 rounded-full pr-4 pl-2.5 text-[0.98rem] font-semibold"
              style={
                on
                  ? { background: grad(GRAD.lists), color: '#3b2400', boxShadow: '0 10px 24px -12px #FF9A1F' }
                  : { background: 'var(--surface)', color: 'var(--text)' }
              }
            >
              {c.logo ? <StoreLogo slug={c.slug ?? null} name={c.label} size={24} /> : null}
              {c.label}
              <span className={`rounded-full px-2 text-[0.85rem] ${on ? 'bg-white/45' : 'bg-(--card) text-(--text-muted)'}`}>{c.count}</span>
            </button>
          )
        })}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          void add()
        }}
        className="mx-4 mb-3 flex shrink-0 items-center gap-2 sm:mx-6"
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={!full}
          placeholder={full ? t('casa.lists.addTo', { list: targetName }) : t('casa.plan.displayOnly')}
          className="h-12 min-w-0 flex-1 rounded-[16px] border border-(--surface-2) bg-(--card) px-4 outline-none focus:border-[#FF9A1F] disabled:opacity-60"
          style={{ fontSize: '1.05rem' }}
        />
        {full ? (
          <button
            type="submit"
            disabled={!text.trim() || busy}
            className="casa-press inline-flex h-12 shrink-0 items-center gap-1.5 rounded-[16px] px-5 text-[1rem] font-semibold disabled:opacity-50"
            style={{ background: grad(GRAD.lists), color: '#3b2400' }}
          >
            <Plus size={19} strokeWidth={2.6} aria-hidden />
            {t('casa.lists.add')}
          </button>
        ) : (
          <PlusTag label="Plus" />
        )}
      </form>

      <div className="casa-scroll min-h-0 flex-1 px-4 pb-8 sm:px-6">
        {shown.length === 0 ? (
          <div className="casa-fade flex flex-col items-center justify-center py-16 text-center">
            <span className="text-[4rem]" aria-hidden>
              🧺
            </span>
            <p className="font-display mt-3 text-[2rem]">{t('casa.lists.empty')}</p>
          </div>
        ) : (
          // "All": one section per list — its logo, name and count — with
          // that list's items under it ("Geral" for items with no list).
          sections.map((sec) => (
            <section key={sec.id} className="mb-5">
              {filter === 'all' ? (
                <h3 className="mb-2 flex items-center gap-2.5">
                  <StoreLogo slug={sec.slug} name={sec.name} size={30} />
                  <span className="font-display min-w-0 truncate text-[1.25rem]">{sec.name}</span>
                  <span className="shrink-0 rounded-full bg-(--surface) px-2 text-[0.85rem] font-semibold text-(--text-muted)">{sec.items.length}</span>
                </h3>
              ) : null}
              <ul className="grid gap-2 sm:grid-cols-2 landscape:grid-cols-3">{sec.items.map((item) => itemRow(item))}</ul>
            </section>
          ))
        )}

        {shownDone.length ? (
          <section className="mt-6">
            <h3 className="mb-3 text-[0.95rem] font-semibold uppercase tracking-[0.16em] text-(--text-faint)">{t('casa.lists.done')}</h3>
            <ul className="flex flex-wrap gap-2.5">
              {shownDone.map((item) => (
                <li key={item.id} className="casa-fade">
                  <button
                    onClick={() => void untick(item)}
                    disabled={!full}
                    className="casa-press inline-flex h-10 items-center gap-2 rounded-full bg-(--surface) px-3.5 text-[0.95rem] text-(--text-muted)"
                  >
                    <span className="line-through decoration-2">{item.label}</span>
                    {full ? <RotateCcw size={16} aria-hidden /> : null}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </div>
  )
}
