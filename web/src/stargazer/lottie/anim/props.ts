// Animated properties of a Lottie animation, compiled once into flat typed
// arrays so that sampling a frame allocates nothing.
//
// A property is either static (one value) or a list of keyframes. Sampling
// clamps outside the keyframe range, holds a value across a hold keyframe,
// eases each component with its own cubic Bézier when the file gives one per
// axis, and moves position along a spatial curve by arc length. A path property
// morphs vertex by vertex between keyframes that have the same vertex count and
// holds the earlier keyframe otherwise.

import { cubicBezier, linear, type Easing } from '../../math/easings'

/** One easing control pair: out handle `(ox, oy)` and in handle `(ix, iy)`. */
export interface Handles {
  ox: number
  oy: number
  ix: number
  iy: number
}

/** Samples along a spatial segment used to map arc length to curve time. */
const ARC_SAMPLES = 64

/** A cubic spatial segment with its arc-length table. */
export interface SpatialSegment {
  /** Start, first control, second control and end points, `dims` floats each. */
  p: Float64Array
  /** Cumulative length at each of `ARC_SAMPLES + 1` samples. */
  length: Float64Array
}

type Json = unknown

function isObj(v: Json): v is Record<string, Json> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function toArray(v: Json): number[] {
  if (Array.isArray(v)) return v.map((x) => (typeof x === 'number' ? x : 0))
  return typeof v === 'number' ? [v] : []
}

function handleAt(v: Json, key: 'x' | 'y', dim: number): number {
  if (!isObj(v)) return key === 'x' ? 0 : 0
  const h = v[key]
  if (Array.isArray(h)) {
    const e = h[Math.min(dim, h.length - 1)]
    return typeof e === 'number' ? e : 0
  }
  return typeof h === 'number' ? h : 0
}

/**
 * The compiled form of one animated number or vector.
 *
 * @remarks
 *   Engine developers: keyframe times, start values and end values live in
 *   `Float64Array`s. Easing closures are built at parse time and shared between
 *   keyframes with identical handles. `sample` keeps the index of the last
 *   segment and starts its search there, so playing forward is O(1).
 * @example
 *   const opacity = parseProp(
 *     {
 *       a: 1,
 *       k: [
 *         { t: 0, s: [0] },
 *         { t: 30, s: [100] },
 *       ],
 *     },
 *     1,
 *   )
 *   opacity.get(15) // 50
 */
export class ValueProp {
  /** Number of components per value. */
  readonly dims: number
  /** True when the property never changes, so it needs sampling only once. */
  get isStatic(): boolean {
    return this.#times.length <= 1
  }
  /** Slot id from the file, for overriding the value at runtime, or `null`. */
  slotId: string | null = null

  #times: Float64Array
  #starts: Float64Array
  #ends: Float64Array
  #hold: Uint8Array
  /** Per keyframe and component, `null` meaning linear. */
  #ease: (Easing | null)[]
  #easeDims: number
  #spatial: (SpatialSegment | null)[]
  #idx = 0

  /** @internal Use {@link parseProp}. */
  constructor(
    dims: number,
    times: Float64Array,
    starts: Float64Array,
    ends: Float64Array,
    hold: Uint8Array,
    ease: (Easing | null)[],
    easeDims: number,
    spatial: (SpatialSegment | null)[],
  ) {
    this.dims = dims
    this.#times = times
    this.#starts = starts
    this.#ends = ends
    this.#hold = hold
    this.#ease = ease
    this.#easeDims = easeDims
    this.#spatial = spatial
  }

  /**
   * A copy that shares this property's immutable data. Used to remember the
   * original of a property that a slot overrides.
   *
   * @internal
   */
  clone(): ValueProp {
    const c = new ValueProp(
      this.dims,
      this.#times,
      this.#starts,
      this.#ends,
      this.#hold,
      this.#ease,
      this.#easeDims,
      this.#spatial,
    )
    c.slotId = this.slotId
    return c
  }

  /**
   * Take on another property's animation, keeping this object's identity so
   * every holder of it sees the change. `other` must have the same `dims`.
   *
   * @internal
   */
  assign(other: ValueProp): void {
    if (other.dims !== this.dims) {
      throw new Error('ValueProp.assign: dimension mismatch')
    }
    this.#times = other.#times
    this.#starts = other.#starts
    this.#ends = other.#ends
    this.#hold = other.#hold
    this.#ease = other.#ease
    this.#easeDims = other.#easeDims
    this.#spatial = other.#spatial
    this.#idx = 0
  }

