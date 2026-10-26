import { ignoreAbort, type BitmapMask, type Vec2 } from 'stargazer'
import type { PacketNode } from '../nodes/PacketNode'
import type { EpicenterNode } from '../nodes/EpicenterNode'
import { PacketBehavior } from '../behaviors/PacketBehavior'
import { TUNING } from '../data/tuning'
import {
  isFairer,
  minSeparation,
  predictAlongTrail,
  predictLine,
  type PredictableArea,
  type PredictionClock,
  type SpawnCandidate,
  type Track,
} from './spawnSafety'

export type SpeedTier = 'regular' | 'slow' | 'medium'

const TIERS: readonly SpeedTier[] = ['regular', 'slow', 'medium']

export function tierSpeed(tier: SpeedTier): number {
  const { regularSpeedWorld, slow, medium } = TUNING.difficulty
  if (tier === 'slow') return regularSpeedWorld * slow.speedFactor
  if (tier === 'medium') return regularSpeedWorld * medium.speedFactor
  return regularSpeedWorld
}

/** The tier whose speed is nearest `speed`. */
export function tierOfSpeed(speed: number): SpeedTier {
  let nearest: SpeedTier = 'regular'
  let nearestGap = Infinity
  for (const tier of TIERS) {
    const gap = Math.abs(tierSpeed(tier) - speed)
    if (gap < nearestGap) {
      nearest = tier
      nearestGap = gap
    }
  }
  return nearest
}

/** Each tier's target share of the board at `score`. Locked tiers are 0. */
export function tierShares(score: number): Record<SpeedTier, number> {
  const { slow, medium } = TUNING.difficulty
  const slowShare =
    score < slow.unlockScore
      ? 0
      : Math.min(
          slow.shareCap,
          slow.shareStart +
            slow.shareGrowthPerPoint * (score - slow.unlockScore),
        )
  const mediumShare = score < medium.unlockScore ? 0 : medium.share
  return {
    regular: 1 - slowShare - mediumShare,
    slow: slowShare,
    medium: mediumShare,
  }
}

/**
 * Weighted pick of a tier. A tier's weight is its target share, raised by
 * `gain` times its shortfall on the board, so a tier already crowding the board
 * is drawn less. Falls back to regular when no tier has weight.
 */
export function pickTier(
  shares: Record<SpeedTier, number>,
  onBoard: readonly SpeedTier[],
  gain: number,
  random: () => number,
): SpeedTier {
  const weights: Record<SpeedTier, number> = { regular: 0, slow: 0, medium: 0 }
  let total = 0
  for (const tier of TIERS) {
    const target = shares[tier]
    if (target <= 0) continue
    let count = 0
    for (const t of onBoard) if (t === tier) count++
    const actual = onBoard.length > 0 ? count / onBoard.length : target
    const weight = Math.max(0, target + gain * (target - actual))
    weights[tier] = weight
    total += weight
  }
  if (total <= Number.EPSILON) return 'regular'
  let roll = random() * total
  for (const tier of TIERS) {
    if (weights[tier] <= 0) continue
    roll -= weights[tier]
    if (roll < 0) return tier
  }
  return 'regular'
}

/**
 * Difficulty ramp, a fresh instance per round. The spawn interval tightens with
 * spawn count to a floor. The speed mix follows the score: slow and then medium
 * unlock at their `unlockScore`, and each spawn's tier leans toward whichever
 * tier the board is short of. Baseline speed is fixed, so difficulty comes from
 * mixing speeds, not from speeding up. See `TUNING.difficulty`.
 */
export class SessionDifficulty {
  #spawns = 0
  readonly #random: () => number

  constructor(random: () => number = Math.random) {
    this.#random = random
  }

  reset(): void {
    this.#spawns = 0
  }

  onSpawn(): void {
    this.#spawns++
  }

