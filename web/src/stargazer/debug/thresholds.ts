// Fixed thresholds for the debug HUD's stat cards, gauges and rows. A value is
// good up to `good`, a warning up to `warn`, and bad above that. They are
// heuristics from this repo's benchmarks (an Apple M2 Max and an Intel Iris Xe
// class laptop), not limits of any hardware, which is why every metric carries
// a `tip` saying what it counts and what a high value costs.

/** How a reading looks at a glance. */
export type Tone = 'neutral' | 'good' | 'warn' | 'bad'

/** The colors every debug graphic uses for a tone. */
export const TONE_COLORS: Record<Tone, string> = {
  neutral: '#60a5fa',
  good: '#4ade80',
  warn: '#fbbf24',
  bad: '#f87171',
}

export interface Threshold {
  /** The metric's name, as a tooltip title. */
  label: string
  /** At or below this, the value is good (at or above it, when `lowIsBad`). */
  good: number
  /** At or below this, a warning (at or above it, when `lowIsBad`). */
  warn: number
  /** A high reading is the healthy one, as with a cache hit rate. */
  lowIsBad?: boolean
  /** What the number counts and what a bad reading means, shown on hover. */
  tip: string
}

/** The tone of `value` against `t`. */
export function toneFor(t: Threshold, value: number): Tone {
  if (t.lowIsBad) {
    if (value >= t.good) return 'good'
    if (value >= t.warn) return 'warn'
    return 'bad'
  }
  if (value <= t.good) return 'good'
  if (value <= t.warn) return 'warn'
  return 'bad'
}

/** The worse of two tones. */
export function worseTone(a: Tone, b: Tone): Tone {
  const rank: Record<Tone, number> = { neutral: 0, good: 1, warn: 2, bad: 3 }
  return rank[a] >= rank[b] ? a : b
}

const MB = 1024 * 1024

export const THRESHOLDS = {
  frameMs: {
    label: 'Frame time (p95)',
    good: 16.7,
    warn: 33,
    tip: 'The slowest 5% of frames took at least this long. Above 16.7 ms a 60 Hz display misses frames, and above 33 ms the motion visibly stutters.',
  },
  drawCalls: {
    label: 'Draw calls per frame',
    good: 30,
    warn: 150,
    tip: 'Draw calls the 2D renderer issued last frame. Each is a driver call, and in Firefox each is a message to the GPU process, so past about 150 the CPU side of the frame starts to show.',
  },
  picturesPainted: {
    label: 'Pictures painted',
    good: 2,
    warn: 20,
    tip: 'Nodes that recorded their drawing again last frame. Content at rest paints nothing. A few per frame is ordinary animation, and a high number means something is repainting every frame that could be moving by transform.',
  },
  stalePictures: {
    label: 'Stale pictures',
    good: 0,
    warn: 0,
    tip: 'Pictures the checker found out of date: a node changed what it draws without a paint property, a versioned resource or markNeedsPaint(). Any value above 0 is a bug in a node. Development builds only.',
  },
  bytesUploaded: {
    label: 'Bytes uploaded per frame',
    good: 256 * 1024,
    warn: 2 * MB,
    tip: 'Vertex and instance data copied to the GPU last frame. It grows with the number of primitives that are not retained, and large values cost bandwidth on integrated GPUs.',
  },
  primitives: {
    label: 'Primitives written',
    good: 2000,
    warn: 10000,
    tip: 'Shapes, glyph quads, strokes and polygons written last frame. This is the renderer’s work per frame whether the content was drawn directly or replayed from a picture.',
  },
  programSwitches: {
    label: 'Program switches',
    good: 10,
    warn: 40,
    tip: 'Times the GPU program changed between draws. Each switch ends a batch, so a high count means interleaved shape kinds are defeating batching.',
  },
  textureBinds: {
    label: 'Texture binds',
    good: 10,
    warn: 40,
    tip: 'Texture bindings changed last frame. Images too large for the shared page each break a batch.',
  },
  blendSwitches: {
    label: 'Blend switches',
    good: 10,
    warn: 40,
    tip: 'Changes of blend mode between draws. Alternating blend modes cannot batch.',
  },
  uboSlices: {
    label: 'Uniform slices',
    good: 64,
    warn: 512,
    tip: 'Per-draw uniform slices written last frame. Each costs a padded 256 byte slot, so a high number is wasted upload bandwidth.',
  },
  passCount: {
    label: 'Render passes',
    good: 3,
    warn: 8,
    tip: 'Render passes opened by the 2D renderer. Offscreen surfaces add passes, and on tile-based GPUs each pass is a full tile load and store.',
  },
  submits: {
    label: 'Queue submits',
    good: 2,
    warn: 4,
    tip: 'Queue submissions last frame. One per frame is ideal.',
  },
  bindGroupsCreated: {
    label: 'Bind groups created',
    good: 0,
    warn: 8,
    tip: 'Bind groups created last frame. They are cached, so a steady value above 0 means a cache is being missed.',
  },
  offscreenBytes: {
    label: 'Offscreen memory',
    good: 8 * MB,
    warn: 64 * MB,
    tip: 'Memory held by offscreen render targets. Large values mean big layers or many surfaces, and memory pressure on integrated GPUs.',
  },
  labelPressure: {
    label: 'Label cache fullness',
    good: 0.7,
    warn: 0.9,
    tip: 'How full the label cache is. Text and small images share it, and when it is full the least recently used entries are evicted and drawn again.',
  },
  atlasPressure: {
    label: 'Atlas fullness',
    good: 0.7,
    warn: 0.95,
    tip: 'How many atlas tiles are in use. Sprites that no longer fit fall back to a texture of their own, which costs an extra draw call each.',
  },
  labelPageRows: {
    label: 'Label page rows',
    good: 0.7,
    warn: 0.9,
    tip: 'How much of the label page height the shelves use. When no shelf fits a new entry the oldest are evicted, and if that is not enough the page is wiped and every label drawn again.',
  },
  rampPressure: {
    label: 'Gradient ramp rows',
    good: 0.7,
    warn: 0.95,
    tip: 'How many rows of the gradient ramp texture hold a color ramp. Each distinct gradient takes one row.',
  },
  retainedPressure: {
    label: 'Retained cache fullness',
    good: 0.7,
    warn: 0.95,
    tip: 'How much of its memory budget a retained cache holds. Past the budget the least recently drawn entries are freed and built again when they are next drawn.',
  },
  maskPressure: {
    label: 'Mask memory',
    good: 0.6,
    warn: 0.9,
    tip: 'Path-shadow mask memory against its budget. At the budget, masks are evicted and baked again.',
  },
  cacheHitRate: {
    label: 'Cache hit rate',
    good: 0.9,
    warn: 0.6,
    lowIsBad: true,
    tip: 'Share of lookups served from the cache. A low rate means the work is being redone.',
  },
  mergeRatio: {
    label: 'Runs merged',
    good: 0.5,
    warn: 0.15,
    lowIsBad: true,
    tip: 'Share of draws the renderer joined into an earlier one. A high share means batching is working, and a low one can also mean there was little to join.',
  },
  labelPageResets: {
    label: 'Label page resets',
    good: 0,
    warn: 0,
    tip: 'Times the label page filled and was cleared. Any reset redraws every label, a visible hitch.',
  },
} satisfies Record<string, Threshold>

export type MetricId = keyof typeof THRESHOLDS