  /** @internal Multiply every stored value, at parse time only. */
  scaleValues(scale: number): void {
    for (let i = 0; i < this.#starts.length; i++) this.#starts[i] *= scale
    if (this.#ends !== this.#starts) {
      for (let i = 0; i < this.#ends.length; i++) this.#ends[i] *= scale
    }
  }

  /** Number of keyframes. A static value counts as one. */
  get keyframeCount(): number {
    return this.#times.length
  }

  /** Time of the first and last keyframe. */
  get firstTime(): number {
    return this.#times[0]
  }
  get lastTime(): number {
    return this.#times[this.#times.length - 1]
  }

  /** Write the value at `frame` into `out[offset .. offset + dims)`. */
  sample(
    frame: number,
    out: ArrayLike<number> & { [i: number]: number },
    offset = 0,
  ): void {
    const times = this.#times
    const n = times.length
    const d = this.dims
    const starts = this.#starts
    if (n === 1 || frame <= times[0]) {
      for (let k = 0; k < d; k++) out[offset + k] = starts[k]
      return
    }
    if (frame >= times[n - 1]) {
      const b = (n - 1) * d
      for (let k = 0; k < d; k++) out[offset + k] = starts[b + k]
      return
    }
    // Find i with times[i] <= frame < times[i + 1], starting from the last hit.
    let i = this.#idx
    if (!(i < n - 1 && times[i] <= frame && frame < times[i + 1])) {
      let lo = 0
      let hi = n - 1
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1
        if (times[mid] <= frame) lo = mid
        else hi = mid
      }
      i = lo
      this.#idx = i
    }
    const b = i * d
    if (this.#hold[i]) {
      for (let k = 0; k < d; k++) out[offset + k] = starts[b + k]
      return
    }
    const u = (frame - times[i]) / (times[i + 1] - times[i])
    const ends = this.#ends
    const seg = this.#spatial[i]
    if (seg) {
      const ease = this.#ease[i * this.#easeDims]
      const eased = ease ? ease(u) : u
      pointOnSegment(seg, eased, d, out, offset)
      return
    }
    const ed = this.#easeDims
    for (let k = 0; k < d; k++) {
      const ease = this.#ease[i * ed + (ed === 1 ? 0 : k)]
      const t = ease ? ease(u) : u
      out[offset + k] = starts[b + k] + (ends[b + k] - starts[b + k]) * t
    }
  }

  /** The first component at `frame`. Allocation-free for scalar properties. */
  get(frame: number): number {
    const times = this.#times
    const n = times.length
    if (n === 1 || frame <= times[0]) return this.#starts[0]
    if (this.dims === 1) {
      this.sample(frame, SCRATCH1)
      return SCRATCH1[0]
    }
    this.sample(frame, SCRATCH_N)
    return SCRATCH_N[0]
  }
}

const SCRATCH1 = new Float64Array(1)
const SCRATCH_N = new Float64Array(64)

function pointOnSegment(
  seg: SpatialSegment,
  fraction: number,
  d: number,
  out: ArrayLike<number> & { [i: number]: number },
  offset: number,
): void {
  const len = seg.length
  const total = len[ARC_SAMPLES]
  let t: number
  if (total <= 0) {
    t = fraction
  } else {
    const target = Math.max(0, Math.min(1, fraction)) * total
    let lo = 0
    let hi = ARC_SAMPLES
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if (len[mid] <= target) lo = mid
      else hi = mid
    }
    const span = len[hi] - len[lo]
    const frac = span > 0 ? (target - len[lo]) / span : 0
    t = (lo + frac) / ARC_SAMPLES
  }
  const p = seg.p
  const mt = 1 - t
  const a = mt * mt * mt
  const b = 3 * mt * mt * t
  const c = 3 * mt * t * t
  const e = t * t * t
  for (let k = 0; k < d; k++) {
    out[offset + k] =
      a * p[k] + b * p[d + k] + c * p[2 * d + k] + e * p[3 * d + k]
  }
}

