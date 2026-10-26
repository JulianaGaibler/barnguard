import type { PacketNode } from '../nodes/PacketNode'
import type { EpicenterNode } from '../nodes/EpicenterNode'
import { PathTrailNode } from '../nodes/PathTrailNode'
import { PacketBehavior } from '../behaviors/PacketBehavior'
import { TUNING } from '../data/tuning'
import { planRoute } from './planRoute'

/** What the pilot needs from the session. */
export interface AttractPilotHooks {
  packets(): readonly PacketNode[]
  epicenter(): EpicenterNode | null
  pathLayerAdd(node: PathTrailNode): void
  bindTrailToPacket(packet: PacketNode, trail: PathTrailNode): void
  /** Source of `[0, 1)` numbers, replaceable so a test is deterministic. */
  random?: () => number
}

/** Seconds a packet drifts before the pilot reacts to it, from this to this. */
const REACTION_MIN_SEC = 0.5
const REACTION_MAX_SEC = 1.4
/** Chance a route stops short and the packet is lost. */
const FUMBLE_CHANCE = 0.3

/**
 * Plays the game in place of a hand: when a packet has drifted for a moment
 * without a route, it draws one into the target.
 *
 * It uses the same trail and binding the pointer drawing does, so a packet
 * follows it exactly as it would a player's line. It reacts late, and now and
 * then draws a route that stops short, so the round it plays ends in a loss
 * rather than running forever.
 */
export class AttractPilot {
  readonly #hooks: AttractPilotHooks
  readonly #random: () => number
  /** When each packet it has seen gets its route, in seconds. */
  readonly #dueAt = new WeakMap<PacketNode, number>()
  readonly #handled = new WeakSet<PacketNode>()

  constructor(hooks: AttractPilotHooks) {
    this.#hooks = hooks
    this.#random = hooks.random ?? Math.random
  }

  /** Call every step with the current time in seconds. */
  update(nowSec: number): void {
    const epicenter = this.#hooks.epicenter()
    if (!epicenter) return
    for (const packet of this.#hooks.packets()) {
      if (packet.isDestroyed || this.#handled.has(packet)) continue
      const behavior = packet.getBehavior(PacketBehavior)
      if (!behavior || behavior.boundTrail) continue

      let due = this.#dueAt.get(packet)
      if (due === undefined) {
        due =
          nowSec +
          REACTION_MIN_SEC +
          this.#random() * (REACTION_MAX_SEC - REACTION_MIN_SEC)
        this.#dueAt.set(packet, due)
      }
      if (nowSec < due) continue

      this.#handled.add(packet)
      this.#draw(packet, epicenter)
    }
  }

  #draw(packet: PacketNode, epicenter: EpicenterNode): void {
    const route = planRoute(
      {
        from: { x: packet.transform.x, y: packet.transform.y },
        apex: epicenter.center,
        axisRad: epicenter.axisRad,
        coneRadius: epicenter.coneRadius,
        spacing: TUNING.path.minPointDistWorld,
      },
      this.#random,
      { fumble: this.#random() < FUMBLE_CHANCE },
    )
    const trail = new PathTrailNode()
    this.#hooks.pathLayerAdd(trail)
    this.#hooks.bindTrailToPacket(packet, trail)
    for (const p of route) trail.push(p.x, p.y)
  }
}
