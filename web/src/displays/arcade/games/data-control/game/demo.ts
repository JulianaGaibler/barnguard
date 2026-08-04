/**
 * Non-interactive tutorial demos for Data Control, built on the shared demo
 * stage. They reuse the real game scene the confirm-card mini-stage used — a
 * pulsing epicenter with a packet that routes into it — but script the routing
 * instead of taking pointer input, so each card animates on its own.
 *
 * Packets come from the SAME factory the live game and the menu preview use
 * (`spawnPacketInSession` / `spawnDriftPacket`), so they carry the real hex,
 * shooting-star tail, and heading orientation. Each demo builds into a root
 * scaled from a small local space (≈200 tall) up to the demo stage's viewport,
 * so packet/epicenter sizes match the tuning the original mini-stage used.
 *
 * - {@link buildRouteDemo}: a packet auto-routes into the epicenter, looping.
 * - {@link buildAvoidDemo}: two packets drift together and explode.
 */
import {
  Behavior,
  Node2D,
  ignoreAbort,
  type EngineHost,
  type Stage,
  type Vec2,
} from '@src/stargazer'
import type { DemoHandle } from '../../../tutorial/types'
import { EpicenterNode } from './nodes/EpicenterNode'
import { EpicenterBehavior } from './behaviors/EpicenterBehavior'
import type { PacketNode } from './nodes/PacketNode'
import { PacketBehavior } from './behaviors/PacketBehavior'
import { PathTrailNode } from './nodes/PathTrailNode'
import { spawnPacketInSession, spawnDriftPacket } from './spawnPacketInSession'
import { spawnDecayingCollisionDebris } from './lossVisuals'
import { RectMask } from './tutorial/RectMask'
import { TUNING } from './data/tuning'

/** Local-space height the demo viewport maps onto (sets packet/epicenter size). */
const LOCAL_H = 200
const ROUTE_SPEED = 60
const RESPAWN_DELAY_SEC = 0.5

/** A root scaled from local (≈200-tall) space up to the demo stage viewport. */
interface DemoScene {
  root: Node2D
  w: number
  h: number
}

function demoScene(stage: Stage, name: string): DemoScene {
  const v = stage.currentCamera2D?.viewport ?? {
    x: 0,
    y: 0,
    width: 1000,
    height: 750,
  }
  const scale = v.height / LOCAL_H
  const root = new Node2D(name)
  root.transform.x = v.x
  root.transform.y = v.y
  root.transform.scaleX = scale
  root.transform.scaleY = scale
  return { root, w: v.width / scale, h: LOCAL_H }
}

function packetStart(s: DemoScene): Vec2 {
  return { x: s.w * 0.24, y: s.h * 0.3 }
}
function targetPos(s: DemoScene): Vec2 {
  return { x: s.w * 0.74, y: s.h * 0.66 }
}

function makeEpicenter(s: DemoScene): EpicenterNode {
  const ep = new EpicenterNode({
    center: targetPos(s),
    // Held well above the frame so the cone tilts strongly upward.
    approachReference: { x: s.w * 0.24, y: -s.h * 0.6 },
  })
  ep.addBehavior(new EpicenterBehavior())
  return ep
}

/**
 * Card: an epicenter plus a packet that auto-routes into it and respawns.
 * Reuses the live packet stack via `spawnPacketInSession`; the "drawn" path is
 * scripted here as a pre-bound trail rather than a drag.
 */
