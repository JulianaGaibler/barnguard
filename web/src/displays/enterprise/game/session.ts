import {
  Node2D,
  Path2DNode,
  CameraNode2D,
  AbortScope,
  createEmitter,
  easings,
  ignoreAbort,
  interiorThickness,
  registerPathTessellation,
  tessellateContours,
  type EngineHost,
  type Emitter,
  type GfxLinearGradient,
  type GfxShadowStyle,
  type Rect,
  type SvgPathEntry,
  type Vec2,
} from '@src/stargazer'
import { loadGameAssets } from './assets'
import {
  findRegion,
  type MapDescriptor,
  type RegionId,
  type RegionInfo,
} from './maps'
import { rippleLayers } from './maps/ripple'
import { overviewView, PICKER_MAP_HEIGHT_OVER_VIEW } from './maps/overviewView'
import { EpicenterNode } from './nodes/EpicenterNode'
import { PacketNode } from './nodes/PacketNode'
import {
  spawnImpactFlash as lossImpactFlash,
  spawnCollisionDebris as lossCollisionDebris,
  spawnBorderBreachDebris as lossBorderBreachDebris,
} from './lossVisuals'
import { EpicenterBehavior } from './behaviors/EpicenterBehavior'
import { StateSelectionBehavior } from './behaviors/StateSelectionBehavior'
import { PacketBehavior } from './behaviors/PacketBehavior'
import { spawnPacketInSession } from './spawnPacketInSession'
import { fireStateRipple } from './animations/stateRipple'
import { GridOverlayNode } from './nodes/GridOverlayNode'
import { SmallRegionDiscNode, discDiameter } from './nodes/SmallRegionDiscNode'
import { AttractPilot } from './attract/AttractPilot'
import type { PacketMask } from './behaviors/PacketBehavior'
import { SpawnController } from './spawn/SpawnController'
import {
  emptyHighScores,
  type GameEndReason as WireGameEndReason,
  type EnterpriseGameRecord as GameRecord,
  type EnterpriseHighScores as HighScores,
} from '../game-log'
import { TUNING } from './data/tuning'
import { persistFinishedGame, type Persisted } from './persistGame'

// -----------------------------------------------------------------------------
// Public API
// -----------------------------------------------------------------------------

/**
 * Why the round ended, in the session's own vocabulary. `'leftPlayArea'` is the
 * screen-edge loss a map whose play area is bounded by the view uses, as
 * against `'exitedGermany'` for crossing a coastline.
 */
export type GameOverReason = 'exitedGermany' | 'leftPlayArea' | 'collision'

export interface GameEvents {
  /**
   * Assets loaded and the map is on screen. `stateIds` lists the regions a
   * player may pick, so drawn-only geometry is absent.
   */
  ready: { stateIds: readonly RegionId[] }
  /**
   * A tap on the map while the attract round plays, one no packet took for
   * drawing.
   */
  attractTapped: void
  /** A tap on the picker's map that missed every region on offer. */
  outsideTapped: void
  /** User tapped a state, awaiting `startRound()` or `cancelSelection()`. */
  stateSelected: { stateId: RegionId }
  /** `cancelSelection` was called before the round started. */
  selectionCanceled: void
  /** `startRound` fired and the round is in progress. */
  roundStarted: { stateId: RegionId }
  /** A packet reached the epicenter and scored. `total` is the current score. */
  packetScored: { total: number }
  /** The round ended. */
  gameOver: {
    /** Counts the rounds this session has ended, to match `gameRecorded`. */
    round: number
    reason: GameOverReason
    stateId: RegionId
    score: number
    /** High-score outcome, used by the game-over card to celebrate. */
    isOverallHigh: boolean
    isStateHigh: boolean
    /** Snapshot after this round is persisted, used to populate the card. */
    highScores: HighScores
    /**
     * The escaping packet's velocity direction (radians) at the moment it
     * crossed Germany's boundary. Present only when `reason ===
     * 'exitedGermany'`. Consumed by the game-over card's loss animation to
     * replay the flight in the same direction.
     */
    escapeHeadingRad?: number
    /**
     * The server-side game record for this round. `null` if the server was
     * unreachable when the round ended, in which case the card still shows, but
     * reprint / delete affordances tied to a record id are disabled.
     */
    record: GameRecord | null
  }
  /**
   * The server recorded a round whose `gameOver` went out without a record,
   * because the server was unreachable then. Fires only while that round's
   * game-over screen is still up, so the card can catch up.
   */
  gameRecorded: {
    round: number
    isOverallHigh: boolean
    isStateHigh: boolean
    highScores: HighScores
    record: GameRecord
  }
  /** Reset back to the idle map. */
  reset: void
}

export type SessionState =
  | 'loading'
  | 'idle'
  | 'zoomingIn'
  | 'preGame'
  | 'zoomingOut'
  | 'playing'
  | 'gameOver'

export interface GameSession {
  readonly events: Emitter<GameEvents>
  readonly stateIds: readonly RegionId[]
  /**
   * Pickable regions whose on-screen size at the idle framing is below
   * `SMALL_REGION_PX`, so tapping them is unreliable. A list in the UI is what
   * makes these reachable, and it is empty on a map whose regions are all
   * comfortably tappable.
   */
  readonly smallRegionIds: readonly RegionId[]
  /** Currently in view, read-only for Svelte overlays. */
  readonly state: SessionState
  readonly selectedStateId: RegionId | null
  readonly score: number
  /**
   * Seconds the current round has run, counted in fixed steps so a pause
   * freezes it. It holds its value once the round ends and resets when the next
   * starts.
   */
  readonly elapsedSec: number
  /** True while the session is in a state where a state can be tapped. */
  acceptsStateTap(): boolean
  /**
   * Allow or refuse a tap on a region. Off by default, so the map is scenery
   * until a screen that wants a pick turns it on.
   */
  setTapsEnabled(enabled: boolean): void
  /**
   * Fade the whole map, fills and borders, to a low opacity so a screen over it
   * reads clearly, or bring it back. Animated.
   */
  setMapDimmed(dimmed: boolean): void
  /**
   * Play a round by itself on the full map until stopped, restarting on a new
   * region after each loss. Records nothing and raises no screen. Ignored while
   * a round or selection is live.
   */
  startAttract(): void
  /** End the self-playing round and clear what it left. */
  stopAttract(): void
  /**
   * Select `id` as though it had been tapped, for a UI that offers regions the
   * map cannot practically be tapped on. Ignored once a round is live.
   */
  selectRegion(id: RegionId): void
  /**
   * Start a round for the currently-selected state (called from the pre-game
   * card).
   */
  startRound(): Promise<void>
  /**
   * After a loss, put the same region back up as the pending selection without
   * moving the camera. Ignored unless a round has just ended.
   */
  returnToSelection(): void
  /** Drop the pending selection and animate back to the idle map. */
  cancelSelection(): Promise<void>
  /** End any in-progress round and return to the idle map. */
  reset(): Promise<void>
  /** Tear down the session's scene-facing state. */
  destroy(): void
}

