// An in-memory stand-in for the Supabase client with the semantics the app
// relies on: RLS scoping to my household, column defaults stamping
// user_email/household_id, upsert-on-conflict, and awaitable query builders.
import { HOUSEHOLD, Row, world } from './world'

type Filter = (r: Row) => boolean

function builder(table: string) {
  const w = world()
  const state: {
    op: 'select' | 'insert' | 'upsert' | 'update' | 'delete'
    payload?: any
    options?: any
    filters: Filter[]
    single: boolean
    maybe: boolean
    limit?: number
  } = { op: 'select', filters: [], single: false, maybe: false }

  const rows = (): Row[] => (w.db[table] ??= [])

  const stamp = (r: Row): Row => ({
    household_id: HOUSEHOLD,
    ...(w.sessionEmail && !('user_email' in r) && table === 'member_locations' ? { user_email: w.sessionEmail } : {}),
    ...r,
  })

  function exec(): { data: any; error: any } {
    if (!w.sessionEmail && state.op !== 'select') {
      return { data: null, error: { message: 'JWT missing', code: '401' } }
    }
    const match = (r: Row) => state.filters.every((f) => f(r))
    let data: any = null
    switch (state.op) {
      case 'select': {
        data = w.sessionEmail ? rows().filter(match) : []
        if (state.limit != null) data = data.slice(0, state.limit)
        break
      }
      case 'insert':
      case 'upsert': {
        const list = (Array.isArray(state.payload) ? state.payload : [state.payload]).map(stamp)
        w.writes.push({ table, op: state.op, payload: state.payload, options: state.options })
        const key: string =
          state.options?.onConflict ?? (table === 'member_locations' ? 'user_email' : 'id')
        for (const r of list) {
          const i = state.op === 'upsert' ? rows().findIndex((x) => x[key] === r[key]) : -1
          if (i >= 0) rows()[i] = { ...rows()[i], ...r }
          else rows().push({ id: `id-${rows().length + 1}`, ...r })
        }
        data = list
        break
      }
      case 'update': {
        w.writes.push({ table, op: 'update', payload: state.payload })
        const hit = rows().filter(match)
        hit.forEach((r) => Object.assign(r, state.payload))
        data = hit
        break
      }
      case 'delete': {
        w.writes.push({ table, op: 'delete', payload: null })
        const keep = rows().filter((r) => !match(r))
        data = rows().filter(match)
        w.db[table] = keep
        break
      }
    }
    if (state.single || state.maybe) {
      const arr = Array.isArray(data) ? data : [data]
      if (arr.length === 0) {
        return state.single ? { data: null, error: { message: 'no rows', code: 'PGRST116' } } : { data: null, error: null }
      }
      return { data: arr[0], error: null }
    }
    return { data, error: null }
  }

  const api: any = {
    select() {
      return proxy
    },
    insert(p: any, o?: any) {
      state.op = 'insert'
      state.payload = p
      state.options = o
      return proxy
    },
    upsert(p: any, o?: any) {
      state.op = 'upsert'
      state.payload = p
      state.options = o
      return proxy
    },
    update(p: any) {
      state.op = 'update'
      state.payload = p
      return proxy
    },
    delete() {
      state.op = 'delete'
      return proxy
    },
    eq(c: string, v: any) {
      state.filters.push((r) => r[c] === v)
      return proxy
    },
    neq(c: string, v: any) {
      state.filters.push((r) => r[c] !== v)
      return proxy
    },
    in(c: string, v: any[]) {
      state.filters.push((r) => v.includes(r[c]))
      return proxy
    },
    is(c: string, v: any) {
      state.filters.push((r) => (r[c] ?? null) === v)
      return proxy
    },
    gt(c: string, v: any) {
      state.filters.push((r) => r[c] > v)
      return proxy
    },
    gte(c: string, v: any) {
      state.filters.push((r) => r[c] >= v)
      return proxy
    },
    lt(c: string, v: any) {
      state.filters.push((r) => r[c] < v)
      return proxy
    },
    lte(c: string, v: any) {
      state.filters.push((r) => r[c] <= v)
      return proxy
    },
    limit(n: number) {
      state.limit = n
      return proxy
    },
    single() {
      state.single = true
      return proxy
    },
    maybeSingle() {
      state.maybe = true
      return proxy
    },
    then(res: any, rej: any) {
      return Promise.resolve().then(exec).then(res, rej)
    },
  }
  // Anything else (order, or, not, range, abortSignal, returns…) is a no-op
  // that keeps the chain going.
  const proxy: any = new Proxy(api, {
    get(t, k) {
      if (k in t) return t[k as string]
      if (typeof k === 'symbol') return undefined
      return () => proxy
    },
  })
  return proxy
}

function channel() {
  const ch: any = {
    on: () => ch,
    subscribe: (cb?: (s: string) => void) => {
      cb?.('SUBSCRIBED')
      return ch
    },
    unsubscribe: async () => 'ok',
    send: async () => 'ok',
    track: async () => 'ok',
  }
  return ch
}

function session() {
  const email = world().sessionEmail
  if (!email) return null
  return {
    access_token: 'test-access-token',
    refresh_token: 'test-refresh-token',
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: { id: 'user-1', email },
  }
}

export const supabase: any = {
  from: (table: string) => builder(table),
  rpc: async (name: string, args?: any) => {
    const fn = world().rpc[name]
    return fn ? { data: await fn(args), error: null } : { data: null, error: null }
  },
  channel: () => channel(),
  removeChannel: async () => 'ok',
  removeAllChannels: async () => [],
  auth: {
    getSession: async () => ({ data: { session: session() }, error: null }),
    getUser: async () => ({ data: { user: session()?.user ?? null }, error: null }),
    refreshSession: async () => ({ data: { session: session() }, error: null }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    startAutoRefresh: () => {},
    stopAutoRefresh: () => {},
  },
  functions: { invoke: async () => ({ data: null, error: null }) },
  storage: {
    from: () => ({
      upload: async () => ({ data: null, error: null }),
      createSignedUrl: async () => ({ data: { signedUrl: 'https://x' }, error: null }),
      createSignedUrls: async () => ({ data: [], error: null }),
    }),
  },
}
