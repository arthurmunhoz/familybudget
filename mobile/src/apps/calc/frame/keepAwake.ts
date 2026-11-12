// Keep the screen on while the photo frame is open. expo-keep-awake ships
// inside the `expo` package (it's a dependency of it, so it's in every binary
// built from this project), but it's required lazily and guarded anyway — the
// mobile/CLAUDE.md rule for native modules: an older binary without it must
// get a frame that may dim, never a crash.
type KeepAwake = {
  activateKeepAwakeAsync: (tag?: string) => Promise<void>
  deactivateKeepAwake: (tag?: string) => Promise<void>
}

let mod: KeepAwake | null | undefined
function load(): KeepAwake | null {
  if (mod !== undefined) return mod
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    mod = require('expo-keep-awake') as KeepAwake
  } catch {
    mod = null
  }
  return mod
}

const TAG = 'photo-frame'

export async function keepAwakeOn(): Promise<boolean> {
  const m = load()
  if (!m) return false
  try {
    await m.activateKeepAwakeAsync(TAG)
    return true
  } catch {
    return false
  }
}

export function keepAwakeOff(): void {
  const m = load()
  if (!m) return
  m.deactivateKeepAwake(TAG).catch(() => {})
}
