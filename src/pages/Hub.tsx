import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Backdrop from '../components/Backdrop'
import Drawer from '../components/Drawer'
import { useAppPrefs } from '../hooks/useAppPrefs'
import { useAuth } from '../hooks/useAuth'
import { useHousehold } from '../hooks/useHousehold'
import { ADMIN_APP, APPS } from '../lib/apps'
import { supabase } from '../lib/supabase'

export default function Hub() {
  const { profile } = useAuth()
  // Header shows the family's own name ("Munhoz Family"); the hook caches it
  // locally so it doesn't flash "One Roof" on every open.
  const { household } = useHousehold()
  // Each user picks their own tiles and density; Admin is always shown to admins.
  const { hidden, tileStyle } = useAppPrefs()
  const navigate = useNavigate()
  const [drawerOpen, setDrawerOpen] = useState(false)

  // Open (unchecked) shopping items, shown as a badge on the tile. Live via
  // the same Realtime table the list itself uses, so the badge updates while
  // the other phone is shopping.
  const [shoppingCount, setShoppingCount] = useState(0)
  const loadShoppingCount = useCallback(async () => {
    const { count } = await supabase
      .from('shopping_items')
      .select('id', { count: 'exact', head: true })
      .eq('checked', false)
    setShoppingCount(count ?? 0)
  }, [])
  useEffect(() => {
    loadShoppingCount()
    const channel = supabase
      .channel('hub_shopping_badge')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'shopping_items' },
        () => loadShoppingCount(),
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [loadShoppingCount])

  const badges: Record<string, number> = { shopping: shoppingCount }

  const tiles = [
    ...APPS.filter((app) => !hidden.includes(app.id)),
    ...(profile?.is_admin ? [ADMIN_APP] : []),
  ]

  const badgeFor = (appId: string) => {
    const n = badges[appId] ?? 0
    if (n === 0) return null
    return (
      <span className="absolute right-2 top-2 min-w-5 rounded-full bg-(--accent) px-1.5 py-0.5 text-center text-[11px] font-bold leading-tight text-white">
        {n > 99 ? '99+' : n}
      </span>
    )
  }

  return (
    <div className="mx-auto min-h-dvh max-w-md px-4 pb-28">
      <Backdrop />
      <header className="flex items-center justify-between pt-6 pb-5">
        <div>
          <h1 className="text-2xl font-bold text-(--text)">
            {household?.name ?? 'One Roof'}
          </h1>
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

      {tiles.length === 0 ? (
        <div className="mt-16 text-center text-(--text-muted)">
          <div className="text-5xl">🫥</div>
          <p className="mt-4">All apps are hidden.</p>
          <p className="text-sm text-(--text-faint)">
            Open ☰ Settings → My apps to bring them back.
          </p>
        </div>
      ) : tileStyle === 'compact' ? (
        <div className="grid grid-cols-3 gap-2.5">
          {tiles.map((app) => (
            <button
              key={app.id}
              onClick={() => navigate(app.route)}
              className="relative flex flex-col items-center gap-1.5 rounded-xl bg-(--card) px-2 py-3.5 active:bg-(--card-active) transition-colors"
            >
              {badgeFor(app.id)}
              <span className="text-2xl">{app.icon}</span>
              <span className="w-full truncate text-center text-xs font-semibold text-(--text)">
                {app.name}
              </span>
            </button>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {tiles.map((app) => (
            <button
              key={app.id}
              onClick={() => navigate(app.route)}
              className="relative flex flex-col items-start gap-1.5 rounded-2xl bg-(--card) p-5 text-left active:bg-(--card-active) transition-colors"
            >
              {badgeFor(app.id)}
              <span className="text-3xl">{app.icon}</span>
              <span className="mt-1 font-bold text-(--text)">{app.name}</span>
              <span className="text-xs leading-snug text-(--text-faint)">
                {app.description}
              </span>
            </button>
          ))}
        </div>
      )}

      <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
    </div>
  )
}
