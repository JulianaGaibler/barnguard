import {
  Node2D,
  Path2DNode,
  CameraNode2D,
  AbortScope,
  createEmitter,
  easings,
  ignoreAbort,
  registerPathTessellation,
  tessellateContours,
  type EngineHost,
  type Emitter,
  type GfxLinearGradient,
  type GfxShadowStyle,
  type Rect,
  type Vec2,
} from '@src/stargazer'
import { loadGameAssets } from './assets'
import { findRegion, type MapDescriptor, type RegionId } from './maps'
import { rippleLayers } from './maps/ripple'
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
import { SpawnController } from './spawn/SpawnController'
import {
  DISPLAY_ID,
  fetchEnterpriseHighScores,
  recordEnterpriseGame,
  type GameEndReason as WireGameEndReason,
  type EnterpriseGameRecord as GameRecord,
  type EnterpriseHighScores as HighScores,
} from '../game-log'
import { TUNING } from './data/tuning'

// -----------------------------------------------------------------------------
// Public API
// -----------------------------------------------------------------------------

export type GameOverReason = 'exitedGermany' | 'collision'

export interface GameEvents {
  /** Assets loaded and the map is on screen. */
  ready: { stateIds: readonly RegionId[] }
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
  /** Currently in view, read-only for Svelte overlays. */
  readonly state: SessionState
  readonly selectedStateId: RegionId | null
  readonly score: number
  /** True while the session is in a state where a state can be tapped. */
  acceptsStateTap(): boolean
  /**
   * Start a round for the currently-selected state (called from the pre-game
   * card).
   */
  startRound(): Promise<void>
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
// (`tweenStaticAlpha` below dims every state uniformly), so the selected one
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
const BORDER_WIDTH = 3
// Two stacked inset glows along each state's own border, in map units because
// the state nodes carry `strokeSpace: 'world'`. A path shadow's mask is cached
// per blur radius in local units, so a screen-space radius re-keys all 32
// masks at every camera scale and rebakes them through a camera tween. Map
// units hold the radius still, and the glow stays the same fraction of the
// country at any canvas size.
//
// The radii are the brand's 36.138 px and 20.077 px over the 1080 / 888 scale
// the full-country view resolves to in a 1920 x 1080 frame, which is the size
// the brand composition is drawn at. They are fixed rather than derived from
// the live camera because `strokeSpaceScale()` reads the screen transform and
// returns 1 until the first resize settles, so reading it during the scene
// build would bake a wrong radius on whichever boot happened to be early. The
// glow is a fixed fraction of the country, so it measures 36 px at idle only
// on a 1080-tall stage.
const STATE_GLOW: readonly GfxShadowStyle[] = [
  { color: 'rgba(255, 255, 255, 0.5)', blur: 29.714, inset: true },
  { color: 'rgba(255, 255, 255, 0.4)', blur: 16.508, inset: true },
]

const CAMERA_TWEEN_SEC = 0.6

/**
 * Canvas aspect, which a map needs to fit a play framing to the live viewport.
 * Falls back to 16:9 before the first resize settles, the same window in which
 * `strokeSpaceScale()` reports 1.
 */
function canvasAspect(host: EngineHost): number {
  const size = host.engine.primaryStage.renderer.cssSize
  return size.h > 0 ? size.w / size.h : 16 / 9
}

// -----------------------------------------------------------------------------
// startGame
// -----------------------------------------------------------------------------

/**
 * Post the finished game to the server and refetch the current high-scores. A
 * single fetch failure returns `{record: null, highScores: empty}` so the
 * game-over overlay can still render. The kiosk shouldn't hard-fail on a
 * momentary daemon hiccup.
 */
async function persistFinishedGame(input: {
  stateId: RegionId
  reason: WireGameEndReason
  score: number
  durationMs: number
  escapeHeadingRad?: number
}): Promise<{ record: GameRecord | null; highScores: HighScores }> {
  try {
    const record = await recordEnterpriseGame({
      score: input.score,
      durationMs: input.durationMs,
      stateId: input.stateId,
      reason: input.reason,
      escapeHeadingRad: input.escapeHeadingRad,
    })
    // High-scores AFTER this record landed. The overlay uses this to render
    // "current best" copy next to the freshly-posted score.
    const highScores = await fetchEnterpriseHighScores()
    return { record, highScores }
  } catch (e) {
    console.warn('[session] failed to persist game to server', e)
    return {
      record: null,
      highScores: { display: DISPLAY_ID, overall: 0, byState: {} },
    }
  }
}

export async function startGame(
  host: EngineHost,
  map: MapDescriptor,
): Promise<GameSession> {
  const events = createEmitter<GameEvents>()
  const assets = await loadGameAssets()
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
  const stateBorderNode = buildStateBorderNode(map)
  const packetLayer = new Node2D('packet-layer')
  const pathLayer = new Node2D('path-layer')
  const handleLayer = new Node2D('handle-layer')
  const activePackets: PacketNode[] = []
  const gridOverlay = new GridOverlayNode({
    mask: map.geometry.landMask,
    cellSizeWorld: map.gridCellWorld,
  })
  gridOverlay.attachWarnSource({
    activePackets: () => activePackets,
    mask: () => map.geometry.landMask,
    isPlaying: () => sessionState === 'playing',
  })
  // Register the mask with the debug controller so the `'clip-mask'` HUD
  // render mode can visualise it. Safe to call unconditionally, the
  // controller stores the reference, and nothing draws unless the mode is
  // active.
  host.debug.setInspectedMask(map.geometry.landMask)

  let sessionState: SessionState = 'loading'
  let selectedStateId: RegionId | null = null
  let score = 0
  let epicenter: EpicenterNode | null = null
  // The game's 2D camera, created explicitly in the scene build below.
  let camera: CameraNode2D | null = null
  // Re-abortable scope for the camera tween: each `animateTo` cancels the prior.
  const cameraScope = new AbortScope()
  let packetIdSeq = 0
  // Re-abortable scope for the deferred game-over timers (ripple settle + the
  // gameOver-event grace). `reset()`/`destroy()` cancel them.
  const graceScope = new AbortScope()
  // Round-start wall clock (`performance.now()`), used to compute the game's
  // `durationMs` when the round ends. 0 means "no active round".
  let roundStartedAtMs = 0

  const spawnController = new SpawnController(
    {
      isPlaying: () => sessionState === 'playing',
      mask: () => map.geometry.landMask,
      epicenter: () => epicenter,
      activePackets: () => activePackets,
      // Spawn only inside the current game-camera viewport so packets never
      // grow off-screen: sampling the whole 661×888 country regardless of
      // which half the camera frames would let packets grow outside the
      // visible area. Rejection sampling still trims out the
      // letterbox-inside-country via `mask.contains(pt, inset=minDistFromBorder)`.
      spawnBounds: () => camera?.viewport ?? map.idleView,
      spawnPacket,
    },
    (seconds, signal) => host.engine.wait(seconds, signal),
  )
  let offCollision: (() => void) | null = null

  // --- Scene build ---------------------------------------------------------
  await host.loadScene((scene) => {
    // The game's 2D camera, framing the full 661×888 country.
    const cam = new CameraNode2D('enterprise-camera')
    cam.setViewport(map.idleView)
    scene.root.add(cam)
    cam.makeCurrent()
    camera = cam

    const mapGroup = new Node2D('map')
    mapGroup.renderLayer = 'static'
    scene.root.add(mapGroup)

    for (const info of map.regions) {
      const entry = map.geometry.regions.paths.get(info.id)
      if (!entry) continue
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
      const node = new Path2DNode({
        id: `state:${info.id}`,
        path: entry.path,
        fill: gradients.normal,
        shadow: STATE_GLOW,
        strokeSpace: 'world',
        hitMode: 'fill',
        debugBounds: entry.bounds,
      })
      node.renderLayer = 'static'
      node.addBehavior(new StateSelectionBehavior(info.id, onStateTap))
      mapGroup.add(node)
      stateNodes.set(info.id, node)
    }

    // The combined state-border path draws after every state's fill and
    // inset shadows, see `buildStateBorderNode`.
    if (stateBorderNode) mapGroup.add(stateBorderNode)

    // Country grid overlay sits above the static state fills but under
    // the dynamic path / packet layers. Its own `renderLayer =
    // 'above-static'` handles the compositing, this add order just
    // controls scene-tree traversal for `onUpdate` (overlay ticks
    // before packets, which is fine, the warn sampler reads live
    // packet positions each frame).
    scene.root.add(gridOverlay)

    // Dynamic-layer groups, paths draw under packets so trails don't
    // occlude the finger's target. Endpoint handles draw on top so the
    // player can grab them.
    scene.root.add(pathLayer)
    scene.root.add(packetLayer)
    scene.root.add(handleLayer)
  })

  host.start()
  sessionState = 'idle'
  events.emit('ready', { stateIds: Array.from(stateNodes.keys()) })

  // Dismiss-on-outside-tap for the pre-game screen: any pointerdown that
  // doesn't get captured by a state fill (background water, off-country
  // area, etc.) cancels the selection. Runs only during `'preGame'` so an
  // in-flight zoom or an accidental extra tap right after `confirmState`
  // doesn't drop the round.
  const offBackgroundTap = host.engine.primaryStage.events.on(
    'pointerDown',
    (e) => {
      if (e.pointer.capturedBy !== null) return
      if (sessionState !== 'preGame') return
      void cancelSelection()
    },
  )

  // --- Tap handler --------------------------------------------------------
  function onStateTap(id: RegionId): void {
    // From idle, always start a fresh selection.
    if (sessionState === 'idle') {
      void selectState(id)
      return
    }
    // Mid-selection (zoom in-flight OR card shown), allow retargeting to
    // a different state. Same state → no-op, avoids re-triggering the
    // zoom + fade + epicenter build on an accidental double-tap.
    if (sessionState === 'zoomingIn' || sessionState === 'preGame') {
      if (id !== selectedStateId) void selectState(id)
      return
    }
    // Round is live or ending, ignore state taps entirely.
  }

  // --- CameraView2D framing -----------------------------------------------------
  async function selectState(id: RegionId): Promise<void> {
    const info = findRegion(map, id)
    if (!info) return

    // Retargeting mid-selection, tear down the previous state's
    // epicenter before building the new one so we never leak a ring.
    disposeEpicenter()

    selectedStateId = id
    sessionState = 'zoomingIn'
    events.emit('stateSelected', { stateId: id })
    highlightState(id)
    // Ripple flashes through the neighbour graph starting at the newly-
    // selected state so the choice reads as "energising the map from
    // here outward". Fire-and-forget, pulses self-clean.
    fireStateRipple(rippleLayers(map, id), stateNodes)

    // Show the epicenter at the region's start point, breathing. The cone
    // opens toward the midpoint of the idle view (the map's own centre) so the
    // axis always points into the interior.
    {
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
      epicenter.renderLayer = 'dynamic'
      epicenter.addBehavior(new EpicenterBehavior())
      host.engine.tree.root.add(epicenter)
      // Fade the epicenter in as the camera zooms.
      void epicenter
        .tween({ alpha: 1 }, { duration: 0.5, easing: easings.outCubic })
        .catch(ignoreAbort)
    }

    const target = map.playViewFor(info, canvasAspect(host))
    await animateCameraTo(target)
    if (sessionState === 'zoomingIn') sessionState = 'preGame'
  }

  async function animateCameraTo(target: Rect): Promise<void> {
    if (!camera) return
    const signal = cameraScope.reset()
    try {
      await camera.animateTo(target, {
        duration: CAMERA_TWEEN_SEC,
        easing: easings.inOutCubic,
        signal,
      })
    } catch (err) {
      ignoreAbort(err)
    }
  }

  // --- Highlight bookkeeping ---------------------------------------------
  //
  // State fills live on `renderLayer: 'static'`, drawn in one pass in list
  // order alongside the border path and every other state. A state tweening
  // its own alpha promotes to `'above-static'` for the tween's duration, a
  // separate pass drawn after `'static'`, so the transition reads on top of
  // its siblings instead of interleaved among them in whatever order the
  // static list happens to hold. It demotes back to `'static'` on completion.
  //
  // Nodes whose alpha is already at target skip the promote-tween-demote
  // dance entirely since there is nothing to keep clear of the backdrop.

  function tweenStaticAlpha(
    node: Path2DNode,
    targetAlpha: number,
    durationSec: number,
  ): void {
    if (Math.abs(node.transform.alpha - targetAlpha) < 1e-3) return
    // `node.tweenStatic` handles the promote-to-above-static / demote-back
    // dance internally, including on abort, so we just need to swallow
    // AbortError on the returned promise.
    node
      .tweenStatic(
        { alpha: targetAlpha },
        { duration: durationSec, easing: easings.inOutQuad },
      )
      .catch(ignoreAbort)
  }

  function highlightState(id: RegionId): void {
    // Every state dims to the same muted alpha. The selected one gets a
    // brighter gradient so it reads distinctly by color, not by opacity.
    for (const [otherId, node] of stateNodes) {
      const gradients = stateFillGradients.get(otherId)
      if (gradients)
        node.fill = otherId === id ? gradients.selected : gradients.normal
      tweenStaticAlpha(node, 0.35, 0.4)
    }
  }

  function clearHighlight(): void {
    for (const [id, node] of stateNodes) {
      const gradients = stateFillGradients.get(id)
      if (gradients) node.fill = gradients.normal
      tweenStaticAlpha(node, 1, 0.35)
    }
  }

  // --- Session methods ----------------------------------------------------
  async function cancelSelection(): Promise<void> {
    if (sessionState !== 'preGame' && sessionState !== 'zoomingIn') return
    sessionState = 'zoomingOut'
    events.emit('selectionCanceled', undefined)
    disposeEpicenter()
    clearHighlight()
    await animateCameraTo(map.idleView)
    if (sessionState === 'zoomingOut') sessionState = 'idle'
    selectedStateId = null
  }

  async function startRound(): Promise<void> {
    if (sessionState !== 'preGame' || selectedStateId === null) return
    const stateId = selectedStateId
    sessionState = 'playing'
    score = 0
    roundStartedAtMs = performance.now()
    events.emit('roundStarted', { stateId })
    spawnController.start()
    // Collision loop on the fixed-step ticker. O(N²) but N is tiny.
    offCollision = host.engine.ticker.onFixedStep(() => {
      if (sessionState !== 'playing') return
      checkPacketPacketCollisions()
    })
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
          gameViewport: () => camera?.viewport ?? map.idleView,
          mask: () => playAreaMask,
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
    events.emit('packetScored', { total: score })
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

    // Persist to the server as soon as the round ends, in parallel with the
    // grace animation. The overlay awaits the same promise, so the record id
    // is guaranteed to be present when the card renders (or explicitly null
    // if the server was unreachable, which the card degrades gracefully on).
    const durationMs = Math.max(
      0,
      Math.round(performance.now() - roundStartedAtMs),
    )
    roundStartedAtMs = 0
    const wireReason: WireGameEndReason =
      reason === 'exitedGermany' ? 'exited_germany' : 'collision'
    const finalScore = score
    const persistPromise = persistFinishedGame({
      stateId,
      reason: wireReason,
      score: finalScore,
      durationMs,
      escapeHeadingRad,
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
      .then(() => persistPromise)
      .then(({ record, highScores }) => {
        // The scope may have been reset while persistence was in flight.
        if (graceSignal.aborted || sessionState !== 'gameOver') return
        events.emit('gameOver', {
          reason,
          stateId,
          score: finalScore,
          isOverallHigh: record?.wasOverallHigh ?? false,
          isStateHigh: record?.wasStateHigh ?? false,
          highScores,
          escapeHeadingRad,
          record,
        })
      })
      .catch(ignoreAbort)
  }

  async function reset(): Promise<void> {
    if (sessionState === 'idle') return
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
    await animateCameraTo(map.idleView)
    if (sessionState === 'zoomingOut') sessionState = 'idle'
    selectedStateId = null
    score = 0
    events.emit('reset', undefined)
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
    spawnController.stop()
    offCollision?.()
    offCollision = null
    graceScope.dispose()
    offBackgroundTap()
    clearGameplayNodes()
    disposeEpicenter()
    gridOverlay.reset()
    selectedStateId = null
    sessionState = 'idle'
  }

  return {
    events,
    get stateIds() {
      return Array.from(stateNodes.keys())
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
    acceptsStateTap(): boolean {
      return sessionState === 'idle'
    },
    startRound,
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
function buildStateBorderNode(map: MapDescriptor): Path2DNode | null {
  const combined = new Path2D()
  const combinedContours: Float32Array[] = []
  let any = false
  for (const info of map.regions) {
    const entry = map.geometry.regions.paths.get(info.id)
    if (!entry) continue
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
    id: 'state-borders',
    path: combined,
    stroke: BORDER_COLOR,
    lineWidth: BORDER_WIDTH,
    hitMode: 'none',
  })
  node.renderLayer = 'static'
  return node
}
