import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import BeachBackdrop from '../components/BeachBackdrop'
import Drawer from '../components/Drawer'
import { useAuth } from '../hooks/useAuth'
import { ADMIN_APP, APPS } from '../lib/apps'

export default function Hub() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const [drawerOpen, setDrawerOpen] = useState(false)

  return (
    <div className="mx-auto min-h-dvh max-w-md px-4 pb-28">
      <BeachBackdrop />
      <header className="flex items-center justify-between pt-6 pb-5">
        <div>
          <h1 className="text-2xl font-bold text-(--text)">One Roof</h1>
          <p className="text-sm text-(--text-muted)">Hi, {profile?.display_name} 👋</p>
        </div>
        <button
          onClick={() => setDrawerOpen(true)}
          aria-label="Open settings"
          className="rounded-lg px-3 py-2 text-xl text-(--text-muted) active:text-(--text)"
        >
          ☰
        </button>
      </header>

      <div className="grid grid-cols-2 gap-3">
        {[...APPS, ...(profile?.is_admin ? [ADMIN_APP] : [])].map((app) => (
          <button
            key={app.id}
            onClick={() => navigate(app.route)}
            className="flex flex-col items-start gap-1.5 rounded-2xl bg-(--card) p-5 text-left active:bg-(--card-active) transition-colors"
          >
            <span className="text-3xl">{app.icon}</span>
            <span className="mt-1 font-bold text-(--text)">{app.name}</span>
            <span className="text-xs leading-snug text-(--text-faint)">
              {app.description}
            </span>
          </button>
        ))}
      </div>

      <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
    </div>
  )
}
