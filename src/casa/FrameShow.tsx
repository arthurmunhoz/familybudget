// Modo Casa — the family photo frame: a crossfading slideshow with a gentle
// Ken Burns move. Two faces: <FrameMode> (full screen, entered by the button
// or after N idle minutes — tap anywhere to return) and <FrameWidget> (one
// page of the Widgets carousel). Opacity/transform only; reduced motion keeps
// the crossfade and drops the move.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Images, Maximize2, Smartphone } from 'lucide-react'
import { useI18n } from '../hooks/useI18n'
import type { Member } from './data'
import { fitFor, kenBurns, useSlideshow, type FramePhoto } from './frame'
import { Avatar } from './ui'
import { GRAD, LOCALE, cap, grad, prefersReducedMotion } from './util'

const SLIDE_MS = 12_000

/** Stacks the current photo over the previous one and fades it in. */
function Slides({ photo, kb, box }: { photo: FramePhoto | null; kb: boolean; box: { w: number; h: number } }) {
  const [stack, setStack] = useState<FramePhoto[]>(photo ? [photo] : [])
  useEffect(() => {
    if (!photo) return
    setStack((s) => (s[s.length - 1]?.id === photo.id ? s : [...s.slice(-1), photo]))
  }, [photo])
  const reduce = prefersReducedMotion()
  return (
    <>
      {stack.map((p, i) => {
        const fit = fitFor(p.width, p.height, box.w, box.h)
        const k = kenBurns(p.id)
        const move = kb && !reduce
        return (
          <div key={p.id} className={`absolute inset-0 overflow-hidden ${i === stack.length - 1 && stack.length > 1 ? 'casa-frame-in' : ''}`}>
            {fit === 'contain' ? (
              <img src={p.url} alt="" draggable={false} className="casa-frame-blur absolute inset-0 h-full w-full object-cover" />
            ) : null}
            <img
              src={p.url}
              alt=""
              draggable={false}
              className={`absolute inset-0 h-full w-full ${fit === 'contain' ? 'object-contain' : 'object-cover'} ${move ? 'casa-kb' : ''}`}
              style={
                move
                  ? ({
                      ['--kb-from' as string]: k.from,
                      ['--kb-to' as string]: k.to,
                      ['--kb-dx' as string]: `${k.dx * 1.3}%`,
                      ['--kb-dy' as string]: `${k.dy * 0.9}%`,
                      animationDuration: `${SLIDE_MS + 3000}ms`,
                    } as React.CSSProperties)
                  : undefined
              }
            />
          </div>
        )
      })}
    </>
  )
}

function useBox<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [box, setBox] = useState({ w: window.innerWidth, h: window.innerHeight })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, box] as const
}

function birthdaysToday(members: Member[], today: string): string[] {
  const md = today.slice(5)
  return members.filter((m) => m.profile?.birthday?.slice(5) === md).map((m) => m.email)
}

function AddedBy({ photo, members, light }: { photo: FramePhoto; members: Member[]; light?: boolean }) {
  const { t } = useI18n()
  const m = members.find((x) => x.email === photo.addedBy)
  if (!m) return null
  return (
    <span className={`inline-flex items-center gap-2.5 rounded-full py-1.5 pr-4 pl-1.5 text-[1rem] font-semibold ${light ? 'bg-black/35 text-white' : ''}`}>
      <Avatar m={m} size={30} />
      {t('casa.frame.addedBy', { name: m.first })}
    </span>
  )
}

function EmptyAlbum({ big }: { big?: boolean }) {
  const { t } = useI18n()
  return (
    <div className="casa-scroll h-full">
    <div className="casa-fade flex min-h-full flex-col items-center justify-center px-6 py-4 text-center">
      <span
        className="casa-breathe-slow inline-flex shrink-0 items-center justify-center rounded-[30%]"
        style={{ width: big ? 'clamp(4.5rem, 16dvh, 7.5rem)' : 'clamp(3.5rem, 11dvh, 5.25rem)', height: big ? 'clamp(4.5rem, 16dvh, 7.5rem)' : 'clamp(3.5rem, 11dvh, 5.25rem)', background: grad(GRAD.frame), boxShadow: `0 24px 60px -24px ${GRAD.frame[1]}` }}
      >
        <Images className="h-1/2 w-1/2" color="#fff" strokeWidth={1.9} aria-hidden />
      </span>
      <p className={`font-display mt-[clamp(10px,3dvh,24px)] leading-tight ${big ? 'text-[clamp(1.8rem,min(6vw,6dvh),2.6rem)]' : 'text-[clamp(1.35rem,4dvh,1.7rem)]'}`}>{t('casa.frame.emptyTitle')}</p>
      <p className={`mt-3 flex max-w-[42ch] items-start gap-2 text-left text-(--text-muted) ${big ? 'text-[1.2rem]' : 'text-[1rem]'}`}>
        <Smartphone size={big ? 24 : 20} className="mt-0.5 shrink-0" aria-hidden />
        {t('casa.frame.emptyBody')}
      </p>
    </div>
    </div>
  )
}

