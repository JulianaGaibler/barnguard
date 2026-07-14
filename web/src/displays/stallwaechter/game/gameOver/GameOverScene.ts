import {
  Path2DNode,
  SceneNode,
  easings,
  ignoreAbort,
  type Camera,
  type EngineHost,
  type Gfx2D,
  type Rect,
  type Stage,
  type Vec2,
} from '@src/stargazer'
import { PacketNode } from '../nodes/PacketNode'
import { PacketMotionTrailNode } from '../nodes/PacketMotionTrailNode'
import { DebrisBurstNode } from '../nodes/DebrisBurstNode'
import { TUNING } from '../data/tuning'
import { tessellateContours } from '@src/stargazer/assets/SvgPathContours'
import {
  getPathContours,
  registerPathTessellation,
} from '@src/stargazer/render/gfx/PathTessellationRegistry'
import { BackgroundStarsNode } from './BackgroundStarsNode'
import { EyeNode } from './EyeNode'
import type { GameOverReason } from '../session'

// ----------------------------------------------------------------------------
// Tuning, module-local; promote to `TUNING.gameOverScene` if any of these
// need to be tweaked from playtesting without touching this file.
// ----------------------------------------------------------------------------

/**
 * Camera viewport (portrait), tuned to the loss card's aspect. Zoomed ~6×
 * closer than the initial `300 × 400` so the packet reads big enough to be the
 * focal point. Eyes' world size shrinks in tandem below so their on-screen
 * dimensions stay in the "right size" the user landed on.
 */
const CAM_W = 78
const CAM_H = 104

// Collision
/** Two packets fly toward the centre at this speed. */
const COLLIDE_SPEED_WU_PER_SEC = 45
/** Spawn fraction of the half-viewport-width, packets start off-screen. */
const COLLIDE_SPAWN_X_FRAC = 0.9

// Escape
/** Speed of the packet drifting along the escape heading. */
const ESCAPE_SPEED_WU_PER_SEC = 30
/**
 * How far ahead of the origin the border line sits. Long approach so the packet
 * has time to visibly close on the wall before hitting it.
 */
const BORDER_LINE_OFFSET_WORLD = 44
/**
 * Full length of the border line perpendicular to the heading, extends far past
 * the camera's visible slice so the wall reads as a boundary that stretches
 * "off in both directions" rather than a fixed segment. Camera only ever sees
 * the central strip.
 */
const BORDER_LINE_LENGTH_WORLD = 1200
/** Fade-out of the border line after the packet crosses. */
const BORDER_LINE_FADE_MS = 200
/** Delay after the border cross before the eyes start appearing. */
const EYE_APPEAR_DELAY_SEC = 1.2
/** Duration of a single eye's lid-open tween. */
const EYE_OPEN_MS = 400
/** Duration of a single eye's iris slide-into-focus tween. */
const IRIS_SLIDE_MS = 300
/** Delay between consecutive eyes opening. */
const EYE_STAGGER_SEC = 0.25
/** Range for the random pause between blinks. */
const EYE_BLINK_INTERVAL_SEC: readonly [number, number] = [3, 5]
/** Duration of a single blink close/open pair. */
const EYE_BLINK_HALF_MS = 110
/** Whether eyes periodically blink after they're all open. */
const EYE_BLINK_ENABLED = true

/**
 * Three local offsets (relative to the packet) where the eyes float around the
 * packet as the camera follows it. Arranged so all three fit inside the
 * camera's viewport when centred on the packet, roughly upper-left,
 * upper-right, lower-left triangular composition matching the design mock.
 * Scaled to the current tighter camera so the eyes ring the packet at the same
 * on-screen distance as the "right size" playtesting settled on.
 */
const EYE_LOCAL_OFFSETS: readonly Vec2[] = [
  { x: -20, y: -18 },
  { x: 22, y: -13 },
  { x: -15, y: 17 },
]

const EYE_OUTLINE_FILL = '#ffffff'
const EYE_IRIS_FILL = '#010612'
/**
 * Visual size of the eye in world units (longest axis). A touch larger than the
 * last tuning so the eyes read more clearly.
 */
const EYE_WIDTH_WORLD = 13
const EYE_IRIS_RADIUS_WORLD = 2.1
const EYE_IRIS_MAX_OFFSET_WORLD = 2.2