// -----------------------------------------------------------------------------
// Look tokens, should eventually move to a theme.ts, but the game layer is
// still small enough that inlining is clear.
// -----------------------------------------------------------------------------

// State fill: a vertical white glass gradient, hoisted as module constants so
// every state's gradient reuses the same stops array (a fresh array with the
// same content still dedupes against the shared ramp atlas, just with an
// extra string join). Each state builds its own `GfxLinearGradient` from
// these stops against its own bounds, since a gradient's axis is a rect in
// local space and every state has a different one.
const FILL_STOPS: GfxLinearGradient['stops'] = [
  { offset: 0, color: 'rgba(255, 255, 255, 0.5)' },
  { offset: 1, color: 'rgba(255, 255, 255, 0.8)' },
]
// Selected-state fill: every state stays at the same muted node alpha
// (`tweenAlpha` below dims every state uniformly), so the selected one
// distinguishes itself by a brighter gradient, not a different opacity
// multiplier.
const FILL_STOPS_SELECTED: GfxLinearGradient['stops'] = [
  { offset: 0, color: 'rgba(255, 255, 255, 0.75)' },
  { offset: 1, color: 'rgba(255, 255, 255, 1)' },
]
// Every state's border is one glow along a single combined path (see
// `buildStateBorderNode`) rather than each state stroking its own contour:
// sixteen separately stroked borders would draw every interior, shared edge
// twice, stacking a translucent stroke's alpha there above the coastline's.
const BORDER_COLOR = 'rgba(255, 255, 255, 0.9)'
/**
 * Border for a region the map draws but does not offer, at 70% of the regular
 * border's opacity. It reads as a real boundary, which is what the source
 * artwork draws, while staying visibly quieter than a region you can pick.
 */
const BORDER_COLOR_INERT = 'rgba(255, 255, 255, 0.63)'
const BORDER_WIDTH = 3
// Two stacked inset glows along each region's own border, in map units because
// the region nodes carry `strokeSpace: 'world'`. A path shadow's mask is cached
// per blur radius in local units, so a screen-space radius would re-key every
// mask at every camera scale and rebake them through a camera tween. Map units
// hold the radius still, and the glow stays the same fraction of the map at any
// canvas size.
//
// The radii are the brand's 36.138 px and 20.077 px over the 1080 / 888 scale
// the full-country view resolves to in a 1920 x 1080 frame, which is the size
// the brand composition is drawn at. They are fixed rather than derived from
// the live camera because `strokeSpaceScale()` reads the screen transform and
// returns 1 until the first resize settles, so reading it during the scene
// build would bake a wrong radius on whichever boot happened to be early.
const GLOW_OUTER = 29.714
const GLOW_INNER = 16.508
/**
 * A region's glow radius as a fraction of the mean width of the land it draws
 * (`interiorThickness`), capped at the brand radius.
 *
 * Every region takes the same mean brightness from its glow this way, which a
 * single radius does not: the brand radii suit a region a few hundred map units
 * across, and a thin or broken-up one barely wider than the radius has the glow
 * meet itself in the middle and flood the whole shape. Greece and Norway are
 * the extremes on the European map, each one filling a fifth of its own
 * bounding box in ribbons and islands a tenth as wide as the box is tall.
 *
 * A half, which is roughly what the brand radius is to the widest region on
 * either map, so the glow holds its overall weight and only evens out.
 */
const GLOW_THICKNESS_FRACTION = 0.5

/** The two inset glows for a region, scaled to the width of its own land. */
function glowFor(shape: SvgPathEntry): readonly GfxShadowStyle[] {
  const outer = Math.min(
    GLOW_OUTER,
    interiorThickness(shape) * GLOW_THICKNESS_FRACTION,
  )
  return [
    { color: 'rgba(255, 255, 255, 0.5)', blur: outer, inset: true },
    {
      color: 'rgba(255, 255, 255, 0.4)',
      blur: outer * (GLOW_INNER / GLOW_OUTER),
      inset: true,
    },
  ]
}

/** The muted fill every region takes while one is picked. */
const HIGHLIGHT_ALPHA = 0.35
/** The map's opacity under the result screen. */
const MAP_DIMMED_ALPHA = 0.3
const MAP_DIM_SEC = 0.5

/** Cells the splash round's dot grid fades over at its edges. */
const ATTRACT_GRID_FEATHER_CELLS = 6

/** A boundary nothing crosses, for a round that only a collision can end. */
const NEVER_LOST: PacketMask = { contains: () => true }

const CAMERA_TWEEN_SEC = 0.6
/** How long a lost attract round stays on screen after the impact finishes. */
const ATTRACT_LINGER_SEC = 1.2

/**
 * A region narrower or shorter than this on screen, at the idle framing, goes
 * in the corner list instead of relying on a tap. Roughly a fingertip: below it
 * a player is aiming at something smaller than the border drawn around it.
 */
const SMALL_REGION_PX = 24

/** Session reason to the wire value the server stores. */
const WIRE_REASON: Record<GameOverReason, WireGameEndReason> = {
  exitedGermany: 'exited_germany',
  leftPlayArea: 'left_play_area',
  collision: 'collision',
}

/**
 * Canvas aspect, which a map needs to fit a play framing to the live viewport.
 * Falls back to 16:9 before the first resize settles, the same window in which
 * `strokeSpaceScale()` reports 1.
 */
function canvasAspect(host: EngineHost): number {
  const size = host.engine.primaryStage.renderer.cssSize
  return size.h > 0 ? size.w / size.h : 16 / 9
}

