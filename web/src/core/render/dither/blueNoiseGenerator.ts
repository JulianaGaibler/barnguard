/** Side of the tile `npm run gen:blue-noise` builds. */
export const BLUE_NOISE_SIZE = 64

/** A small seeded generator, so the same tile comes out every time. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let mixed = state
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1)
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61)
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * A blue-noise tile by void and cluster: `size * size` bytes, row by row, each
 * cell holding its rank scaled to 0..255. The tile wraps at its edges, so it
 * repeats without a seam. The build takes about 100 ms at 64, and seconds at
 * 128. Run it from a script, not at startup.
 */
export function generateBlueNoise(
  size = BLUE_NOISE_SIZE,
  sigma = 1.5,
  seed = 1,
) {
  const cellCount = size * size
  const random = mulberry32(seed)
  const reach = Math.ceil(sigma * 3)
  const kernel: Array<[number, number, number]> = []
  for (let dy = -reach; dy <= reach; dy++) {
    for (let dx = -reach; dx <= reach; dx++) {
      kernel.push([
        dx,
        dy,
        Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma)),
      ])
    }
  }

  // Adds (or removes, with a negative sign) the energy a set cell spreads.
  const spread = (energy: Float64Array, index: number, sign: number) => {
    const x = index % size
    const y = (index / size) | 0
    for (const [dx, dy, weight] of kernel) {
      energy[((y + dy + size) % size) * size + ((x + dx + size) % size)] +=
        sign * weight
    }
  }
  const tightestCluster = (set: Uint8Array, energy: Float64Array) => {
    let best = -1
    let bestEnergy = -Infinity
    for (let i = 0; i < cellCount; i++) {
      if (set[i] === 1 && energy[i] > bestEnergy) {
        bestEnergy = energy[i]
        best = i
      }
    }
    return best
  }
  const largestVoid = (set: Uint8Array, energy: Float64Array) => {
    let best = -1
    let bestEnergy = Infinity
    for (let i = 0; i < cellCount; i++) {
      if (set[i] === 0 && energy[i] < bestEnergy) {
        bestEnergy = energy[i]
        best = i
      }
    }
    return best
  }

  // Start from a random tenth of the cells, then move the tightest cluster
  // into the largest void until nothing moves.
  const set = new Uint8Array(cellCount)
  const energy = new Float64Array(cellCount)
  const startCount = Math.max(1, (cellCount / 10) | 0)
  let count = 0
  while (count < startCount) {
    const index = (random() * cellCount) | 0
    if (!set[index]) {
      set[index] = 1
      spread(energy, index, 1)
      count++
    }
  }
  for (;;) {
    const cluster = tightestCluster(set, energy)
    set[cluster] = 0
    spread(energy, cluster, -1)
    const hole = largestVoid(set, energy)
    set[hole] = 1
    spread(energy, hole, 1)
    if (hole === cluster) break
  }

  const rank = new Int32Array(cellCount).fill(-1)
  // The initial cells rank by removing the tightest cluster one at a time.
  const removable = set.slice()
  const removableEnergy = energy.slice()
  let next = count
  while (next > 0) {
    next--
    const cluster = tightestCluster(removable, removableEnergy)
    removable[cluster] = 0
    spread(removableEnergy, cluster, -1)
    rank[cluster] = next
  }
  // The rest rank by filling the largest void one at a time.
  next = count
  while (next < cellCount) {
    const hole = largestVoid(set, energy)
    set[hole] = 1
    spread(energy, hole, 1)
    rank[hole] = next
    next++
  }

  const tile = new Uint8Array(cellCount)
  for (let i = 0; i < cellCount; i++) {
    tile[i] = Math.round(((rank[i] + 0.5) / cellCount) * 255)
  }
  return tile
}