const BORDER_LINE_COLOR = 'rgba(253, 246, 227, 0.85)'
const BORDER_LINE_WIDTH_CSS_PX = 12
/**
 * Border line is solid (no dashes) so it reads as a definite wall rather than
 * an indicator hint. `[0, 0]` disables `setLineDash`.
 */
const BORDER_LINE_DASH_CSS_PX: readonly [number, number] = [0, 0]
/**
 * Overrides `PacketNode`'s default `lineWidth: 1.5`, the game-over vignette
 * wants a slightly chunkier violet outline than the live game so the hex reads
 * at the tighter camera. Same value for collision and escape scenes so the
 * packet looks identical between the two. Live-game packets are unaffected
 * (this scene sets the field directly on its own `PacketNode` instances).
 */
const PACKET_STROKE_CSS_PX = 5

export interface GameOverSceneOptions {
  reason: GameOverReason
  /** Present only for `'exitedGermany'`. Radians (`atan2` output). */
  escapeHeadingRad?: number
  /**
   * The two eye-lid SVG paths (`top` + `bottom` from `eye.svg`), already parsed
   * by `loadGameAssets`. We merge them into one pre-centred path per scene
   * instance.
   */
  eyeOutlineParts: readonly {
    path: Path2D
    bounds: Rect
  }[]
  /**
   * The pre-centred + pre-scaled impact-flash sparkle from
   * `loadGameAssets().impactFlashPath`. Fired at the exact moment of collision
   *
   * - Border crossing to match the live game's impact beat.
   */
  impactFlashPath: Path2D
}

/**
 * One-shot scene painted into the loss card's canvas. Owns a secondary `Stage`
 * on the primary engine, a small scene graph, and a per-reason async phase
 * machine. Destroys cleanly on card unmount, every await is scoped to a shared
 * `AbortController` and the frame handler is unsubscribed in `destroy()`.
 */
export class GameOverScene {
  private readonly host: EngineHost
  private readonly stage: Stage
  private readonly reason: GameOverReason
  private readonly escapeHeadingRad: number
  private readonly eyeOutlinePath: Path2D
  private readonly eyeOutlineBounds: Rect
  private readonly impactFlashPath: Path2D
  private readonly sessionAbort = new AbortController()
  private offFrame: (() => void) | null = null
  private destroyed = false
  /** Monotonic counter so multiple impact flashes have unique scene ids. */
  private flashIdSeq = 0

  // --- collision state ---
  private leftPacket: PacketNode | null = null
  private rightPacket: PacketNode | null = null
  private leftTrail: PacketMotionTrailNode | null = null
  private rightTrail: PacketMotionTrailNode | null = null
  private collided = false

  // --- escape state ---
  private escapePacket: PacketNode | null = null
  private escapeTrail: PacketMotionTrailNode | null = null
  private escapeDirX = 1
  private escapeDirY = 0
  private borderLine: BorderLineNode | null = null
  private borderCrossed = false
  private eyes: EyeNode[] = []

  constructor(
    host: EngineHost,
    canvas: HTMLCanvasElement,
    opts: GameOverSceneOptions,
  ) {
    this.host = host
    this.reason = opts.reason
    this.escapeHeadingRad = opts.escapeHeadingRad ?? 0

    // Merge the two eyelid paths into one centred Path2D. `eye.svg`
    // authors the eye at (0, 0)-(125, 76); we shift so (0, 0) is the
    // visual centre and scale to `EYE_WIDTH_WORLD` on the long axis.
    const merged = mergeEyeParts(opts.eyeOutlineParts, EYE_WIDTH_WORLD)
    this.eyeOutlinePath = merged.path
    this.eyeOutlineBounds = merged.bounds
    this.impactFlashPath = opts.impactFlashPath

    this.stage = host.engine.attachStage(canvas, {
      name: 'GameOver',
      interactive: false,
      // Transparent compositing so the frame clear leaves the canvas
      // corners transparent; the card's own rounded `#010612` background
      // (same color) shows through there, so the card's `border-radius`
      // clips cleanly instead of the opaque canvas painting square corners
      // over it. `clearColor` is ignored while `transparent` is true.
      transparent: true,
      clearColor: '#010612',
      initialViewport: {
        x: -CAM_W / 2,
        y: -CAM_H / 2,
        width: CAM_W,
        height: CAM_H,
      },
    })

    // Kick off the per-reason async choreography. Both flows finish by
    // idling; on destroy the shared abort signal cancels every await.
    // Starfield is added inside `runEscapeScene` only, it's the camera
    // motion that sells the parallax, and the collision scene's camera
    // stays put.
    if (this.reason === 'collision') {
      void this.runCollisionScene()
    } else {
      void this.runEscapeScene()
    }

    // Per-frame integration for packet movement + camera follow + eye
    // positions. Registered even before either flow adds a packet, the
    // handler bails on null refs.
    this.offFrame = this.host.engine.ticker.onFrame((dt) => this.tick(dt))
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.sessionAbort.abort()
    this.offFrame?.()
    this.offFrame = null
    this.host.engine.detachStage(this.stage)
  }

