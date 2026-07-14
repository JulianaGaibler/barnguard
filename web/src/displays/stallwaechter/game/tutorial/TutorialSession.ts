import {
  GroupNode,
  ignoreAbort,
  parseSvgPaths,
  type EngineHost,
  type Rect,
  type Stage,
  type StageResizeInfo,
} from '@src/stargazer'
import handSvgRaw from '@src/displays/stallwaechter/assets/hand.svg?raw'
import type { PacketNode } from '../nodes/PacketNode'
import { EpicenterNode } from '../nodes/EpicenterNode'
import { EpicenterBehaviour } from '../behaviours/EpicenterBehaviour'
import { PacketBehaviour } from '../behaviours/PacketBehaviour'
import { TutorialHintNode } from '../nodes/TutorialHintNode'
import { spawnPacketInSession } from '../spawnPacketInSession'
import { RectMask } from './RectMask'

/**
 * World-space width of the tutorial's viewport. Height is derived at runtime
 * from the canvas's rendered aspect ratio (see `handleResize`), so the world
 * dimensions always match whatever CSS box the card sits in, no letterbox, no
 * cropping.
 */
const TUTORIAL_BASE_WIDTH = 200
/** Placeholder viewport used before the first `handleResize` fires. */
const TUTORIAL_INITIAL_VIEWPORT: Rect = {
  x: 0,
  y: 0,
  width: TUTORIAL_BASE_WIDTH,
  height: TUTORIAL_BASE_WIDTH,
}
/** Fractional positions inside the viewport so tuning stays screen-relative. */
const PACKET_X_FRAC = 0.22
const EPICENTER_X_FRAC = 0.78
/**
 * Vertical positions of the packet and the target. The target sits BELOW the
 * packet so the cone (which opens toward the packet) angles upward, matching
 * the hint's dashed hand path that arcs from the packet down into the wedge.
 */
const PACKET_Y_FRAC = 0.32
const TARGET_Y_FRAC = 0.72
/**
 * Fractional Y of the VIRTUAL point the cone axis points toward, kept separate
 * from `PACKET_Y_FRAC` so we can steepen the axis's upward tilt without moving
 * the visible packet. Pulled well above the viewport so the axis reads much
 * closer to vertical than the packet-to-target line itself would suggest.
 */
const AXIS_REF_Y_FRAC = -0.6
/**
 * Camera pan applied on top of the viewport rectangle. Negative shifts the
 * visible content DOWN on screen (the camera looks at a higher slice of the
 * world). Small value used for a subtle compositional drop so the action sits
 * below dead-centre.
 */
const CAMERA_Y_OFFSET_FRAC = -0.06
/** Delay between a packet retiring (capture / exit) and the next one spawning. */
const RESPAWN_DELAY_SEC = 0.4
/** Ambient travel speed for the tutorial packet once a trail steers it. */
const TUTORIAL_TRAVEL_SPEED = 60
/**
 * How far past the visible viewport edge the packet may drift before it's
 * considered "gone" and retired. Prevents the retire+respawn cycle from firing
 * the instant the packet nicks the frame, the player sees the packet leave, not
 * vanish on contact.
 */
const EXIT_BUFFER_WORLD = 15
/**
 * Huge rect returned from `gameViewport()` so
 * `PacketBehaviour::applyBorderTurnaround` never engages in the tutorial. The
 * turnaround check gates on "within `edgeBufferWorld` of the viewport edge",
 * pushing the edge far away means the packet never trips it, so it can freely
 * fly off-frame.
 */
const NO_TURNAROUND_VIEWPORT: Rect = {
  x: -1e6,
  y: -1e6,
  width: 2e6,
  height: 2e6,
}

/**
 * Mini-game inside the state-confirm card. Secondary `Stage`, one packet
 * left, one epicenter right, reuses the main-game packet/path stack via
 * `spawnPacketInSession` so visual and dynamics changes flow through.
 *
 * Packet uses `autonomousDrift: false`, sits at v=0 until drawn. On capture
 * or viewport exit it retires and respawns after `RESPAWN_DELAY_SEC`.
 * `mountTutorialStage` owns lifecycle. A session `AbortController` cancels
 * every in-flight `engine.wait` on unmount.
 */
