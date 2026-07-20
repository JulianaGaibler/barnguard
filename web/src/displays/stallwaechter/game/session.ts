import {
  SceneNode,
  Path2DNode,
  createEmitter,
  easings,
  ignoreAbort,
  type EngineHost,
  type Emitter,
  type Rect,
  type Vec2,
} from '@src/stargazer'
import { loadGameAssets, type GameAssets } from './assets'
import { STATES, findState, type StateId } from './data/states'
import { EpicenterNode } from './nodes/EpicenterNode'
import { PacketNode } from './nodes/PacketNode'
import {
  DebrisBurstNode,
  type DebrisBurstOptions,
} from './nodes/DebrisBurstNode'
import { EpicenterBehavior } from './behaviors/EpicenterBehavior'
import { StateSelectionBehavior } from './behaviors/StateSelectionBehavior'
import { PacketBehavior } from './behaviors/PacketBehavior'
import { spawnPacketInSession } from './spawnPacketInSession'
import { fireStateRipple } from './animations/stateRipple'
import { GridOverlayNode } from './nodes/GridOverlayNode'
import { SpawnController } from './spawn/SpawnController'
import {
  fetchStallwaechterHighScores,
  recordStallwaechterGame,
  type GameEndReason as WireGameEndReason,
  type StallwaechterGameRecord as GameRecord,
  type StallwaechterHighScores as HighScores,
} from '../game-log'
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
     * unreachable when the round ended — in that case the card still shows, but
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

const COLOR_STATE_FILL = '#354a6e'
// Lighter shade used on the selected state during highlight. Every state
// stays at the muted alpha (uniform apparent opacity across the map), the
// selected one distinguishes itself by colour, not opacity.
const COLOR_STATE_FILL_SELECTED = '#8692a8'
// Strokes are OPAQUE, pre-blended equivalents of the old semi-transparent
// cream (`rgb(253, 246, 227)`) over their backdrop. Drawn translucent, the
// cream stacked wherever geometry overlapped; shared state borders, tripoints,
// outline-over-state-stroke; reading as brighter dots on the transparent
// canvas. An opaque line drawn over an opaque line is idempotent, so the dots
// disappear while non-overlapping segments look identical to before.
//   pre-blend = cream * a + backdrop * (1 - a)
// State stroke: a = 0.85 over the state fill `#354a6e`.
const COLOR_STATE_STROKE = '#dfdcd1'
// Country outline: a = 0.95 over the background gradient blue (~`#243b67`).
const COLOR_OUTLINE = '#f2eddd'

const FULL_VIEW: Rect = { x: 0, y: 0, width: 661, height: 888 }
// Upper- and lower-half framings share the same width (whole country) but
// crop to a smaller vertical slice so the pre-game card fits below without
// obscuring the selected state. The lower half is bottom-anchored to the
// new 888-tall map so the camera doesn't show empty space past the coast.
const UPPER_HALF: Rect = { x: 0, y: -30, width: 661, height: 560 }
const LOWER_HALF: Rect = { x: 0, y: 328, width: 661, height: 560 }

const CAMERA_TWEEN_SEC = 0.6

// -----------------------------------------------------------------------------
// startGame
// -----------------------------------------------------------------------------

/**
 * Post the finished game to the server and refetch the current high-scores. A
 * single fetch failure returns `{record: null, highScores: empty}` so the
 * game-over overlay can still render — the kiosk shouldn't hard-fail on a
 * momentary daemon hiccup.
 */
async function persistFinishedGame(input: {
  stateId: StateId
  reason: WireGameEndReason
  score: number
  durationMs: number
  escapeHeadingRad?: number
}): Promise<{ record: GameRecord | null; highScores: HighScores }> {
  try {
    const record = await recordStallwaechterGame({
      score: input.score,
      durationMs: input.durationMs,
      stateId: input.stateId,
      reason: input.reason,
      escapeHeadingRad: input.escapeHeadingRad,
    })
    // High-scores AFTER this record landed — the overlay uses this to render
    // "current best" copy next to the freshly-posted score.
    const highScores = await fetchStallwaechterHighScores()
    return { record, highScores }
  } catch (e) {
    console.warn('[session] failed to persist game to server', e)
    return {
      record: null,
      highScores: { display: 'stallwaechter', overall: 0, byState: {} },
    }
  }
}

