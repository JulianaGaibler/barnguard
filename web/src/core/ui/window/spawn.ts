/**
 * Shared registry + spawn-positioning helper for `DraggableWindow` instances.
 *
 * A window that mounts with a `storageId` calls `registerWindow` so any other
 * code can ask "where is that window right now?" without walking the DOM.
 * `placeNextTo` uses that registry to seed a child window's initial position
 * next to its spawning parent, so operator flows like "booth menu → printer
 * panel" don't dump both windows on top of each other in the top-left corner.
 *
 * The helper only writes a starting position on the child's FIRST open (no
 * saved position). Once the operator has dragged the window anywhere, their
 * saved position wins; subsequent opens honour it and `placeNextTo` no-ops.
 *
 * Re-anchor cascades: when a parent window re-anchors (its `side` prop changes,
 * or the × close button resets it), any window that declared it as their
 * `spawnedBy` also resets — otherwise a child's stale saved position (e.g.
 * seeded when the parent was on the OTHER side) would keep it far from the
 * parent's new location. See `resetChildrenOf`.
 */

type RectGetter = () => DOMRect | null
type ResetFn = () => void

interface WindowEntry {
  getRect: RectGetter
  reset: ResetFn
  spawnedBy?: string
}

const windows = new Map<string, WindowEntry>()

export function registerWindow(
  storageId: string,
  getRect: RectGetter,
  reset: ResetFn,
  spawnedBy?: string,
): void {
  windows.set(storageId, { getRect, reset, spawnedBy })
}

export function unregisterWindow(storageId: string): void {
  windows.delete(storageId)
}

/**
 * Reset every window that declared `parentStorageId` as its `spawnedBy`. Each
 * child's `reset` clears its localStorage entry and its in-memory position, so
 * its next reactive tick re-seeds via `placeNextTo` against the parent's new
 * anchor. Non-recursive: grand-children reset when their own parent's reset
 * runs.
 */
export function resetChildrenOf(parentStorageId: string): void {
  for (const entry of windows.values()) {
    if (entry.spawnedBy === parentStorageId) {
      entry.reset()
    }
  }
}

export interface PlaceNextToOptions {
  /** Gap in CSS px between parent and child edges. */
  gap?: number
  /**
   * Fallback child width used when the child isn't mounted yet (so its rect
   * can't be measured). Defaults to a mid-sized panel width.
   */
  childWidth?: number
  /** Fallback child height used when the child isn't mounted yet. */
  childHeight?: number
}

/**
 * Seed the child window's saved position adjacent to the parent window, but
 * only if the child doesn't already have a saved position. Preference order:
 * right of parent → left of parent → below parent → clamped to viewport.
 */
export function placeNextTo(
  parentStorageId: string,
  childStorageId: string,
  opts: PlaceNextToOptions = {},
): void {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
    return
  }
  // Operator preference wins; if the child already knows where it belongs,
  // don't overwrite.
  if (localStorage.getItem(childStorageId) !== null) return

  const parentRect = windows.get(parentStorageId)?.getRect()
  if (!parentRect) return

  const gap = opts.gap ?? 12
  const padding = 10

  const childRect = windows.get(childStorageId)?.getRect()
  const childW = childRect?.width ?? opts.childWidth ?? 320
  const childH = childRect?.height ?? opts.childHeight ?? 200

  const viewportW = window.innerWidth
  const viewportH = window.innerHeight

  let x: number
  let y = parentRect.top

  const rightSlot = parentRect.right + gap
  const leftSlot = parentRect.left - childW - gap

  if (rightSlot + childW + padding <= viewportW) {
    x = rightSlot
  } else if (leftSlot >= padding) {
    x = leftSlot
  } else {
    // Neither horizontal slot fits; drop below the parent instead.
    x = parentRect.left
    y = parentRect.bottom + gap
  }

  const maxX = Math.max(padding, viewportW - childW - padding)
  const maxY = Math.max(padding, viewportH - childH - padding)
  x = Math.max(padding, Math.min(x, maxX))
  y = Math.max(padding, Math.min(y, maxY))

  localStorage.setItem(childStorageId, JSON.stringify({ x, y }))
}