function sameRect(a: Rect, b: Rect): boolean {
  return (
    a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
  )
}

/** Camera scale, in px per map unit, that fitting `view` to the canvas lands on. */
function fitScale(host: EngineHost, view: Rect): number {
  const size = host.engine.primaryStage.renderer.cssSize
  if (view.width <= 0 || view.height <= 0 || size.h <= 0) return 0
  return Math.min(size.w / view.width, size.h / view.height)
}

/**
 * How much further in than the idle framing each region's play framing sits,
 * which is what `Stage.warmPathShadows` needs to bake the region glows' masks
 * for a framing the camera has not reached. Near-equal factors are left in: the
 * cache keys a mask by half-octave scale bucket, so framings that close
 * together warm the same masks and collapse to one request there.
 */
function playZoomFactors(host: EngineHost, map: MapDescriptor): number[] {
  const aspect = canvasAspect(host)
  const idle = fitScale(host, overviewView(map.idleView, aspect))
  if (idle <= 0) return []
  const picker = overviewView(map.idleView, aspect, PICKER_MAP_HEIGHT_OVER_VIEW)
  const factors = new Set<number>([fitScale(host, picker) / idle])
  for (const region of map.regions) {
    if (!region.selectable) continue
    const factor = fitScale(host, map.playViewFor(region, aspect)) / idle
    if (factor > 0) factors.add(factor)
  }
  return [...factors]
}

// -----------------------------------------------------------------------------
// startGame
// -----------------------------------------------------------------------------

/**
 * How long past the end-screen grace the game-over card waits on the server
 * before it shows without the record.
 */
const PERSIST_WAIT_MS = 1000

/**
 * Build the map, packets and overlays for `map` and return the session that
 * drives them. The content goes under `world` when one is given, which keeps it
 * between nodes the caller placed around it, such as a layer drawn over it.
 * Without one it goes straight on the scene's root.
 */