  // -------------------------------------------------------------------------
  // Frame integration
  // -------------------------------------------------------------------------

  private tick(dt: number): void {
    if (this.destroyed) return
    if (this.reason === 'collision') {
      this.tickCollision(dt)
    } else {
      this.tickEscape(dt)
    }
  }

  private tickCollision(dt: number): void {
    if (this.collided) return
    const left = this.leftPacket
    const right = this.rightPacket
    if (!left || !right) return
    left.transform.x += COLLIDE_SPEED_WU_PER_SEC * dt
    right.transform.x -= COLLIDE_SPEED_WU_PER_SEC * dt
    // Feed the shooting-star trails. `setLiveHead` glues the ribbon
    // tip to the current position each frame; `sample` pushes only if
    // the distance filter accepts it (dedupes near-stationary samples).
    if (this.leftTrail) {
      this.leftTrail.setLiveHead(left.transform.x, left.transform.y)
      this.leftTrail.sample(left.transform.x, left.transform.y)
    }
    if (this.rightTrail) {
      this.rightTrail.setLiveHead(right.transform.x, right.transform.y)
      this.rightTrail.sample(right.transform.x, right.transform.y)
    }
    // Overlap check, meet when centres are within the same collision
    // threshold the live game uses. Guarantees the collision fires at
    // ~x=0 regardless of the exact frame boundaries.
    const gap = right.transform.x - left.transform.x
    if (gap <= TUNING.collision.pairThresholdWorld) {
      this.collided = true
      const meetX = (left.transform.x + right.transform.x) / 2
      const meetY = 0
      if (!left.isDestroyed) left.destroy()
      if (!right.isDestroyed) right.destroy()
      this.leftPacket = null
      this.rightPacket = null
      // Fade + destroy trails so the ribbons don't hang static in the
      // scene after the packets are gone. Motion trails don't
      // self-fade like `PathTrailNode` does, they render the last N
      // samples at uniform alpha, so an explicit alpha tween is the
      // only way to make them disappear cleanly.
      this.fadeAndDestroyTrail(this.leftTrail)
      this.fadeAndDestroyTrail(this.rightTrail)
      this.leftTrail = null
      this.rightTrail = null
      // Impact flash + debris ring, same visual grammar as the live
      // game (`session.spawnImpactFlash` + collision debris burst).
      this.spawnImpactFlash({ x: meetX, y: meetY })
      this.spawnCollisionDebris({ x: meetX, y: meetY })
    }
  }

  private tickEscape(dt: number): void {
    const packet = this.escapePacket
    if (!packet) return
    // Integrate packet position along the recorded escape heading.
    packet.transform.x += this.escapeDirX * ESCAPE_SPEED_WU_PER_SEC * dt
    packet.transform.y += this.escapeDirY * ESCAPE_SPEED_WU_PER_SEC * dt
    // Feed the trail, same pattern the live game uses via
    // `PacketBehaviour.onFixedStep` / `.onUpdate`.
    if (this.escapeTrail) {
      this.escapeTrail.setLiveHead(packet.transform.x, packet.transform.y)
      this.escapeTrail.sample(packet.transform.x, packet.transform.y)
    }
    // Camera keeps the packet centred.
    this.stage.camera.setViewport({
      x: packet.transform.x - CAM_W / 2,
      y: packet.transform.y - CAM_H / 2,
      width: CAM_W,
      height: CAM_H,
    })
    // Border cross detection, projection of the packet's position onto
    // the heading vector. When that projection passes the fixed
    // BORDER_LINE_OFFSET, fire the shrapnel and dissolve the line.
    if (!this.borderCrossed) {
      const projected =
        packet.transform.x * this.escapeDirX +
        packet.transform.y * this.escapeDirY
      if (projected >= BORDER_LINE_OFFSET_WORLD) {
        this.borderCrossed = true
        this.onBorderCrossed({
          x: packet.transform.x,
          y: packet.transform.y,
        })
      }
    }
    // Eyes float alongside the packet at fixed local offsets, their
    // world position rides the packet each frame so they stay in view
    // as the camera follows.
    for (let i = 0; i < this.eyes.length; i++) {
      const off = EYE_LOCAL_OFFSETS[i]
      const eye = this.eyes[i]
      eye.transform.x = packet.transform.x + off.x
      eye.transform.y = packet.transform.y + off.y
      eye.lookAtX = packet.transform.x
      eye.lookAtY = packet.transform.y
    }
  }