function buildSegment(
  s: ArrayLike<number>,
  e: ArrayLike<number>,
  to: number[],
  ti: number[],
  d: number,
): SpatialSegment {
  const p = new Float64Array(4 * d)
  for (let k = 0; k < d; k++) {
    p[k] = s[k]
    p[d + k] = s[k] + (to[k] ?? 0)
    p[2 * d + k] = e[k] + (ti[k] ?? 0)
    p[3 * d + k] = e[k]
  }
  const length = new Float64Array(ARC_SAMPLES + 1)
  const prev = new Float64Array(d)
  for (let k = 0; k < d; k++) prev[k] = p[k]
  const pt = new Float64Array(d)
  for (let j = 1; j <= ARC_SAMPLES; j++) {
    const t = j / ARC_SAMPLES
    const mt = 1 - t
    const a = mt * mt * mt
    const b = 3 * mt * mt * t
    const c = 3 * mt * t * t
    const f = t * t * t
    let dist = 0
    for (let k = 0; k < d; k++) {
      pt[k] = a * p[k] + b * p[d + k] + c * p[2 * d + k] + f * p[3 * d + k]
      const diff = pt[k] - prev[k]
      dist += diff * diff
      prev[k] = pt[k]
    }
    length[j] = length[j - 1] + Math.sqrt(dist)
  }
  return { p, length }
}

/** Easing cache shared by every property of one parse, keyed by handle values. */
export class EasingCache {
  readonly #map = new Map<string, Easing | null>()

