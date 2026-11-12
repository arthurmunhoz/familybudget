// Family games (hub app "Games", migration 090). The SERVER runs every game:
// clients only read game_sessions / game_players (household RLS) and follow
// them over Realtime, and every move is an RPC that checks it's the caller's
// turn. Secrets (the hangman word) live in game_secrets, which no client can
// read — so what's on screen here is always the PUBLIC state.
//
// Shapes mirror the comment at the top of supabase/migration-090-family-games.sql.
import { useCallback, useEffect, useRef, useState } from 'react'
import { AppState } from 'react-native'

import { channelName } from './realtime'
import { supabase } from './supabase'

export type GameKind = 'hangman' | 'battleship' | 'quiz'
export type Team = 'A' | 'B'
export type GameStatus = 'lobby' | 'playing' | 'done' | 'cancelled'

export interface HangmanState {
  phase?: 'choosing' | 'guessing' | 'round_over'
  round?: number
  rounds?: number
  setter_team?: Team
  guess_team?: Team
  setter?: string
  guesser?: string
  order?: Record<Team, string[]>
  category?: string | null
  mask?: string | null
  guessed?: string[]
  wrong?: number
  max_wrong?: number
  scores?: Record<Team, number>
  solved?: boolean | null
  word?: string | null
  last?: { letter?: string; word?: string; hit: boolean; at: string } | null
  ended?: 'finished' | 'abandoned' | 'cancelled' | 'expired'
  /** Who left when a team emptied (migration 102). */
  left_by?: string
}

/** A ship on an 8×8 board: top-left cell, length, horizontal/vertical. */
export interface Ship {
  r: number
  c: number
  len: number
  dir: 'h' | 'v'
}
export interface Shot {
  r: number
  c: number
  hit: boolean
  by: string
  at: string
}
/** Battleship public state (migration 093). Fleets are NOT here — a team reads
 *  its own with games.battleship.myFleet(); the other team's never leaves the
 *  server. */
export interface BattleshipState {
  phase: 'placing' | 'battle'
  size: number
  fleet: number[]
  order: Record<Team, string[]>
  ready: Record<Team, boolean>
  rev: Record<Team, number>
  turn_team: Team | null
  shooter: string | null
  /** Shots ON that team's board. */
  shots: Record<Team, Shot[]>
  /** That team's sunk ships, revealed to everyone. */
  sunk: Record<Team, Ship[]>
  /** Ships sunk BY that team. */
  scores: Record<Team, number>
  last: { team: Team; r: number; c: number; hit: boolean; sunk: boolean; len: number | null; by: string; at: string } | null
  winner?: Team
  ended?: 'finished' | 'abandoned' | 'cancelled' | 'expired'
  /** Who left when a team emptied (migration 102). */
  left_by?: string
}

/** Buzzer quiz public state (migration 094). Accepted answers stay on the
 *  server until the reveal. */
export interface QuizState {
  phase: 'question' | 'answering' | 'reveal'
  q: number
  total: number
  question: { id: number; text: string; category: string }
  /** Current phase's deadline (server clock). */
  deadline: string
  /** Server time at the last change — used to correct this phone's clock. */
  now: string
  buzz: { email: string; team: Team; at: string } | null
  locked: string[]
  last: { email: string; team: Team; text: string; correct: boolean; timeout?: boolean; at: string } | null
  reveal: { answer: string; winner: Team | null; by: string | null } | null
  scores: Record<Team, number>
  order: Record<Team, string[]>
  ended?: 'finished' | 'abandoned' | 'cancelled' | 'expired'
  /** Who left when a team emptied (migration 102). */
  left_by?: string
}

export interface GameSession {
  id: string
  game: GameKind
  mode: 'live' | 'async'
  status: GameStatus
  host_email: string
  lang: string
  settings: Record<string, unknown>
  state: HangmanState
  created_at: string
  updated_at: string
}

export interface GamePlayer {
  session_id: string
  email: string
  team: Team | null
  ready: boolean
  joined_at: string
  left_at: string | null
}

/** Server error codes raised by the RPCs → i18n key suffixes (games.err.*). */
const KNOWN_ERRORS = [
  'game_not_found',
  'game_started',
  'not_ready',
  'need_two_teams',
  'not_host',
  'not_your_turn',
  'bad_word',
  'not_now',
  'not_member',
  'no_recipients',
  'bad_fleet',
  'fleet_incomplete',
  'locked_out',
  'no_questions',
  'has_room',
] as const
export type GameError = (typeof KNOWN_ERRORS)[number] | 'network'

export class GameRpcError extends Error {
  constructor(public code: GameError) {
    super(code)
  }
}

/** Open rooms re-read themselves after any move made from THIS phone, so the
 *  mover sees the result at once even when Realtime is slow or down (on the
 *  Galaxy it fell back to the 8 s poll, and a missile landed as a plain mark). */