  // -------------------------------------------------------------------------
  // Per-reason flows
  // -------------------------------------------------------------------------

  private async runCollisionScene(): Promise<void> {
    // Two hexes fly in from opposite sides, meeting at the centre. The
    // `pre-orient rotation = heading + π/2` matches the live game's
    // spawn-packet convention so the top vertex points along the
    // velocity vector. Motion trails ride behind each hex, same
    // shooting-star ribbon the live packets use.
    const spawnX = (CAM_W / 2) * COLLIDE_SPAWN_X_FRAC
    this.leftTrail = new PacketMotionTrailNode()
    this.rightTrail = new PacketMotionTrailNode()
    // Trails first (behind), then packets on top.
    this.stage.scene.root.add(this.leftTrail)
    this.stage.scene.root.add(this.rightTrail)

    this.leftPacket = new PacketNode({ id: 'gameover-collide-left' })
    this.leftPacket.transform.x = -spawnX
    this.leftPacket.transform.y = 0
    this.leftPacket.transform.rotation = 0 + Math.PI / 2 // heading = 0 (+x)
    this.leftPacket.lineWidth = PACKET_STROKE_CSS_PX
    this.rightPacket = new PacketNode({ id: 'gameover-collide-right' })
    this.rightPacket.transform.x = spawnX
    this.rightPacket.transform.y = 0
    this.rightPacket.transform.rotation = Math.PI + Math.PI / 2 // heading = π (-x)
    this.rightPacket.lineWidth = PACKET_STROKE_CSS_PX
    this.stage.scene.root.add(this.leftPacket)
    this.stage.scene.root.add(this.rightPacket)

    // Seed the trails' live-head + one sample so the ribbon starts
    // glued to each hex from frame 1 rather than snapping in on the
    // first tick.
    this.leftTrail.setLiveHead(-spawnX, 0)
    this.leftTrail.sample(-spawnX, 0)
    this.rightTrail.setLiveHead(spawnX, 0)
    this.rightTrail.sample(spawnX, 0)
    // Nothing more to sequence, `tickCollision` handles the meeting
    // moment and spawns the debris burst inline.
  }

