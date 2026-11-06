// A unique Realtime channel name per subscription. supabase.channel(name)
// hands back the EXISTING channel when the name is already in use, and
// adding postgres_changes listeners to one that's subscribed throws
// ("cannot add `postgres_changes` callbacks … after `subscribe()`") — which
// crashed the Home when a deep link stacked a second Hub on the first
// (2026-11). Screens that can be mounted twice must use this.
let n = 0
export function channelName(base: string): string {
  n += 1
  return `${base}:${n}`
}