const moved = new Set<() => void>()

async function rpc<T = unknown>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) {
    const code = KNOWN_ERRORS.find((k) => error.message?.includes(k))
    throw new GameRpcError(code ?? 'network')
  }
  moved.forEach((f) => f())
  return data as T
}

export const ROOM_IDLE_MS = 15 * 60_000

export const games = {
  /** One live room per host: throws 'has_room' if you already have one;
   *  `replace` closes it first (migration 096). */
  create: (game: GameKind, lang: string, settings: Record<string, unknown> = {}, replace = false) =>
    rpc<string>('game_create', { p_game: game, p_mode: 'live', p_lang: lang, p_settings: settings, ...(replace ? { p_replace: true } : {}) }),
  /** Close the household's live rooms idle 15 min (migration 096). Best effort. */
  sweep: () => supabase.rpc('game_sweep').then(() => undefined, () => undefined),
  join: (id: string) => rpc('game_join', { p_session: id }),
  setTeam: (id: string, team: Team) => rpc('game_set_team', { p_session: id, p_team: team }),
  setReady: (id: string, ready: boolean) => rpc('game_set_ready', { p_session: id, p_ready: ready }),
  leave: (id: string) => rpc('game_leave', { p_session: id }),
  cancel: (id: string) => rpc('game_cancel', { p_session: id }),
  start: (id: string) => rpc('game_start', { p_session: id }),
  skipTurn: (id: string) => rpc('game_skip_turn', { p_session: id }),
  battleship: {
    myFleet: (id: string) => rpc<Ship[]>('battleship_my_fleet', { p_session: id }),
    setFleet: (id: string, ships: Ship[]) => rpc('battleship_set_fleet', { p_session: id, p_ships: ships }),
    ready: (id: string, ready: boolean) => rpc('battleship_ready', { p_session: id, p_ready: ready }),
    fire: (id: string, r: number, c: number) =>
      rpc<{ hit?: boolean; sunk?: boolean; won?: boolean; repeat?: boolean }>('battleship_fire', { p_session: id, p_r: r, p_c: c }),
  },
  quiz: {
    buzz: (id: string) => rpc<{ first: boolean }>('quiz_buzz', { p_session: id }),
    answer: (id: string, text: string, alts: string[] = []) =>
      rpc<{ correct: boolean }>('quiz_answer', alts.length ? { p_session: id, p_text: text, p_alts: alts } : { p_session: id, p_text: text }),
    tick: (id: string) => rpc('quiz_tick', { p_session: id }),
    next: (id: string) => rpc('quiz_next', { p_session: id }),
  },
  hangman: {
    setWord: (id: string, category: string | null, word: string) =>
      rpc('hangman_set_word', { p_session: id, p_category: category, p_word: word }),
    guess: (id: string, letter: string) => rpc<{ hit?: boolean; repeat?: boolean }>('hangman_guess', { p_session: id, p_letter: letter }),
    guessWord: (id: string, word: string) => rpc<{ hit: boolean }>('hangman_guess_word', { p_session: id, p_word: word }),
    next: (id: string) => rpc('hangman_next', { p_session: id }),
    /** "Send a hangman" (migration 092): one one-round session per recipient. */
    send: (recipients: string[], category: string | null, word: string, lang: string) =>
      rpc<string[]>('hangman_send', { p_recipients: recipients, p_category: category, p_word: word, p_lang: lang }),
  },
}

/** Rooms you can see on the Games screen: open lobbies and games in progress
 *  with activity in the last 15 minutes — a forgotten room closes by itself
 *  (game_sweep, migration 096; the time filter covers a server without it). */
export function useOpenGames() {
  const [rooms, setRooms] = useState<(GameSession & { players: GamePlayer[] })[]>([])
  const [loaded, setLoaded] = useState(false)

  const load = useCallback(async () => {
    await games.sweep()
    const since = new Date(Date.now() - ROOM_IDLE_MS).toISOString()
    const { data } = await supabase
      .from('game_sessions')
      .select('*, players:game_players(*)')
      .in('status', ['lobby', 'playing'])
      .gte('updated_at', since)
      .order('updated_at', { ascending: false })
    setRooms(((data ?? []) as (GameSession & { players: GamePlayer[] })[]).filter((r) => r.mode === 'live'))
    setLoaded(true)
  }, [])

  useEffect(() => {
    // Async fetch: state is set after the await, not synchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
    const ch = supabase
      .channel(channelName('games-list'))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'game_sessions' }, () => void load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'game_players' }, () => void load())
      .subscribe()
    const sub = AppState.addEventListener('change', (s) => s === 'active' && void load())
    return () => {
      void supabase.removeChannel(ch)
      sub.remove()
    }
  }, [load])

  return { rooms, loaded, reload: load }
}