  /** The easing for the given handles, or `null` when it is linear. */
  get(h: Handles): Easing | null {
    const key = `${h.ox},${h.oy},${h.ix},${h.iy}`
    let e = this.#map.get(key)
    if (e === undefined) {
      const x1 = clamp01(h.ox)
      const x2 = clamp01(h.ix)
      e = x1 === h.oy && x2 === h.iy ? null : cubicBezier(x1, h.oy, x2, h.iy)
      if (e === (linear as Easing)) e = null
      this.#map.set(key, e)
    }
    return e
  }
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

/** Whether `k` holds keyframes (an array whose entries carry a time). */
function hasKeyframes(k: Json): k is Json[] {
  return Array.isArray(k) && k.length > 0 && isObj(k[0]) && 't' in k[0]
}

/**
 * Compile a property object (`{ a, k }`) into a {@link ValueProp} with `dims`
 * components. A scalar `k` or a scalar `s` is accepted for a one-component
 * property, and a missing value reads as zero. `scale` multiplies every value,
 * which upgrades 0 to 255 colors to the 0 to 1 range.
 */
export function parseProp(
  json: Json,
  dims: number,
  cache: EasingCache = new EasingCache(),
  scale = 1,
): ValueProp {
  const k = isObj(json) ? json.k : json
  const slot = isObj(json) && typeof json.sid === 'string' ? json.sid : null
  let prop: ValueProp
  if (!hasKeyframes(k)) {
    const v = toArray(k)
    const starts = new Float64Array(dims)
    for (let i = 0; i < dims; i++)
      starts[i] = v[i] ?? (dims > v.length && v.length === 1 ? v[0] : 0)
    prop = new ValueProp(
      dims,
      new Float64Array([0]),
      starts,
      starts,
      new Uint8Array(1),
      [],
      1,
      [null],
    )
  } else {
    prop = compileKeyframes(k, dims, cache)
  }
  if (scale !== 1) prop.scaleValues(scale)
  prop.slotId = slot
  return prop
}

function compileKeyframes(
  kfs: Json[],
  dims: number,
  cache: EasingCache,
): ValueProp {
  // The last keyframe may carry only a time. Drop duplicates of the same time.
  const frames = kfs.filter(isObj)
  const n = frames.length
  const times = new Float64Array(n)
  const starts = new Float64Array(n * dims)
  const ends = new Float64Array(n * dims)
  const hold = new Uint8Array(n)
  const spatial: (SpatialSegment | null)[] = new Array(n).fill(null)
  // Per-axis easing exists when any handle is an array longer than one entry.
  let perAxis = false
  for (const f of frames) {
    for (const key of ['i', 'o'] as const) {
      const h = f[key]
      if (isObj(h) && Array.isArray(h.x) && h.x.length > 1) perAxis = true
    }
  }
  const easeDims = perAxis ? dims : 1
  const ease: (Easing | null)[] = new Array(n * easeDims).fill(null)

  let lastStart: number[] | null = null
  for (let i = 0; i < n; i++) {
    const f = frames[i]
    times[i] = typeof f.t === 'number' ? f.t : 0
    let s = toArray(f.s)
    if (s.length === 0 && lastStart) s = lastStart
    lastStart = s
    for (let k = 0; k < dims; k++) {
      starts[i * dims + k] = s[k] ?? (s.length === 1 ? s[0] : 0)
    }
    hold[i] = f.h === 1 || f.h === true ? 1 : 0
  }
  // End value of segment i is the start of keyframe i + 1, or the legacy `e`.
  for (let i = 0; i < n; i++) {
    const f = frames[i]
    const legacy = toArray(f.e)
    for (let k = 0; k < dims; k++) {
      if (i + 1 < n) {
        // Prefer the next keyframe's own start value.
        ends[i * dims + k] = starts[(i + 1) * dims + k]
      } else {
        ends[i * dims + k] = legacy[k] ?? starts[i * dims + k]
      }
    }
    if (i + 1 < n && frames[i + 1].s === undefined && legacy.length > 0) {
      for (let k = 0; k < dims; k++) {
        const v = legacy[k] ?? (legacy.length === 1 ? legacy[0] : 0)
        ends[i * dims + k] = v
        starts[(i + 1) * dims + k] = v
      }
    }
    // Easing handles describe the segment from keyframe i to i + 1.
    const o = f.o
    const inn = f.i
    if (i + 1 < n && !hold[i]) {
      for (let k = 0; k < easeDims; k++) {
        ease[i * easeDims + k] = cache.get({
          ox: handleAt(o, 'x', k),
          oy: handleAt(o, 'y', k),
          ix: handleAt(inn, 'x', k),
          iy: handleAt(inn, 'y', k),
        })
      }
      const to = toArray(f.to)
      const ti = toArray(f.ti)
      if (
        (to.length > 0 || ti.length > 0) &&
        (to.some((v) => v !== 0) || ti.some((v) => v !== 0))
      ) {
        spatial[i] = buildSegment(
          starts.subarray(i * dims, i * dims + dims),
          ends.subarray(i * dims, i * dims + dims),
          to,
          ti,
          dims,
        )
      }
    }
  }
  return new ValueProp(dims, times, starts, ends, hold, ease, easeDims, spatial)
}

/** A static value, for properties the file leaves out. */
export function constantProp(value: ArrayLike<number>): ValueProp {
  const d = value.length
  const v = new Float64Array(d)
  for (let i = 0; i < d; i++) v[i] = value[i]
  return new ValueProp(
    d,
    new Float64Array([0]),
    v,
    v,
    new Uint8Array(1),
    [],
    1,
    [null],
  )
}

// --- paths ------------------------------------------------------------------

/**
 * A path in Lottie's vertex form: vertices `v` with in and out tangents `i` and
 * `o` relative to each vertex, `count` vertices, and a closed flag.
 */
export interface PathData {
  count: number
  closed: boolean
  /** `2 * count` floats. */
  v: Float64Array
  i: Float64Array
  o: Float64Array
}

/** A reusable output buffer for {@link PathProp.sample}. */
export function createPathData(capacity = 16): PathData {
  return {
    count: 0,
    closed: false,
    v: new Float64Array(capacity * 2),
    i: new Float64Array(capacity * 2),
    o: new Float64Array(capacity * 2),
  }
}

function ensurePathCapacity(out: PathData, count: number): void {
  if (out.v.length >= count * 2) return
  out.v = new Float64Array(count * 2)
  out.i = new Float64Array(count * 2)
  out.o = new Float64Array(count * 2)
}

export interface PathShape {
  count: number
  closed: boolean
  v: Float64Array
  i: Float64Array
  o: Float64Array
}

function parseShape(s: Json): PathShape | null {
  // Keyframe values are wrapped in an array for a path.
  const raw = Array.isArray(s) ? s[0] : s
  if (!isObj(raw)) return null
  const flat = (a: Json): Float64Array => {
    const out: number[] = []
    if (Array.isArray(a)) {
      for (const p of a) {
        if (Array.isArray(p)) out.push(p[0] ?? 0, p[1] ?? 0)
      }
    }
    return new Float64Array(out)
  }
  const v = flat(raw.v)
  const i = flat(raw.i)
  const o = flat(raw.o)
  const count = v.length / 2
  return {
    count,
    closed: raw.c === true || raw.c === 1,
    v,
    i: i.length === v.length ? i : new Float64Array(v.length),
    o: o.length === v.length ? o : new Float64Array(v.length),
  }
}

/**
 * The compiled form of an animated path (`ks` of a path shape or a mask).
 * Keyframes with the same vertex count morph, others hold the earlier shape.
 */
export class PathProp {
  readonly isStatic: boolean
  slotId: string | null = null
  readonly #times: Float64Array
  readonly #shapes: PathShape[]
  readonly #hold: Uint8Array
  readonly #ease: (Easing | null)[]
  #idx = 0

