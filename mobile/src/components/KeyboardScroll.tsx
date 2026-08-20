// A ScrollView that keeps the focused field visible above the keyboard.
//
// Why this and not KeyboardAvoidingView: inside a RN <Modal> the modal is its
// own native view hierarchy, so KAV mis-measures (the same reason
// `useKeyboardHeight` exists) and iOS's `automaticallyAdjustKeyboardInsets`
// doesn't reach it either. On a tall form in a bottom sheet that left fields
// like Color and Weight sitting under the keyboard with no way to see them
// while typing — reported on the Add-pet sheet.
//
// How it works: the host shrinks its sheet above the keyboard (so this
// scroller's own height IS the visible window), and this measures the focused
// field against the scroll content and scrolls just far enough to bring it
// inside. It never scrolls a field that is already visible.
//
// Fields opt in for FREE: `<Field>` in components/ui reports its focus through
// this context, so there's no per-field wiring — and the report is a no-op on
// any screen that doesn't use this scroller.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  type ReactNode,
  type RefObject,
} from 'react'
import { ScrollView, View, type ScrollViewProps } from 'react-native'

import { useKeyboardHeight } from '@/hooks/useKeyboardHeight'

/** Air kept between the focused field and the edge of the visible window. */
const REVEAL_MARGIN = 14
/** Focus fires BEFORE the keyboard is up and the sheet has resized, so the
 *  measurement waits for the layout to settle. `onLayout` re-schedules too, so
 *  a slow keyboard animation self-corrects rather than landing short. */
const REVEAL_DELAY = 90

type FocusReporter = (node: View | null) => void

const noop: FocusReporter = () => {}
const Ctx = createContext<FocusReporter | null>(null)

/** Report a newly-focused field so the surrounding KeyboardScroll can reveal
 *  it. Returns a no-op outside one, so callers never have to check. */
export function useRevealOnFocus(): FocusReporter {
  return useContext(Ctx) ?? noop
}

export function KeyboardScroll({
  children,
  onLayout,
  onScroll,
  ...rest
}: ScrollViewProps & { children: ReactNode }) {
  const scrollRef = useRef<ScrollView>(null)
  // The scroll's CONTENT view — what field positions are measured against.
  // Taken as a ref rather than via getInnerViewNode(), which goes through the
  // deprecated findNodeHandle.
  const contentRef = useRef<View>(null)
  const focused = useRef<View | null>(null)
  const offsetY = useRef(0)
  const viewportH = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const kb = useKeyboardHeight()

  const reveal = useCallback(() => {
    const node = focused.current
    const scroll = scrollRef.current
    const content = contentRef.current
    if (!node || !scroll || !content || viewportH.current === 0) return
    node.measureLayout(
      content,
      (_x, y, _w, h) => {
        const top = y - REVEAL_MARGIN
        const bottom = y + h + REVEAL_MARGIN
        if (bottom > offsetY.current + viewportH.current) {
          scroll.scrollTo({ y: Math.max(0, bottom - viewportH.current), animated: true })
        } else if (top < offsetY.current) {
          scroll.scrollTo({ y: Math.max(0, top), animated: true })
        }
      },
      // Measuring can fail if the field unmounted between focus and here.
      () => {},
    )
  }, [])

  const schedule = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(reveal, REVEAL_DELAY)
  }, [reveal])

  // The keyboard opening (or changing height — a number pad and a text keyboard
  // aren't the same size) is what makes a field disappear, so re-reveal then.
  // On close nothing is focused any more; forget the field instead of scrolling.
  useEffect(() => {
    if (kb > 0) schedule()
    else focused.current = null
  }, [kb, schedule])

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )

  const report = useCallback<FocusReporter>(
    (node) => {
      focused.current = node
      schedule()
    },
    [schedule],
  )

  return (
    <Ctx.Provider value={report}>
      <ScrollView
        ref={scrollRef}
        // Cast: RN types `innerViewRef` as RefObject<View>, but every ref
        // starts null — the type just predates React 19's stricter RefObject.
        innerViewRef={contentRef as RefObject<View>}
        keyboardShouldPersistTaps="handled"
        scrollEventThrottle={16}
        {...rest}
        onLayout={(e) => {
          viewportH.current = e.nativeEvent.layout.height
          // The sheet resizing around the keyboard lands here — re-measure, so
          // a reveal scheduled before the resize doesn't use the old window.
          if (kb > 0) schedule()
          onLayout?.(e)
        }}
        onScroll={(e) => {
          offsetY.current = e.nativeEvent.contentOffset.y
          onScroll?.(e)
        }}
      >
        {children}
      </ScrollView>
    </Ctx.Provider>
  )
}