/** Full-screen frame. Tap anywhere to go back to the hub. */
export function FrameMode({
  photos,
  members,
  today,
  now,
  onExit,
}: {
  photos: FramePhoto[]
  members: Member[]
  today: string
  now: Date
  onExit: () => void
}) {
  const { t, lang } = useI18n()
  const root = useRef<HTMLDivElement>(null)
  const [ref, box] = useBox<HTMLDivElement>()
  const photo = useSlideshow(photos, birthdaysToday(members, today), SLIDE_MS)
  const leaving = useRef(false)
  const loc = LOCALE[lang]

  useLayoutEffect(() => {
    root.current?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: prefersReducedMotion() ? 150 : 700, easing: 'ease-out', fill: 'both' })
  }, [])

  const exit = async () => {
    if (leaving.current) return
    leaving.current = true
    const a = root.current?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: prefersReducedMotion() ? 100 : 320, easing: 'ease-in', fill: 'both' })
    await a?.finished.catch(() => undefined)
    onExit()
  }

  const time = now.toLocaleTimeString(loc, { hour: 'numeric', minute: '2-digit' })
  const date = cap(now.toLocaleDateString(loc, { weekday: 'long', day: 'numeric', month: 'long' }))
  const empty = !photos.length

  return createPortal(
    <div
      ref={root}
      onPointerDown={() => void exit()}
      role="button"
      aria-label={t('casa.frame.back')}
      className={`casa-root z-50 ${empty ? 'bg-(--bg)' : 'bg-black'}`}
      style={{ position: 'fixed' }}
    >
      <div ref={ref} className="absolute inset-0">
        {empty ? <EmptyAlbum big /> : <Slides photo={photo} kb box={box} />}
      </div>
      {!empty ? (
        <>
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[34%]" style={{ background: 'linear-gradient(180deg, transparent, rgb(0 0 0 / .5))' }} />
          <div className="pointer-events-none absolute right-[clamp(20px,3vw,40px)] bottom-[clamp(18px,3vh,34px)] left-[clamp(20px,3vw,40px)] flex items-end gap-4 text-white">
            <div className="casa-fade min-w-0 flex-1" style={{ textShadow: '0 2px 18px rgb(0 0 0 / .45)' }}>
              <p className="casa-clock text-[clamp(2.6rem,5vw,4rem)]">{time}</p>
              <p className="mt-1.5 truncate text-[1.1rem] font-semibold opacity-90">{date}</p>
            </div>
            {photo ? (
              <span key={photo.id} className="casa-fade">
                <AddedBy photo={photo} members={members} light />
              </span>
            ) : null}
          </div>
        </>
      ) : (
        <p className="absolute inset-x-0 bottom-8 text-center text-[1rem] text-(--text-faint)">{t('casa.frame.tapBack')}</p>
      )}
    </div>,
    document.body,
  )
}

/** The frame as a Widgets page: the slideshow in a card + a full-screen button. */
export function FrameWidget({
  photos,
  members,
  today,
  active,
  onFullscreen,
}: {
  photos: FramePhoto[]
  members: Member[]
  today: string
  /** Only run the slideshow while this page is on screen. */
  active: boolean
  onFullscreen: () => void
}) {
  const { t } = useI18n()
  const [ref, box] = useBox<HTMLDivElement>()
  const photo = useSlideshow(photos, birthdaysToday(members, today), 9000, active)
  return (
    <div className="relative flex h-full flex-col">
      <div ref={ref} className="relative min-h-0 flex-1 overflow-hidden rounded-[22px] bg-(--surface)">
        {photos.length ? <Slides photo={photo} kb={active} box={box} /> : <EmptyAlbum />}
        {photos.length ? (
          <>
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-28" style={{ background: 'linear-gradient(180deg, transparent, rgb(0 0 0 / .45))' }} />
            <div className="absolute right-3 bottom-3 left-3 flex items-center gap-3">
              <span className="min-w-0 flex-1">{photo ? <AddedBy key={photo.id} photo={photo} members={members} light /> : null}</span>
              <button
                onClick={onFullscreen}
                data-noswipe
                className="casa-press inline-flex h-12 items-center gap-2 rounded-full bg-white/90 px-5 text-[1rem] font-semibold text-[#2a1f18] shadow-lg"
              >
                <Maximize2 size={18} aria-hidden />
                {t('casa.frame.fullscreen')}
              </button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  )
}
