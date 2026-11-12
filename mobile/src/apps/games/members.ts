// Household members for the game screens: first name + avatar path by email.
import { useEffect, useState } from 'react'

import { useAuth } from '@/lib/auth'
import { supabase } from '@/lib/supabase'

let avatarCache: Record<string, string | null> | null = null
let nameCache: Record<string, string> | null = null

/** Display names + avatar paths for the household, keyed by email.
 *  Names are re-read here, not only taken from useAuth's `profiles`: that list
 *  is loaded when the app opens, so someone who joined (or renamed) since then
 *  showed as their e-mail ("armunhoz21 opened a room", owner 2026-11). */
export function useMembers() {
  const { profiles } = useAuth()
  const [avatars, setAvatars] = useState<Record<string, string | null>>(avatarCache ?? {})
  const [names, setNames] = useState<Record<string, string>>(nameCache ?? {})
  useEffect(() => {
    void supabase
      .from('allowed_users')
      .select('email, display_name')
      .then(({ data }) => {
        const m: Record<string, string> = {}
        for (const r of (data ?? []) as { email: string; display_name: string | null }[]) if (r.display_name) m[r.email] = r.display_name
        nameCache = m
        setNames(m)
      })
    void supabase
      .from('member_profiles')
      .select('email, avatar_path')
      .then(({ data }) => {
        const m: Record<string, string | null> = {}
        for (const r of (data ?? []) as { email: string; avatar_path: string | null }[]) m[r.email] = r.avatar_path
        avatarCache = m
        setAvatars(m)
      })
  }, [])
  const name = (email?: string | null) => {
    if (!email) return ''
    const p = profiles.find((x) => x.email === email)
    return (names[email] || p?.display_name || email.split('@')[0]).trim().split(/\s+/)[0]
  }
  return { name, avatar: (email: string) => avatars[email] ?? null }
}

