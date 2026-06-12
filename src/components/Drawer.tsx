import { useAuth } from '../hooks/useAuth'
import { useTheme } from '../hooks/useTheme'

export default function Drawer({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const { profile, session, signOut } = useAuth()
  const { theme, setTheme } = useTheme()

  if (!open) return null

  return (
    <div className="fixed inset-x-0 top-0 z-50 h-dvh">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div
        className="absolute right-0 top-0 flex h-full w-72 flex-col bg-(--card) p-5"
        style={{
          paddingTop: 'calc(env(safe-area-inset-top) + 1.25rem)',
          paddingBottom: 'calc(env(safe-area-inset-bottom) + 1.25rem)',
        }}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-(--text)">Settings</h2>
          <button onClick={onClose} className="px-2 py-1 text-(--text-muted)">
            ✕
          </button>
        </div>

        <div className="mt-5 rounded-xl bg-(--surface) px-4 py-3">
          <div className="font-semibold text-(--text)">
            {profile?.display_name}
          </div>
          <div className="truncate text-xs text-(--text-faint)">
            {session?.user.email}
          </div>
        </div>

        <div className="mt-6">
          <span className="text-sm text-(--text-muted)">Theme</span>
          <div className="mt-2 grid grid-cols-2 gap-2 rounded-xl bg-(--surface) p-1">
            {(['light', 'dark'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTheme(t)}
                className={`rounded-lg py-2 text-sm font-semibold capitalize transition-colors ${
                  theme === t ? 'bg-(--accent) text-white' : 'text-(--text-muted)'
                }`}
              >
                {t === 'light' ? '🌞 Light' : '🌙 Dark'}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1" />

        <button
          onClick={signOut}
          className="w-full rounded-xl py-3 font-semibold text-(--expense) active:bg-(--surface)"
        >
          Sign out
        </button>
      </div>
    </div>
  )
}
