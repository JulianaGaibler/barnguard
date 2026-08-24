/**
 * How long since a human touched the screen.
 *
 * Kiosk displays use this to put themselves back the way they opened after a
 * visitor walks off. The signal is deliberately display-agnostic: what counts
 * as idle, and what to do about it, belongs to each display.
 */

/** Input types that count as a person being present. */
const INPUT_EVENTS = [
  'pointerdown',
  'pointermove',
  'pointerup',
  'keydown',
  'wheel',
] as const

const LISTENER_OPTIONS = { capture: true, passive: true } as const

// `performance.now()` rather than `Date.now()`: the booth runs unattended for
// months, and a clock correction must not read as ten minutes of idle.
let lastInputMs = performance.now()

/** Count the present moment as input. */
export function pokeActivity(): void {
  lastInputMs = performance.now()
}

/** Milliseconds since the last input. */
export function msSinceInput(): number {
  return performance.now() - lastInputMs
}

/**
 * Start counting input on `window`, and hand back the detach.
 *
 * Capture phase rather than the engine's pointer events, because roughly half
 * of what a visitor touches is DOM overlays the engine never sees, and the
 * engine `preventDefault()`s the rest. Attach this before any other
 * capture-phase `window` listener that calls `stopImmediatePropagation`, or the
 * input it swallows never reaches here (see `initBoothMenuToggle`).
 */
export function startActivityTracking(): () => void {
  for (const type of INPUT_EVENTS) {
    window.addEventListener(type, pokeActivity, LISTENER_OPTIONS)
  }
  pokeActivity()
  return () => {
    for (const type of INPUT_EVENTS) {
      window.removeEventListener(type, pokeActivity, LISTENER_OPTIONS)
    }
  }
}
