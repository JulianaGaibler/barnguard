/**
 * In-engine tutorial demos for Orbo, built on the shared demo stage. Every card
 * reuses the real game nodes (`FieldNode`, `PanelNode`, `OrbNode`,
 * `OrbExplodeNode`), the layout, and the shared field construction
 * (`createOrboPhysicsConfig` / `buildOrboWalls` / `createOrboFieldMask`), laid
 * out to the stage's fixed viewport. They skip the session turn state machine,
 * pointer/flick input, and the pause gesture — a demo builds a subtree and
 * drives orbs directly by assigning launch velocity (no `FlickController`).
 *
 * The launch velocities below are tuned to the demo viewport's damping
 * (horizontal travel ≈ 0.83·v₀); they're feel knobs, adjust visually.
 */
import {
  Node2D,
  PhysicsWorldBehavior,
  easings,
  ignoreAbort,
  type BitmapMask,
  type EngineHost,
  type PhysicsWorld,
  type Stage,
} from '@src/stargazer'
import type { DemoHandle } from '@src/displays/arcade/tutorial/types'
import { FingerHintNode } from '@src/displays/arcade/tutorial/FingerHintNode'
import { Orb } from './Orb'
import {
  calculateLayout,
  launchStripCenterX,
  zoneAtX,
  type FieldLayout,
} from './layout'
import { FieldNode } from './nodes/FieldNode'
import { PanelNode } from './nodes/PanelNode'
import { OrbNode } from './nodes/OrbNode'
import { OrbExplodeNode } from './nodes/OrbExplodeNode'
import { ANIM, ORB_SIZES, PHYSICS, PLAYER_COLORS } from './tuning'
import {
  buildOrboWalls,
  createOrboFieldMask,
  createOrboPhysicsConfig,
  type Bounds,
} from './scene'
import type { OrbSize, TeamId } from './types'

/** World-space margin between the field and the demo viewport edges. */
const FIELD_PADDING = 32

// Launch velocities (world u/s), tuned to the demo viewport's damping.
const VX_BANK = 620 // flick that banks off the top wall into the right zone
const VY_BANK = -600
const VX_BUMP = 460 // shove the cluster out of its band without over-flinging
const VX_OVERSHOOT = 970 // overshoot deep into the opponent's flicking strip
const VX_DEATH = 940 // last-life orb sent well into a flicking zone to expire
const VX_FINAL = 680 // the round-winning flick into the right zone

/**
 * The field's clip mask depends only on the fixed demo viewport, so cache it
 * across builds (keyed by bounds) — the first reveal rasterizes it once.
 */
const maskCache = new Map<string, Promise<BitmapMask>>()

function getFieldMask(bounds: Bounds): Promise<BitmapMask> {
  const key = `${bounds.x},${bounds.y},${bounds.width},${bounds.height}`
  let promise = maskCache.get(key)
  if (!promise) {
    promise = createOrboFieldMask(bounds)
    maskCache.set(key, promise)
  }
  return promise
}

interface OrboScene {
  root: Node2D
  gameGroup: Node2D
  orbLayer: Node2D
  ringLayer: Node2D
  layout: FieldLayout
  world: PhysicsWorld
  abort: AbortController
  /** True while the demo is live (not aborted, subtree alive). */
  alive: () => boolean
  /** Cancellable wait in engine time. */
  wait: (seconds: number) => Promise<void>
}

/**
 * Build the field skeleton (rounded panel + `FieldNode` behind empty ring/orb
 * layers, mirroring the live draw order) plus a physics world with bounding
 * walls. The mask is async, so the panel + field slot into pre-added holders
 * once it resolves; the orbs render immediately meanwhile.
 */