export class TutorialSession {
  private readonly host: EngineHost
  private readonly stage: Stage
  private readonly packetLayer = new GroupNode('tutorial-packets')
  private readonly pathLayer = new GroupNode('tutorial-paths')
  private readonly handleLayer = new GroupNode('tutorial-handles')
  private readonly epicenterNode: EpicenterNode
  private readonly viewport: Rect
  private readonly rectMask: RectMask
  private readonly hint: TutorialHintNode
  private readonly sessionAbort = new AbortController()
  private offStagePointerDown: (() => void) | null = null
  private currentPacket: PacketNode | null = null
  private packetIdSeq = 0
  private destroyed = false
  /**
   * Guards `handleResize` until scene wiring completes. Stage's constructor
   * fires `applyResize` synchronously while our fields are still undefined.
   */
  private initialised = false

  constructor(host: EngineHost, canvas: HTMLCanvasElement) {
    this.host = host
    // Placeholder viewport, first `handleResize` reshapes to canvas aspect.
    this.viewport = { ...TUTORIAL_INITIAL_VIEWPORT }
    // Exit mask sits `EXIT_BUFFER_WORLD` outside the viewport so a packet
    // has to fly cleanly off-frame before `onExitedGermany` fires.
    this.rectMask = new RectMask(this.exitRect())

    // Force Canvas 2D. A fresh WebGL2 context on a new canvas blocks the
    // main thread on GPU-process IPC (~20 ms) at the exact moment of tap.
    // Tutorial is small and simple, Canvas 2D starts instantly.
    this.stage = host.engine.attachStage(canvas, {
      name: 'Tutorial',
      interactive: true,
      transparent: false,
      clearColor: '#0d0d10',
      initialViewport: this.viewport,
      renderer: 'canvas2d',
      onResize: (info) => this.handleResize(info),
    })

    // Layer order matches the main game, paths under packets so trails
    // don't occlude the finger's target.
    this.stage.scene.root.add(this.pathLayer)
    this.stage.scene.root.add(this.packetLayer)
    // Handles ride above packets so the small circle sits on top of the
    // hex when the two overlap at drag release.
    this.stage.scene.root.add(this.handleLayer)

    this.epicenterNode = new EpicenterNode({
      center: {
        x: this.viewport.x + this.viewport.width * EPICENTER_X_FRAC,
        y: this.viewport.y + this.viewport.height * TARGET_Y_FRAC,
      },
      // Axis reference is decoupled from the packet position, held
      // ABOVE the viewport so the cone axis tilts strongly upward
      // regardless of where the packet actually sits on-screen.
      approachReference: {
        x: this.viewport.x + this.viewport.width * PACKET_X_FRAC,
        y: this.viewport.y + this.viewport.height * AXIS_REF_Y_FRAC,
      },
    })
    this.epicenterNode.addBehaviour(new EpicenterBehaviour())
    this.stage.scene.root.add(this.epicenterNode)

    // Hint sits above every gameplay layer so the arch + hand paint on
    // top of packet, trail, and endpoint handles. Auto-stops on first
    // pointerdown inside the canvas (subscription below).
    this.hint = buildHintNode()
    this.stage.scene.root.add(this.hint)
    this.offStagePointerDown = this.stage.events.on('pointerDown', () => {
      this.hint.stop()
      this.offStagePointerDown?.()
      this.offStagePointerDown = null
    })

    // Everything is wired up, flip the guard and reshape the world
    // viewport to match whatever the canvas's rendered aspect currently
    // is. Subsequent CSS-size changes flow through `onResize` naturally.
    this.initialised = true
    const css = this.stage.renderer.cssSize
    this.handleResize({
      cssSize: { ...css },
      pixelSize: { ...this.stage.renderer.pixelSize },
      dpr: window.devicePixelRatio,
    })

    this.spawnStaticPacket()
  }

  /**
   * Reshape the world viewport so its aspect ratio matches the canvas's CSS
   * aspect ratio, result: the visible world fills the canvas exactly, no
   * letterbox, no cropping. Width is held fixed at `TUTORIAL_BASE_WIDTH`;
   * height scales with the aspect. The exit mask + epicenter position update in
   * lock-step so the packet's "close to border" and capture logic stay
   * coherent.
   */
  private handleResize(info: StageResizeInfo): void {
    if (!this.initialised || this.destroyed) return
    const w = info.cssSize.w
    const h = info.cssSize.h
    if (w <= 0 || h <= 0) return
    const aspect = w / h
    if (!Number.isFinite(aspect) || aspect <= 0) return
    const width = TUTORIAL_BASE_WIDTH
    const height = width / aspect
    this.viewport.width = width
    this.viewport.height = height
    // Camera viewport shifts up in world space vs `this.viewport`, which
    // drops visible content down on screen without moving packet or target.
    this.stage.camera.setViewport({
      x: 0,
      y: height * CAMERA_Y_OFFSET_FRAC,
      width,
      height,
    })
    this.rectMask.setRect(this.exitRect())
    this.epicenterNode.transform.x = width * EPICENTER_X_FRAC
    this.epicenterNode.transform.y = height * TARGET_Y_FRAC
    this.hint.setGeometry(
      { x: width * PACKET_X_FRAC, y: height * PACKET_Y_FRAC },
      { x: width * EPICENTER_X_FRAC, y: height * TARGET_Y_FRAC },
      height,
    )
  }

