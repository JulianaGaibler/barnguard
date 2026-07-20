/**
 * Orbo turn state machine. Mirrors the stallwaechter convention:
 * `startGame(host)` builds the scene and returns a `GameSession` control
 * surface with a typed event emitter. Ports the reference `_gameLogic.ts` rules
 * — queues, turn rotation with empty-skip, zone processing, and the
 * end-of-round tally — onto stargazer's fixed-step physics loop and scene nodes
 * (no reference RAF loop, no reference Canvas renderer).
 *
 * Async turn flow (spawn → flick → settle → process → next) is guarded by a
 * `matchGen` counter: `reset()` / `startMatch()` bump it, and every step after
 * an `await` bails if the generation changed underneath it.
 */
import {
  Body,
  BodyType,
  SceneNode,
  PhysicsWorldBehavior,
  aabbShape,
  buildBitmapMask,
  clamp,
  createEmitter,
  easings,
  ignoreAbort,
  type BitmapMask,
  type Emitter,
  type EngineHost,
} from '@src/stargazer'
import { Orb } from './Orb'
import {
  calculateLayout,
  isInOwnScoringBand,
  launchStripCenterX,
  returnTeamForZone,
  zoneAtX,
  type FieldLayout,
} from './layout'
import { OrbNode } from './nodes/OrbNode'
import { OrbExplodeNode } from './nodes/OrbExplodeNode'
import { FieldNode } from './nodes/FieldNode'
import { IndicatorNode } from './nodes/IndicatorNode'
import { ScoringCountNode } from './nodes/ScoringCountNode'
import { PanelNode } from './nodes/PanelNode'
import { FlickController } from './FlickController'
import {
  ANIM,
  INDICATOR,
  MAX_SPEED,
  ORB_SIZES,
  PANEL,
  PAUSE_GESTURE,
  PHYSICS,
  PLAYER_COLORS,
  SCORE_TEXT,
  SETTLE_TIMEOUT_SEC,
  STARTING_ORBS,
} from './tuning'
import type {
  GameMode,
  MatchScore,
  OrbSize,
  PlayerState,
  QueuedOrb,
  QueuedOrbView,
  TeamCounts,
  TeamId,
} from './types'

// -----------------------------------------------------------------------------
// Public API
// -----------------------------------------------------------------------------

export interface RoundResult {
  /** Winning team, or `null` on a tie. */
  winner: TeamId | null
  /** Scoring-band orb counts that decided the round. */
  counts: TeamCounts
  /** Cumulative match score after this round. */
  matchScore: MatchScore
}

export interface GameEvents {
  /** A match started (or restarted with "play again"). */
  matchStarted: { mode: GameMode }
  /**
   * The active seat changed (new orb spawned + armed). Drives the HUD
   * highlight.
   */
  turnChanged: {
    playerId: number
    team: TeamId
    mode: GameMode
  }
  /**
   * All queues emptied; the round has been tallied and the cumulative score
   * updated. Fires before the losing-side explosion + fold-back animation, so
   * the UI knows the winner for the return-to-menu score bump.
   */
  roundOver: RoundResult
  /** Returned to the idle main screen (fold-back complete). */
  reset: void
  /** The cumulative match score was cleared. */
  scoresReset: void
  /** The match was paused (swipe-out gesture or `pause()`). */
  paused: void
  /** The match resumed from a pause. */
  resumed: void
  /**
   * Live progress (0..1) of an in-flight pause swipe, for drag feedback. Fires
   * on move while dragging out from the center; resets to 0 if the swipe is
   * abandoned before it commits (a `paused` event fires when it commits).
   */
  pauseProgress: number
}

export type SessionState = 'idle' | 'playing' | 'gameOver'

export interface GameSession {
  readonly events: Emitter<GameEvents>
  readonly state: SessionState
  readonly mode: GameMode | null
  readonly matchScore: MatchScore
  /** Active player id, or `null` when not mid-turn. */
  currentPlayerId(): number | null
  /** Begin a fresh round in the given mode. */
  startMatch(mode: GameMode): void
  /** Freeze the match (physics + animation) for the pause menu. */
  pause(): void
  /** Resume a paused match. */
  resume(): void
  /** Abandon any round and fold back to the idle main screen. */
  reset(): void
  /** Clear the cumulative match score. */
  resetScores(): void
  /** Tear down scene-facing state + the fixed-step hook. */
  destroy(): void
}

