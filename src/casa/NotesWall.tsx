// Modo Casa — "Recados": the family's hand-drawn notes on the home screen,
// like papers on the fridge door (owner, 2026-11-15). Only notes sent to the
// WHOLE household show here: this device signs in as the member who paired it,
// and a note addressed to one person must not appear on a shared screen
// (migration 113 enforces it in RLS; the filter below is the same rule).
// Read-only: notes are drawn on the phone. Tap a sheet to see it full screen.
import { useCallback, useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { useI18n } from '../hooks/useI18n'
import { getSignedUrls } from '../lib/signedUrls'
import type { CasaNote } from './notes'
import { tick } from './sound'
import { LOCALE } from './util'

const TAPES = ['#F6C7B8', '#BFE0D4', '#F5E0A3', '#CBD3F2']
const seed = (id: string) => id.charCodeAt(0) + id.charCodeAt(id.length - 1)
const tilt = (id: string) => [-2.2, 1.6, -1, 2.4][seed(id) % 4]

export function NotesWidget({ notes, members }: { notes: CasaNote[]; members: { email: string; first: string }[] }) {
  const { t, lang } = useI18n()
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [open, setOpen] = useState<CasaNote | null>(null)

  const paths = notes.map((n) => n.image_path).join('|')
  useEffect(() => {
    if (!paths) return
    let alive = true
    void getSignedUrls(paths.split('|')).then((m) => alive && setUrls(m))
    return () => {
      alive = false
    }
  }, [paths])

  const who = useCallback(
    (email: string) => members.find((m) => m.email === email)?.first || email.split('@')[0],
    [members],
  )
  const when = (iso: string) => new Date(iso).toLocaleDateString(LOCALE[lang], { weekday: 'short', day: 'numeric', month: 'short' })

  if (!notes.length) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
        <p className="font-display text-[1.8rem] leading-tight">{t('casa.notes.emptyTitle')}</p>
        <p className="max-w-[34ch] text-[1.05rem] text-(--text-muted)">{t('casa.notes.emptyHint')}</p>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-baseline gap-3 px-5 pt-4 pb-1">
        <span className="font-display text-[1.7rem] leading-tight">{t('casa.notes.title')}</span>
        <span className="text-[0.95rem] text-(--text-muted)">{t('casa.notes.sub')}</span>
      </div>
      <div className="casa-scroll min-h-0 flex-1 px-5 pt-4 pb-6">
        <div className="grid grid-cols-[repeat(auto-fill,minmax(clamp(130px,17vw,210px),1fr))] gap-x-5 gap-y-6">
          {notes.map((n) => (
            <button
              key={n.id}
              onClick={() => {
                tick()
                setOpen(n)
              }}
              className="casa-press flex flex-col gap-2 text-left"
              aria-label={`${t('casa.notes.from', { name: who(n.sender_email) })}, ${when(n.created_at)}`}
            >
              <span
                className="relative block aspect-[0.78] w-full overflow-hidden rounded-[10px] bg-[#FFFBF2] shadow-[0_10px_24px_rgba(40,25,10,0.18)]"
                style={{ transform: `rotate(${tilt(n.id)}deg)` }}
              >
                {urls[n.image_path] ? <img src={urls[n.image_path]} alt="" className="absolute inset-0 h-full w-full object-cover" draggable={false} /> : null}
                <span
                  className="absolute -top-0.5 left-1/2 h-4 w-14 -translate-x-1/2 -rotate-3 rounded-[2px] opacity-90"
                  style={{ background: TAPES[seed(n.id) % TAPES.length] }}
                />
              </span>
              <span className="px-0.5">
                <span className="block truncate text-[1rem] font-semibold">{t('casa.notes.from', { name: who(n.sender_email) })}</span>
                <span className="block truncate text-[0.85rem] text-(--text-muted)">{when(n.created_at)}</span>
              </span>
            </button>
          ))}
        </div>
      </div>

      {open && urls[open.image_path] ? (
        <div
          className="fixed inset-0 z-[80] flex flex-col items-center justify-center gap-4 bg-[rgba(20,16,12,0.92)] p-6"
          role="dialog"
          aria-modal="true"
          onClick={() => setOpen(null)}
        >
          <p className="font-display text-[1.6rem] text-white">
            {t('casa.notes.from', { name: who(open.sender_email) })} · {when(open.created_at)}
          </p>
          <img src={urls[open.image_path]} alt="" className="min-h-0 max-w-full flex-1 -rotate-1 rounded-[18px] bg-[#FFFBF2] object-contain" draggable={false} />
          <button
            onClick={() => setOpen(null)}
            className="casa-press inline-flex h-14 items-center gap-2 rounded-full bg-[#FFFBF2] px-8 text-[1.1rem] font-semibold text-[#2B2521]"
          >
            <X size={20} aria-hidden /> {t('casa.notes.close')}
          </button>
        </div>
      ) : null}
    </div>
  )
}