  private async runEscapeScene(): Promise<void> {
    // Precompute the heading direction. Store as (dirX, dirY) so the
    // frame handler doesn't `cos/sin` every tick.
    this.escapeDirX = Math.cos(this.escapeHeadingRad)
    this.escapeDirY = Math.sin(this.escapeHeadingRad)

    // Starfield behind everything, fixed world positions pan past the
    // camera as it follows the packet, selling the "we are travelling"
    // beat. Added first so the trail, packet, and eyes paint over it.
    const stars = new BackgroundStarsNode({
      count: 400,
      halfExtent: 800,
      sizeWorld: [0.15, 0.5],
      alphaRange: [0.15, 0.5],
      color: '#ffffff',
    })
    this.stage.scene.root.add(stars)

    // Motion trail behind the packet, added after stars so it renders
    // above them but under the hex. Same shooting-star ribbon the live
    // packets use.
    this.escapeTrail = new PacketMotionTrailNode()
    this.stage.scene.root.add(this.escapeTrail)

    // Single packet at world origin, the camera keeps it centred as it
    // drifts. Pre-orient so the top vertex points along the heading.
    this.escapePacket = new PacketNode({ id: 'gameover-escape-packet' })
    this.escapePacket.transform.rotation = this.escapeHeadingRad + Math.PI / 2
    this.escapePacket.lineWidth = PACKET_STROKE_CSS_PX
    this.stage.scene.root.add(this.escapePacket)

    // Seed trail so the ribbon is anchored to the hex on frame 1.
    this.escapeTrail.setLiveHead(0, 0)
    this.escapeTrail.sample(0, 0)

    // Border line, dashed, perpendicular to the heading, offset ahead
    // of the packet's start. Fades out on cross.
    this.borderLine = new BorderLineNode(
      this.escapeHeadingRad,
      BORDER_LINE_LENGTH_WORLD,
      BORDER_LINE_COLOR,
      BORDER_LINE_WIDTH_CSS_PX,
      BORDER_LINE_DASH_CSS_PX,
    )
    this.borderLine.transform.x = this.escapeDirX * BORDER_LINE_OFFSET_WORLD
    this.borderLine.transform.y = this.escapeDirY * BORDER_LINE_OFFSET_WORLD
    this.stage.scene.root.add(this.borderLine)

    // Wait for `tickEscape` to detect the crossing (sets
    // `this.borderCrossed = true` and calls `onBorderCrossed`), then
    // sleep the appear delay before opening the eyes.
    try {
      // Poll for crossing (rare, usually resolves in ~700 ms). Sleep in
      // 60 ms chunks so we don't spin the animator with tiny waits.
      while (!this.borderCrossed && !this.destroyed) {
        await this.host.engine.wait(0.06, this.sessionAbort.signal)
      }
      if (this.destroyed) return

      await this.host.engine.wait(
        EYE_APPEAR_DELAY_SEC,
        this.sessionAbort.signal,
      )
      if (this.destroyed) return

      // Spawn three eyes at the fixed local offsets. Actual world
      // positioning happens per-frame in `tickEscape`.
      for (let i = 0; i < EYE_LOCAL_OFFSETS.length; i++) {
        const eye = new EyeNode({
          outlinePath: this.eyeOutlinePath,
          outlineBounds: this.eyeOutlineBounds,
          irisRadius: EYE_IRIS_RADIUS_WORLD,
          irisMaxOffset: EYE_IRIS_MAX_OFFSET_WORLD,
          outlineFill: EYE_OUTLINE_FILL,
          irisFill: EYE_IRIS_FILL,
        })
        this.stage.scene.root.add(eye)
        this.eyes.push(eye)
      }

      // Staggered open + iris-slide per eye. Each eye runs its own async
      // chain so the three animations fully overlap after their offsets.
      const openPromises = this.eyes.map(async (eye, i) => {
        try {
          if (i > 0) {
            await this.host.engine.wait(
              i * EYE_STAGGER_SEC,
              this.sessionAbort.signal,
            )
          }
          if (this.destroyed) return
          await this.host.engine.animation.tween(
            eye,
            { openAmount: 1 },
            {
              duration: EYE_OPEN_MS / 1000,
              easing: easings.outCubic,
              signal: this.sessionAbort.signal,
            },
          )
          if (this.destroyed) return
          await this.host.engine.animation.tween(
            eye,
            { irisFocusAmount: 1 },
            {
              duration: IRIS_SLIDE_MS / 1000,
              easing: easings.outCubic,
              signal: this.sessionAbort.signal,
            },
          )
        } catch (err) {
          ignoreAbort(err)
        }
      })
      await Promise.all(openPromises)
      if (this.destroyed) return

      if (EYE_BLINK_ENABLED) this.runBlinkLoop()
    } catch (err) {
      ignoreAbort(err)
    }
  }

  // -------------------------------------------------------------------------
  // Beat handlers
  // -------------------------------------------------------------------------

  private onBorderCrossed(at: Vec2): void {
    // Match the live game's border-breach sequence: impact flash first,
    // then the directional wall-shard burst.
    this.spawnImpactFlash(at)
    // Border-breach shrapnel, same config the live game uses.
    const c = TUNING.lossAnim.borderBreach
    const burst = new DebrisBurstNode({
      center: at,
      count: c.count,
      triangleFraction: c.triangleFraction,
      initialSpeedWorld: c.initialSpeedWorld,
      dampingPerSec: c.dampingPerSec,
      emitDirectionRad: this.escapeHeadingRad,
      emitSpreadRad: c.emitSpreadRad,
      initialAngleOffsetRad: c.initialAngleOffsetRad,
      angInitialRadPerSec: c.angInitialRadPerSec,
      angInitialDampingPerSec: c.angInitialDampingPerSec,
      angBaseAbsRadPerSec: c.angBaseAbsRadPerSec,
      triangleSideWorld: c.triangleSideWorld,
      lineLengthWorld: c.lineLengthWorld,
      lineWidthCssPx: c.lineWidthCssPx,
      color: c.color,
    })
    this.stage.scene.root.add(burst)

    // Fade the border line out.
    const line = this.borderLine
    if (line && !line.isDestroyed) {
      void this.host.engine.animation
        .tween(
          line.transform,
          { alpha: 0 },
          {
            duration: BORDER_LINE_FADE_MS / 1000,
            easing: easings.outQuad,
            signal: this.sessionAbort.signal,
          },
        )
        .then(() => {
          if (!line.isDestroyed) line.destroy()
        })
        .catch(ignoreAbort)
    }
  }