// -----------------------------------------------------------------------------
// startGame
// -----------------------------------------------------------------------------

/**
 * @param bounds World-space rect the field fills (the arcade's game area, inset
 *   by its padding). The field adopts this rect's size/aspect — it is NOT
 *   locked to 16:9.
 */
export async function startGame(
  host: EngineHost,
  bounds: { x: number; y: number; width: number; height: number },
): Promise<GameSession> {
  const events = createEmitter<GameEvents>()
  const layout: FieldLayout = calculateLayout(bounds.width, bounds.height)

  // Physics feel is ported 1:1 onto stargazer's world: no gravity, exponential
  // damping (orbo's `friction`), full-separation positional correction with the
  // same slop/clamp, the same rest threshold, and the anti-tunneling speed cap.
  // Restitution and damping are per-body (see `makeBody` / `buildWalls`).
  const physicsConfig = {
    gravity: { x: 0, y: 0 },
    velocityIterations: PHYSICS.collisionIterations,
    positionIterations: PHYSICS.collisionIterations,
    correctionFactor: 1,
    positionalSlop: PHYSICS.positionalSlop,
    maxCorrection: PHYSICS.maxPositionalCorrection,
    sleepLinearThreshold: PHYSICS.minVelocity,
    sleepTime: 0.1,
    maxLinearSpeed: MAX_SPEED,
  }
  const fieldBounds = { x: 0, y: 0, width: layout.width, height: layout.height }

  // Rounded-rect clip mask matching the panel, in field WORLD coords. Used to
  // reveal the field with a horizontal clip (opening) that keeps the rounded
  // corners, and to keep the tinted bands inside the rounded panel.
  const fieldMaskPath = new Path2D()
  fieldMaskPath.roundRect(
    bounds.x,
    bounds.y,
    bounds.width,
    bounds.height,
    PANEL.radius,
  )
  const fieldMask: BitmapMask = await buildBitmapMask({
    path: fieldMaskPath,
    worldRect: {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
    },
  })
  // Reveal fraction (0 = hidden, 1 = full) driving the horizontal clip opening.
  // Shared by reference with the panel + field nodes, tweened on match start.
  const reveal = { frac: 0 }

  /**
   * Four static walls just outside the field so orbs bounce off the edges
   * (restitution) and stay in bounds, replacing the old manual wall clamp.
   */
  function buildWalls(): void {
    const t = 200
    const w = layout.width
    const h = layout.height
    const mk = (x: number, y: number, hw: number, hh: number): void => {
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
    mk(-t, h / 2, t, h / 2 + t) // left
    mk(w + t, h / 2, t, h / 2 + t) // right
    mk(w / 2, -t, w / 2 + t, t) // top
    mk(w / 2, h + t, w / 2 + t, t) // bottom
  }

  const orbLayer = new SceneNode('orb-layer')
  // orbLayer owns the orbo physics world. Orb nodes are its children with
  // transform = body position, so its world transform maps field coords to
  // scene world for the debug overlay. Attaching the behavior registers the
  // world with the engine (auto-stepped each fixed tick, shown in the debug
  // HUD) and clears it when orboRoot is destroyed.
  const world = orbLayer.addBehavior(
    new PhysicsWorldBehavior({ config: physicsConfig, label: 'orbo' }),
  ).world
  // White scoring rings live in their own layer BELOW the orbs so a ring never
  // obstructs a neighbouring orb it touches — the orb bodies paint over it.
  const ringLayer = new SceneNode('ring-layer')
  const indicatorLayer = new SceneNode('indicator-layer')
  const scoreLayer = new SceneNode('score-layer')
  const fieldNode = new FieldNode(layout, reveal, fieldMask)
  const nodesByBody = new Map<number, OrbNode>()
  let indicators: IndicatorNode[] = [] // indexed by player id

  // The field fills `bounds` (the arcade game area minus its padding). The field
  // uses local coordinates 0..bounds.width × 0..bounds.height; `gameGroup` just
  // translates them to the bounds origin (no scaling, so the field takes the
  // bounds' aspect — not a fixed 16:9). A light rounded panel sits behind it.
  const orboRoot = new SceneNode('orbo-root')
  // `fieldGroup` wraps the panel + game. Both the open and the close are
  // horizontal clip reveals driven by `reveal.frac` (no scaling), so the group
  // keeps an identity transform.
  const fieldGroup = new SceneNode('orbo-field')
  const panel = new PanelNode(
    bounds.x,
    bounds.y,
    bounds.width,
    bounds.height,
    reveal,
    fieldMask,
  )
  const gameGroup = new SceneNode('orbo-game')
  gameGroup.transform.x = bounds.x
  gameGroup.transform.y = bounds.y
  const toLocal = (p: { x: number; y: number }): { x: number; y: number } =>
    gameGroup.worldToLocal(p.x, p.y)

  // Mutable session state.
  let state: SessionState = 'idle'
  let mode: GameMode | null = null
  let players: PlayerState[] = []
  let queues: QueuedOrb[][] = [] // indexed by player id
  let currentPlayerIndex = 0
  let queuedIdSeq = 0
  let matchGen = 0
  const matchScore: MatchScore = { teamL: 0, teamR: 0 }
  let activeFlick: FlickController | null = null
  let paused = false

  // --- Scene build ---------------------------------------------------------
  // The arcade owns the engine (start + camera + persistent background), so the
  // game does NOT call loadScene/start — it just attaches its own subtree.
  // Draw order (dynamic layer = child order): field, then the strip HUD (score
  // count + queue indicators), then the scoring rings, then orbs on top. The HUD
  // sits BEHIND the orbs so orbs resting in a strip visually overlap the number
  // and dots; the rings sit BELOW the orbs so a ring is painted over by any orb
  // it touches (it never obstructs a neighbouring orb).
  gameGroup.add(fieldNode)
  gameGroup.add(scoreLayer)
  gameGroup.add(indicatorLayer)
  gameGroup.add(ringLayer)
  gameGroup.add(orbLayer)
  fieldGroup.add(panel) // behind the field
  fieldGroup.add(gameGroup)
  orboRoot.add(fieldGroup)
  host.engine.scene.root.add(orboRoot)

  // Physics runs on the deterministic fixed-step ticker (120 Hz) via the
  // registered world; the engine steps it automatically. Cheap when idle (no
  // bodies); a guarded pause is handled by the ticker stopping.

  // --- Field reveal (clip open) / fold close -------------------------------

  /** Horizontal clip reveal from the center (opening). */
  function revealOpen(): Promise<void> {
    reveal.frac = 0
    return fieldGroup
      .tweenTo(
        reveal,
        { frac: 1 },
        { duration: ANIM.revealOpen, easing: easings.outCubic },
      )
      .catch(ignoreAbort)
  }
  /**
   * Horizontal clip close to the center (returning to the menu), mirroring the
   * open. The field itself never scales; any remaining orbs (e.g. the winner's)
   * shrink away in parallel since a clip mask can't hide the gradient orbs.
   */
  function foldClose(): Promise<void> {
    const shrinks: Promise<void>[] = []
    for (const node of nodesByBody.values()) {
      if (node.isDestroyed) continue
      shrinks.push(
        node
          .tween(
            { scaleX: 0, scaleY: 0 },
            { duration: ANIM.foldClose, easing: easings.inCubic },
          )
          .catch(ignoreAbort),
      )
    }
    const clip = fieldGroup
      .tweenTo(
        reveal,
        { frac: 0 },
        { duration: ANIM.foldClose, easing: easings.inCubic },
      )
      .catch(ignoreAbort)
    return Promise.all([clip, ...shrinks]).then(() => undefined)
  }

  // --- Pause + swipe-out gesture -------------------------------------------

  function pause(): void {
    if (state !== 'playing' || paused) return
    paused = true
    host.engine.setPaused(true) // soft freeze: physics + animation halt
    events.emit('paused', undefined)
  }
  function resume(): void {
    if (!paused) return
    paused = false
    host.engine.setPaused(false)
    events.emit('resumed', undefined)
  }

  // Open the pause menu on a horizontal swipe that STARTS near the field's
  // vertical center line (empty space — never on an orb, which would capture the
  // pointer for a flick) and drags outward past a threshold.
  let swipeStartX: number | null = null
  const offDown = host.engine.events.on('pointerDown', (e) => {
    swipeStartX = null
    if (state !== 'playing' || paused || e.pointer.capturedBy !== null) return
    const p = toLocal({ x: e.pointer.world.x, y: e.pointer.world.y })
    if (p.y < 0 || p.y > layout.height) return
    if (
      Math.abs(p.x - layout.centerX) <=
      layout.width * PAUSE_GESTURE.startBandFrac
    ) {
      swipeStartX = p.x
    }
  })
  const offMove = host.engine.events.on('pointerMove', (e) => {
    if (swipeStartX === null || state !== 'playing' || paused) return
    const p = toLocal({ x: e.pointer.world.x, y: e.pointer.world.y })
    const dist = Math.abs(p.x - swipeStartX)
    const progress = Math.min(
      1,
      dist / (layout.width * PAUSE_GESTURE.triggerFrac),
    )
    if (progress >= 1) {
      swipeStartX = null
      pause() // emits 'paused'
    } else {
      events.emit('pauseProgress', progress) // drag feedback
    }
  })
  const clearSwipe = (): void => {
    if (swipeStartX === null) return
    swipeStartX = null
    events.emit('pauseProgress', 0) // abandoned before commit → snap back
  }
  const offUp = host.engine.events.on('pointerUp', clearSwipe)
  const offCancel = host.engine.events.on('pointerCancel', clearSwipe)

  /**
   * Fold the field closed and return to the idle main screen. Bumps `matchGen`
   * so any in-flight turn bails, un-pauses first if needed, and emits `reset`
   * once the fold-back finishes.
   */
  async function returnToMenu(): Promise<void> {
    const gen = ++matchGen
    if (paused) resume()
    await foldClose()
    if (gen !== matchGen) return
    clearField()
    queues = []
    state = 'idle'
    mode = null
    currentPlayerIndex = 0
    reveal.frac = 0 // hidden; next match clip-reveals from 0
    events.emit('reset', undefined)
  }

  // --- Helpers -------------------------------------------------------------

  function activePlayerCount(): number {
    return mode === '2v2' ? 4 : 2
  }

  function teamPlayerIds(team: TeamId): number[] {
    return mode === '2v2' ? [team, team + 2] : [team]
  }

  /** How many of a team's orbs currently rest in its own scoring band. */
  function scoringCountForTeam(team: TeamId): number {
    let n = 0
    for (const body of world.bodies) {
      if (!(body instanceof Orb) || body.markedForRemoval) continue
      if (body.team === team && isInOwnScoringBand(layout, body)) n++
    }
    return n
  }

  /** Center anchor for a player's indicator strip. */
  function indicatorAnchor(player: PlayerState): { cx: number; cy: number } {
    // Horizontally centered in the team's launch (flick) strip.
    const cx = launchStripCenterX(layout, player.team)
    // 2v2 top-seat players (ids 0/1) get top-aligned strips; everyone else is
    // bottom-aligned (both players in 1v1, and the bottom seats in 2v2).
    const topSeat = mode === '2v2' && player.id < 2
    const cy = topSeat
      ? INDICATOR.edgeMargin
      : layout.height - INDICATOR.edgeMargin
    return { cx, cy }
  }

  /** Push the current queues into their in-engine indicator strips. */
  function refreshIndicators(): void {
    for (const p of players) {
      const ind = indicators[p.id]
      if (!ind) continue
      ind.update(
        queues[p.id].map((o): QueuedOrbView => ({ id: o.id, size: o.size })),
      )
    }
  }

  /**
   * Fisher-Yates shuffled queue: 3 SMALL, 2 MEDIUM, 1 LARGE, lifetime 3. The
   * shuffled order is stable for the match — returned orbs are appended to the
   * end, so everything already queued is spawned first.
   */
  function buildQueue(): QueuedOrb[] {
    const sizes: OrbSize[] = []
    for (const size of ['SMALL', 'MEDIUM', 'LARGE'] as OrbSize[]) {
      for (let i = 0; i < STARTING_ORBS[size]; i++) sizes.push(size)
    }
    for (let i = sizes.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[sizes[i], sizes[j]] = [sizes[j], sizes[i]]
    }
    return sizes.map((size) => ({
      id: `q-${queuedIdSeq++}`,
      size,
      lifetimeRemaining: ORB_SIZES[size].lifetime,
    }))
  }

  /**
   * Spawn position for a player: strip center-x, vertically centered. Turns are
   * sequential (one active orb at a time), so every seat — in both 1v1 and 2v2
   * — launches from the vertical center of its team's strip.
   */
  function homeFor(player: PlayerState): { x: number; y: number } {
    return { x: launchStripCenterX(layout, player.team), y: layout.height / 2 }
  }

  /** Find a spawn spot near home that doesn't overlap a resting orb. */
  function findClearSpawn(
    player: PlayerState,
    radius: number,
  ): { x: number; y: number } {
    const home = homeFor(player)
    const step = ORB_SIZES.LARGE.radius * 2
    // Try home, then walk outward along y (the strip's long axis).
    for (let i = 0; i < 8; i++) {
      const dy = Math.ceil(i / 2) * step * (i % 2 === 0 ? 1 : -1)
      const y = clamp(home.y + dy, radius, layout.height - radius)
      if (isSpotClear(home.x, y, radius)) return { x: home.x, y }
    }
    return home
  }

  function isSpotClear(x: number, y: number, radius: number): boolean {
    for (const b of world.bodies) {
      if (!(b instanceof Orb) || b.markedForRemoval) continue
      const minDist = radius + b.radius
      const dx = x - b.x
      const dy = y - b.y
      if (dx * dx + dy * dy < minDist * minDist) return false
    }
    return true
  }

  function makeBody(player: PlayerState, queued: QueuedOrb): Orb {
    const spec = ORB_SIZES[queued.size]
    const spot = findClearSpawn(player, spec.radius)
    return new Orb({
      x: spot.x,
      y: spot.y,
      radius: spec.radius,
      mass: spec.mass,
      size: queued.size,
      player: player.id,
      team: player.team,
      lifetimeRemaining: queued.lifetimeRemaining,
      restitution: PHYSICS.restitution,
      linearDamping: PHYSICS.friction,
      sleepThreshold: PHYSICS.minVelocity,
    })
  }

  function removeOrb(body: Orb): void {
    world.removeBody(body)
    const node = nodesByBody.get(body.id)
    if (node && !node.isDestroyed) node.destroy()
    nodesByBody.delete(body.id)
  }

  function clearField(): void {
    activeFlick?.destroy()
    activeFlick = null
    // Destroys orb nodes AND any in-flight death-burst nodes in one pass. Each
    // orb node destroys its companion ring node; clear the layer too for safety.
    orbLayer.destroyChildren()
    ringLayer.destroyChildren()
    nodesByBody.clear()
    world.clear()
    // `world.clear()` drops the walls too; rebuild them for the next round.
    buildWalls()
    indicatorLayer.destroyChildren()
    indicators = []
    scoreLayer.destroyChildren()
  }

  // --- Turn flow -----------------------------------------------------------

  async function spawnActive(gen: number): Promise<void> {
    const player = players[currentPlayerIndex]
    const queue = queues[player.id]
    if (queue.length === 0) {
      // Shouldn't happen — nextTurn skips empty queues — but stay safe.
      await endRound(gen)
      return
    }
    const queued = queue.shift()!
    refreshIndicators() // front orb left the queue — animate it out of the strip
    const body = makeBody(player, queued)
    // Start off the player's side edge and slide in; ghosted so it passes over
    // any resting orbs during entry without exploding them.
    body.isBeingDragged = true
    body.x = player.team === 0 ? -body.radius : layout.width + body.radius
    world.addBody(body)

    // Retint this team's scoring band to the active player's color (2v2).
    fieldNode.setBandColor(player.team, player.color)

    const node = new OrbNode(
      body,
      layout,
      player.color,
      (team) => players[pickReturnPlayer(team)].color,
      ringLayer,
    )
    orbLayer.add(node)
    nodesByBody.set(body.id, node)

    events.emit('turnChanged', {
      playerId: player.id,
      team: player.team,
      mode: mode!,
    })

    // Slide in from the side, then arm the flick.
    await node
      .tweenTo(
        body,
        { x: body.homeX, y: body.homeY },
        { duration: ANIM.spawnSlideIn, easing: easings.outCubic },
      )
      .catch(ignoreAbort)
    if (gen !== matchGen) return
    body.isBeingDragged = false

    activeFlick = new FlickController(
      node,
      body,
      layout,
      {
        onLaunched: (vx, vy) => onLaunched(body, vx, vy),
      },
      toLocal,
    )
  }

  function onLaunched(body: Orb, vx: number, vy: number): void {
    const gen = matchGen
    activeFlick?.destroy()
    activeFlick = null

    // Nudge out of any overlap first (resolveOverlaps ignores the mask, so the
    // orb stays ghosted through the cancel path) so the separation step doesn't
    // explode. If it's hopelessly buried, cancel → re-arm the turn.
    if (!world.resolveOverlaps(body, 6, fieldBounds)) {
      void reArmAfterCancel(body, gen)
      return
    }
    body.isBeingDragged = false
    body.isSleeping = false
    const clamped = world.clampSpeed(vx, vy)
    body.vx = clamped.vx
    body.vy = clamped.vy

    void resolveTurn(gen)
  }

  async function reArmAfterCancel(body: Orb, gen: number): Promise<void> {
    body.vx = 0
    body.vy = 0
    const node = nodesByBody.get(body.id)
    if (!node) return
    await node
      .tweenTo(
        body,
        { x: body.homeX, y: body.homeY },
        { duration: ANIM.snapBack, easing: easings.outCubic },
      )
      .catch(ignoreAbort)
    if (gen !== matchGen) return
    body.isBeingDragged = false
    activeFlick = new FlickController(
      node,
      body,
      layout,
      {
        onLaunched: (vx, vy) => onLaunched(body, vx, vy),
      },
      toLocal,
    )
  }

  async function resolveTurn(gen: number): Promise<void> {
    await settleWithTimeout()
    if (gen !== matchGen) return
    await processZones(gen)
    if (gen !== matchGen) return
    await nextTurn(gen)
  }

  async function settleWithTimeout(): Promise<void> {
    let settled = false
    const settlePromise = world.waitForSettle().then(() => {
      settled = true
    })
    try {
      await Promise.race([settlePromise, host.engine.wait(SETTLE_TIMEOUT_SEC)])
    } catch (err) {
      ignoreAbort(err)
    }
    if (!settled && !world.isAtRest()) world.forceSettle()
  }

  async function processZones(gen: number): Promise<void> {
    interface Pending {
      body: Orb
      action: 'return' | 'delete'
      targetPlayer?: number
    }
    const pending: Pending[] = []

    for (const body of world.bodies) {
      if (
        !(body instanceof Orb) ||
        body.markedForRemoval ||
        body.isBeingDragged
      ) {
        continue
      }
      const zone = zoneAtX(layout, body.x)
      const returnTeam = returnTeamForZone(zone)
      if (returnTeam === null) continue // rests in a scoring / neutral band

      body.lifetimeRemaining -= 1
      if (body.lifetimeRemaining > 0) {
        pending.push({
          body,
          action: 'return',
          targetPlayer: pickReturnPlayer(returnTeam),
        })
      } else {
        pending.push({ body, action: 'delete' })
      }
    }

    if (pending.length === 0) return

    // Mark first so nothing collides with an orb mid-shrink, then animate all
    // shrinks in parallel and commit the queue changes afterward.
    for (const p of pending) p.body.markedForRemoval = true

    await Promise.all(
      pending.map((p) => {
        const node = nodesByBody.get(p.body.id)
        if (!node) return Promise.resolve()
        return node
          .tween(
            { scaleX: 0, scaleY: 0 },
            { duration: ANIM.removeShrink, easing: easings.inCubic },
          )
          .catch(ignoreAbort)
      }),
    )
    if (gen !== matchGen) return

    let queuesTouched = false
    for (const p of pending) {
      if (p.action === 'return' && p.targetPlayer !== undefined) {
        queues[p.targetPlayer].push({
          id: `q-${queuedIdSeq++}`,
          size: p.body.size,
          lifetimeRemaining: p.body.lifetimeRemaining,
        })
        queuesTouched = true
      } else if (p.action === 'delete') {
        // Final death (lifetime spent): explode into shrapnel at the orb's spot.
        orbLayer.add(
          new OrbExplodeNode(
            { x: p.body.x, y: p.body.y },
            players[p.body.player].color,
            p.body.radius,
          ),
        )
      }
      removeOrb(p.body)
    }
    if (queuesTouched) refreshIndicators()
  }

  /** On a team, prefer the player with the fewest queued orbs (reference rule). */
  function pickReturnPlayer(team: TeamId): number {
    const ids = teamPlayerIds(team)
    let best = ids[0]
    for (const id of ids) {
      if (queues[id].length < queues[best].length) best = id
    }
    return best
  }

  async function nextTurn(gen: number): Promise<void> {
    const count = activePlayerCount()
    currentPlayerIndex = (currentPlayerIndex + 1) % count

    if (queues.every((q) => q.length === 0)) {
      await endRound(gen)
      return
    }

    // Bounded skip past players who are out of orbs.
    let attempts = 0
    while (
      queues[players[currentPlayerIndex].id].length === 0 &&
      attempts < count
    ) {
      currentPlayerIndex = (currentPlayerIndex + 1) % count
      attempts++
    }
    if (attempts >= count) {
      await endRound(gen)
      return
    }

    await spawnActive(gen)
  }

  /**
   * Round-end sequence: shrink away the orbs that don't score (no white ring),
   * then bounce each scoring orb one after another as if counting them, and
   * only THEN tally + emit `roundOver` (which surfaces the game-over card).
   */
  async function endRound(gen: number): Promise<void> {
    state = 'gameOver'

    const scoring: Orb[] = []
    const nonScoring: Orb[] = []
    for (const body of world.bodies) {
      if (!(body instanceof Orb) || body.markedForRemoval) continue
      if (isInOwnScoringBand(layout, body)) scoring.push(body)
      else nonScoring.push(body)
    }

    // 1. Shrink out the non-contributing orbs together.
    await Promise.all(
      nonScoring.map((body) => {
        body.markedForRemoval = true
        const node = nodesByBody.get(body.id)
        const done = node
          ? node
              .tween(
                { scaleX: 0, scaleY: 0 },
                { duration: ANIM.gameOverShrink, easing: easings.inCubic },
              )
              .catch(ignoreAbort)
          : Promise.resolve()
        return done.then(() => removeOrb(body))
      }),
    )
    if (gen !== matchGen) return

    // 2. Count the scoring orbs left→right: each bounces big → back, started in
    // a staggered cascade — the next bounce kicks off `countStagger` after the
    // previous one STARTS (not after it finishes), so they overlap. Only the
    // last orb's bounce is fully awaited before moving on.
    scoring.sort((a, b) => a.x - b.x)

    const bounce = (node: OrbNode): Promise<void> =>
      node
        .tween(
          { scaleX: ANIM.countBounceScale, scaleY: ANIM.countBounceScale },
          { duration: ANIM.countBounceUp, easing: easings.outQuad },
        )
        .catch(ignoreAbort)
        .then(() =>
          node
            .tween(
              { scaleX: 1, scaleY: 1 },
              { duration: ANIM.countBounceDown, easing: easings.outBack },
            )
            .catch(ignoreAbort),
        )

    const bounces: Promise<void>[] = []
    for (let i = 0; i < scoring.length; i++) {
      const node = nodesByBody.get(scoring[i].id)
      if (node) bounces.push(bounce(node))
      // Stagger the NEXT start, but don't wait after the final orb.
      if (i < scoring.length - 1) {
        await host.engine.wait(ANIM.countStagger).catch(ignoreAbort)
        if (gen !== matchGen) return
      }
    }
    await Promise.all(bounces)
    if (gen !== matchGen) return

    await host.engine.wait(ANIM.postCountPause).catch(ignoreAbort)
    if (gen !== matchGen) return

    // 3. Tally, bump the cumulative score, and announce the result (drives the
    //    return-to-menu score bump) — no card, the rest is pure animation.
    const counts: TeamCounts = { teamL: 0, teamR: 0 }
    for (const body of scoring) {
      if (body.team === 0) counts.teamL++
      else counts.teamR++
    }
    let winner: TeamId | null = null
    if (counts.teamL > counts.teamR) winner = 0
    else if (counts.teamR > counts.teamL) winner = 1
    if (winner === 0) matchScore.teamL++
    else if (winner === 1) matchScore.teamR++

    events.emit('roundOver', {
      winner,
      counts,
      matchScore: { ...matchScore },
    })

    // 4. On a decisive round, the losing side's scoring orbs explode into
    //    shrapnel (skipped on a tie); hold briefly so it reads.
    if (winner !== null) {
      const loser: TeamId = winner === 0 ? 1 : 0
      for (const body of scoring) {
        if (body.team !== loser) continue
        orbLayer.add(
          new OrbExplodeNode(
            { x: body.x, y: body.y },
            players[body.player].color,
            body.radius,
          ),
        )
        removeOrb(body)
      }
      await host.engine.wait(ANIM.explodeHold).catch(ignoreAbort)
      if (gen !== matchGen) return
    }

    // 5. Fold the field closed and return to the main screen.
    await returnToMenu()
  }

  // --- Public methods ------------------------------------------------------

  function startMatch(nextMode: GameMode): void {
    matchGen++
    if (paused) resume()
    clearField()
    reveal.frac = 0 // hidden until the clip-reveal tween runs
    mode = nextMode
    state = 'playing'
    currentPlayerIndex = 0

    const numPlayers = nextMode === '1v1' ? 2 : 4
    players = []
    queues = []
    for (let i = 0; i < numPlayers; i++) {
      players.push({ id: i, team: (i % 2) as TeamId, color: PLAYER_COLORS[i] })
      queues.push([])
    }

    if (nextMode === '1v1') {
      queues[0] = buildQueue()
      queues[1] = buildQueue()
    } else {
      // Split each team's queue across its two seats.
      const teamL = buildQueue()
      const teamR = buildQueue()
      const lSplit = Math.ceil(teamL.length / 2)
      const rSplit = Math.ceil(teamR.length / 2)
      queues[0] = teamL.slice(0, lSplit)
      queues[2] = teamL.slice(lSplit)
      queues[1] = teamR.slice(0, rSplit)
      queues[3] = teamR.slice(rSplit)
    }

    // Reset the scoring-band tints to the two teams' default colors.
    fieldNode.resetColors()

    // Build one in-engine indicator strip per player, positioned by seat.
    indicators = players.map((p) => {
      const a = indicatorAnchor(p)
      const node = new IndicatorNode(p.color, a.cx, a.cy)
      indicatorLayer.add(node)
      return node
    })
    refreshIndicators()

    // One live "orbs in our scoring band" count per team, drawn in that team's
    // flick strip OPPOSITE its queue indicator (which shows orbs left): centered
    // in 2v2 (indicators sit at both the top and bottom seats), and at the top in
    // 1v1 (the lone indicator is at the bottom).
    for (const team of [0, 1] as TeamId[]) {
      const cx = launchStripCenterX(layout, team)
      const cy = nextMode === '2v2' ? layout.height / 2 : INDICATOR.edgeMargin
      scoreLayer.add(
        new ScoringCountNode(
          () => scoringCountForTeam(team),
          cx,
          cy,
          SCORE_TEXT.color,
        ),
      )
    }

    events.emit('matchStarted', { mode: nextMode })
    // Clip the field open from the center, THEN arm the first turn.
    const gen = matchGen
    void (async () => {
      await revealOpen()
      if (gen !== matchGen) return
      await spawnActive(matchGen)
    })()
  }

  function reset(): void {
    void returnToMenu()
  }

  function resetScores(): void {
    matchScore.teamL = 0
    matchScore.teamR = 0
    events.emit('scoresReset', undefined)
  }

  function destroy(): void {
    matchGen++
    offDown()
    offMove()
    offUp()
    offCancel()
    if (paused) {
      paused = false
      host.engine.setPaused(false)
    }
    clearField()
    // Remove the whole game subtree (panel + field) from the shared scene; the
    // arcade background stays.
    if (!orboRoot.isDestroyed) orboRoot.destroy()
    state = 'idle'
  }

  return {
    events,
    get state() {
      return state
    },
    get mode() {
      return mode
    },
    get matchScore() {
      return { ...matchScore }
    },
    currentPlayerId() {
      return state === 'playing' && players.length > 0
        ? players[currentPlayerIndex].id
        : null
    },
    startMatch,
    pause,
    resume,
    reset,
    resetScores,
    destroy,
  }
}
