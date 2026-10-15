import type { DataTable, GfxDevice } from './GfxDevice'
import { clipEquals, type ResolvedClip } from './StateStack'

/**
 * Size of one param record, in `vec4` elements. A record is the per-primitive
 * state that does not live in a vertex or instance: today the clip, later a
 * transform, paint and texture layer. A primitive carries the index of its
 * record as a `u32` attribute, and the vertex shader reads the record from the
 * table at `index * PARAM_RECORD_VEC4`.
 */
export const PARAM_RECORD_VEC4 = 4

const RECORD_FLOATS = PARAM_RECORD_VEC4 * 4

/** Where the param table binds in the shared frame group. */
export const PARAM_TABLE_BINDING = 10

/**
 * Records of one frame, in a {@link DataTable} the 2D programs read by index.
 *
 * Index 0 is the empty record, which reads as "no clip", so a primitive written
 * as zero is unclipped. A clip record holds the clip shape in the local space
 * of the transform it was set under, plus the inverse of that transform, so the
 * fragment stage maps a device pixel back into local space and measures it
 * against the shape. A circle clip under a non-uniform scale is then the
 * ellipse it should be, and a rounded rect stays correct under rotation.
 *
 * Record layout, as `vec4` elements:
 *
 * - `(kind, cx, cy, radius)` where `kind` is 0 none, 1 circle, 2 rounded rect,
 *   and `radius` is the circle radius.
 * - `(halfW, halfH, tl, tr)`, the rounded rect half extents and its top corner
 *   radii.
 * - `(ia, ib, ic, id)` and then `(ie, if, br, bl)`, the device to local affine,
 *   `local.x = ia*x + ic*y + ie` and `local.y = ib*x + id*y + if`, and the
 *   rounded rect's bottom corner radii. The radii fill the words the half
 *   extents and the translation leave free.
 */
export class ParamTable {
  #data = new Float32Array(256 * RECORD_FLOATS)
  #count = 1
  #table: DataTable | null = null
  #capacity = 0
  #lastClip: ResolvedClip | null = null
  #lastIndex = 0
  /** Changes when the GPU table is replaced, so bind groups naming it rebuild. */
  generation = 0

  /** Start a frame: only the empty record is live. */
  reset(): void {
    this.#count = 1
    this.#lastClip = null
    this.#lastIndex = 0
  }

  /** Records written this frame, the empty one included. */
  get count(): number {
    return this.#count
  }

  /** The record index for `clip`, written now if it is not the last one used. */
  clipIndex(clip: ResolvedClip | null): number {
    if (clip === null) return 0
    if (this.#lastClip && clipEquals(clip, this.#lastClip))
      return this.#lastIndex
    const index = this.#count++
    this.#grow(this.#count)
    writeClipRecord(this.#data, index * RECORD_FLOATS, clip)
    this.#lastClip = clip
    this.#lastIndex = index
    return index
  }

  /** The record at `index`, as its floats, for tests. */
  record(index: number): Float32Array {
    return this.#data.subarray(
      index * RECORD_FLOATS,
      (index + 1) * RECORD_FLOATS,
    )
  }

  #grow(records: number): void {
    if (records * RECORD_FLOATS <= this.#data.length) return
    const next = new Float32Array(
      Math.max(records, (this.#data.length / RECORD_FLOATS) * 2) *
        RECORD_FLOATS,
    )
    next.set(this.#data)
    this.#data = next
  }

  /**
   * Send this frame's records to the GPU table, replacing the table with a
   * larger one when they no longer fit. Returns the table to bind.
   */
  upload(device: GfxDevice): DataTable {
    const need = this.#count * PARAM_RECORD_VEC4
    if (this.#table === null || need > this.#capacity) {
      if (this.#table) device.deleteDataTable(this.#table)
      let capacity = Math.max(this.#capacity, 1024)
      while (capacity < need) capacity *= 2
      capacity = Math.min(capacity, device.limits.maxDataTableVec4)
      this.#table = device.createDataTable(capacity)
      this.#capacity = capacity
      this.generation++
    }
    device.updateDataTable(this.#table, 0, this.#data.subarray(0, need * 4))
    return this.#table
  }

  /** The table to bind before the first upload: one empty record. */
  ensure(device: GfxDevice): DataTable {
    return this.#table ?? this.upload(device)
  }

  /** Forget the GPU table, after a device loss. */
  dropGpu(): void {
    this.#table = null
    this.#capacity = 0
    this.generation++
  }
}

/** Write `clip` as a record at `at` in `out`. */
export function writeClipRecord(
  out: Float32Array,
  at: number,
  clip: ResolvedClip,
): void {
  out[at] = clip.kind
  out[at + 1] = clip.lcx
  out[at + 2] = clip.lcy
  out[at + 3] = clip.kind === 1 ? clip.lr : 0
  out[at + 4] = clip.lhalfW
  out[at + 5] = clip.lhalfH
  out[at + 6] = clip.lradii[0]
  out[at + 7] = clip.lradii[1]
  out[at + 8] = clip.ia
  out[at + 9] = clip.ib
  out[at + 10] = clip.ic
  out[at + 11] = clip.id
  out[at + 12] = clip.ie
  out[at + 13] = clip.if
  out[at + 14] = clip.lradii[2]
  out[at + 15] = clip.lradii[3]
}

/**
 * Signed distance, in local units, from the device pixel `(x, y)` to the clip
 * shape in `record`, negative inside. The fragment shaders compute the same
 * thing, and this is what tests check a clip against. A record of kind 0 is
 * `-Infinity`, everywhere inside.
 */
export function clipDistance(
  record: ArrayLike<number>,
  x: number,
  y: number,
): number {
  const kind = record[0]
  if (kind < 0.5) return -Infinity
  const lx = record[8] * x + record[10] * y + record[12]
  const ly = record[9] * x + record[11] * y + record[13]
  const px = lx - record[1]
  const py = ly - record[2]
  if (kind < 1.5) return Math.hypot(px, py) - record[3]
  // The radius of the corner in the point's quadrant: tl, tr, br, bl.
  const rad =
    px > 0 ? (py > 0 ? record[14] : record[7]) : py > 0 ? record[15] : record[6]
  const qx = Math.abs(px) - record[4] + rad
  const qy = Math.abs(py) - record[5] + rad
  return (
    Math.min(Math.max(qx, qy), 0) +
    Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) -
    rad
  )
}
