// Today's date (ISO `YYYY-MM-DD`) that ACTUALLY ADVANCES while the screen stays
// mounted.
//
// `const today = todayISO()` in a render body only updates when something else
// re-renders the component, and on iOS that can be days. The app is suspended,
// not killed: reopen it and the same tree renders again with the same state, so
// a Hub left open on the 10th still says "Sunday, Aug 10" on the 12th and still
// scores "due today" against the 10th. Refetching the data doesn't help —
// useCachedQuery deliberately doesn't re-render when the rows are unchanged,
// and an unchanged agenda is exactly the case that goes wrong.
//
// So the date gets its own state, moved on the two events that can change it:
// the app returning from the background, and midnight passing with the app
// open. (Only the second needs a timer; JS timers don't run while iOS has the
// process suspended, which is what the foreground hook is there for.)
import { useCallback, useEffect, useState } from 'react'

import { todayISO } from '@/lib/format'
import { useRevalidateOnForeground } from './useCachedQuery'

export function useToday(): string {
  const [day, setDay] = useState(todayISO)

  // Same value → same state object, so a foreground that didn't cross midnight
  // costs nothing.
  const sync = useCallback(() => {
    setDay((prev) => {
      const now = todayISO()
      return now === prev ? prev : now
    })
  }, [])

  useRevalidateOnForeground(sync)

  useEffect(() => {
    // Re-armed after every rollover (`day` is a dependency). A few seconds past
    // midnight rather than exactly on it, so a slightly early timer can't read
    // back the day that just ended.
    const now = new Date()
    const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 5)
    const id = setTimeout(sync, Math.max(1000, next.getTime() - now.getTime()))
    return () => clearTimeout(id)
  }, [day, sync])

  return day
}
