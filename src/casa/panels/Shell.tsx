import type { ReactNode } from 'react'
import { X, type LucideIcon } from 'lucide-react'
import { IconChip } from '../ui'

/** The header every in-hub panel shares: gradient chip, big title, close. */
export function PanelHeader({
  icon,
  g,
  title,
  sub,
  onClose,
  closeLabel,
  right,
}: {
  icon: LucideIcon
  g: readonly string[]
  title: string
  sub?: string
  onClose: () => void
  closeLabel: string
  right?: ReactNode
}) {
  return (
    <header className="flex shrink-0 items-center gap-3 px-4 pt-[clamp(10px,2.4dvh,20px)] pb-[clamp(6px,1.6dvh,12px)] sm:gap-4 sm:px-6">
      <IconChip icon={icon} g={g} size={44} />
      <div className="min-w-0 flex-1">
        <h2 className="font-display truncate text-[clamp(1.45rem,min(5vw,5dvh),1.9rem)] leading-none">{title}</h2>
        {sub ? <p className="mt-1 truncate text-[0.95rem] text-(--text-muted)">{sub}</p> : null}
      </div>
      {right}
      <button
        onClick={onClose}
        aria-label={closeLabel}
        className="casa-press inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-(--surface) text-(--text)"
      >
        <X size={24} strokeWidth={2.2} aria-hidden />
      </button>
    </header>
  )
}