function buildOrboScene(stage: Stage, host: EngineHost): OrboScene {
  const vp = stage.camera.viewport
  const bounds: Bounds = {
    x: vp.x + FIELD_PADDING,
    y: vp.y + FIELD_PADDING,
    width: vp.width - FIELD_PADDING * 2,
    height: vp.height - FIELD_PADDING * 2,
  }
  const layout = calculateLayout(bounds.width, bounds.height)
  const reveal = { frac: 1 }
  const abort = new AbortController()

  const root = new Node2D('orbo-demo')
  const fieldGroup = new Node2D('orbo-demo-field')
  // Empty holders keep draw order correct: the panel sits behind everything and
  // the field behind the orbs, even though both mount after the async mask.
  const panelHolder = new Node2D('orbo-demo-panel')
  const gameGroup = new Node2D('orbo-demo-game')
  gameGroup.transform.x = bounds.x
  gameGroup.transform.y = bounds.y
  const fieldHolder = new Node2D('orbo-demo-field-holder')
  const ringLayer = new Node2D('orbo-demo-rings')
  const orbLayer = new Node2D('orbo-demo-orbs')

  fieldGroup.add(panelHolder)
  fieldGroup.add(gameGroup)
  gameGroup.add(fieldHolder)
  gameGroup.add(ringLayer)
  gameGroup.add(orbLayer)
  root.add(fieldGroup)
  stage.tree.root.add(root)

  const world = orbLayer.addBehavior(
    new PhysicsWorldBehavior({
      config: createOrboPhysicsConfig(),
      label: 'orbo-demo',
    }),
  ).world
  buildOrboWalls(world, layout)

  getFieldMask(bounds)
    .then((mask) => {
      if (abort.signal.aborted || root.isDestroyed) return
      panelHolder.add(
        new PanelNode(
          bounds.x,
          bounds.y,
          bounds.width,
          bounds.height,
          reveal,
          mask,
        ),
      )
      fieldHolder.add(new FieldNode(layout, reveal, mask))
    })
    .catch(ignoreAbort)

  const alive = (): boolean => !abort.signal.aborted && !root.isDestroyed
  const wait = (seconds: number): Promise<void> =>
    host.engine.wait(seconds, abort.signal).catch(ignoreAbort)

  return {
    root,
    gameGroup,
    orbLayer,
    ringLayer,
    layout,
    world,
    abort,
    alive,
    wait,
  }
}

function makeOrb(
  x: number,
  y: number,
  size: OrbSize,
  team: TeamId,
  lifetime?: number,
): Orb {
  const spec = ORB_SIZES[size]
  return new Orb({
    x,
    y,
    radius: spec.radius,
    mass: spec.mass,
    size,
    player: team,
    team,
    lifetimeRemaining: lifetime ?? spec.lifetime,
    restitution: PHYSICS.restitution,
    linearDamping: PHYSICS.friction,
    sleepThreshold: PHYSICS.minVelocity,
  })
}

interface DemoOrb {
  body: Orb
  node: OrbNode
}

function spawnOrb(
  scene: OrboScene,
  x: number,
  y: number,
  size: OrbSize,
  team: TeamId,
  lifetime?: number,
): DemoOrb {
  const body = makeOrb(x, y, size, team, lifetime)
  scene.world.addBody(body)
  const node = new OrbNode(
    body,
    scene.layout,
    PLAYER_COLORS[team],
    (t: TeamId) => PLAYER_COLORS[t],
    scene.ringLayer,
  )
  scene.orbLayer.add(node)
  // Fade in so spawns and resets ease in instead of popping.
  node.transform.alpha = 0
  void node
    .tween({ alpha: 1 }, { duration: 0.22, easing: easings.outCubic })
    .catch(ignoreAbort)
  return { body, node }
}

function launch(body: Orb, vx: number, vy: number): void {
  body.isSleeping = false
  body.vx = vx
  body.vy = vy
}

/**
 * Play the finger cue on `orb` and launch it. The hand is parented to the orb
 * node so it tracks the orb's position for free: it fades in onto the orb, then
 * on "release" the orb flies (`launch`) while the hand rides along, and lifts
 * away quickly the moment the orb clears its flicking strip.
 */
async function flick(
  scene: OrboScene,
  orb: DemoOrb,
  vx: number,
  vy: number,
): Promise<void> {
  const finger = new FingerHintNode()
  orb.node.add(finger) // child of the orb → tracks it automatically
  finger.visible = true

  await finger
    .tween({ alpha: 1 }, { duration: 0.3, easing: easings.outCubic })
    .catch(ignoreAbort)
  if (scene.alive()) await scene.wait(0.22)

  if (scene.alive()) {
    const launchZone = zoneAtX(scene.layout, orb.body.x)
    launch(orb.body, vx, vy)
    // Ride the orb until it clears the strip it was flicked from.
    await waitUntil(
      scene,
      () => zoneAtX(scene.layout, orb.body.x) !== launchZone,
      1.2,
    )
    // Lift the hand away as the orb flies on — still tracking it, no stop.
    await finger
      .tween(
        { y: finger.transform.y - 45, alpha: 0 },
        { duration: 0.28, easing: easings.outCubic },
      )
      .catch(ignoreAbort)
  }
  if (!finger.isDestroyed) finger.destroy()
}

/**
 * Poll `predicate` on a coarse tick until it's true, the scene dies, or
 * timeout.
 */
async function waitUntil(
  scene: OrboScene,
  predicate: () => boolean,
  maxSec: number,
): Promise<void> {
  const step = 1 / 30
  let elapsed = 0
  while (scene.alive() && !predicate() && elapsed < maxSec) {
    await scene.wait(step)
    elapsed += step
  }
}