export async function startGame(
  host: EngineHost,
  map: MapDescriptor,
  world?: Node2D,
): Promise<GameSession> {
  const events = createEmitter<GameEvents>()
  const assets = await loadGameAssets()
  /** The picker's framing, which shows the whole map, fitted to the live canvas. */
  const pickerView = (): Rect =>
    overviewView(map.idleView, canvasAspect(host), PICKER_MAP_HEIGHT_OVER_VIEW)
  /** The splash's framing, fitted to the live canvas. */
  const splashView = (): Rect => overviewView(map.idleView, canvasAspect(host))
  /**
   * The framing with no region chosen: the splash's while it plays, else the
   * picker's.
   */
  const overview = (): Rect => (attractWanted ? splashView() : pickerView())
  // The failure boundary, which the map owns. Germany reads its coastline,
  // Europe bounds the view's left and right edges.
  const playAreaMask = map.playAreaMask({
    viewport: () => camera?.viewport ?? map.idleView,
  })

  const stateNodes = new Map<RegionId, Path2DNode>()
  const stateFillGradients = new Map<
    RegionId,
    { normal: GfxLinearGradient; selected: GfxLinearGradient }
  >()
  // Two paths rather than one, so the inert border can carry its own opacity.
  // Each path still dedups its own overlapping edges, and the two sets never
  // share an edge: a region encloses another only in its fill, never in the
  // outline these stroke.
  const stateBorderNode = buildStateBorderNode(map, true)
  const inertBorderNode = buildStateBorderNode(map, false)
  const packetLayer = new Node2D('packet-layer')
  const pathLayer = new Node2D('path-layer')
  const handleLayer = new Node2D('handle-layer')
  const activePackets: PacketNode[] = []
  /**
   * What the round is lost across. The splash round is lost by a collision, and
   * across the border too only on a map whose border is a real edge.
   */
  const lossMask = (): PacketMask =>
    attractMode && !map.previewLostAtBorder ? NEVER_LOST : playAreaMask
  /**
   * The rect packets spawn in and turn back at. The splash round stays over the
   * map itself, so a packet never wanders out beneath the text beside it.
   */
  const playViewport = (): Rect =>
    attractMode ? map.idleView : (camera?.viewport ?? map.idleView)

  const gridOverlay = new GridOverlayNode({
    bounds: map.gridMask?.worldRect ?? map.idleView,
    mask: map.gridMask,
    cellSizeWorld: map.gridCellWorld,
  })
  gridOverlay.attachWarnSource({
    activePackets: () => activePackets,
    mask: lossMask,
    isPlaying: () => sessionState === 'playing',
  })
  // Register the mask with the debug controller so the `'clip-mask'` HUD
  // render mode can visualise it. Safe to call unconditionally, the
  // controller stores the reference, and nothing draws unless the mode is
  // active.
  host.debug.setInspectedMask(map.geometry.landMask)

  let sessionState: SessionState = 'loading'
  /**
   * Whether a tap on a region selects it. Off on the splash, where the map is
   * scenery, and on while the player is picking.
   */
  let tapsEnabled = false
  /** Whether the map is faded under the result screen. */
  let mapDimmed = false
  /** Whether a region is picked, so every fill sits at the muted alpha. */
  let highlighted = false
  /** Seconds of play this round, summed from fixed steps so a pause freezes it. */
  let elapsedSec = 0
  /** A disc for each region too small to tap, in the order the map lists them. */
  const discs: SmallRegionDiscNode[] = []
  /** Whether the splash's self-playing round is running. */
  let attractMode = false
  /** Asked for while the session was busy, to start once it is idle again. */
  let attractWanted = false
  let lastAttractId: RegionId | null = null
  const attractScope = new AbortScope()
  /** The region whose disc covers a world point, nearest centre first. */
  function discAt(x: number, y: number): RegionId | null {
    let best: SmallRegionDiscNode | null = null
    let bestDistSq = Infinity
    const worldPerCssPx = camera?.strokeSpaceScale() ?? 1
    for (const disc of discs) {
      if (!disc.visible || !disc.contains(x, y, worldPerCssPx)) continue
      const dx = x - disc.transform.x
      const dy = y - disc.transform.y
      const d = dx * dx + dy * dy
      if (d < bestDistSq) {
        best = disc
        bestDistSq = d
      }
    }
    return best?.regionId ?? null
  }
  function syncDiscs(): void {
    const css = host.engine.primaryStage.renderer.cssSize
    for (const disc of discs) {
      disc.diameterCssPx = discDiameter(css.w, css.h)
      disc.visible = tapsEnabled
      disc.selected = disc.regionId === selectedStateId
    }
  }
  let selectedStateId: RegionId | null = null
  let score = 0
  let epicenter: EpicenterNode | null = null
  // The game's 2D camera, created explicitly in the scene build below.
  let camera: CameraNode2D | null = null
  // Re-abortable scope for the camera tween: each `animateTo` cancels the prior.
  const cameraScope = new AbortScope()
  /** The framing the camera tween is heading to, and its completion. */
  let cameraHeading: { target: Rect; done: Promise<void> } | null = null
  let packetIdSeq = 0
  // Re-abortable scope for the deferred game-over timers (ripple settle + the
  // gameOver-event grace). `reset()`/`destroy()` cancel them.
  const graceScope = new AbortScope()
  // Round-start wall clock (`performance.now()`), used to compute the game's
  // `durationMs` when the round ends. 0 means "no active round".
  let roundStartedAtMs = 0
  /** Rounds ended so far, see `GameEvents['gameOver'].round`. */
  let roundsEnded = 0

  const spawnController = new SpawnController(
    {
      isPlaying: () => sessionState === 'playing',
      mask: () => map.geometry.landMask,
      epicenter: () => epicenter,
      activePackets: () => activePackets,
      score: () => score,
      // Spawn only inside the current game-camera viewport so packets never
      // grow off-screen: sampling the whole 661×888 country regardless of
      // which half the camera frames would let packets grow outside the
      // visible area. Rejection sampling still trims out the
      // letterbox-inside-country via `mask.contains(pt, inset=minDistFromBorder)`.
      spawnBounds: playViewport,
      spawnPacket,
    },
    (seconds, signal) => host.engine.wait(seconds, signal),
  )
  let offCollision: (() => void) | null = null

  /**
   * Ids a player may pick. Drawn-only regions are part of the landmass, not
   * choices, so nothing offering a list of regions should see them.
   */
  function selectableIds(): RegionId[] {
    return map.regions.filter((r) => r.selectable).map((r) => r.id)
  }

  /**
   * Pickable regions too small to tap at the idle framing, measured rather than
   * listed: the artwork decides which regions these are, and a hardcoded list
   * would rot the next time the map is redrawn.
   */
  function smallRegionIdsNow(): RegionId[] {
    const view = pickerView()
    const size = host.engine.primaryStage.renderer.cssSize
    if (view.width <= 0 || view.height <= 0 || size.h <= 0) return []
    // The idle framing is fit into the canvas, so the scale is whichever axis
    // constrains it.
    const scale = Math.min(size.w / view.width, size.h / view.height)
    return map.regions
      .filter((r) => r.selectable)
      .filter(
        (r) =>
          r.shape.bounds.width * scale < SMALL_REGION_PX ||
          r.shape.bounds.height * scale < SMALL_REGION_PX,
      )
      .map((r) => r.id)
  }

  // --- Scene build ---------------------------------------------------------
  await host.loadScene((scene) => {
    // Everything but the camera hangs here, in the order it is added.
    const content = world ?? scene.root
    world?.destroyChildren()
    // The game's 2D camera, framing the full 661×888 country.
    const cam = new CameraNode2D('enterprise-camera')
    // The display opens on the splash.
    cam.setViewport(splashView())
    scene.root.add(cam)
    cam.makeCurrent()
    camera = cam

    const mapGroup = new Node2D('map')
    content.add(mapGroup)

    for (const info of map.regions) {
      const entry = info.shape
      // The gradient axis is a rect in the path's own local space, so each
      // state builds its own from its own bounds rather than sharing one
      // across the map.
      const top = entry.bounds.y
      const bottom = entry.bounds.y + entry.bounds.height
      const gradients = {
        normal: {
          kind: 'linear',
          x0: 0,
          y0: top,
          x1: 0,
          y1: bottom,
          stops: FILL_STOPS,
        },
        selected: {
          kind: 'linear',
          x0: 0,
          y0: top,
          x1: 0,
          y1: bottom,
          stops: FILL_STOPS_SELECTED,
        },
      } satisfies { normal: GfxLinearGradient; selected: GfxLinearGradient }
      stateFillGradients.set(info.id, gradients)
      if (!info.drawsFill) {
        // Drawn by the region around it, see `RegionInfo.drawsFill`. Its
        // border still comes from the inert border path.
        continue
      }
      const node = new Path2DNode({
        id: `state:${info.id}`,
        path: entry.path,
        fill: gradients.normal,
        shadow: glowFor(entry),
        strokeSpace: 'world',
        // A region the map draws but does not offer takes no taps at all, so
        // it reads as part of the landmass rather than a dead target.
        hitMode: info.selectable ? 'fill' : 'none',
        bounds: entry.bounds,
      })
      if (info.selectable) {
        node.addBehavior(
          new StateSelectionBehavior(info.id, onStateTap, discAt),
        )
      }
      mapGroup.add(node)
      stateNodes.set(info.id, node)
    }

    // The combined border paths draw after every region's fill and inset
    // shadows, see `buildStateBorderNode`. The inert one goes first so a
    // pickable region's border wins wherever the two run close together.
    if (inertBorderNode) mapGroup.add(inertBorderNode)
    if (stateBorderNode) mapGroup.add(stateBorderNode)

    // Country grid overlay draws above the state fills and under the path and
    // packet layers added after it. It also updates before the packets, which
    // is fine, the warn sampler reads live packet positions each frame.
    content.add(gridOverlay)

    // A disc for each region too small to tap, shown while the player picks.
    const small = new Set(smallRegionIdsNow())
    for (const info of map.regions) {
      if (!small.has(info.id)) continue
      const disc = new SmallRegionDiscNode(
        info.id,
        info.startPoint.x,
        info.startPoint.y,
      )
      disc.visible = false
      discs.push(disc)
      content.add(disc)
    }

    // Dynamic-layer groups, paths draw under packets so trails don't
    // occlude the finger's target. Endpoint handles draw on top so the
    // player can grab them.
    content.add(pathLayer)
    content.add(packetLayer)
    content.add(handleLayer)
  })

  host.start()
  // Refit the camera when the window changes shape, since every framing is built
  // to the canvas aspect. A tween already in flight finishes on its old target
  // and the next resize or move corrects it.
  const offResize = host.engine.events.on('resize', () => {
    syncDiscs()
    if (!camera) return
    if (
      attractMode ||
      sessionState === 'idle' ||
      sessionState === 'zoomingOut'
    ) {
      camera.setViewport(overview())
      return
    }
    const info =
      selectedStateId !== null ? findRegion(map, selectedStateId) : undefined
    if (info) camera.setViewport(map.playViewFor(info, canvasAspect(host)))
  })
  // Bake the region glows' masks for the framings a tap can zoom to, while the
  // map is still idle. A path shadow's mask is cached per camera scale, so
  // otherwise the first zoom into a map arrives with a hundred masks to bake, a
  // few per frame, and each region's glow visibly steps into place as its own
  // mask lands.
  host.engine.primaryStage.warmPathShadows(playZoomFactors(host, map))
  sessionState = 'idle'
  events.emit('ready', { stateIds: selectableIds() })

  // Dismiss-on-outside-tap: any pointerdown that no state fill captures
  // (water, or a region the map draws but does not offer) leaves the picker
  // from idle and cancels the selection from `'preGame'`. Mid-zoom taps do
  // neither, so an extra tap right after `confirmState` doesn't drop the
  // round.
  const offBackgroundTap = host.engine.primaryStage.events.on(
    'pointerDown',
    (e) => {
      if (e.pointer.capturedBy !== null) return
      if (!tapsEnabled) {
        onTapWhileUntappable()
        return
      }
      const disc = discAt(e.pointer.world.x, e.pointer.world.y)
      if (disc !== null) {
        onStateTap(disc)
        return
      }
      if (sessionState === 'idle') {
        events.emit('outsideTapped', undefined)
        return
      }
      if (sessionState !== 'preGame') return
      void cancelSelection()
    },
  )

  // --- Tap handler --------------------------------------------------------
  function onStateTap(id: RegionId): void {
    if (!tapsEnabled) {
      onTapWhileUntappable()
      return
    }
    // From idle, always start a fresh selection.
    if (sessionState === 'idle') {
      void selectState(id)
      return
    }
    // Mid-selection (zoom in-flight OR card shown), allow retargeting to
    // a different state. Same state -> no-op, avoids re-triggering the
    // zoom + fade + epicenter build on an accidental double-tap.
    if (sessionState === 'zoomingIn' || sessionState === 'preGame') {
      if (id !== selectedStateId) void selectState(id)
      return
    }
    // Round is live or ending, ignore state taps entirely.
  }

  /** A tap the map ignores, which the splash takes as a request to play. */
  function onTapWhileUntappable(): void {
    if (attractWanted) events.emit('attractTapped', undefined)
  }

  // --- CameraView2D framing -----------------------------------------------------
  async function selectState(id: RegionId): Promise<void> {
    const info = findRegion(map, id)
    if (!info) return

    // Retargeting mid-selection, tear down the previous state's
    // epicenter before building the new one so we never leak a ring.
    disposeEpicenter()

    selectedStateId = id
    syncDiscs()
    sessionState = 'zoomingIn'
    events.emit('stateSelected', { stateId: id })
    highlightState(id)
    // Ripple flashes through the neighbour graph starting at the newly-
    // selected state so the choice reads as "energising the map from
    // here outward". Fire-and-forget, pulses self-clean.
    fireStateRipple(rippleLayers(map, id), stateNodes)

    showEpicenter(info)

    const target = map.playViewFor(info, canvasAspect(host))
    await animateCameraTo(target)
    if (sessionState === 'zoomingIn') sessionState = 'preGame'
  }

  /**
   * Show the epicenter at the region's start point, breathing. The cone opens
   * toward the midpoint of the idle view (the map's own centre) so the axis
   * always points into the interior.
   */
  function showEpicenter(info: RegionInfo): void {
    const mapCentre: Vec2 = {
      x: map.idleView.x + map.idleView.width / 2,
      y: map.idleView.y + map.idleView.height / 2,
    }
    epicenter = new EpicenterNode({
      center: info.startPoint,
      approachReference: mapCentre,
      apexIcon: assets.firefoxLogo,
    })
    epicenter.transform.alpha = 0
    epicenter.addBehavior(new EpicenterBehavior())
    ;(world ?? host.engine.tree.root).add(epicenter)
    // Fade the epicenter in as the camera zooms.
    void epicenter
      .tween({ alpha: 1 }, { duration: 0.5, easing: easings.outCubic })
      .catch(ignoreAbort)
  }

  /**
   * Tween the camera to `target`. A call for the framing already being tweened
   * to joins that tween rather than restarting it, so a second caller neither
   * resets the easing nor cuts the first caller's wait short.
   */
  function animateCameraTo(target: Rect): Promise<void> {
    if (!camera) return Promise.resolve()
    if (cameraHeading && sameRect(cameraHeading.target, target)) {
      return cameraHeading.done
    }
    const signal = cameraScope.reset()
    const heading = {
      target,
      done: camera
        .animateTo(target, {
          duration: CAMERA_TWEEN_SEC,
          easing: easings.inOutCubic,
          signal,
        })
        .catch(ignoreAbort)
        .finally(() => {
          if (cameraHeading === heading) cameraHeading = null
        }),
    }
    cameraHeading = heading
    return heading.done
  }

  // --- Highlight bookkeeping ---------------------------------------------
  //
  // State fills draw in tree order under the map group, alongside the border
  // paths. Nodes whose alpha is already at target skip the tween.

  function tweenAlpha(
    node: Path2DNode,
    targetAlpha: number,
    durationSec: number,
  ): void {
    if (Math.abs(node.transform.alpha - targetAlpha) < 1e-3) return
    // Swallow the AbortError a destroyed node rejects with.
    node
      .tween(
        { alpha: targetAlpha },
        { duration: durationSec, easing: easings.inOutQuad },
      )
      .catch(ignoreAbort)
  }

  function highlightState(id: RegionId): void {
    // Every state dims to the same muted alpha. The selected one gets a
    // brighter gradient so it reads distinctly by color, not by opacity.
    highlighted = true
    for (const [otherId, node] of stateNodes) {
      const gradients = stateFillGradients.get(otherId)
      if (gradients)
        node.fill = otherId === id ? gradients.selected : gradients.normal
      tweenAlpha(node, HIGHLIGHT_ALPHA * mapAlpha(), 0.4)
    }
  }

  function clearHighlight(): void {
    highlighted = false
    for (const [id, node] of stateNodes) {
      const gradients = stateFillGradients.get(id)
      if (gradients) node.fill = gradients.normal
      tweenAlpha(node, mapAlpha(), 0.35)
    }
  }

  /** The whole map's opacity on top of the highlight, faded under a result. */
  function mapAlpha(): number {
    return mapDimmed ? MAP_DIMMED_ALPHA : 1
  }

  /**
   * Fade the whole map, fills and borders alike, so the cards over it read
   * clearly, or bring it back.
   */
  function setMapDimmed(dimmed: boolean): void {
    if (dimmed === mapDimmed) return
    mapDimmed = dimmed
    const fill = (highlighted ? HIGHLIGHT_ALPHA : 1) * mapAlpha()
    for (const node of stateNodes.values()) {
      tweenAlpha(node, fill, MAP_DIM_SEC)
    }
    for (const border of [stateBorderNode, inertBorderNode]) {
      if (border) tweenAlpha(border, mapAlpha(), MAP_DIM_SEC)
    }
  }

  // --- Session methods ----------------------------------------------------
  async function cancelSelection(): Promise<void> {
    if (sessionState !== 'preGame' && sessionState !== 'zoomingIn') return
    sessionState = 'zoomingOut'
    events.emit('selectionCanceled', undefined)
    disposeEpicenter()
    clearHighlight()
    await animateCameraTo(overview())
    if (sessionState === 'zoomingOut') sessionState = 'idle'
    selectedStateId = null
    syncDiscs()
    if (attractWanted) startAttract()
  }

  async function startRound(): Promise<void> {
    if (sessionState !== 'preGame' || selectedStateId === null) return
    const stateId = selectedStateId
    sessionState = 'playing'
    score = 0
    elapsedSec = 0
    roundStartedAtMs = performance.now()
    events.emit('roundStarted', { stateId })
    beginPlaying()
  }

  /** Start spawning packets and watching them for collisions. */
  function beginPlaying(): void {
    spawnController.start()
    // Collision loop on the fixed-step ticker. O(N²) but N is tiny.
    offCollision = host.engine.ticker.onFixedStep((fixedDt) => {
      if (sessionState !== 'playing') return
      checkPacketPacketCollisions()
      if (attractMode) pilot.update(performance.now() / 1000)
      else elapsedSec += fixedDt
    })
  }

  // --- Attract mode --------------------------------------------------------
  //
  // The splash plays a round by itself on the full map: a random region, a
  // pilot drawing the routes, and on a loss the next region. Nothing is
  // recorded and no screen is raised, it only ends a round the way a player's
  // would.

  const pilot = new AttractPilot({
    packets: () => activePackets,
    epicenter: () => epicenter,
    pathLayerAdd: (node) => pathLayer.add(node),
    bindTrailToPacket: (target, trail) => {
      target.getBehavior(PacketBehavior)?.setTrail(trail)
    },
  })

  /** Pick a region other than the last and play it. */
  function playAttractRound(): void {
    if (!attractMode || sessionState !== 'idle') return
    const ids = selectableIds().filter((id) => id !== lastAttractId)
    const id = ids[Math.floor(Math.random() * ids.length)]
    const info = id === undefined ? undefined : findRegion(map, id)
    if (!info) return
    lastAttractId = id
    selectedStateId = id
    highlightState(id)
    showEpicenter(info)
    sessionState = 'playing'
    score = 0
    beginPlaying()
  }

  /**
   * Clear a finished or abandoned attract round and return to idle. Between two
   * rounds the map stays dimmed, since clearing the highlight and setting it
   * again in the same tick leaves the clearing tween running and the map
   * bright.
   */
  function clearAttractRound(keepHighlight: boolean): void {
    spawnController.stop()
    offCollision?.()
    offCollision = null
    clearGameplayNodes()
    disposeEpicenter()
    if (!keepHighlight) clearHighlight()
    gridOverlay.reset()
    selectedStateId = null
    sessionState = 'idle'
  }

  /**
   * Move to the framing for no region chosen, when the splash starts or stops
   * while no region is chosen. Already there, the camera stays still.
   */
  function reframeOverview(): void {
    if (sessionState === 'idle' || sessionState === 'zoomingOut') {
      void animateCameraTo(overview())
    }
  }

  function startAttract(): void {
    attractWanted = true
    reframeOverview()
    if (attractMode || sessionState !== 'idle') return
    attractMode = true
    gridOverlay.setFeather(
      map.previewLostAtBorder ? 0 : ATTRACT_GRID_FEATHER_CELLS,
    )
    playAttractRound()
  }

  function stopAttract(): void {
    attractWanted = false
    if (attractMode) {
      attractMode = false
      gridOverlay.setFeather(0)
      attractScope.abort()
      if (sessionState !== 'idle') clearAttractRound(false)
    }
    reframeOverview()
  }

  /** After a loss, let the impact play out, then start the next region. */
  function queueNextAttractRound(): void {
    const signal = attractScope.reset()
    host.engine
      .wait(TUNING.lossAnim.endScreenGraceSec + ATTRACT_LINGER_SEC, signal)
      .then(() => {
        if (!attractMode) return
        clearAttractRound(true)
        playAttractRound()
      })
      .catch(ignoreAbort)
  }

  function spawnPacket(
    worldPos: Vec2,
    headingRad: number,
    travelSpeed: number,
  ): PacketNode | null {
    if (sessionState !== 'playing') return null
    const id = packetIdSeq++
    const packet = spawnPacketInSession(
      {
        host,
        packetLayer,
        hooks: {
          isPlaying: () => sessionState === 'playing',
          epicenter: () => epicenter,
          gameViewport: playViewport,
          mask: lossMask,
          onExitedGermany: (p, exitPos, exitHeading) =>
            onPacketExited(p, exitPos, exitHeading),
          onCaptured: (p) => onPacketCaptured(p),
        },
        drawHooks: {
          isPlaying: () => sessionState === 'playing',
          epicenter: () => epicenter,
          pathLayerAdd: (node) => pathLayer.add(node),
          handleLayerAdd: (node) => handleLayer.add(node),
          bindTrailToPacket: (target, trail) => {
            const b = target.getBehavior(PacketBehavior)
            b?.setTrail(trail)
          },
        },
        packetId: `packet-${id}`,
        hexParticleId: `packet-hex-particles-${id}`,
        onDestroy: (p) => {
          const idx = activePackets.indexOf(p)
          if (idx >= 0) activePackets.splice(idx, 1)
        },
      },
      worldPos,
      headingRad,
      travelSpeed,
    )
    activePackets.push(packet)
    return packet
  }

  function onPacketExited(
    _packet: PacketNode,
    worldPos: Vec2,
    headingRad: number,
  ): void {
    if (sessionState !== 'playing') return
    if (selectedStateId === null) return
    // The exit packet keeps drifting per the spec, behavior handles that
    // in its `'lost'` mode gate. All other packets freeze via the state
    // check inside PacketBehavior.onFixedStep. The visual pair (flash +
    // border-shrapnel burst) plays out at the breach point on the shared
    // clock while the grace timer counts down before the game-over card.
    spawnImpactFlash(worldPos)
    spawnBorderBreachDebris(worldPos, headingRad)
    gridOverlay.pulseFrom(worldPos)
    endRound('exitedGermany', selectedStateId, headingRad)
  }

  function onPacketCaptured(packet: PacketNode): void {
    // Guarded so the tween's completion after a game-over doesn't tick score.
    if (sessionState !== 'playing') {
      packet.destroy()
      return
    }
    score++
    if (!attractMode) events.emit('packetScored', { total: score })
    packet.destroy()
  }

  function checkPacketPacketCollisions(): void {
    const threshold = TUNING.collision.pairThresholdWorld
    const thresholdSq = threshold * threshold
    const list = activePackets
    for (let i = 0; i < list.length; i++) {
      const a = list[i]
      if (!a.hitEnabled) continue
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j]
        if (!b.hitEnabled) continue
        const dx = a.transform.x - b.transform.x
        const dy = a.transform.y - b.transform.y
        if (dx * dx + dy * dy <= thresholdSq) {
          triggerCollision(a, b)
          return
        }
      }
    }
  }

  function triggerCollision(a: PacketNode, b: PacketNode): void {
    if (sessionState !== 'playing') return
    if (selectedStateId === null) return
    // Snapshot the midpoint BEFORE destroying either packet, their
    // transform values are still valid at this call.
    const point: Vec2 = {
      x: (a.transform.x + b.transform.x) * 0.5,
      y: (a.transform.y + b.transform.y) * 0.5,
    }
    // The collision visuals stand in for the packets from here on. Destroy
    // both packets so their hexes / trails / hex-particle emitters clean
    // up in a single cascade, the flash + debris ring will play out at
    // the recorded midpoint. Destroy handlers remove them from
    // `activePackets` automatically.
    a.destroy()
    b.destroy()
    spawnImpactFlash(point)
    spawnCollisionDebris(point)
    gridOverlay.pulseFrom(point)
    endRound('collision', selectedStateId)
  }

  // The loss visuals are shared with the game-over vignette (see
  // `lossVisuals.ts`). These thin wrappers pin them to the round's packet layer.
  function spawnImpactFlash(center: Vec2): void {
    lossImpactFlash(packetLayer, center, assets.impactFlashPath)
  }

  function spawnCollisionDebris(center: Vec2): void {
    lossCollisionDebris(packetLayer, center)
  }

  function spawnBorderBreachDebris(center: Vec2, headingRad: number): void {
    lossBorderBreachDebris(packetLayer, center, headingRad)
  }

  function endRound(
    reason: GameOverReason,
    stateId: RegionId,
    escapeHeadingRad?: number,
  ): void {
    sessionState = 'gameOver'
    spawnController.stop()
    offCollision?.()
    offCollision = null
    // Drop every user-drawn line + endpoint handle the moment the game
    // ends so the loss visuals aren't cluttered by leftover routing
    // scaffolding. Packets are gated on `mode === 'travelling'` before
    // they steer along a trail, and by this point they're either
    // destroyed (collision) or `'lost'` (breach drifting out), so a
    // dangling trail ref on `PacketBehavior` never gets dereferenced.
    pathLayer.destroyChildren()
    handleLayer.destroyChildren()

    if (attractMode) {
      queueNextAttractRound()
      return
    }

    // Persist to the server as soon as the round ends, in parallel with the
    // grace animation. The card waits on it a moment past the grace and shows
    // without it if the server is slow or down. A record that lands later
    // goes out as `gameRecorded` while this round's card is still up.
    const durationMs = Math.max(
      0,
      Math.round(performance.now() - roundStartedAtMs),
    )
    roundStartedAtMs = 0
    const wireReason: WireGameEndReason = WIRE_REASON[reason]
    const finalScore = score
    const round = ++roundsEnded
    const persisted = new Promise<Persisted>((resolve) => {
      persistFinishedGame(
        {
          mapId: map.id,
          stateId,
          reason: wireReason,
          score: finalScore,
          durationMs,
          escapeHeadingRad,
        },
        resolve,
      )
    })

    // Defer the outbound `gameOver` event. Svelte listens for it to slide
    // in the game-over card, and we want the impact flash + debris ring +
    // grid ripple to be visible for a moment before the UI takes over.
    // `session.reset()` / `destroy()` cancel these timers via `graceScope`.
    const graceSignal = graceScope.reset()
    // Once the ripple finishes, unify every state's fill alpha so the
    // map settles at a single consistent brightness before the game-over
    // card slides in. Without this, mid-round selection dims some states
    // to 0.35, leaving a splotchy map during the grace.
    host.engine
      .wait(TUNING.stateRipple.settleClearDelaySec, graceSignal)
      .then(() => {
        if (sessionState === 'gameOver') clearHighlight()
      })
      .catch(ignoreAbort)
    // Defer the outbound `gameOver` event. Svelte listens for it to slide
    // in the game-over card, and we want the impact flash + debris ring +
    // shockwave to be visible for a moment before the UI takes over.
    host.engine
      .wait(TUNING.lossAnim.endScreenGraceSec, graceSignal)
      .then(() =>
        Promise.race([
          persisted,
          new Promise<null>((resolve) =>
            setTimeout(() => resolve(null), PERSIST_WAIT_MS),
          ),
        ]),
      )
      .then((result) => {
        // The scope may have been reset while persistence was in flight.
        if (graceSignal.aborted || sessionState !== 'gameOver') return
        events.emit('gameOver', {
          round,
          reason,
          stateId,
          score: finalScore,
          isOverallHigh: result?.record.wasOverallHigh ?? false,
          isStateHigh: result?.record.wasStateHigh ?? false,
          highScores: result?.highScores ?? emptyHighScores(),
          escapeHeadingRad,
          record: result?.record ?? null,
        })
        if (result) return
        void persisted.then(({ record, highScores }) => {
          if (roundsEnded !== round || sessionState !== 'gameOver') return
          events.emit('gameRecorded', {
            round,
            isOverallHigh: record.wasOverallHigh,
            isStateHigh: record.wasStateHigh,
            highScores,
            record,
          })
        })
      })
      .catch(ignoreAbort)
  }

  /**
   * After a loss, clear the round and stand the same region up again as the
   * pending selection: epicenter back, map highlighted, camera where it is. The
   * player can start another round from the selected card without the map
   * zooming out and back in.
   */
  function returnToSelection(): void {
    if (sessionState !== 'gameOver' || selectedStateId === null) return
    const info = findRegion(map, selectedStateId)
    if (!info) return
    spawnController.stop()
    offCollision?.()
    offCollision = null
    graceScope.abort()
    clearGameplayNodes()
    disposeEpicenter()
    gridOverlay.reset()
    highlightState(info.id)
    showEpicenter(info)
    score = 0
    elapsedSec = 0
    sessionState = 'preGame'
    syncDiscs()
    events.emit('stateSelected', { stateId: info.id })
  }

  async function reset(): Promise<void> {
    if (sessionState === 'idle') return
    // A round, live or over, ends on the splash, so the camera goes straight
    // to the splash's framing rather than through the picker's.
    const target =
      sessionState === 'playing' || sessionState === 'gameOver'
        ? splashView()
        : overview()
    sessionState = 'zoomingOut'
    spawnController.stop()
    offCollision?.()
    offCollision = null
    graceScope.abort()
    clearGameplayNodes()
    disposeEpicenter()
    clearHighlight()
    // Zero the district overlay so a round ending mid-flash doesn't
    // carry stale yellow warnings or half-decayed pulses into the next
    // round. `warnAlpha` is an integrated state array, must be cleared
    // explicitly, `clearGameplayNodes` only walks layers.
    gridOverlay.reset()
    await animateCameraTo(target)
    if (sessionState === 'zoomingOut') sessionState = 'idle'
    selectedStateId = null
    syncDiscs()
    score = 0
    events.emit('reset', undefined)
    if (attractWanted) startAttract()
  }

  function clearGameplayNodes(): void {
    // Destroy every child of every gameplay layer, packets, motion trails,
    // hex-particle emitters, impact flashes, debris rings, drawn paths,
    // endpoint handles. Packet destroy handlers pair-destroy their trail +
    // emitter, but those siblings ALSO appear in the layer walk here.
    // `destroyChildren`'s snapshot + `isDestroyed` gate keeps it idempotent.
    packetLayer.destroyChildren()
    activePackets.length = 0
    pathLayer.destroyChildren()
    handleLayer.destroyChildren()
  }

  function disposeEpicenter(): void {
    epicenter?.destroy()
    epicenter = null
  }

  function destroy(): void {
    cameraScope.dispose()
    attractScope.dispose()
    spawnController.stop()
    offCollision?.()
    offCollision = null
    graceScope.dispose()
    offBackgroundTap()
    offResize()
    clearGameplayNodes()
    disposeEpicenter()
    gridOverlay.reset()
    selectedStateId = null
    sessionState = 'idle'
  }

  return {
    events,
    get stateIds() {
      return selectableIds()
    },
    get smallRegionIds() {
      return smallRegionIdsNow()
    },
    get state() {
      return sessionState
    },
    get selectedStateId() {
      return selectedStateId
    },
    get score() {
      return score
    },
    get elapsedSec() {
      return elapsedSec
    },
    acceptsStateTap(): boolean {
      return (
        tapsEnabled &&
        (sessionState === 'idle' ||
          sessionState === 'zoomingIn' ||
          sessionState === 'preGame')
      )
    },
    startAttract,
    stopAttract,
    setMapDimmed,
    setTapsEnabled(enabled: boolean): void {
      tapsEnabled = enabled
      syncDiscs()
    },
    selectRegion: onStateTap,
    startRound,
    returnToSelection,
    cancelSelection,
    reset,
    destroy,
  }
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