  /** @internal Use {@link parsePathProp}. */
  constructor(
    times: Float64Array,
    shapes: PathShape[],
    hold: Uint8Array,
    ease: (Easing | null)[],
  ) {
    this.#times = times
    this.#shapes = shapes
    this.#hold = hold
    this.#ease = ease
    this.isStatic = times.length <= 1
  }

  /** Vertex count of the first keyframe. */
  get vertexCount(): number {
    return this.#shapes[0]?.count ?? 0
  }

  /** Write the path at `frame` into `out`, growing its arrays when needed. */
  sample(frame: number, out: PathData): void {
    const times = this.#times
    const n = times.length
    const shapes = this.#shapes
    if (n === 0) {
      out.count = 0
      return
    }
    let i = 0
    if (n > 1 && frame > times[0]) {
      if (frame >= times[n - 1]) i = n - 1
      else {
        i = this.#idx
        if (!(i < n - 1 && times[i] <= frame && frame < times[i + 1])) {
          let lo = 0
          let hi = n - 1
          while (hi - lo > 1) {
            const mid = (lo + hi) >> 1
            if (times[mid] <= frame) lo = mid
            else hi = mid
          }
          i = lo
          this.#idx = i
        }
      }
    }
    const a = shapes[i]
    ensurePathCapacity(out, a.count)
    out.count = a.count
    out.closed = a.closed
    const b = i + 1 < n ? shapes[i + 1] : null
    if (!b || this.#hold[i] || b.count !== a.count || i >= n - 1) {
      out.v.set(a.v)
      out.i.set(a.i)
      out.o.set(a.o)
      return
    }
    const u = (frame - times[i]) / (times[i + 1] - times[i])
    const ease = this.#ease[i]
    const t = ease ? ease(u) : u
    const m = a.count * 2
    for (let k = 0; k < m; k++) {
      out.v[k] = a.v[k] + (b.v[k] - a.v[k]) * t
      out.i[k] = a.i[k] + (b.i[k] - a.i[k]) * t
      out.o[k] = a.o[k] + (b.o[k] - a.o[k]) * t
    }
  }
}

/** Compile an animated path property (`{ a, k }`). */
export function parsePathProp(
  json: Json,
  cache: EasingCache = new EasingCache(),
): PathProp {
  const k = isObj(json) ? json.k : json
  const slot = isObj(json) && typeof json.sid === 'string' ? json.sid : null
  let prop: PathProp
  if (hasKeyframes(k)) {
    const frames = k.filter(isObj)
    const times = new Float64Array(frames.length)
    const shapes: PathShape[] = []
    const hold = new Uint8Array(frames.length)
    const ease: (Easing | null)[] = []
    let last: PathShape | null = null
    for (let i = 0; i < frames.length; i++) {
      const f = frames[i]
      times[i] = typeof f.t === 'number' ? f.t : 0
      const parsed: PathShape | null = parseShape(f.s) ?? last
      const shape: PathShape = parsed ?? {
        count: 0,
        closed: false,
        v: new Float64Array(0),
        i: new Float64Array(0),
        o: new Float64Array(0),
      }
      shapes.push(shape)
      last = shape
      hold[i] = f.h === 1 || f.h === true ? 1 : 0
      ease.push(
        cache.get({
          ox: handleAt(f.o, 'x', 0),
          oy: handleAt(f.o, 'y', 0),
          ix: handleAt(f.i, 'x', 0),
          iy: handleAt(f.i, 'y', 0),
        }),
      )
    }
    prop = new PathProp(times, shapes, hold, ease)
  } else {
    const shape = parseShape(k) ?? {
      count: 0,
      closed: false,
      v: new Float64Array(0),
      i: new Float64Array(0),
      o: new Float64Array(0),
    }
    prop = new PathProp(new Float64Array([0]), [shape], new Uint8Array(1), [
      null,
    ])
  }
  prop.slotId = slot
  return prop
}
