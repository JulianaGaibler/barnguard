// Tracks whether anything in the scene may use offscreen surfaces.
//
// The main render pass opens before the frame's 2D draws are replayed, and a
// pass cannot start storing its multisampled samples after it has begun. The
// renderer therefore decides at the start of a frame whether to keep them, and
// it keeps them only while something has asked for offscreen compositing.

let demand = 0

/**
 * Declare that a node may use offscreen surfaces. Returns a function that
 * withdraws the claim, which must be called once.
 *
 * @internal
 */
export function addOffscreenDemand(): () => void {
  demand++
  let released = false
  return () => {
    if (released) return
    released = true
    demand--
  }
}

/** Whether any live claim exists. @internal */
export function hasOffscreenDemand(): boolean {
  return demand > 0
}