  /** The travel speed for the next spawn, given the speeds of live packets. */
  sampleTravelSpeed(score: number, onBoardSpeeds: readonly number[]): number {
    const tier = pickTier(
      tierShares(score),
      onBoardSpeeds.map(tierOfSpeed),
      TUNING.difficulty.mixBiasGain,
      this.#random,
    )
    return tierSpeed(tier)
  }

  get nextInterval(): number {
    const { startIntervalSec, intervalDecayPer, intervalFloorSec } =
      TUNING.difficulty
    const raw = startIntervalSec * Math.pow(intervalDecayPer, this.#spawns)
    return Math.max(raw, intervalFloorSec)
  }
}

export interface SpawnControllerHooks {
  isPlaying(): boolean
  mask(): BitmapMask
  epicenter(): EpicenterNode | null
  /** All currently-alive packets, used for the anti-spawn-kill check. */
  activePackets(): readonly PacketNode[]
  /** The round's score, which unlocks the speed tiers. */
  score(): number
  /** World rect the spawn point must land inside, usually the country AABB. */
  spawnBounds(): { x: number; y: number; width: number; height: number }
  /**
   * Called with a valid spawn point + initial heading. Returns the constructed
   * packet.
   */
  spawnPacket(
    worldPos: Vec2,
    headingRad: number,
    travelSpeed: number,
  ): PacketNode | null
}

/**
 * Drives the packet spawn cadence for one round. Rejection-samples the world
 * rect for spawn positions, respects the border / epicenter / active-packet
 * buffers from `TUNING.spawn`, and advances `SessionDifficulty`. Each position
 * is tried with several headings, and a pair is only taken when its predicted
 * path keeps clear of every live packet's (see `spawnSafety`). Fully abortable
 * via its `AbortController` so `session.destroy` / `session.reset` don't leave
 * dangling waits.
 */
export class SpawnController {
  readonly difficulty = new SessionDifficulty()
  readonly #hooks: SpawnControllerHooks
  readonly #wait: (seconds: number, signal?: AbortSignal) => Promise<void>
  #controller: AbortController | null = null
  #spawnable: SpawnableGrid | null = null

  constructor(
    hooks: SpawnControllerHooks,
    wait: (seconds: number, signal?: AbortSignal) => Promise<void>,
  ) {
    this.#hooks = hooks
    this.#wait = wait
  }

  /** Kick off the spawn loop. Cancellable via `stop()`. */
  start(): void {
    this.#controller?.abort()
    const controller = new AbortController()
    this.#controller = controller
    this.difficulty.reset()
    void this.#loop(controller.signal).catch(ignoreAbort)
  }

  /** Cancel the spawn loop (aborts any pending `wait`). */
  stop(): void {
    this.#controller?.abort()
    this.#controller = null
  }

  async #loop(signal: AbortSignal): Promise<void> {
    await this.#wait(TUNING.spawn.firstDelaySec, signal)
    while (!signal.aborted) {
      if (!this.#hooks.isPlaying()) return
      this.#trySpawn()
      const interval = this.difficulty.nextInterval
      await this.#wait(interval, signal)
    }
  }

  #trySpawn(): void {
    const packets = this.#hooks.activePackets()
    const speed = this.difficulty.sampleTravelSpeed(
      this.#hooks.score(),
      onBoardSpeeds(packets),
    )
    const area = this.#predictableArea()
    const spawn = this.#placeFairly(speed, packetTracks(packets, area), area)
    if (!spawn) {
      // Every spawn slot has 20 retries. If all failed, log and skip.
      // The next interval kicks in normally, no cascade of failures.
      console.warn(
        '[spawn] no valid spawn point found within retry cap; skipping slot',
      )
      return
    }
    const packet = this.#hooks.spawnPacket(spawn.point, spawn.heading, speed)
    if (packet) this.difficulty.onSpawn()
  }

