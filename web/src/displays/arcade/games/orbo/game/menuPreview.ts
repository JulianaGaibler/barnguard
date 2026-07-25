/**
 * Stylized in-engine menu preview for Orbo, built on the primary stage across
 * the game region while the menu is shown. A translucent "scoring zone" fills
 * the lower-right (a diagonal edge). Two white orbs rest outside the zone (one
 * parked far off that never moves); a heavier orb rolls in, touches only the
 * nearer one, and crosses the diagonal — gaining a faint outline once inside —
 * using the real physics feel. Physics is confined to the right portion so orbs
 * never drift under the left menu rail. Everything works in view-local coords
 * so the zone and the orbs' ring-crossing share one space.
 */
import {
  Body,
  BodyType,
  PhysicsWorldBehavior,
  SceneNode,
  aabbShape,
  ignoreAbort,
  lerp,
  type EngineHost,
  type Gfx2D,
  type PhysicsWorld,
  type Rect,
} from '@src/stargazer'
import type { MenuPreview } from '@src/displays/arcade/menu/types'
import { createOrboPhysicsConfig } from './scene'
import { Orb } from './Orb'
import { PHYSICS } from './tuning'
import type { TeamId } from './types'

const ORB_COLOR = '#ffffff'
const ZONE_COLOR = 'rgba(255, 255, 255, 0.28)'
// Semi-transparent so the outline reads as a faint halo on the white orb (the
// game's ring is opaque `#ffffff`, which is invisible against a white orb).
const RING_COLOR = 'rgba(255, 255, 255, 0.55)'
/** Wait before the orb launches. */
const START_DELAY_SEC = 0.5

type InZone = (x: number, y: number) => boolean

/** A filled convex polygon — the translucent scoring zone. */
class PolyPanel extends SceneNode {
  readonly #pts: Float32Array
  readonly #color: string
  constructor(pts: number[], color: string) {
    super('orbo-menu-zone')
    this.#pts = new Float32Array(pts)
    this.#color = color
    this.renderLayer = 'dynamic'
  }
  override draw(gfx: Gfx2D): void {
    gfx.fillConvexPoly(this.#pts, this.#pts.length / 2, this.#color)
  }
}

/**
 * Preview orb: a white fill that tracks its physics body, plus a faint outline
 * that appears once the body is inside the zone (`inZone`). A small custom node
 * rather than the game `OrbNode` so the ring can be semi-transparent.
 */
class PreviewOrb extends SceneNode {
  readonly #body: Orb
  readonly #radius: number
  readonly #ringWidth: number
  readonly #inZone: InZone
  constructor(body: Orb, radius: number, inZone: InZone) {
    super('preview-orb')
    this.#body = body
    this.#radius = radius
    this.#ringWidth = radius * 0.16
    this.#inZone = inZone
    this.renderLayer = 'dynamic'
  }
  override onUpdate(): void {
    const a = this.scene?.engine?.ticker.fixedAlpha ?? 1
    const prev = this.#body.prevPosition
    this.transform.x = lerp(prev.x, this.#body.x, a)
    this.transform.y = lerp(prev.y, this.#body.y, a)
  }
  override draw(gfx: Gfx2D): void {
    gfx.fillCircle(0, 0, this.#radius, ORB_COLOR)
    if (this.#inZone(this.#body.x, this.#body.y)) {
      gfx.strokeCircle(0, 0, this.#radius + this.#ringWidth / 2, {
        color: RING_COLOR,
        width: this.#ringWidth,
      })
    }
  }
}

export function buildOrboMenuPreview(
  host: EngineHost,
  view: Rect,
): MenuPreview {
  const abort = new AbortController()
  const vw = view.width
  const vh = view.height

  const root = new SceneNode('orbo-menu-preview')
  root.transform.x = view.x
  root.transform.y = view.y

  // Scoring zone: the lower-right region past the diagonal A→B. `inZone` tests
  // which side of the line a point is on. (A/B fractions are feel knobs.)
  const ax = vw * 0.29
  const ay = vh
  const bx = vw
  const by = vh * 0.23
  const abx = bx - ax
  const aby = by - ay
  const inZone: InZone = (x, y) => abx * (y - ay) - aby * (x - ax) > 0
  root.add(new PolyPanel([ax, ay, bx, by, vw, vh], ZONE_COLOR))

  const orbLayer = new SceneNode('preview-orbs')
  const world = orbLayer.addBehavior(
    new PhysicsWorldBehavior({
      config: createOrboPhysicsConfig(),
      label: 'orbo-menu',
    }),
  ).world
  // Walls confining orbs to the right portion (clear of the left menu rail).
  const leftX = vw * 0.5
  addWalls(world, leftX, vw, vh)
  root.add(orbLayer)
  host.engine.scene.root.add(root)

  const makeOrb = (x: number, y: number, radius: number, mass: number): Orb => {
    const body = new Orb({
      x,
      y,
      radius,
      mass,
      size: 'MEDIUM',
      player: 0,
      team: 0 as TeamId,
      lifetimeRemaining: 3,
      restitution: PHYSICS.restitution,
      linearDamping: PHYSICS.friction,
      sleepThreshold: PHYSICS.minVelocity,
    })
    world.addBody(body)
    orbLayer.add(new PreviewOrb(body, radius, inZone))
    return body
  }

  const rLarge = vh * 0.1
  const rMed = vh * 0.076
  // One orb parked far off to the upper-right, well clear of the action so it
  // never moves…
  makeOrb(vw * 0.82, vh * 0.3, rMed, 2)
  // …one waiting just outside the zone to be nudged…
  makeOrb(vw * 0.64, vh * 0.55, rMed, 2)
  // …and the heavier orb that rolls in, touches only that one, and carries on
  // across the zone line — gaining its outline.
  const third = makeOrb(vw * 0.58, vh * 0.18, rLarge, 4)

  host.engine
    .wait(START_DELAY_SEC, abort.signal)
    .then(() => {
      if (abort.signal.aborted || root.isDestroyed) return
      third.isSleeping = false
      third.vx = vw * 0.12
      third.vy = vh * 0.72
    })
    .catch(ignoreAbort)

  return {
    destroy() {
      abort.abort()
      if (!root.isDestroyed) root.destroy()
    },
  }
}

/** Four static walls confining orbs to `[leftX, vw] × [0, vh]`. */
function addWalls(
  world: PhysicsWorld,
  leftX: number,
  vw: number,
  vh: number,
): void {
  const overhang = 200 // how far each wall extends past the confined region
  const midX = (leftX + vw) / 2
  const halfW = (vw - leftX) / 2
  const addWall = (x: number, y: number, hw: number, hh: number): void => {
    world.addBody(
      new Body({
        type: BodyType.Static,
        position: { x, y },
        restitution: PHYSICS.restitution,
        friction: 0,
        colliders: [{ shape: aabbShape(hw, hh) }],
      }),
    )
  }
  addWall(leftX - overhang, vh / 2, overhang, vh / 2 + overhang) // left
  addWall(vw + overhang, vh / 2, overhang, vh / 2 + overhang) // right
  addWall(midX, -overhang, halfW + overhang, overhang) // top
  addWall(midX, vh + overhang, halfW + overhang, overhang) // bottom
}