export async function startGame(host: EngineHost): Promise<GameSession> {
  const events = createEmitter<GameEvents>()
  const assets = await loadGameAssets()

  const stateNodes = new Map<StateId, Path2DNode>()
  const outlineNode = buildOutlineNode(assets)
  const packetLayer = new SceneNode('packet-layer')
  const pathLayer = new SceneNode('path-layer')
  const handleLayer = new SceneNode('handle-layer')
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
  // render mode can visualise it. Safe to call unconditionally, the
  // controller stores the reference; nothing draws unless the mode is
  // active.
  host.debug.setInspectedMask(assets.mask)

  let sessionState: SessionState = 'loading'
  let selectedStateId: StateId | null = null
  let score = 0
  let epicenter: EpicenterNode | null = null
  let cameraController: AbortController | null = null
  let packetIdSeq = 0
  let flashIdSeq = 0
  let gameOverGrace: AbortController | null = null
  // Round-start wall clock (`performance.now()`), used to compute the game's
  // `durationMs` when the round ends. 0 means "no active round".
  let roundStartedAtMs = 0

  const spawnController = new SpawnController(
    {
      isPlaying: () => sessionState === 'playing',
      mask: () => assets.mask,
      epicenter: () => epicenter,
      activePackets: () => activePackets,
      // Spawn only inside the current game-camera viewport so packets never
      // grow off-screen (previous rounds sampled the whole 661×888 country
      // even when the camera was framed on the upper or lower half).
      // Rejection sampling still trims out the letterbox-inside-country
      // via `mask.contains(pt, inset=minDistFromBorder)`.
      spawnBounds: () => host.engine.camera.viewport,
      spawnPacket,
    },
    (seconds, signal) => host.engine.wait(seconds, signal),
  )
  let offCollision: (() => void) | null = null

  // --- Scene build ---------------------------------------------------------
  await host.loadScene((scene) => {
    const mapGroup = new SceneNode('map')
    mapGroup.renderLayer = 'static'
    scene.root.add(mapGroup)

    for (const info of STATES) {
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

    // Country grid overlay sits above the static state fills but under
    // the dynamic path / packet layers. Its own `renderLayer =
    // 'above-static'` handles the compositing, this add order just
    // controls scene-tree traversal for `onUpdate` (overlay ticks
    // before packets, which is fine, the warn sampler reads live
    // packet positions each frame).
    scene.root.add(gridOverlay)

    // Dynamic-layer groups, paths draw under packets so trails don't
    // occlude the finger's target; endpoint handles draw on top so the
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
  function onStateTap(id: StateId): void {
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

  // --- Camera framing -----------------------------------------------------
  async function selectState(id: StateId): Promise<void> {
    const info = findState(id)
    if (!info.half) return // geometry not filled, should never happen

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
    fireStateRipple(id, stateNodes)

    // Show the epicenter at the capital, breathing. The cone opens
    // toward the midpoint of `FULL_VIEW` (Germany's viewBox centre) so
    // the axis always points into the interior.
    if (info.capitalWorld) {
      const germanyCentre: Vec2 = {
        x: FULL_VIEW.x + FULL_VIEW.width / 2,
        y: FULL_VIEW.y + FULL_VIEW.height / 2,
      }
      epicenter = new EpicenterNode({
        center: info.capitalWorld,
        approachReference: germanyCentre,
        apexIcon: assets.firefoxLogo,
      })
      epicenter.transform.alpha = 0
      epicenter.renderLayer = 'dynamic'
      epicenter.addBehavior(new EpicenterBehavior())
      host.engine.scene.root.add(epicenter)
      // Fade the epicenter in as the camera zooms.
      void epicenter
        .tween({ alpha: 1 }, { duration: 0.5, easing: easings.outCubic })
        .catch(ignoreAbort)
    }

    const target = info.half === 'upper' ? UPPER_HALF : LOWER_HALF
    await animateCameraTo(target)
    if (sessionState === 'zoomingIn') sessionState = 'preGame'
  }

  async function animateCameraTo(target: Rect): Promise<void> {
    cameraController?.abort()
    const controller = new AbortController()
    cameraController = controller
    try {
      await host.engine.camera.animateTo(target, {
        duration: CAMERA_TWEEN_SEC,
        easing: easings.inOutCubic,
        signal: controller.signal,
      })
    } catch (err) {
      ignoreAbort(err)
    } finally {
      if (cameraController === controller) cameraController = null
    }
  }

  // --- Highlight bookkeeping ---------------------------------------------
  //
  // State fills live on `renderLayer: 'static'`, which the engine bakes
  // once and blits every frame while the camera is idle. Alpha tweens on
  // static nodes are therefore INVISIBLE unless we promote the node to
  // `'above-static'` (drawn per-frame) for the tween's duration and
  // demote back to `'static'` on completion. Setting `renderLayer` to /
  // from `'static'` invalidates `scene.staticInvalid`, so the demote
  // triggers exactly one re-bake with the final alpha value, the same
  // pattern `ShockwaveBehavior` uses for pulses.
  //
  // The same treatment applies to the outline path. Nodes whose alpha is
  // already at target skip the promote-tween-demote dance entirely so
  // we don't churn the static bake for a no-op.

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

  function highlightState(id: StateId): void {
    // Every state dims to the same muted alpha. The selected one gets a
    // lighter fill so it reads distinctly by colour, not by opacity.
    for (const [otherId, node] of stateNodes) {
      node.fill = otherId === id ? COLOR_STATE_FILL_SELECTED : COLOR_STATE_FILL
      tweenStaticAlpha(node, 0.35, 0.4)
    }
    if (outlineNode) tweenStaticAlpha(outlineNode, 0.6, 0.4)
  }

  function clearHighlight(): void {
    for (const node of stateNodes.values()) {
      node.fill = COLOR_STATE_FILL
      tweenStaticAlpha(node, 1, 0.35)
    }
    if (outlineNode) tweenStaticAlpha(outlineNode, 1, 0.35)
  }

  // --- Session methods ----------------------------------------------------
  async function cancelSelection(): Promise<void> {
    if (sessionState !== 'preGame' && sessionState !== 'zoomingIn') return
    sessionState = 'zoomingOut'
    events.emit('selectionCanceled', undefined)
    disposeEpicenter()
    clearHighlight()
    await animateCameraTo(FULL_VIEW)
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
          gameViewport: () => host.engine.camera.viewport,
          mask: () => assets.mask,
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
      if (!packet.isDestroyed) packet.destroy()
      return
    }
    score++
    events.emit('packetScored', { total: score })
    if (!packet.isDestroyed) packet.destroy()
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
    if (!a.isDestroyed) a.destroy()
    if (!b.isDestroyed) b.destroy()
    spawnImpactFlash(point)
    spawnCollisionDebris(point)
    gridOverlay.pulseFrom(point)
    endRound('collision', selectedStateId)
  }

  function spawnImpactFlash(center: Vec2): void {
    const cfg = TUNING.lossAnim.impactFlash
    const flash = new Path2DNode({
      id: `impact-flash-${flashIdSeq++}`,
      path: assets.impactFlashPath,
      fill: cfg.color,
      hitMode: 'none',
    })
    flash.transform.x = center.x
    flash.transform.y = center.y
    flash.transform.scaleX = cfg.scaleFrom
    flash.transform.scaleY = cfg.scaleFrom
    packetLayer.add(flash)
    void flash.autoDestroy(
      flash.tween(
        { scaleX: cfg.scaleTo, scaleY: cfg.scaleTo, alpha: 0 },
        { duration: cfg.durationSec, easing: easings.outCubic },
      ),
    )
  }

  /**
   * Attach a `DebrisBurstNode` to the packet layer. Cleaned up on reset. * the
   * `packetLayer` walk in `clearGameplayNodes` picks it up alongside every
   * other visual for the round.
   */
  function spawnDebrisBurst(opts: DebrisBurstOptions): void {
    packetLayer.add(new DebrisBurstNode(opts))
  }

  function spawnCollisionDebris(center: Vec2): void {
    // Radial explosion, mix of triangles + lines. Shape + damping
    // + emission uniformity come straight from `TUNING.lossAnim.debris`
    // so the moment matches the game-over card's collision vignette.
    const c = TUNING.lossAnim.debris
    spawnDebrisBurst({
      center,
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
  }

  function spawnBorderBreachDebris(center: Vec2, headingRad: number): void {
    // Directional lines-only burst along the packet's exit velocity.
    // Border-coloured; each line launches broadside to its flight path
    // (`initialAngleOffsetRad = π/2`) and tumbles as it drifts out, a
    // wall-shard read for the "border burst" moment.
    const c = TUNING.lossAnim.borderBreach
    spawnDebrisBurst({
      center,
      count: c.count,
      triangleFraction: c.triangleFraction,
      initialSpeedWorld: c.initialSpeedWorld,
      dampingPerSec: c.dampingPerSec,
      emitDirectionRad: headingRad,
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
    // Drop every user-drawn line + endpoint handle the moment the game
    // ends so the loss visuals aren't cluttered by leftover routing
    // scaffolding. Packets are gated on `mode === 'travelling'` before
    // they steer along a trail, and by this point they're either
    // destroyed (collision) or `'lost'` (breach drifting out), so a
    // dangling trail ref on `PacketBehavior` never gets dereferenced.
    pathLayer.destroyChildren()
    handleLayer.destroyChildren()

    // Persist to the server as soon as the round ends — in parallel with the
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
    // `session.reset()` / `destroy()` abort this timer.
    gameOverGrace?.abort()
    const grace = new AbortController()
    gameOverGrace = grace
    // Once the ripple finishes, unify every state's fill alpha so the
    // map settles at a single consistent brightness before the game-over
    // card slides in. Without this, mid-round selection dims some states
    // to 0.35, leaving a splotchy map during the grace.
    host.engine
      .wait(TUNING.stateRipple.settleClearDelaySec, grace.signal)
      .then(() => {
        if (sessionState === 'gameOver') clearHighlight()
      })
      .catch(ignoreAbort)
    // Defer the outbound `gameOver` event. Svelte listens for it to slide
    // in the game-over card, and we want the impact flash + debris ring +
    // shockwave to be visible for a moment before the UI takes over.
    // `session.reset()` / `destroy()` abort this timer.
    host.engine
      .wait(TUNING.lossAnim.endScreenGraceSec, grace.signal)
      .then(() => persistPromise.then((p) => ({ grace, ...p })))
      .then(({ grace: g, record, highScores }) => {
        if (gameOverGrace !== g) return
        gameOverGrace = null
        if (sessionState !== 'gameOver') return
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
    gameOverGrace?.abort()
    gameOverGrace = null
    clearGameplayNodes()
    disposeEpicenter()
    clearHighlight()
    // Zero the district overlay so a round ending mid-flash doesn't
    // carry stale yellow warnings or half-decayed pulses into the next
    // round. `warnAlpha` is an integrated state array, must be cleared
    // explicitly, `clearGameplayNodes` only walks layers.
    gridOverlay.reset()
    await animateCameraTo(FULL_VIEW)
    if (sessionState === 'zoomingOut') sessionState = 'idle'
    selectedStateId = null
    score = 0
    events.emit('reset', undefined)
  }

  function clearGameplayNodes(): void {
    // Destroy every child of every gameplay layer, packets, motion trails,
    // hex-particle emitters, impact flashes, debris rings, drawn paths,
    // endpoint handles. Packet destroy handlers pair-destroy their trail +
    // emitter, but those siblings ALSO appear in the layer walk here.    // `destroyChildren`'s snapshot + `isDestroyed` gate keeps it idempotent.
    packetLayer.destroyChildren()
    activePackets.length = 0
    pathLayer.destroyChildren()
    handleLayer.destroyChildren()
  }

  function disposeEpicenter(): void {
    if (epicenter && !epicenter.isDestroyed) epicenter.destroy()
    epicenter = null
  }

  function destroy(): void {
    cameraController?.abort()
    cameraController = null
    spawnController.stop()
    offCollision?.()
    offCollision = null
    gameOverGrace?.abort()
    gameOverGrace = null
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