  private spawnCollisionDebris(at: Vec2): void {
    // Same code path the live game uses in `session.spawnCollisionDebris`
    //, every knob (speed range, damping, equidistant emission) lives on
    // `TUNING.lossAnim.debris` so the game-over vignette and the live
    // in-round collision look identical.
    const c = TUNING.lossAnim.debris
    const burst = new DebrisBurstNode({
      center: at,
      count: c.count,
      triangleFraction: c.triangleFraction,
      initialSpeedWorld: c.initialSpeedWorld,
      dampingPerSec: c.dampingPerSec,
      angInitialRadPerSec: c.angInitialRadPerSec,
      angInitialDampingPerSec: c.angInitialDampingPerSec,
      angBaseAbsRadPerSec: c.angBaseAbsRadPerSec,
      triangleSideWorld: c.triangleSideWorld,
      lineLengthWorld: c.lineLengthWorld,
      lineWidthCssPx: c.lineWidthCssPx,
      color: c.color,
      equidistantEmission: c.equidistantEmission,
    })
    this.stage.scene.root.add(burst)
  }

  /**
   * Mirror of the live game's `session.spawnImpactFlash`, a scaled + fading
   * white sparkle at the impact point. Reuses the same pre-centred
   * `impactFlashPath` from `loadGameAssets`.
   */
  private spawnImpactFlash(at: Vec2): void {
    const cfg = TUNING.lossAnim.impactFlash
    const flash = new Path2DNode({
      id: `gameover-impact-flash-${this.flashIdSeq++}`,
      path: this.impactFlashPath,
      fill: cfg.color,
      hitMode: 'none',
    })
    flash.transform.x = at.x
    flash.transform.y = at.y
    flash.transform.scaleX = cfg.scaleFrom
    flash.transform.scaleY = cfg.scaleFrom
    this.stage.scene.root.add(flash)
    flash
      .tween(
        { scaleX: cfg.scaleTo, scaleY: cfg.scaleTo, alpha: 0 },
        { duration: cfg.durationSec, easing: easings.outCubic },
      )
      .then(() => {
        if (!flash.isDestroyed) flash.destroy()
      })
      .catch(ignoreAbort)
  }

  /**
   * Alpha-tween a motion trail to zero over ~300 ms, then destroy it. Called on
   * both packets when they collide, otherwise the ribbon's last frame of
   * samples sits static in the scene forever.
   */
  private fadeAndDestroyTrail(trail: PacketMotionTrailNode | null): void {
    if (!trail || trail.isDestroyed) return
    trail
      .tween({ alpha: 0 }, { duration: 0.3, easing: easings.outQuad })
      .then(() => {
        if (!trail.isDestroyed) trail.destroy()
      })
      .catch(ignoreAbort)
  }

  private runBlinkLoop(): void {
    // Each eye runs its own independent blink loop, every iteration
    // picks a fresh random delay in `EYE_BLINK_INTERVAL_SEC`, so the
    // three eyes fall out of sync naturally over time. Reads as three
    // separate creatures glancing at their own pace rather than one
    // three-eyed thing blinking as one.
    for (const eye of this.eyes) {
      void this.runEyeBlinkLoop(eye)
    }
  }