export function buildRouteDemo(stage: Stage, host: EngineHost): DemoHandle {
  const s = demoScene(stage, 'dc-demo-route')
  const packetLayer = new Node2D('dc-demo-route-packets')
  const pathLayer = new Node2D('dc-demo-route-paths')
  s.root.add(pathLayer)
  s.root.add(packetLayer)

  const epicenter = makeEpicenter(s)
  s.root.add(epicenter)
  stage.tree.root.add(s.root)

  const mask = new RectMask({ x: -1e6, y: -1e6, width: 2e6, height: 2e6 })
  const abort = new AbortController()
  let destroyed = false
  const start = packetStart(s)
  const target = targetPos(s)

  const spawn = (): void => {
    if (destroyed) return
    pathLayer.destroyChildren()
    const packet = spawnPacketInSession(
      {
        host,
        packetLayer,
        hooks: {
          isPlaying: () => !destroyed,
          epicenter: () => epicenter,
          gameViewport: () => ({ x: -1e6, y: -1e6, width: 2e6, height: 2e6 }),
          mask: () => mask,
          onExitedGermany: (p) => {
            if (!p.isDestroyed) p.destroy()
          },
          onCaptured: (p) => {
            if (!p.isDestroyed) p.destroy()
          },
        },
        drawHooks: {
          isPlaying: () => false,
          epicenter: () => epicenter,
          worldToMap: (x, y) => ({ x, y }),
          pathLayerAdd: (node) => pathLayer.add(node),
          handleLayerAdd: (node) => pathLayer.add(node),
          bindTrailToPacket: (t, trail) =>
            t.getBehavior(PacketBehavior)?.setTrail(trail),
        },
        packetId: 'dc-demo-route-packet',
        hexParticleId: 'dc-demo-route-hex',
        autonomousDrift: false,
        onDestroy: () => {
          host.engine
            .wait(RESPAWN_DELAY_SEC, abort.signal)
            .then(() => spawn())
            .catch(ignoreAbort)
        },
      },
      start,
      0,
      ROUTE_SPEED,
    )

    // Script the route: a short arced trail from the packet into the target.
    const trail = new PathTrailNode()
    pathLayer.add(trail)
    const steps = 10
    for (let i = 1; i <= steps; i++) {
      const tt = i / steps
      const x = start.x + (target.x - start.x) * tt
      const y =
        start.y +
        (target.y - start.y) * tt -
        Math.sin(tt * Math.PI) * (s.h * 0.12)
      trail.push(x, y)
    }
    packet.getBehavior(PacketBehavior)?.setTrail(trail)
  }
  spawn()

  return {
    destroy() {
      destroyed = true
      abort.abort()
      s.root.destroy()
    },
  }
}

/** Card 3: two packets drift together, collide, and burst into debris. */
export function buildAvoidDemo(stage: Stage, host: EngineHost): DemoHandle {
  const s = demoScene(stage, 'dc-demo-avoid')
  stage.tree.root.add(s.root)
  s.root.addBehavior(new AvoidLoop(s, host))
  return { destroy: () => s.root.destroy() }
}

const AVOID_SPEED = 42
const AVOID_COLLIDE_DIST = TUNING.packet.radius * 1.9
const AVOID_COOLDOWN_SEC = 1.1

/** Sends two packets at each other, explodes them on contact, then repeats. */
class AvoidLoop extends Behavior {
  readonly #s: DemoScene
  readonly #host: EngineHost
  readonly #abort = new AbortController()
  #a: PacketNode | null = null
  #b: PacketNode | null = null
  #idSeq = 0
  #cooldown = 0
  #destroyed = false

  constructor(scene: DemoScene, host: EngineHost) {
    super()
    this.#s = scene
    this.#host = host
    this.#reset()
  }

  override onDetach(): void {
    this.#destroyed = true
    this.#abort.abort()
  }

  #reset(): void {
    if (this.#destroyed) return
    const midY = this.#s.h * 0.5
    // Heading 0 = +x (moving right), π = -x (moving left).
    this.#a = spawnDriftPacket({
      host: this.#host,
      layer: this.#s.root,
      pos: { x: this.#s.w * 0.22, y: midY },
      headingRad: 0,
      speed: AVOID_SPEED,
      id: `dc-demo-avoid-a-${this.#idSeq}`,
      onDestroy: (p) => {
        if (this.#a === p) this.#a = null
      },
    })
    this.#b = spawnDriftPacket({
      host: this.#host,
      layer: this.#s.root,
      pos: { x: this.#s.w * 0.78, y: midY },
      headingRad: Math.PI,
      speed: AVOID_SPEED,
      id: `dc-demo-avoid-b-${this.#idSeq}`,
      onDestroy: (p) => {
        if (this.#b === p) this.#b = null
      },
    })
    this.#idSeq++
  }

  override onUpdate(dt: number): void {
    if (this.#destroyed) return
    if (this.#cooldown > 0) {
      this.#cooldown -= dt
      if (this.#cooldown <= 0) this.#reset()
      return
    }
    const a = this.#a
    const b = this.#b
    if (!a || !b || a.isDestroyed || b.isDestroyed) return
    if (!a.hitEnabled || !b.hitEnabled) return
    const dx = a.transform.x - b.transform.x
    const dy = a.transform.y - b.transform.y
    if (dx * dx + dy * dy <= AVOID_COLLIDE_DIST * AVOID_COLLIDE_DIST) {
      const point: Vec2 = {
        x: (a.transform.x + b.transform.x) / 2,
        y: (a.transform.y + b.transform.y) / 2,
      }
      a.destroy()
      b.destroy()
      this.#a = null
      this.#b = null
      spawnDecayingCollisionDebris(
        this.#s.root,
        point,
        this.#host,
        this.#abort.signal,
      )
      this.#cooldown = AVOID_COOLDOWN_SEC
    }
  }
}
