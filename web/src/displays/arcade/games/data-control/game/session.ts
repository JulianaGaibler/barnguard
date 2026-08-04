import {
  Node2D,
  Path2DNode,
  AbortScope,
  createEmitter,
  easings,
  ignoreAbort,
  mixColor,
  type EngineHost,
  type Emitter,
  type Rect,
  type Vec2,
} from '@src/stargazer'
import { gameView } from '../../../world'
import type { ArcadeCamera } from '../../arcadeCamera'
import { loadGameAssets, type GameAssets } from './assets'
import { STATES, findState, type StateId } from './data/states'
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
import { TUNING } from './data/tuning'

// -----------------------------------------------------------------------------
// Public API
// -----------------------------------------------------------------------------

export type GameOverReason = 'exitedGermany' | 'collision'

export interface GameEvents {
  /** Assets loaded and the map is on screen. */
  ready: { stateIds: readonly StateId[] }
  /** User tapped a state, awaiting `startRound()` or `cancelSelection()`. */
  stateSelected: { stateId: StateId }
  /** `cancelSelection` was called before the round started. */
  selectionCanceled: void
  /** `startRound` fired and the round is in progress. */
  roundStarted: { stateId: StateId }
  /** A packet reached the epicenter and scored. `total` is the current score. */
  packetScored: { total: number }
  /** The round ended. */
  gameOver: {
    reason: GameOverReason
    stateId: StateId
    score: number
    /** Wall-clock length of the round, for the arcade game-log record. */
    durationMs: number
    /**
     * The escaping packet's velocity direction (radians) at the moment it
     * crossed Germany's boundary. Present only when `reason ===
     * 'exitedGermany'`.
     */
    escapeHeadingRad?: number
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
  readonly stateIds: readonly StateId[]
  /** Currently in view, read-only for Svelte overlays. */
  readonly state: SessionState
  readonly selectedStateId: StateId | null
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

// The map is black like the backdrop, so states read purely by their opaque
// borders on the blue grid. No alpha anywhere — highlight/dim is done with
// solid colour, never opacity.
const COLOR_STATE_FILL = '#050505'
// Selected state: the blue accent mixed toward the black backdrop with
// `mixColor` so it reads as a softer, less heavy highlight. Opaque result — no
// opacity.
const COLOR_STATE_FILL_SELECTED = mixColor('#031BC4', '#050505', 0.8)

// City-state enclaves sit fully inside another state; they must draw AFTER
// their surrounder or its fill paints over them (border + selection hidden).
const ENCLAVE_STATE_IDS = new Set<StateId>(['BE', 'HB'])
// Opaque so overlapping geometry (shared borders, tripoints) reads identically
// to a single stroke rather than stacking.
const COLOR_STATE_STROKE = '#aab4e8'
// Country outline: near-white so the border pops off the black.
const COLOR_OUTLINE = '#f2f4ff'

// Map-space framings, in the 661×888 country viewBox. The placement transform
// below maps these into arcade world coordinates before they reach the camera.
const FULL_VIEW: Rect = { x: 0, y: 0, width: 661, height: 888 }
// Upper- and lower-half framings share the same width (whole country) but crop
// to a smaller vertical slice so the pre-game card fits below without obscuring
// the selected state. The lower half is bottom-anchored to the 888-tall map so
// the camera doesn't show empty space past the coast.
const UPPER_HALF: Rect = { x: 0, y: -30, width: 661, height: 560 }
const LOWER_HALF: Rect = { x: 0, y: 328, width: 661, height: 560 }

const CAMERA_TWEEN_SEC = 0.6

// -----------------------------------------------------------------------------
// Map placement: fit the 661×888 country (contain) into the arcade's fixed
// 1920×1080 GAME region and center it. The game's scene lives under a single
// parent node carrying this transform, so every ported node/behavior keeps
// operating in map-local units. Only the camera framings (map→world) and the
// spawn bounds (world→map) cross the boundary. All constant — the region and
// viewBox are both fixed, so the camera handles every aspect via contain-fit.
// -----------------------------------------------------------------------------

const REGION = gameView()
const PLACEMENT_SCALE = Math.min(
  REGION.width / FULL_VIEW.width,
  REGION.height / FULL_VIEW.height,
)
const PLACEMENT_X =
  REGION.x + (REGION.width - FULL_VIEW.width * PLACEMENT_SCALE) / 2
const PLACEMENT_Y =
  REGION.y + (REGION.height - FULL_VIEW.height * PLACEMENT_SCALE) / 2

function mapToWorld(rect: Rect): Rect {
  return {
    x: PLACEMENT_X + rect.x * PLACEMENT_SCALE,
    y: PLACEMENT_Y + rect.y * PLACEMENT_SCALE,
    width: rect.width * PLACEMENT_SCALE,
    height: rect.height * PLACEMENT_SCALE,
  }
}

function worldToMap(rect: Rect): Rect {
  return {
    x: (rect.x - PLACEMENT_X) / PLACEMENT_SCALE,
    y: (rect.y - PLACEMENT_Y) / PLACEMENT_SCALE,
    width: rect.width / PLACEMENT_SCALE,
    height: rect.height / PLACEMENT_SCALE,
  }
}

/** Arcade-world point → map-local point (pointer input for path drawing). */
function worldToMapPoint(x: number, y: number): Vec2 {
  return {
    x: (x - PLACEMENT_X) / PLACEMENT_SCALE,
    y: (y - PLACEMENT_Y) / PLACEMENT_SCALE,
  }
}

// -----------------------------------------------------------------------------
// startGame
// -----------------------------------------------------------------------------

export async function startGame(
  host: EngineHost,
  camera: ArcadeCamera,
): Promise<GameSession> {
  const events = createEmitter<GameEvents>()
  const assets = await loadGameAssets()

  // Everything the game draws lives under this node; its transform places the
  // 661×888 map into the arcade's game region (see the placement helpers).
  const mapRoot = new Node2D('data-control-map-root')
  mapRoot.transform.x = PLACEMENT_X
  mapRoot.transform.y = PLACEMENT_Y
  mapRoot.transform.scaleX = PLACEMENT_SCALE
  mapRoot.transform.scaleY = PLACEMENT_SCALE

  const stateNodes = new Map<StateId, Path2DNode>()
  const outlineNode = buildOutlineNode(assets)
  const packetLayer = new Node2D('packet-layer')
  const pathLayer = new Node2D('path-layer')
  const handleLayer = new Node2D('handle-layer')
  const activePackets: PacketNode[] = []
  const gridOverlay = new GridOverlayNode({
    mask: assets.mask,
    cellSizeWorld: TUNING.wahlkreise.grid.cellSizeWorld,
  })
  gridOverlay.attachWarnSource({
    activePackets: () => activePackets,
    mask: () => assets.mask,
    isPlaying: () => sessionState === 'playing',
  })
  // Register the mask with the debug controller so the `'clip-mask'` HUD
  // render mode can visualise it. Safe to call unconditionally, the controller
  // stores the reference; nothing draws unless the mode is active.
  host.debug.setInspectedMask(assets.mask)

  let sessionState: SessionState = 'loading'
  let selectedStateId: StateId | null = null
  let score = 0
  // Set once `destroy()` runs so a late-resolving camera tween or grace timer
  // can't re-enter the state machine on a torn-down session.
  let destroyed = false
  let epicenter: EpicenterNode | null = null
  // Re-abortable scope for the camera tween: each `animateTo` cancels the prior.
  const cameraScope = new AbortScope()
  let packetIdSeq = 0
  // Re-abortable scope for the deferred game-over timers (ripple settle + the
  // gameOver-event grace); `reset()`/`destroy()` cancel them.
  const graceScope = new AbortScope()
  // Round-start wall clock (`performance.now()`), used to compute the game's
  // `durationMs` when the round ends. 0 means "no active round".
  let roundStartedAtMs = 0

  const spawnController = new SpawnController(
    {
      isPlaying: () => sessionState === 'playing',
      mask: () => assets.mask,
      epicenter: () => epicenter,
      activePackets: () => activePackets,
      // Spawn only inside the current camera framing so packets never grow
      // off-screen. The camera frames a world rect; map it back to the map's
      // local space, which is what the mask + rejection sampling expect.
      spawnBounds: () => worldToMap(camera.viewport),
      spawnPacket,
    },
    (seconds, signal) => host.engine.wait(seconds, signal),
  )
  let offCollision: (() => void) | null = null

  // --- Scene build ---------------------------------------------------------
  // No `host.loadScene` / `host.start()` here: the arcade engine is already
  // running with its own camera + background. We attach a subtree instead.
  const mapGroup = new Node2D('map')
  mapGroup.renderLayer = 'static'
  mapRoot.add(mapGroup)

  // Enclaves last so they paint on top of their surrounding state (stable sort
  // keeps the rest in their original order).
  const buildOrder = [...STATES].sort(
    (a, b) =>
      Number(ENCLAVE_STATE_IDS.has(a.id)) - Number(ENCLAVE_STATE_IDS.has(b.id)),
  )
  for (const info of buildOrder) {
    const entry = assets.states.paths.get(info.id)
    if (!entry) continue
    const node = new Path2DNode({
      id: `state:${info.id}`,
      path: entry.path,
      fill: COLOR_STATE_FILL,
      stroke: COLOR_STATE_STROKE,
      lineWidth: 1,
      hitMode: 'fill',
      debugBounds: entry.bounds,
    })
    node.renderLayer = 'static'
    node.addBehavior(new StateSelectionBehavior(info.id, onStateTap))
    mapGroup.add(node)
    stateNodes.set(info.id, node)
  }

  if (outlineNode) mapGroup.add(outlineNode)

  // Country grid overlay sits above the static state fills but under the
  // dynamic path / packet layers. Its own `renderLayer = 'above-static'`
  // handles the compositing; this add order just controls scene-tree traversal
  // for `onUpdate` (overlay ticks before packets, which is fine).
  mapRoot.add(gridOverlay)

  // Dynamic-layer groups: paths draw under packets so trails don't occlude the
  // finger's target; endpoint handles draw on top so the player can grab them.
  mapRoot.add(pathLayer)
  mapRoot.add(packetLayer)
  mapRoot.add(handleLayer)

  host.engine.tree.root.add(mapRoot)

  // Frame the whole country. The arcade panned the shared camera to the game
  // region's home framing on Play; snap to the map slab so it fills the view.
  camera.snapTo(mapToWorld(FULL_VIEW))

  sessionState = 'idle'
  events.emit('ready', { stateIds: Array.from(stateNodes.keys()) })

  // Dismiss-on-outside-tap for the pre-game screen: any pointerdown that
  // doesn't get captured by a state fill (background water, off-country area,
  // etc.) cancels the selection. Runs only during `'preGame'` so an in-flight
  // zoom or an accidental extra tap right after `confirmState` doesn't drop the
  // round.
  const offBackgroundTap = host.engine.primaryStage.events.on(
    'pointerDown',
    (e) => {
      if (e.pointer.capturedBy !== null) return
      if (sessionState !== 'preGame') return
      void cancelSelection()
    },
  )

  // --- Tap handler --------------------------------------------------------
  function onStateTap(id: StateId): void {
    // From idle, always start a fresh selection.
    if (sessionState === 'idle') {
      void selectState(id)
      return
    }
    // Mid-selection (zoom in-flight OR card shown), allow retargeting to a
    // different state. Same state → no-op, avoids re-triggering the zoom + fade
    // + epicenter build on an accidental double-tap.
    if (sessionState === 'zoomingIn' || sessionState === 'preGame') {
      if (id !== selectedStateId) void selectState(id)
      return
    }
    // Round is live or ending, ignore state taps entirely.
  }

  // --- Camera framing -----------------------------------------------------
  async function selectState(id: StateId): Promise<void> {
    const info = findState(id)
    if (!info.half) return // geometry not filled, should never happen

    // Retargeting mid-selection, tear down the previous state's epicenter
    // before building the new one so we never leak a ring.
    disposeEpicenter()

    selectedStateId = id
    sessionState = 'zoomingIn'
    events.emit('stateSelected', { stateId: id })
    highlightState(id)
    // Ripple flashes through the neighbour graph starting at the newly-selected
    // state so the choice reads as "energising the map from here outward".
    // Fire-and-forget, pulses self-clean.
    fireStateRipple(id, stateNodes)

    // Show the epicenter at the capital, breathing. The cone opens toward the
    // midpoint of `FULL_VIEW` (Germany's viewBox centre) so the axis always
    // points into the interior.
    if (info.capitalWorld) {
      const germanyCentre: Vec2 = {
        x: FULL_VIEW.x + FULL_VIEW.width / 2,
        y: FULL_VIEW.y + FULL_VIEW.height / 2,
      }
      epicenter = new EpicenterNode({
        center: info.capitalWorld,
        approachReference: germanyCentre,
        // No apex icon: the epicenter falls back to its small marker dot
        // (smaller than the logo disc), which suits the minimal look.
      })
      epicenter.transform.alpha = 0
      epicenter.renderLayer = 'dynamic'
      epicenter.addBehavior(new EpicenterBehavior())
      mapRoot.add(epicenter)
      // Fade the epicenter in as the camera zooms.
      void epicenter
        .tween({ alpha: 1 }, { duration: 0.5, easing: easings.outCubic })
        .catch(ignoreAbort)
    }

    const target = info.half === 'upper' ? UPPER_HALF : LOWER_HALF
    await animateCameraTo(target)
    if (!destroyed && sessionState === 'zoomingIn') sessionState = 'preGame'
  }

  async function animateCameraTo(target: Rect): Promise<void> {
    cameraScope.reset()
    await camera
      .animateTo(mapToWorld(target), {
        duration: CAMERA_TWEEN_SEC,
        easing: easings.inOutCubic,
      })
      .catch(ignoreAbort)
  }

  // --- Highlight bookkeeping ---------------------------------------------
  //
  // Highlight is colour-only: the selected state fills with the accent, the
  // rest stay black. No opacity — the `'static'` layer is drawn per frame (not
  // baked), so a plain `fill` reassignment shows on the next frame.

  function highlightState(id: StateId): void {
    for (const [otherId, node] of stateNodes) {
      node.fill = otherId === id ? COLOR_STATE_FILL_SELECTED : COLOR_STATE_FILL
    }
  }

  function clearHighlight(): void {
    for (const node of stateNodes.values()) node.fill = COLOR_STATE_FILL
  }

  // --- Session methods ----------------------------------------------------
  async function cancelSelection(): Promise<void> {
    if (sessionState !== 'preGame' && sessionState !== 'zoomingIn') return
    sessionState = 'zoomingOut'
    events.emit('selectionCanceled', undefined)
    disposeEpicenter()
    clearHighlight()
    await animateCameraTo(FULL_VIEW)
    if (!destroyed && sessionState === 'zoomingOut') sessionState = 'idle'
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
          gameViewport: () => worldToMap(camera.viewport),
          mask: () => assets.mask,
          onExitedGermany: (p, exitPos, exitHeading) =>
            onPacketExited(p, exitPos, exitHeading),
          onCaptured: (p) => onPacketCaptured(p),
        },
        drawHooks: {
          isPlaying: () => sessionState === 'playing',
          epicenter: () => epicenter,
          worldToMap: (x, y) => worldToMapPoint(x, y),
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
    // The exit packet keeps drifting per the spec, behavior handles that in its
    // `'lost'` mode gate. All other packets freeze via the state check inside
    // PacketBehavior.onFixedStep. The visual pair (flash + border-shrapnel
    // burst) plays out at the breach point on the shared clock while the grace
    // timer counts down before the game-over card.
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
    // Snapshot the midpoint BEFORE destroying either packet, their transform
    // values are still valid at this call.
    const point: Vec2 = {
      x: (a.transform.x + b.transform.x) * 0.5,
      y: (a.transform.y + b.transform.y) * 0.5,
    }
    // The collision visuals stand in for the packets from here on. Destroy both
    // packets so their hexes / trails / hex-particle emitters clean up in a
    // single cascade; the flash + debris ring plays out at the recorded
    // midpoint. Destroy handlers remove them from `activePackets` automatically.
    a.destroy()
    b.destroy()
    spawnImpactFlash(point)
    spawnCollisionDebris(point)
    gridOverlay.pulseFrom(point)
    endRound('collision', selectedStateId)
  }

  // The loss visuals are shared with the game-over vignette (see
  // `lossVisuals.ts`); these thin wrappers pin them to the round's packet layer.
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
    stateId: StateId,
    escapeHeadingRad?: number,
  ): void {
    sessionState = 'gameOver'
    spawnController.stop()
    offCollision?.()
    offCollision = null
    // Drop every user-drawn line + endpoint handle the moment the game ends so
    // the loss visuals aren't cluttered by leftover routing scaffolding.
    pathLayer.destroyChildren()
    handleLayer.destroyChildren()

    const durationMs = Math.max(
      0,
      Math.round(performance.now() - roundStartedAtMs),
    )
    roundStartedAtMs = 0
    const finalScore = score

    // Defer the outbound `gameOver` event. Svelte listens for it to slide in
    // the game-over card, and we want the impact flash + debris ring + grid
    // ripple to be visible for a moment before the UI takes over.
    // `session.reset()` / `destroy()` cancel these timers via `graceScope`.
    const graceSignal = graceScope.reset()
    // Once the ripple finishes, unify every state's fill alpha so the map
    // settles at a single consistent brightness before the game-over card
    // slides in. Without this, mid-round selection dims some states to 0.35,
    // leaving a splotchy map during the grace.
    host.engine
      .wait(TUNING.stateRipple.settleClearDelaySec, graceSignal)
      .then(() => {
        if (sessionState === 'gameOver') clearHighlight()
      })
      .catch(ignoreAbort)
    host.engine
      .wait(TUNING.lossAnim.endScreenGraceSec, graceSignal)
      .then(() => {
        if (destroyed || graceSignal.aborted || sessionState !== 'gameOver')
          return
        events.emit('gameOver', {
          reason,
          stateId,
          score: finalScore,
          durationMs,
          escapeHeadingRad,
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
    // Zero the district overlay so a round ending mid-flash doesn't carry stale
    // yellow warnings or half-decayed pulses into the next round.
    gridOverlay.reset()
    await animateCameraTo(FULL_VIEW)
    if (!destroyed && sessionState === 'zoomingOut') sessionState = 'idle'
    selectedStateId = null
    score = 0
    events.emit('reset', undefined)
  }

  function clearGameplayNodes(): void {
    // Destroy every child of every gameplay layer: packets, motion trails,
    // hex-particle emitters, impact flashes, debris rings, drawn paths,
    // endpoint handles. `destroyChildren`'s snapshot + `isDestroyed` gate keeps
    // it idempotent even though packet destroy handlers pair-destroy siblings.
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
    if (destroyed) return
    destroyed = true
    cameraScope.dispose()
    spawnController.stop()
    offCollision?.()
    offCollision = null
    graceScope.dispose()
    offBackgroundTap()
    clearGameplayNodes()
    disposeEpicenter()
    gridOverlay.reset()
    if (!mapRoot.isDestroyed) mapRoot.destroy()
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

function buildOutlineNode(assets: GameAssets): Path2DNode | null {
  for (const entry of assets.outline.paths.values()) {
    const node = new Path2DNode({
      id: 'outline',
      path: entry.path,
      stroke: COLOR_OUTLINE,
      lineWidth: 1.5,
      hitMode: 'none',
    })
    node.renderLayer = 'static'
    return node
  }
  return null
}
