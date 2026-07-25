/**
 * Shelf packer for a 2D atlas page with variably-sized entries (the label
 * atlas). Rows ("shelves") are opened top-to-bottom; each shelf has a fixed
 * bucketed height and packs entries left-to-right. Freed spans join a per-shelf
 * free list so an evicted label's slot is reusable by any later label that fits
 * the shelf height and is no wider than the span.
 *
 * Heights are bucketed (rounded up to a multiple of `bucket`) so a shelf serves
 * a band of similar heights: the same label re-rasterized at the same scale
 * lands on an identically-sized slot, and near-height labels share shelves,
 * which keeps freed spans reusable instead of each height opening its own row.
 *
 * The packer only tracks rectangles; the caller owns the pixels (a backing
 * canvas + GL texture) and the mapping from an entry to its placement.
 */

/** A packed rectangle's top-left corner, in page pixels. */
export interface PackedRect {
  x: number
  y: number
}

/** A contiguous free span within a shelf, in page pixels along x. */
interface FreeSpan {
  x: number
  w: number
}

interface Shelf {
  /** Top edge of the shelf in page pixels. */
  y: number
  /** Bucketed shelf height in page pixels; entries must be no taller. */
  height: number
  /** Next unused x at the shelf's right end. */
  cursorX: number
  /** Freed interior spans, kept sorted by `x` and coalesced. */
  free: FreeSpan[]
}

export class ShelfPacker {
  readonly #width: number
  readonly #height: number
  readonly #bucket: number
  #shelves: Shelf[] = []
  #usedHeight = 0

  /**
   * @param width Page width in pixels.
   * @param height Page height in pixels.
   * @param bucket Height-bucket granularity in pixels; shelf heights round up
   *   to a multiple of this. Smaller values waste less vertical space per shelf
   *   but open more shelves (less cross-label span reuse).
   */
  constructor(width: number, height: number, bucket = 4) {
    this.#width = width
    this.#height = height
    this.#bucket = Math.max(1, Math.floor(bucket))
  }

  /**
   * Place a `w × h` box. Reuses a freed span on a matching-height shelf when
   * one fits, else appends to such a shelf's right end, else opens a new shelf.
   * Returns the top-left corner, or `null` if the page has no room.
   */
  pack(w: number, h: number): PackedRect | null {
    if (w <= 0 || h <= 0 || w > this.#width) return null
    const bh = Math.ceil(h / this.#bucket) * this.#bucket
    if (bh > this.#height) return null

    for (const shelf of this.#shelves) {
      if (shelf.height !== bh) continue
      // First-fit over freed spans.
      for (let i = 0; i < shelf.free.length; i++) {
        const span = shelf.free[i]
        if (span.w < w) continue
        const x = span.x
        if (span.w === w) shelf.free.splice(i, 1)
        else {
          span.x += w
          span.w -= w
        }
        return { x, y: shelf.y }
      }
      // Append at the shelf's right end.
      if (shelf.cursorX + w <= this.#width) {
        const x = shelf.cursorX
        shelf.cursorX += w
        return { x, y: shelf.y }
      }
    }

    // Open a new shelf if there's vertical room.
    if (this.#usedHeight + bh <= this.#height) {
      const shelf: Shelf = {
        y: this.#usedHeight,
        height: bh,
        cursorX: w,
        free: [],
      }
      this.#shelves.push(shelf)
      this.#usedHeight += bh
      return { x: 0, y: shelf.y }
    }

    return null
  }

  /**
   * Return the span `[x, x + w)` at row `y` to the free list. A span flush
   * against the shelf's right end pulls the cursor back (and absorbs any free
   * spans now adjacent to it); an interior span is inserted and coalesced with
   * its neighbors. A `(x, y, w)` that names no live shelf is ignored.
   */
  free(x: number, y: number, w: number): void {
    const shelf = this.#shelves.find((s) => s.y === y)
    if (!shelf || w <= 0) return

    if (x + w === shelf.cursorX) {
      shelf.cursorX = x
      // Reclaim any free spans that now touch the cursor's left edge.
      let merged = true
      while (merged) {
        merged = false
        for (let i = 0; i < shelf.free.length; i++) {
          if (shelf.free[i].x + shelf.free[i].w === shelf.cursorX) {
            shelf.cursorX = shelf.free[i].x
            shelf.free.splice(i, 1)
            merged = true
            break
          }
        }
      }
      return
    }

    shelf.free.push({ x, w })
    shelf.free.sort((a, b) => a.x - b.x)
    for (let i = 0; i < shelf.free.length - 1;) {
      const cur = shelf.free[i]
      const next = shelf.free[i + 1]
      if (cur.x + cur.w === next.x) {
        cur.w += next.w
        shelf.free.splice(i + 1, 1)
      } else {
        i++
      }
    }
  }

  /** Drop every shelf so the page can be repacked from scratch. */
  reset(): void {
    this.#shelves = []
    this.#usedHeight = 0
  }
}