/**
 * One `Path2D` combining every region's own contour, stroked once rather than
 * each region stroking its own: separately stroked borders would draw every
 * shared interior edge twice, stacking a translucent stroke's alpha there above
 * the coastline's, and a later region's translucent fill would cover the outer
 * half of an earlier region's centered stroke. One path means one stencil
 * group, so every edge composites exactly once.
 */
function buildStateBorderNode(
  map: MapDescriptor,
  selectable: boolean,
): Path2DNode | null {
  const combined = new Path2D()
  const combinedContours: Float32Array[] = []
  let any = false
  for (const info of map.regions) {
    if (info.selectable !== selectable) continue
    // The region's own outline, not its fill: a region that encloses another
    // has that one cut out of its fill, and stroking the cut would draw the
    // enclosed region's boundary a second time.
    const entry = info.shape
    combined.addPath(entry.path)
    if (entry.contours) combinedContours.push(...entry.contours)
    any = true
  }
  if (!any) return null
  registerPathTessellation(
    combined,
    tessellateContours(combinedContours),
    combinedContours,
  )
  const node = new Path2DNode({
    id: selectable ? 'region-borders' : 'region-borders-inert',
    path: combined,
    stroke: selectable ? BORDER_COLOR : BORDER_COLOR_INERT,
    lineWidth: BORDER_WIDTH,
    hitMode: 'none',
  })
  return node
}
