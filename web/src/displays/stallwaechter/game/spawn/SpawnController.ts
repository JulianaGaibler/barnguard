import { ignoreAbort, type BitmapMask, type Vec2 } from '@src/stargazer'
import type { PacketNode } from '../nodes/PacketNode'
import type { EpicenterNode } from '../nodes/EpicenterNode'
import { TUNING } from '../data/tuning'

/**
 * Difficulty ramp, a fresh instance per round. Two knobs progress with spawn
 * count: the spawn interval (tightens gently to a floor) and the "chance the
 * next spawn rolls slow" (linear ramp to a cap). Baseline speed is fixed,
 * difficulty comes from mixing slow packets into the regular flow, not from
 * speeding things up. See `TUNING.difficulty`.
 */
export class SessionDifficulty {
  #spawns = 0

  reset(): void {
    this.#spawns = 0
  }

  onSpawn(): void {
    this.#spawns++
  }

  /**
   * Return a fresh travel speed for the next spawn. Each call reads
   * `Math.random()`, expect a different value on consecutive calls. Returns
   * either `regularSpeedWorld` (majority case) or the slow tier at
   * `regularSpeedWorld × slowSpeedFactor`. The chance to roll slow starts at
   * `slowChanceStart` and climbs `slowChanceGrowthPer` per spawn, capped at
   * `slowChanceCap`.
   */
  sampleTravelSpeed(): number {
    const {
      regularSpeedWorld,
      slowSpeedFactor,
      slowChanceStart,
      slowChanceGrowthPer,
      slowChanceCap,
    } = TUNING.difficulty
    const raw = slowChanceStart + slowChanceGrowthPer * this.#spawns
    const slowChance = raw > slowChanceCap ? slowChanceCap : raw
    const isSlow = Math.random() < slowChance
    return isSlow ? regularSpeedWorld * slowSpeedFactor : regularSpeedWorld
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
 * rect for spawn positions, respects the border / epicenter / active- packet
 * buffers from `TUNING.spawn`, and advances `SessionDifficulty`. Fully
 * abortable via its `AbortController` so `session.destroy` / `session.reset`
 * don't leave dangling waits.
 */
export class SpawnController {
  readonly difficulty = new SessionDifficulty()
  readonly #hooks: SpawnControllerHooks
  readonly #wait: (seconds: number, signal?: AbortSignal) => Promise<void>
  #controller: AbortController | null = null

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
    const point = this.#rejectionSample()
    if (!point) {
      // Every spawn slot has 20 retries; if all failed, we log and skip.
      // The next interval kicks in normally, no cascade of failures.
      console.warn(
        '[spawn] no valid spawn point found within retry cap; skipping slot',
      )
      return
    }
    const ep = this.#hooks.epicenter()
    const heading = pickInitialHeading(point, ep?.center, this.#hooks.mask())
    const packet = this.#hooks.spawnPacket(
      point,
      heading,
      this.difficulty.sampleTravelSpeed(),
    )
    if (packet) this.difficulty.onSpawn()
  }

  #rejectionSample(): Vec2 | null {
    const bounds = this.#hooks.spawnBounds()
    const mask = this.#hooks.mask()
    const ep = this.#hooks.epicenter()
    const packets = this.#hooks.activePackets()
    const maxRetries = TUNING.spawn.maxRetries
    const minBorder = TUNING.spawn.minDistFromBorderWorld
    const minEp = TUNING.spawn.minDistFromEpicenterWorld
    const minPacket =
      TUNING.collision.pairThresholdWorld + TUNING.spawn.minDistFromPacketWorld
    const minEpSq = minEp * minEp
    const minPacketSq = minPacket * minPacket

    for (let i = 0; i < maxRetries; i++) {
      const x = bounds.x + Math.random() * bounds.width
      const y = bounds.y + Math.random() * bounds.height
      if (!mask.contains(x, y, minBorder)) continue
      if (ep) {
        const dx = ep.center.x - x
        const dy = ep.center.y - y
        if (dx * dx + dy * dy < minEpSq) continue
      }
      let tooCloseToPacket = false
      for (const p of packets) {
        const dx = p.transform.x - x
        const dy = p.transform.y - y
        if (dx * dx + dy * dy < minPacketSq) {
          tooCloseToPacket = true
          break
        }
      }
      if (tooCloseToPacket) continue
      return { x, y }
    }
    return null
  }
}

/**
 * Random heading pointing broadly at Germany's interior but at least 45° off
 * the direct-to-epicenter line. Sweeps each candidate ray forward in
 * `initialHeadingProbeStepWorld` steps up to `initialHeadingProbeWorld`,
 * keeping `initialHeadingClearInsetWorld` off the border. Longest surviving
 * runway wins, a full sweep is accepted immediately. Always returns.
 */
function pickInitialHeading(
  spawn: Vec2,
  target: Vec2 | undefined,
  mask: BitmapMask,
): number {
  const {
    initialHeadingProbeWorld: maxProbe,
    initialHeadingProbeStepWorld: step,
    initialHeadingClearInsetWorld: inset,
    initialHeadingMaxTries: maxTries,
  } = TUNING.spawn
  const useTarget = target !== undefined
  const towardTarget = useTarget
    ? Math.atan2(target.y - spawn.y, target.x - spawn.x)
    : 0

  let bestAngle = 0
  let bestClear = -1

  for (let i = 0; i < maxTries; i++) {
    const angle = randomHeading(towardTarget, useTarget)
    const dx = Math.cos(angle)
    const dy = Math.sin(angle)
    // Walk the ray forward; `clear` is the last distance at which the
    // ray still had `inset` clearance to any border. Break as soon as
    // it fails, coastline clips at 45 wu are what this catches.
    let clear = 0
    for (let d = step; d <= maxProbe; d += step) {
      const px = spawn.x + dx * d
      const py = spawn.y + dy * d
      if (!mask.contains(px, py, inset)) break
      clear = d
    }
    if (clear >= maxProbe) {
      // Full sweep passed, no need to keep searching for a "better" one.
      return angle
    }
    if (clear > bestClear) {
      bestClear = clear
      bestAngle = angle
    }
  }
  return bestAngle
}

function randomHeading(towardTarget: number, useTarget: boolean): number {
  if (!useTarget) return Math.random() * Math.PI * 2
  const minOffset = Math.PI / 4
  const maxOffset = (Math.PI * 3) / 4
  const magnitude = minOffset + Math.random() * (maxOffset - minOffset)
  const sign = Math.random() < 0.5 ? -1 : 1
  return towardTarget + magnitude * sign
}
