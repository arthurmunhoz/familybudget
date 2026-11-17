import { buildFeed, type EventRow } from '../src/lib/activityFeed'

let id = 0
const row = (type: string, extra: Partial<EventRow> = {}): EventRow => ({
  id: ++id,
  user_email: 'm@x.com',
  type,
  path: null,
  target: null,
  meta: null,
  created_at: '2026-11-16T12:00:00Z',
  ...extra,
})

describe('admin feed', () => {
  it('folds a run of screens into one line, oldest first', () => {
    // newest first, as the RPC returns them
    const feed = buildFeed([
      row('screen_view', { path: '/calc/deal' }),
      row('screen_view', { path: '/calc' }),
      row('screen_view', { path: '/' }),
    ])
    expect(feed).toHaveLength(1)
    expect(feed[0].predicate).toBe('looked at Home → Utilities → Utilities › Better deal')
  })
  it('an action splits screen runs', () => {
    const feed = buildFeed([
      row('screen_view', { path: '/pets' }),
      row('pet.created', { meta: { species: 'dog', name_len: 5, filled: ['photo', 'birthday'], empty: ['breed', 'weight'] } }),
      row('screen_view', { path: '/pets' }),
    ])
    expect(feed.map((f) => f.predicate)).toEqual(['looked at Pets', 'added a pet (dog)', 'looked at Pets'])
    expect(feed[1].detail).toBe('filled photo, birthday · left breed, weight empty')
  })
  it('says which nudge was sent', () => {
    const p = (meta: Record<string, unknown>) => buildFeed([row('nudge.sent', { meta })])[0].predicate
    expect(p({ source: 'preset', kind: 'omw', recipients: null, urgent: false })).toBe('sent the ready-made nudge “omw” to everyone')
    expect(p({ source: 'typed', kind: 'custom', messageLength: 12, recipients: 2 })).toBe('typed a nudge (12 chars) to 2 people')
    expect(p({ source: 'drawing', drawing: true, recipients: 1 })).toBe('sent a hand-drawn note to 1 person')
    expect(p({ kind: 'help', urgent: true })).toBe('sent a nudge (help) to everyone, as urgent')
  })
  it('routine from the template vs typed', () => {
    const p = (meta: Record<string, unknown>) => buildFeed([row('petcare.task_added', { meta })])[0].predicate
    expect(p({ source: 'template', count: 4 })).toBe('added the suggested routine (4 tasks) to a pet')
    expect(p({ source: 'own', kind: 'interval', everyDays: 30, reminder: true })).toBe("added a task to a pet's routine (every 30 days, with a reminder)")
  })
})