/** Wait for the world to come to rest, with a hard timeout so it can't hang. */
async function settle(scene: OrboScene, maxSec = 2.6): Promise<void> {
  await Promise.race([scene.world.waitForSettle(), scene.wait(maxSec)]).catch(
    ignoreAbort,
  )
}

/** Play the orb death burst and remove the orb, mirroring the live game. */
function explode(scene: OrboScene, orb: DemoOrb): void {
  scene.orbLayer.add(
    new OrbExplodeNode(
      { x: orb.body.x, y: orb.body.y },
      PLAYER_COLORS[orb.body.team],
      orb.body.radius,
    ),
  )
  scene.world.removeBody(orb.body)
  if (!orb.node.isDestroyed) orb.node.destroy()
}

function removeOrb(scene: OrboScene, orb: DemoOrb): void {
  scene.world.removeBody(orb.body)
  if (!orb.node.isDestroyed) orb.node.destroy()
}

/** Fade an orb out, then take it (and its ring) off the board. */
async function fadeRemove(scene: OrboScene, orb: DemoOrb): Promise<void> {
  await orb.node
    .tween({ alpha: 0 }, { duration: 0.2, easing: easings.inCubic })
    .catch(ignoreAbort)
  removeOrb(scene, orb)
}

/** The round-end "count" bounce reused from the live game's tally. */
async function bounceWin(scene: OrboScene, node: OrbNode): Promise<void> {
  await node
    .tween(
      { scaleX: ANIM.countBounceScale, scaleY: ANIM.countBounceScale },
      { duration: ANIM.countBounceUp, easing: easings.outQuad },
    )
    .catch(ignoreAbort)
  if (!scene.alive()) return
  await node
    .tween(
      { scaleX: 1, scaleY: 1 },
      { duration: ANIM.countBounceDown, easing: easings.outBack },
    )
    .catch(ignoreAbort)
}

function makeHandle(scene: OrboScene): DemoHandle {
  return {
    destroy() {
      scene.abort.abort()
      if (!scene.root.isDestroyed) scene.root.destroy()
    },
  }
}

/**
 * "Flick to score": a single orb banks off the top wall and settles in Team L's
 * scoring band, then resets and repeats.
 */
export function buildOrboScoreDemo(stage: Stage, host: EngineHost): DemoHandle {
  const scene = buildOrboScene(stage, host)
  const { layout } = scene
  const startX = launchStripCenterX(layout, 0)
  const startY = layout.height / 2

  async function run(): Promise<void> {
    while (scene.alive()) {
      // Fade a fresh orb in at the strip (no glide/teleport that reads as a shot).
      const orb = spawnOrb(scene, startX, startY, 'MEDIUM', 0)
      await flick(scene, orb, VX_BANK, VY_BANK)
      if (!scene.alive()) return
      await settle(scene)
      if (!scene.alive()) return
      await scene.wait(1.0)
      if (!scene.alive()) return
      await fadeRemove(scene, orb)
      if (!scene.alive()) return
      await scene.wait(0.25)
      if (!scene.alive()) return
    }
  }
  void run()
  return makeHandle(scene)
}

/**
 * "Bump them out": a heavy Team L orb flicks in from the left and plows through
 * a cluster of Team R orbs resting in Team R's OWN scoring band, shoving them
 * rightward out of it, then everything resets.
 */
export function buildOrboBumpDemo(stage: Stage, host: EngineHost): DemoHandle {
  const scene = buildOrboScene(stage, host)
  const { layout } = scene
  const cy = layout.height / 2
  const startX = launchStripCenterX(layout, 0)

  async function run(): Promise<void> {
    while (scene.alive()) {
      // Team R cluster resting in its own (left-center) band, on the flick path.
      const reds = [
        spawnOrb(scene, layout.width * 0.28, cy, 'MEDIUM', 1),
        spawnOrb(scene, layout.width * 0.35, cy - 82, 'MEDIUM', 1),
        spawnOrb(scene, layout.width * 0.32, cy + 82, 'SMALL', 1),
      ]
      const blue = spawnOrb(scene, startX, cy, 'LARGE', 0)
      await scene.wait(0.5)
      if (!scene.alive()) return
      await flick(scene, blue, VX_BUMP, 0)
      if (!scene.alive()) return
      await settle(scene)
      if (!scene.alive()) return
      await scene.wait(1.1)
      if (!scene.alive()) return
      await Promise.all([blue, ...reds].map((o) => fadeRemove(scene, o)))
      if (!scene.alive()) return
      await scene.wait(0.25)
      if (!scene.alive()) return
    }
  }
  void run()
  return makeHandle(scene)
}

