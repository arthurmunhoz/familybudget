// A small long-press-to-drag sortable list, built on the modern gesture-handler
// Gesture API + reanimated 4 (react-native-draggable-flatlist can't be used —
// it relies on useAnimatedGestureHandler, removed in reanimated 4).
//
// Rows are absolutely positioned by their index * rowHeight; a shared
// `positions` map (id → index) is the source of truth while dragging. Long-press
// picks a row up (so a short tap still reaches the row's own Pressables, and a
// short vertical swipe still scrolls a parent ScrollView); dragging past a
// neighbour reindexes the map and the others spring to their new slots. On
// release the final order is committed to JS via onReorder.
//
// IMPORTANT: for gestures to work inside a RN <Modal>, the modal's content must
// be wrapped in <GestureHandlerRootView> — the app-root one doesn't reach into a
// modal's separate native hierarchy.
import { type ReactNode, useEffect } from 'react'
import { View } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, {
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated'
import { scheduleOnRN } from 'react-native-worklets'

const SPRING = { damping: 20, stiffness: 220, mass: 0.6 }

function clamp(v: number, lo: number, hi: number): number {
  'worklet'
  return Math.min(Math.max(v, lo), hi)
}

/** Move the row currently at `from` to `to`, shifting everything between. */
function reindex(
  order: Record<string, number>,
  from: number,
  to: number,
): Record<string, number> {
  'worklet'
  const next: Record<string, number> = {}
  for (const id in order) {
    const p = order[id]
    if (p === from) next[id] = to
    else if (from < to && p > from && p <= to) next[id] = p - 1
    else if (from > to && p < from && p >= to) next[id] = p + 1
    else next[id] = p
  }
  return next
}

export interface DragItem {
  id: string
}

export function DraggableList<T extends DragItem>({
  data,
  rowHeight,
  renderItem,
  onReorder,
}: {
  data: T[]
  rowHeight: number
  renderItem: (item: T) => ReactNode
  /** Called once on drop with the ids in their new order. */
  onReorder: (orderedIds: string[]) => void
}) {
  // id → index. Re-seeded whenever the membership/order from the parent changes
  // (add / delete / a committed reorder). Not seeded mid-drag: the parent data
  // only changes after we commit, so this never clobbers an in-progress drag.
  const positions = useSharedValue<Record<string, number>>(
    Object.fromEntries(data.map((d, i) => [d.id, i])),
  )
  // Re-seed on any membership/order change from the parent (add / delete / a
  // committed reorder). Runs only when the id-order string changes — never
  // mid-drag, since the parent's data changes only after we commit — so it can't
  // clobber a drag in progress. Writing a shared value from JS is fine.
  const orderKey = data.map((d) => d.id).join('|')
  useEffect(() => {
    positions.value = Object.fromEntries(data.map((d, i) => [d.id, i]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderKey])

  function commit() {
    const pos = positions.value
    onReorder(Object.keys(pos).sort((a, b) => pos[a] - pos[b]))
  }

  return (
    <View style={{ height: data.length * rowHeight }}>
      {data.map((item) => (
        <Row
          key={item.id}
          id={item.id}
          count={data.length}
          rowHeight={rowHeight}
          positions={positions}
          onCommit={commit}
        >
          {renderItem(item)}
        </Row>
      ))}
    </View>
  )
}

function Row({
  id,
  count,
  rowHeight,
  positions,
  onCommit,
  children,
}: {
  id: string
  count: number
  rowHeight: number
  positions: ReturnType<typeof useSharedValue<Record<string, number>>>
  onCommit: () => void
  children: ReactNode
}) {
  const top = useSharedValue((positions.value[id] ?? 0) * rowHeight)
  const dragging = useSharedValue(false)
  const startTop = useSharedValue(0)

  // Follow index changes driven by OTHER rows moving (but not while I'm the one
  // being dragged — my finger owns `top` then).
  useAnimatedReaction(
    () => positions.value[id],
    (cur, prev) => {
      if (cur != null && cur !== prev && !dragging.value) {
        top.value = withSpring(cur * rowHeight, SPRING)
      }
    },
  )

  const pan = Gesture.Pan()
    .activateAfterLongPress(180)
    .onStart(() => {
      dragging.value = true
      startTop.value = top.value
    })
    .onUpdate((e) => {
      top.value = startTop.value + e.translationY
      const newIndex = clamp(Math.round(top.value / rowHeight), 0, count - 1)
      const curIndex = positions.value[id]
      if (newIndex !== curIndex) {
        positions.value = reindex(positions.value, curIndex, newIndex)
      }
    })
    .onEnd(() => {
      top.value = withSpring(positions.value[id] * rowHeight, SPRING)
    })
    .onFinalize(() => {
      if (dragging.value) {
        dragging.value = false
        scheduleOnRN(onCommit)
      }
    })

  const style = useAnimatedStyle(() => ({
    position: 'absolute',
    left: 0,
    right: 0,
    top: top.value,
    height: rowHeight,
    zIndex: dragging.value ? 10 : 0,
    transform: [{ scale: withSpring(dragging.value ? 1.03 : 1, SPRING) }],
    // A soft lift while held.
    shadowColor: '#000',
    shadowOpacity: dragging.value ? 0.18 : 0,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: dragging.value ? 8 : 0,
  }))

  return (
    <Animated.View style={style}>
      <GestureDetector gesture={pan}>
        <View style={{ flex: 1, justifyContent: 'center' }}>{children}</View>
      </GestureDetector>
    </Animated.View>
  )
}
