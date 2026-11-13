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
    <header className="flex items-center gap-5 px-8 pt-7 pb-5">
      <IconChip icon={icon} g={g} size={64} />
      <div className="min-w-0 flex-1">
        <h2 className="font-display truncate text-[2.6rem] leading-none">{title}</h2>
        {sub ? <p className="mt-1.5 truncate text-[1.1rem] text-(--text-muted)">{sub}</p> : null}
      </div>
      {right}
      <button
        onClick={onClose}
        aria-label={closeLabel}
        className="casa-press inline-flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-(--surface) text-(--text)"
      >
        <X size={30} strokeWidth={2.2} aria-hidden />
      </button>
    </header>
  )
}