/** One room, live. Refetches the whole (small) room on any change rather than
 *  patching rows, so the screen can never drift from the server. */
export function useGameRoom(id: string | undefined, me?: string) {
  const [session, setSession] = useState<GameSession | null>(null)
  /** Emails with the room open now; null until presence first syncs. */
  const [online, setOnline] = useState<Set<string> | null>(null)
  const [players, setPlayers] = useState<GamePlayer[]>([])
  const [missing, setMissing] = useState(false)
  const seq = useRef(0)

  const load = useCallback(async () => {
    if (!id) return
    const mine = ++seq.current
    const [s, p] = await Promise.all([
      supabase.from('game_sessions').select('*').eq('id', id).maybeSingle(),
      supabase.from('game_players').select('*').eq('session_id', id).order('joined_at'),
    ])
    if (mine !== seq.current) return // a newer load already landed
    if (!s.error && !s.data) setMissing(true)
    if (s.data) setSession(s.data as GameSession)
    if (p.data) setPlayers(p.data as GamePlayer[])
  }, [id])

  useEffect(() => {
    if (!id) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
    const ch = supabase
      .channel(channelName(`game:${id}`))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'game_sessions', filter: `id=eq.${id}` }, () => void load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'game_players', filter: `session_id=eq.${id}` }, () => void load())
      .subscribe()
    // Who has the room open right now (Realtime presence): a phone that lost
    // its connection drops out, and the others see "X lost connection".
    // Presence is per TOPIC, so this one must be the SAME name on every phone
    // — channelName()'s per-client counter (`game:<id>:3` vs `:7`) put each
    // player alone in their own room and everyone looked disconnected while
    // playing fine (owner, 2026-11). A stale copy of the topic (fast remount)
    // is dropped first: supabase-js would hand back the old, closing channel.
    const topic = `game-presence:${id}`
    for (const old of supabase.getChannels()) if (old.topic === `realtime:${topic}`) void supabase.removeChannel(old)
    const pres = supabase.channel(topic, { config: { presence: { key: me || undefined } } })
    pres
      .on('presence', { event: 'sync' }, () => {
        const state = pres.presenceState() as Record<string, { email?: string }[]>
        const here = new Set<string>()
        for (const metas of Object.values(state)) for (const m of metas) if (m.email) here.add(m.email)
        setOnline(here)
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED' && me) void pres.track({ email: me })
      })
    // A suspended app misses Realtime events; catch up when it comes back.
    const sub = AppState.addEventListener('change', (st) => st === 'active' && void load())
    // Belt and braces: a slow poll in case a socket silently dies mid-game.
    const poll = setInterval(() => void load(), 8000)
    const onMove = () => void load()
    moved.add(onMove)
    // A room left alone closes after 15 min for everyone still looking at it.
    const sweep = setInterval(() => void games.sweep(), 60_000)
    return () => {
      void supabase.removeChannel(ch)
      void supabase.removeChannel(pres)
      sub.remove()
      clearInterval(poll)
      clearInterval(sweep)
      moved.delete(onMove)
    }
  }, [id, load, me])

  return { session, players, missing, online, reload: load }
}

/** Active (not left) players of a team, in join order. */
export function teamOf(players: GamePlayer[], team: Team) {
  return players.filter((p) => p.team === team && !p.left_at)
}

/** Letters A–Z that can be guessed; accents fold onto these on the server. */
export const ALPHABET = 'abcdefghijklmnopqrstuvwxyz'.split('')

export type Room = GameSession & { players: GamePlayer[] }

/** Sent hangmans (mode 'async', migration 092) that involve me, last 7 days:
 *  `forMe` = waiting for me to play, `sent` = ones I sent (playing or done). */
export function useChallenges(me: string | undefined) {
  const [list, setList] = useState<Room[]>([])
  const load = useCallback(async () => {
    if (!me) return
    const since = new Date(Date.now() - 7 * 86400_000).toISOString()
    const { data } = await supabase
      .from('game_sessions')
      .select('*, players:game_players(*)')
      .eq('mode', 'async')
      .gte('created_at', since)
      .order('created_at', { ascending: false })
    setList(((data ?? []) as Room[]).filter((r) => r.players.some((p) => p.email === me)))
  }, [me])
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch
    void load()
    const ch = supabase
      .channel(channelName('games-challenges'))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'game_sessions' }, () => void load())
      .subscribe()
    const sub = AppState.addEventListener('change', (st) => st === 'active' && void load())
    return () => {
      void supabase.removeChannel(ch)
      sub.remove()
    }
  }, [load])
  const forMe = list.filter((r) => r.status === 'playing' && r.state.guesser === me)
  const sent = list.filter((r) => r.host_email === me)
  const played = list.filter((r) => r.status === 'done' && r.state.guesser === me)
  return { forMe, sent, played, reload: load }
}