  private exitRect(): Rect {
    return {
      x: this.viewport.x - EXIT_BUFFER_WORLD,
      y: this.viewport.y - EXIT_BUFFER_WORLD,
      width: this.viewport.width + EXIT_BUFFER_WORLD * 2,
      height: this.viewport.height + EXIT_BUFFER_WORLD * 2,
    }
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.sessionAbort.abort()
    this.offStagePointerDown?.()
    this.offStagePointerDown = null
    this.host.engine.detachStage(this.stage)
  }

  private spawnStaticPacket(): void {
    if (this.destroyed) return
    const id = this.packetIdSeq++
    // Drop any lingering trail + endpoint handle from the previous packet
    // before the new one spawns. Neither is owned by the packet, so they
    // survive its destroy on their own.
    this.pathLayer.destroyChildren()
    this.handleLayer.destroyChildren()

    const packet = spawnPacketInSession(
      {
        host: this.host,
        packetLayer: this.packetLayer,
        hooks: {
          isPlaying: () => !this.destroyed,
          epicenter: () => this.epicenterNode,
          gameViewport: () => NO_TURNAROUND_VIEWPORT,
          mask: () => this.rectMask,
          onExitedGermany: () => this.onPacketRetired(),
          onCaptured: (p) => {
            // Match main-game behaviour: session destroys the packet after
            // capture. spawnPacketInSession's destroy handler + our
            // onDestroy hook take care of respawn scheduling.
            if (!p.isDestroyed) p.destroy()
          },
        },
        drawHooks: {
          isPlaying: () => !this.destroyed,
          epicenter: () => this.epicenterNode,
          pathLayerAdd: (node) => this.pathLayer.add(node),
          handleLayerAdd: (node) => this.handleLayer.add(node),
          bindTrailToPacket: (target, trail) => {
            target.getBehaviour(PacketBehaviour)?.setTrail(trail)
          },
        },
        packetId: `tutorial-packet-${id}`,
        hexParticleId: `tutorial-packet-hex-particles-${id}`,
        autonomousDrift: false,
        onDestroy: () => {
          if (this.currentPacket === packet) this.currentPacket = null
          this.scheduleRespawn()
        },
      },
      {
        x: this.viewport.x + this.viewport.width * PACKET_X_FRAC,
        y: this.viewport.y + this.viewport.height * PACKET_Y_FRAC,
      },
      0,
      TUTORIAL_TRAVEL_SPEED,
    )
    this.currentPacket = packet
  }

  private onPacketRetired(): void {
    // Exit path: PacketBehaviour switched the packet to `'lost'` mode and
    // will keep drifting it out. We destroy immediately so the respawn
    // scheduler kicks off promptly, the tutorial doesn't need the slow
    // "packet exits silently" beat that the main game uses.
    const p = this.currentPacket
    if (p && !p.isDestroyed) p.destroy()
  }

  private scheduleRespawn(): void {
    if (this.destroyed) return
    this.host.engine
      .wait(RESPAWN_DELAY_SEC, this.sessionAbort.signal)
      .then(() => {
        if (this.destroyed) return
        if (this.currentPacket) return
        this.spawnStaticPacket()
      })
      .catch(ignoreAbort)
  }
}

/**
 * Parse `hand.svg` into a `TutorialHintNode`. SVG ships two paths, fill and
 * outline, `TutorialHintNode` pre-translates them so the fingertip sits at
 * world origin.
 */
function buildHintNode(): TutorialHintNode {
  // Hand paths render on the dynamic layer, opt into GPU tessellation so
  // WebGL2 fill/stroke can find triangles + contours for them.
  const map = parseSvgPaths(handSvgRaw, { tessellate: true })
  const entries = Array.from(map.paths.values())
  if (entries.length < 2) {
    throw new Error(
      `TutorialSession: hand.svg expected 2 <path> elements, got ${entries.length}`,
    )
  }
  return new TutorialHintNode(entries[0].path, entries[1].path)
}