/**
 * "Overshoot and lose it": a Team L orb is flicked too hard and lands deep in
 * Team R's flicking strip, where the capture glow signals it's about to be
 * taken. The loop then restarts.
 */
export function buildOrboOvershootDemo(
  stage: Stage,
  host: EngineHost,
): DemoHandle {
  const scene = buildOrboScene(stage, host)
  const { layout } = scene
  const startX = launchStripCenterX(layout, 0)
  const startY = layout.height / 2

  async function run(): Promise<void> {
    while (scene.alive()) {
      const blue = spawnOrb(scene, startX, startY, 'MEDIUM', 0)
      await flick(scene, blue, VX_OVERSHOOT, 0)
      if (!scene.alive()) return
      await settle(scene)
      if (!scene.alive()) return
      // Rests deep in Team R's strip; the capture glow signals it's about to be
      // taken. Hold on that, then restart.
      await scene.wait(1.6)
      if (!scene.alive()) return
      await fadeRemove(scene, blue)
      if (!scene.alive()) return
      await scene.wait(0.3)
      if (!scene.alive()) return
    }
  }
  void run()
  return makeHandle(scene)
}

/**
 * "Three lives": a last-life orb (flashing the expiry warning) is flicked into
 * a flicking strip, comes to a full stop, and only then is taken off the board
 * with its death burst.
 */
export function buildOrboLivesDemo(stage: Stage, host: EngineHost): DemoHandle {
  const scene = buildOrboScene(stage, host)
  const { layout } = scene
  const startX = launchStripCenterX(layout, 0)
  const startY = layout.height / 2

  async function run(): Promise<void> {
    while (scene.alive()) {
      // lifetime 1 → the orb pulses the "about to expire" warning.
      const orb = spawnOrb(scene, startX, startY, 'MEDIUM', 0, 1)
      await flick(scene, orb, VX_DEATH, 0)
      if (!scene.alive()) return
      // Wait for a genuine stop (generous cap so the settle, not the timeout,
      // wins), then hold so the orb visibly rests before it's removed.
      await settle(scene, 4)
      if (!scene.alive()) return
      await scene.wait(0.9)
      if (!scene.alive()) return
      explode(scene, orb)
      await scene.wait(1.3)
      if (!scene.alive()) return
    }
  }
  void run()
  return makeHandle(scene)
}

/**
 * "Most orbs win": Team L already leads with orbs resting in its band; a final
 * flick lands one more, then Team L's orbs bounce in a count. Team R keeps
 * fewer orbs in its own band — they stay put, so the tally reads as a count,
 * not a wipeout.
 */
export function buildOrboWinDemo(stage: Stage, host: EngineHost): DemoHandle {
  const scene = buildOrboScene(stage, host)
  const { layout } = scene
  const midY = layout.height / 2
  const startX = launchStripCenterX(layout, 0)

  async function run(): Promise<void> {
    while (scene.alive()) {
      // Resting orbs are scattered within each band (uneven, not a tidy column)
      // but kept clear of the mid-height flick path so the final shot can't knock
      // anyone out of their zone.
      const blues = [
        spawnOrb(scene, layout.width * 0.6, 96, 'MEDIUM', 0),
        spawnOrb(scene, layout.width * 0.72, 612, 'MEDIUM', 0),
      ]
      const reds = [
        spawnOrb(scene, layout.width * 0.27, 128, 'MEDIUM', 1),
        spawnOrb(scene, layout.width * 0.37, 560, 'SMALL', 1),
      ]
      await scene.wait(0.7)
      if (!scene.alive()) return

      const finalBlue = spawnOrb(scene, startX, midY, 'MEDIUM', 0)
      await flick(scene, finalBlue, VX_FINAL, 0)
      if (!scene.alive()) return
      await settle(scene)
      if (!scene.alive()) return
      await scene.wait(0.5)
      if (!scene.alive()) return

      // Count Team L's orbs with a staggered bounce; Team R's stay in their band
      // (fewer, so Team L takes the round). Linger on the final tally.
      const winners = [...blues, finalBlue]
      for (let i = 0; i < winners.length; i++) {
        void bounceWin(scene, winners[i].node)
        if (i < winners.length - 1) {
          await scene.wait(ANIM.countStagger)
          if (!scene.alive()) return
        }
      }
      await scene.wait(ANIM.postCountPause + 1.6)
      if (!scene.alive()) return

      await Promise.all([...winners, ...reds].map((o) => fadeRemove(scene, o)))
      if (!scene.alive()) return
      await scene.wait(0.3)
      if (!scene.alive()) return
    }
  }
  void run()
  return makeHandle(scene)
}