  /** Inside the spawn bounds and the mask, where paths can be predicted. */
  #predictableArea(): PredictableArea {
    const bounds = this.#hooks.spawnBounds()
    const mask = this.#hooks.mask()
    return (x, y) =>
      x >= bounds.x &&
      y >= bounds.y &&
      x <= bounds.x + bounds.width &&
      y <= bounds.y + bounds.height &&
      mask.contains(x, y, 0)
  }

  /**
   * The first position and heading with a full runway whose path keeps clear of
   * `tracks`. Without one, the fairest pair tried, so a crowded board still
   * gets its spawn.
   */
  #placeFairly(
    speed: number,
    tracks: readonly Track[],
    area: PredictableArea,
  ): { point: Vec2; heading: number } | null {
    const mask = this.#hooks.mask()
    const ep = this.#hooks.epicenter()
    const { initialHeadingProbeWorld, initialHeadingMaxTries } = TUNING.spawn
    const required =
      TUNING.collision.pairThresholdWorld + TUNING.spawn.safety.marginWorld
    const holdSec = TUNING.packet.preGrowDelaySec + TUNING.packet.spawnGrowSec
    let best: { point: Vec2; heading: number; fit: SpawnCandidate } | null =
      null

    for (let i = 0; i < TUNING.spawn.maxRetries; i++) {
      const point = this.#samplePosition()
      if (!point) continue
      const toward = ep
        ? Math.atan2(ep.center.y - point.y, ep.center.x - point.x)
        : undefined
      for (let h = 0; h < initialHeadingMaxTries; h++) {
        const heading = randomHeading(toward)
        const runway = probeRunway(point, heading, mask)
        const track = predictLine(point, heading, speed, holdSec, area, CLOCK)
        const fit = {
          separation: minSeparation(track, tracks, required),
          runway,
        }
        if (runway >= initialHeadingProbeWorld && fit.separation >= required) {
          return { point, heading }
        }
        if (!best || isFairer(fit, best.fit, required)) {
          best = { point, heading, fit }
        }
      }
    }
    return best
  }

  /**
   * One random point that passes the border, epicenter and packet buffers. It
   * is drawn from the grid of points that pass the first two, so a view that is
   * mostly sea does not spend its tries on water.
   */
  #samplePosition(): Vec2 | null {
    const grid = this.#spawnableGrid()
    if (grid.count === 0) return null
    const cell = Math.floor(Math.random() * grid.count)
    const cx = grid.points[cell * 2]
    const cy = grid.points[cell * 2 + 1]
    const x = cx + (Math.random() - 0.5) * grid.step
    const y = cy + (Math.random() - 0.5) * grid.step
    // The jitter can cross the border inset, where the cell centre is known
    // to pass.
    const point = this.#passesFixedBuffers(x, y) ? { x, y } : { x: cx, y: cy }

    const minPacket =
      TUNING.collision.pairThresholdWorld + TUNING.spawn.minDistFromPacketWorld
    const minPacketSq = minPacket * minPacket
    for (const p of this.#hooks.activePackets()) {
      const dx = p.transform.x - point.x
      const dy = p.transform.y - point.y
      if (dx * dx + dy * dy < minPacketSq) return null
    }
    return point
  }

  /** The border and epicenter buffers, which hold for the whole round. */
  #passesFixedBuffers(x: number, y: number): boolean {
    if (!this.#hooks.mask().contains(x, y, TUNING.spawn.minDistFromBorderWorld))
      return false
    const ep = this.#hooks.epicenter()
    if (!ep) return true
    const dx = ep.center.x - x
    const dy = ep.center.y - y
    const minEp = TUNING.spawn.minDistFromEpicenterWorld
    return dx * dx + dy * dy >= minEp * minEp
  }

  /** The grid for the current bounds and epicenter, rebuilt when either moves. */
  #spawnableGrid(): SpawnableGrid {
    const bounds = this.#hooks.spawnBounds()
    const ep = this.#hooks.epicenter()?.center
    const key = `${bounds.x},${bounds.y},${bounds.width},${bounds.height},${ep?.x},${ep?.y}`
    if (this.#spawnable?.key === key) return this.#spawnable

    const { gridStepWorld, gridMaxCells } = TUNING.spawn
    const area = bounds.width * bounds.height
    const step = Math.max(gridStepWorld, Math.sqrt(area / gridMaxCells))
    const columns = Math.max(1, Math.floor(bounds.width / step))
    const rows = Math.max(1, Math.floor(bounds.height / step))
    const points = new Float32Array(columns * rows * 2)
    let count = 0
    for (let row = 0; row < rows; row++) {
      for (let column = 0; column < columns; column++) {
        const x = bounds.x + (column + 0.5) * step
        const y = bounds.y + (row + 0.5) * step
        if (!this.#passesFixedBuffers(x, y)) continue
        points[count * 2] = x
        points[count * 2 + 1] = y
        count++
      }
    }
    this.#spawnable = { key, points, count, step }
    return this.#spawnable
  }
}

