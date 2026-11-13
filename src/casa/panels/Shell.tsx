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
    <header className="flex items-center gap-4 px-6 pt-5 pb-3">
      <IconChip icon={icon} g={g} size={44} />
      <div className="min-w-0 flex-1">
        <h2 className="font-display truncate text-[1.9rem] leading-none">{title}</h2>
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