  private async runEyeBlinkLoop(eye: EyeNode): Promise<void> {
    try {
      while (!this.destroyed && !eye.isDestroyed) {
        const [lo, hi] = EYE_BLINK_INTERVAL_SEC
        const delay = lo + Math.random() * (hi - lo)
        await this.host.engine.wait(delay, this.sessionAbort.signal)
        if (this.destroyed || eye.isDestroyed) return
        await this.host.engine.animation.tween(
          eye,
          { openAmount: 0.05 },
          {
            duration: EYE_BLINK_HALF_MS / 1000,
            easing: easings.inQuad,
            signal: this.sessionAbort.signal,
          },
        )
        if (this.destroyed || eye.isDestroyed) return
        await this.host.engine.animation.tween(
          eye,
          { openAmount: 1 },
          {
            duration: EYE_BLINK_HALF_MS / 1000,
            easing: easings.outQuad,
            signal: this.sessionAbort.signal,
          },
        )
      }
    } catch (err) {
      ignoreAbort(err)
    }
  }
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

/**
 * Draws a single dashed line perpendicular to a heading, centred at the node's
 * transform origin. All state fits in `readonly` fields; no per-frame
 * allocations.
 */
class BorderLineNode extends SceneNode {
  private readonly nx: number
  private readonly ny: number
  private readonly halfLength: number
  private readonly color: string
  private readonly widthCssPx: number
  private readonly dashCssPx: readonly [number, number]

  constructor(
    headingRad: number,
    lengthWorld: number,
    color: string,
    widthCssPx: number,
    dashCssPx: readonly [number, number],
  ) {
    super('gameover-border-line')
    // Perpendicular direction (heading rotated +π/2).
    this.nx = -Math.sin(headingRad)
    this.ny = Math.cos(headingRad)
    this.halfLength = lengthWorld / 2
    this.color = color
    this.widthCssPx = widthCssPx
    this.dashCssPx = dashCssPx
  }

  override draw(gfx: Gfx2D, camera: Camera): void {
    const a = this.transform.alpha
    if (a <= 0.001) return
    const s = camera.strokeSpaceScale()
    // Zero-length dashes = solid stroke.
    const dash =
      this.dashCssPx[0] <= 0 && this.dashCssPx[1] <= 0
        ? undefined
        : [this.dashCssPx[0] * s, this.dashCssPx[1] * s]
    gfx.save()
    gfx.setAlpha(a > 1 ? 1 : a)
    gfx.strokeLine(
      -this.nx * this.halfLength,
      -this.ny * this.halfLength,
      this.nx * this.halfLength,
      this.ny * this.halfLength,
      { color: this.color, width: this.widthCssPx * s, dash },
    )
    gfx.restore()
  }
}

/**
 * Merge `top` + `bottom` eyelid paths (from `eye.svg`, viewBox `125 × 76`) into
 * one Path2D pre-centred on (0, 0) and scaled so the longer axis equals
 * `targetWidth` world units.
 */
function mergeEyeParts(
  parts: readonly { path: Path2D; bounds: Rect }[],
  targetWidth: number,
): { path: Path2D; bounds: Rect } {
  // Compute the union AABB across every incoming part so the centre +
  // scale reflect the whole eye rather than either lid alone.
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const part of parts) {
    const b = part.bounds
    if (b.x < minX) minX = b.x
    if (b.y < minY) minY = b.y
    if (b.x + b.width > maxX) maxX = b.x + b.width
    if (b.y + b.height > maxY) maxY = b.y + b.height
  }
  const srcW = maxX - minX || 1
  const srcH = maxY - minY || 1
  const scale = targetWidth / srcW
  const cx = minX + srcW / 2
  const cy = minY + srcH / 2

  const merged = new Path2D()
  const matrix = {
    a: scale,
    b: 0,
    c: 0,
    d: scale,
    e: -cx * scale,
    f: -cy * scale,
  }
  const mergedContours: Float32Array[] = []
  for (const part of parts) {
    merged.addPath(part.path, matrix)
    // Also merge tessellation data if the source part is registered.
    const partContours = getPathContours(part.path)
    if (partContours) {
      for (const c of partContours) {
        const transformed = new Float32Array(c.length)
        for (let i = 0; i < c.length; i += 2) {
          transformed[i] = matrix.a * c[i] + matrix.c * c[i + 1] + matrix.e
          transformed[i + 1] = matrix.b * c[i] + matrix.d * c[i + 1] + matrix.f
        }
        mergedContours.push(transformed)
      }
    }
  }
  if (mergedContours.length > 0) {
    const triangles = tessellateContours(mergedContours)
    registerPathTessellation(merged, triangles, mergedContours)
  }
  return {
    path: merged,
    bounds: {
      x: -srcW * scale * 0.5,
      y: -srcH * scale * 0.5,
      width: srcW * scale,
      height: srcH * scale,
    },
  }
}
