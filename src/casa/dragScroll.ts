// Mouse drag-to-scroll for the home device (owner, 2026-11-13: "clicking and
// dragging doesn't move it like a finger does"). Fingers already scroll every
// `.casa-scroll` natively; a MOUSE does not, so a press-and-drag that starts
// inside one and moves mostly vertically scrolls it, and the click that ends
// the drag is swallowed so it doesn't also tick a row. Horizontal drags are
// left alone (the widget pager swipes sideways). Wheels already work.
export function installDragScroll(): () => void {
  let el: HTMLElement | null = null
  let id = -1
  let y0 = 0
  let x0 = 0
  let top0 = 0
  let on = false
  let dead = false
  let swallow = false

  const scroller = (t: EventTarget | null): HTMLElement | null => {
    let n = t instanceof HTMLElement ? t : null
    while (n) {
      if (n.classList?.contains('casa-scroll') && n.scrollHeight > n.clientHeight + 1) return n
      n = n.parentElement
    }
    return null
  }
  const down = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return
    if ((e.target as HTMLElement)?.closest?.('input, textarea, select, [contenteditable]')) return
    el = scroller(e.target)
    if (!el) return
    id = e.pointerId
    y0 = e.clientY
    x0 = e.clientX
    top0 = el.scrollTop
    on = false
    dead = false
  }
  const move = (e: PointerEvent) => {
    if (!el || e.pointerId !== id || dead) return
    const dy = e.clientY - y0
    const dx = e.clientX - x0
    if (!on) {
      if (Math.abs(dy) < 6 && Math.abs(dx) < 6) return
      if (Math.abs(dx) > Math.abs(dy)) {
        dead = true
        return
      }
      on = true
      document.documentElement.style.cursor = 'grabbing'
    }
    el.scrollTop = top0 - dy
    e.preventDefault()
  }
  const up = (e: PointerEvent) => {
    if (e.pointerId !== id) return
    if (on) {
      swallow = true
      setTimeout(() => (swallow = false), 0)
    }
    document.documentElement.style.cursor = ''
    el = null
    id = -1
    on = false
  }
  const click = (e: MouseEvent) => {
    if (!swallow) return
    swallow = false
    e.stopPropagation()
    e.preventDefault()
  }
  window.addEventListener('pointerdown', down, true)
  window.addEventListener('pointermove', move, { capture: true, passive: false })
  window.addEventListener('pointerup', up, true)
  window.addEventListener('pointercancel', up, true)
  window.addEventListener('click', click, true)
  return () => {
    window.removeEventListener('pointerdown', down, true)
    window.removeEventListener('pointermove', move, true)
    window.removeEventListener('pointerup', up, true)
    window.removeEventListener('pointercancel', up, true)
    window.removeEventListener('click', click, true)
  }
}
