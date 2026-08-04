/**
 * Menu preview for Data Control: data packets drift down and up across the
 * right of the region at shallow angles. When two meet they explode into
 * decaying debris (the same loss-visual the live game uses), then fresh packets
 * feed in from the edges. Runs on the shared engine; torn down when the game
 * starts.
 *
 * Packets are spawned through the SAME factory the live game uses
 * (`spawnDriftPacket` → `spawnPacketInSession`), so they carry the real hex,
 * shooting-star tail, and heading orientation with no bespoke rendering. The
 * sim runs in a small local space scaled up to the region so the packets and
 * their debris are sized like the live game (`TUNING.packet.radius`, etc.).
 */
import {
  Behavior,
  Node2D,
  type EngineHost,
  type Rect,
  type Vec2,
} from '@src/stargazer'
import type { MenuPreview } from '../../../menu/types'
import type { PacketNode } from './nodes/PacketNode'
import { spawnDriftPacket } from './spawnPacketInSession'
import { spawnDecayingCollisionDebris } from './lossVisuals'
import { TUNING } from './data/tuning'

/** Local-space height the region maps onto (picks the packet/debris scale). */
const LOCAL_H = 260
const PACKET_RADIUS = TUNING.packet.radius
/** Packets collide when centres are within this (local units). */
const COLLIDE_DIST = PACKET_RADIUS * 1.9
/** Vertical drift speed range (local units / sec). */
const SPEED_MIN = 30
const SPEED_MAX = 48
/** Max heading tilt off vertical (radians) — shallow angles. */
const TILT_RAD = 0.32
const TARGET_COUNT = 16
const RESPAWN_DELAY_SEC = 0.22

function rand(lo: number, hi: number): number {
  return lo + Math.random() * (hi - lo)
}

/**
 * The drift + collision simulation, ticked per frame off a host node. Kept as a
 * behavior so it rides the engine's update pass and tears down with the root.
 */
class PreviewSim extends Behavior {
  readonly #root: Node2D
  readonly #host: EngineHost
  readonly #w: number
  readonly #h: number
  readonly #packets = new Set<PacketNode>()
  readonly #abort = new AbortController()
  #idSeq = 0
  #pendingRespawns = 0
  #respawnAcc = 0
  #destroyed = false

  constructor(root: Node2D, host: EngineHost, localW: number, localH: number) {
    super()
    this.#root = root
    this.#host = host
    this.#w = localW
    this.#h = localH
    // Seed the field entirely from off-screen so no packet ever appears inside
    // the viewport; the varied off-screen distances stagger their entry.
    for (let i = 0; i < TARGET_COUNT; i++) this.#spawn()
  }

  override onDetach(): void {
    this.#destroyed = true
    this.#abort.abort()
  }

  #spawn(): void {
    if (this.#destroyed) return
    const fromTop = Math.random() < 0.5
    // Bias to the right of the region so packets clear the menu rail.
    const x = rand(this.#w * 0.4, this.#w * 0.95)
    // Always start OFF-SCREEN (above the top or below the bottom), at a varied
    // distance so packets drift in at staggered times.
    const y = fromTop
      ? rand(-this.#h * 0.7, -PACKET_RADIUS * 1.5)
      : rand(this.#h + PACKET_RADIUS * 1.5, this.#h * 1.7)
    // Heading π/2 = straight down (y-down world), -π/2 = straight up.
    const heading =
      (fromTop ? Math.PI / 2 : -Math.PI / 2) + rand(-TILT_RAD, TILT_RAD)
    const packet = spawnDriftPacket({
      host: this.#host,
      layer: this.#root,
      pos: { x, y },
      headingRad: heading,
      speed: rand(SPEED_MIN, SPEED_MAX),
      id: `dc-menu-packet-${this.#idSeq++}`,
      onDestroy: (p) => {
        this.#packets.delete(p)
        if (!this.#destroyed) this.#pendingRespawns++
      },
    })
    this.#packets.add(packet)
  }

  override onUpdate(dt: number): void {
    if (this.#destroyed) return
    const margin = PACKET_RADIUS * 4
    // Cull packets that have drifted off the local field. Their `onDestroy`
    // above removes them from the set and queues a replacement.
    for (const p of this.#packets) {
      if (p.isDestroyed) continue
      const { x, y } = p.transform
      if (
        y < -margin ||
        y > this.#h + margin ||
        x < -margin ||
        x > this.#w + margin
      ) {
        p.destroy()
      }
    }

    // Pairwise collisions → explode both into decaying debris. Gate on the
    // same `hitEnabled` flag the live game uses so packets still growing in
    // don't collide.
    const t2 = COLLIDE_DIST * COLLIDE_DIST
    const live = [...this.#packets].filter(
      (p) => !p.isDestroyed && p.hitEnabled,
    )
    outer: for (let i = 0; i < live.length; i++) {
      const a = live[i]
      for (let j = i + 1; j < live.length; j++) {
        const b = live[j]
        const dx = a.transform.x - b.transform.x
        const dy = a.transform.y - b.transform.y
        if (dx * dx + dy * dy <= t2) {
          const point: Vec2 = {
            x: (a.transform.x + b.transform.x) / 2,
            y: (a.transform.y + b.transform.y) / 2,
          }
          a.destroy()
          b.destroy()
          spawnDecayingCollisionDebris(
            this.#root,
            point,
            this.#host,
            this.#abort.signal,
          )
          break outer
        }
      }
    }

    // Feed fresh packets in from the edges after a short beat.
    if (this.#pendingRespawns > 0) {
      this.#respawnAcc += dt
      if (this.#respawnAcc >= RESPAWN_DELAY_SEC) {
        this.#respawnAcc = 0
        this.#pendingRespawns--
        this.#spawn()
      }
    }
  }
}

export function buildDataControlMenuPreview(
  host: EngineHost,
  view: Rect,
): MenuPreview {
  const root = new Node2D('data-control-menu-preview')
  const scale = view.height / LOCAL_H
  const localW = view.width / scale
  root.transform.x = view.x
  root.transform.y = view.y
  root.transform.scaleX = scale
  root.transform.scaleY = scale
  root.addBehavior(new PreviewSim(root, host, localW, LOCAL_H))
  host.engine.tree.root.add(root)

  return {
    destroy() {
      if (!root.isDestroyed) root.destroy()
    },
  }
}