/** Cell centres inside the spawn bounds that pass the round's fixed buffers. */
interface SpawnableGrid {
  key: string
  points: Float32Array
  count: number
  step: number
}

const CLOCK: PredictionClock = TUNING.spawn.safety

/** Packets still in play, the ones a spawn has to keep clear of. */
function liveBehaviors(packets: readonly PacketNode[]): PacketBehavior[] {
  const live: PacketBehavior[] = []
  for (const packet of packets) {
    if (!packet.hitEnabled) continue
    const behavior = packet.getBehavior(PacketBehavior)
    if (!behavior) continue
    const mode = behavior.currentMode
    if (mode === 'growing' || mode === 'travelling') live.push(behavior)
  }
  return live
}

function onBoardSpeeds(packets: readonly PacketNode[]): number[] {
  return liveBehaviors(packets).map((b) => b.targetSpeed)
}

/** Each live packet's predicted path, along its trail when it has one. */
function packetTracks(
  packets: readonly PacketNode[],
  area: PredictableArea,
): Track[] {
  return liveBehaviors(packets).map((behavior) => {
    const t = behavior.node.transform
    const at = { x: t.x, y: t.y }
    const v = behavior.velocity
    const trail = behavior.boundTrail
    if (trail && trail.nextTargetIndex < trail.pointCount) {
      return predictAlongTrail(
        at,
        v,
        behavior.targetSpeed,
        trail,
        trail.nextTargetIndex,
        area,
        CLOCK,
      )
    }
    return predictLine(
      at,
      Math.atan2(v.y, v.x),
      behavior.targetSpeed,
      behavior.holdRemainingSec,
      area,
      CLOCK,
    )
  })
}

/**
 * How far a ray from `spawn` along `angle` keeps
 * `initialHeadingClearInsetWorld` off the border, in
 * `initialHeadingProbeStepWorld` steps up to `initialHeadingProbeWorld`.
 */
function probeRunway(spawn: Vec2, angle: number, mask: BitmapMask): number {
  const {
    initialHeadingProbeWorld: maxProbe,
    initialHeadingProbeStepWorld: step,
    initialHeadingClearInsetWorld: inset,
  } = TUNING.spawn
  const dx = Math.cos(angle)
  const dy = Math.sin(angle)
  let clear = 0
  for (let d = step; d <= maxProbe; d += step) {
    if (!mask.contains(spawn.x + dx * d, spawn.y + dy * d, inset)) break
    clear = d
  }
  return clear
}

/**
 * Random heading pointing broadly at the interior, at least 45° off the line to
 * `towardTarget`. Any heading without a target.
 */
function randomHeading(towardTarget: number | undefined): number {
  if (towardTarget === undefined) return Math.random() * Math.PI * 2
  const minOffset = Math.PI / 4
  const maxOffset = (Math.PI * 3) / 4
  const magnitude = minOffset + Math.random() * (maxOffset - minOffset)
  const sign = Math.random() < 0.5 ? -1 : 1
  return towardTarget + magnitude * sign
}
