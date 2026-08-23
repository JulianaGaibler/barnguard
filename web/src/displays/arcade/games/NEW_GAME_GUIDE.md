# Adding a new arcade game

This is the reference doc for building a new game on the stargazer-powered arcade
shell. It captures the engine APIs, the shared shell infra, and the conventions
both existing games (`orbo`, `connect-four`) follow, so a new game can reuse the
same patterns instead of re-deriving them from scratch.

For engine internals beyond what's summarized here, read the guides under
`web/src/stargazer/docs/guides/` (architecture, physics, layout, camera,
animation, particles, input, html-overlays, text, scene, stages, setup).

## 1. The game contract

Path: `web/src/displays/arcade/games/GameModule.ts`

```ts
export interface GameMeta {
  id: string
  title: string
  description: string
  players: string // e.g. "2-4" or "1"
  thumbColor: string // solid placeholder thumbnail color (no live launcher preview exists)
  themeTokens?: ThemePalette // optional per-game overrides, scoped via themeScope
}

export interface GameProps {
  host: EngineHost // shared, already-started engine host with background attached
  onExit: () => void // hand control back to the arcade/launcher
  demoStage: DemoStageController | null // shared pre-warmed tutorial demo stage; null if WebGL2 unavailable
}

export interface GameModule {
  meta: GameMeta
  component: Component<GameProps>
}
```

That's the entire enforced surface. Everything else below (splash, pause,
session, scoring, tutorial, menu preview) is convention, followed by both
existing games, not contractually required.

**Registration**: add the module to the `GAMES` array in
`web/src/displays/arcade/games/registry.ts`, or it won't appear in the launcher.

Contract obligations implied by how `ArcadeScreen.svelte` uses `component`:

- Build your own scene subtree + overlays on mount; tear them down on unmount.
- Pin overlays to the game region with the `domAnchor` action so they ride the
  shared camera pan (no manual fade choreography needed on exit).
- Provide your own "return to launcher" affordance that calls `onExit` — the
  shell's swipe-down escape hatch calls the same `onExit`.
- If `demoStage` is `null`, hide the "How to play" affordance rather than crash.

## 2. File layout convention

```
games/<name>/
  meta.ts            GameModule export (id/title/description/players/thumbColor)
  strings.ts         flat `as const` i18n object, imported directly — NOT the shared arcade i18n store
  tutorial.ts        TutorialSpec: array of { title, body, build(stage, host) }
  <Name>Game.svelte  root component — shell wiring + registration + copy
  overlays/          Svelte DOM screens, presentation-only, driven by props/callbacks
    SplashScreen.svelte   thin config over shared MenuScreen
    PauseMenu.svelte       Surface + Score + Resume/Quit
    (optional game-specific HUD, e.g. TurnIndicator.svelte)
  game/              non-Svelte engine logic
    index.ts           barrel — re-exports startGame + public types
    session.ts         state machine, turn flow, scoring — the "engine" of the game
    layout.ts          pure geometry (grid/field → world coordinates), no engine deps
    tuning.ts          every constant: colors, sizes, physics feel, animation durations
    types.ts           dependency-free value types (avoids import cycles)
    demo.ts            tutorial-card demo builders, reuse real nodes/scene helpers
    menuPreview.ts      standalone animated preview shown behind the splash screen
    nodes/             one Node2D subclass per visual concern
    (ai.ts, anim.ts, board.ts, etc. as needed — game-specific)
```

Root = shell wiring; `overlays/` = thin Svelte, no engine logic; `game/` =
engine-facing TS, no Svelte; `game/nodes/` = individual render classes kept
small and composable (e.g. split a glow ring from its parent shape so draw
order/layering can differ).

## 3. Root `<Name>Game.svelte` lifecycle

Both `OrboGame.svelte` and `ConnectFourGame.svelte` follow this shape:

```
onMount:
  1. compute visible game rect via gameVisibleRect() (world.ts)
  2. create a UI-anchor Node2D pinned to that rect's top-left
  3. subscribe to host.engine.events.on('resize', ...) to keep the anchor +
     gameRect in sync with viewport changes
  4. call startGame(host, bounds) from game/session.ts -> GameSession
  5. wire session events (matchStarted, roundOver/turnChanged, reset,
     scoresReset, paused, resumed, pauseProgress) into local $state
  6. $effect: rebuild the menuPreview whenever the splash is shown or
     gameRect changes; destroy the previous preview first

onDestroy / cleanup:
  - unsubscribe resize listener
  - session.destroy()
  - destroy the anchor node
```

Template: one `div` using `use:domAnchor={{ engine, node: anchor, size, cull: true }}`
holding the conditionally-rendered `SplashScreen` / `PauseMenu` (+ any HUD
overlay); the `HowToPlay` tutorial modal is rendered as a sibling, NOT inside
the camera-anchored div, so its demo canvas runs at true resolution.

## 4. Main menu (splash screen)

Reuse `web/src/displays/arcade/menu/MenuScreen.svelte` — don't build a menu
from scratch. Both games' `SplashScreen.svelte` are thin config layers over it:

- Props: `matchScore`, `bumpTeam` (pulses a score tile), `onStart(mode)`,
  `onExit()`, optional `onHowToPlay()` (omit if `demoStage` is null upstream).
- Build a `MenuItem[]` (`menu/types.ts`): flat `MenuAction`s or nested
  `MenuSubmenu`s (submenus work well for difficulty tiers on an AI opponent —
  see Connect Four's "1 Player" → Easy/Medium/Hard).
- Derive a `MenuScore` (`left/right/leftColor/rightColor`) from your session's
  running score if the game tracks one across rounds; pass it as `score` +
  `bump` to `MenuScreen`.
- Include a "Return to Launcher" item (`variant: 'surface'`, `RobotIcon`).
- No internal state — every transition is a callback into the parent, which
  maps it to `session.startMatch(mode)` / the arcade's `onExit`.

There is no live animated preview on the _launcher_ `GameCard` — thumbnails
are a flat `thumbColor`. The animated backdrop belongs on the _splash screen_
itself, via `menuPreview.ts` (see §9).

## 5. Pause screen

Two viable trigger patterns from prior art:

- **Gesture-driven** (Orbo): a swipe near the field's centerline, checked
  against empty space so it doesn't hijack normal input, emits a live
  `pauseProgress` (0..1) for drag feedback before committing.
- **Explicit button** (simpler; Connect Four's `PauseMenu.svelte` has no
  gesture layer at all — just Resume/Quit buttons).

Either way: `pause()`/`resume()` call `host.engine.setPaused(true/false)`
(freezes physics + animation) and emit `paused`/`resumed` session events.

`PauseMenu.svelte` composition: `Surface` + `Score` (shared component) +
Resume/Quit buttons, `fade`/`scale` transitions. If using the gesture pattern,
gate `pointer-events: auto` on a `committed` flag so an in-progress swipe still
reaches the canvas underneath, and scale/fade the card by the live `progress`
value for a responsive drag preview.

Quit should call `session.reset()` (fold back to idle, no win/score bump).

### Where the pause control can go

The booth owns three strips along the top edge, and the two gestures behind
them run on `window` at capture phase. They fire before the scene is hit-tested
and before a DOM `click`, so a control underneath one does not get a "maybe" —
it never sees the tap at all, however it is painted or layered. This is not
something a game can override.

- **Both top corners**, `BOOTH_CORNER_SIZE_PX` square: the attendant's
  double-tap for the booth menu.
- **The middle third of the top 5%**: the return-to-launcher swipe. Not
  capture-phase, so it only competes rather than blocking, but a game that
  drags near the top should still stay out of it.

For canvas chrome placed in world units, use `boothCornerInset(cssW, cssH)` from
`world.ts`. Do not hardcode a world offset: the gesture box is a fixed CSS size,
so the slice of the region it covers grows as the canvas shrinks, and an offset
tuned at 1920x1080 stops clearing it on a smaller window. Recompute it on
resize, next to wherever the game already caches `gameRect`.

The reach is the same on both axes, so clearing it on **either one** is enough:
move the control down past the inset, or in from the side edge by it. Spend
whichever axis the game can afford. `flood-it` and `full-stack` go sideways,
because directly below their top strip is the board and the card rows. JezzBall
goes down, because its right margin is empty and it has decorative corner marks
to clear anyway.

For DOM chrome, offset by `var(--booth-corner-size)`. Keep it in `px`, not
`rem`: the gesture box is absolute CSS pixels and does not follow
`--ui-scale`.

Anything sized in CSS pixels but placed in world units needs the same
conversion. `worldPerCssPx(cssW, cssH)` is the factor for layout code, and
`camera.strokeSpaceScale()` is the same number inside a node's `draw`.

## 6. Scoring / session state machine

`game/session.ts` is the whole engine. Shape to follow:

```ts
interface GameSession {
  state: 'idle' | 'playing' | 'gameOver'
  mode: GameMode | null
  matchScore: MatchScore // getter returns a copy, e.g. { teamL, teamR }
  currentPlayerId(): PlayerId
  startMatch(mode): void
  pause(): void
  resume(): void
  reset(): void
  resetScores(): void
  destroy(): void
  events: Emitter<GameEvents> // matchStarted, roundOver, reset, scoresReset, paused, resumed, ...
}
```

There is **no central match-score service** in the shell — `MatchScore` /
running score is entirely owned by each game's `session.ts`. Feed it into
`MenuScreen`'s `score`/`bump` props and the shared `Score.svelte` component
(used directly in `PauseMenu`).

Use a generation counter (`matchGen`/`moveGen`) bumped on `reset()`/`startMatch()`,
and check it after every `await` in async turn/round logic so stale async work
(e.g. a settling animation from a round that was reset mid-flight) bails out
cleanly instead of mutating a dead state.

If you need a live (not round-tally) indicator — e.g. "orbs currently resting
in your zone" — that's a separate lightweight node (see `ScoringCountNode.ts`)
that polls a closure each `draw()` rather than being pushed state.

## 7. Effects, colors, tuning

**Colors**: pull from `arcadeTheme` (`web/src/displays/arcade/theme.ts`) —
especially `teamA` (`#4a90e2` blue) / `teamB` (`#e24a4a` red) for any two-side
competitive game, plus `surface`/`text`/`accent`/action-button roles. Override
locally via `meta.themeTokens` (applied through `themeScope`) instead of
inventing a new palette.

**`tuning.ts`**: one object per concern, all constants in one file, e.g.
`PLAYER_COLORS`/`TEAM_COLORS`, geometry (prefer fractions of cell/field size
over absolute pixels so layout stays resolution-independent), `PHYSICS`
(friction, restitution, iterations, slop), `ANIM` (every duration, in
seconds, in one place), gesture thresholds, AI difficulty table. Comment
"feel knob" on anything meant to be playtest-tunable.

**Win/celebration effect**: the house style is a self-destructing,
allocation-free particle burst — radial emission with jitter, exponential
velocity damping, scale tied to current/initial speed ratio, self-destruct
once every piece has settled or a hard max-life cap is hit. Don't hand-roll
this anymore; the stargazer particle system covers it natively:

- All-one-shape bursts (e.g. tumbling squares) → a bare `ParticleEmitterNode`
  with `spinRadPerSec`, `scaleBy: 'speed'`, and `minSpeedFrac` set, cleaned up
  via `node.autoDestroy(node.emitter.waitUntilEmpty())`. See Connect Four's
  win burst (`anim.ts`'s `createWinBurst`) for the pattern.
- Mixed-shape bursts (e.g. triangles + line shards) or anything needing
  per-piece vector drawing → subclass `VectorParticleNode`. See Orbo's
  `OrbExplodeNode.ts` or stallwaechter's `DebrisBurstNode.ts`.

**Panel/board rasterization**: for a mostly-static background shape (rounded
panel, board-with-holes), rasterize once to an `OffscreenCanvas` bitmap and
blit it in `draw()` (see `PanelNode.ts`, `BoardNode.ts`) rather than redrawing
vector paths every frame; fall back to a live clipped fill only during
open/close reveal animations.

## 8. Physics (only if the game needs simulation)

Opt in per subtree with `PhysicsWorldBehavior` on a root node — each instance
gets a fully independent `PhysicsWorld`, so a menu-preview backdrop and the
real game can run simultaneous, non-interacting simulations.

```ts
const arena = new Node2D('arena')
arena.addBehavior(
  new PhysicsWorldBehavior({ config: { gravity: { x: 0, y: 0 } } }),
)
arena.add(buildDynamicThing()) // its RigidBodyBehavior resolves to arena's world
```

Bind physics to a visual node with `RigidBodyBehavior`; it writes
`node.transform.x/y/rotation` each `onUpdate` by lerping the fixed-step
`body.prevPosition/rotation` → `body.position/rotation` using
`engine.ticker.fixedAlpha`, so motion renders smoothly independent of the
120Hz fixed-step rate.

Shapes: `circleShape(r)`, `aabbShape(hw, hh)` (stays axis-aligned even if the
body rotates — use `polygonShape` for a box that should turn), `polygonShape(verts)`
(CCW-wound). Mark a collider `sensor: true` for trigger-only detection
(`triggerEnter`/`triggerExit`, never physically resolved). Layers/masks gate
which colliders can interact (`shouldCollide`).

Useful non-integration APIs: `world.raycast(...)`, `world.queryRegion/queryPoint`,
`world.moveAndCollide`/`moveAndSlide` (kinematic movement without touching
velocity), `world.waitForSettle()`/`isAtRest()`/`forceSettle()` (used by both
games to detect "turn is done, orb/piece stopped moving").

Gotchas: `RigidBodyBehavior` throws at `onSceneReady` if it can't resolve a
world (no ancestor `PhysicsWorldBehavior` and no stage-level physics) — enable
physics before adding the behavior. Sensor colliders never resolve physically.
AABB shapes never rotate.

## 9. Effects/animation for a computer opponent (if applicable)

Don't write new search code — Connect Four's AI reuses a shared
`searchBestMove`/`AdversarialGame<Board, Move>` minimax+alpha-beta utility
from `@src/stargazer`. Pattern to copy (`game/ai.ts`):

1. Pure, allocation-light board/state module with in-place `makeMove`/`unmakeMove`
   (mutate + undo on one scratch instance, not per-search-node cloning).
2. A thin adapter object implementing `AdversarialGame` (`moves`, `makeMove`,
   `unmakeMove`, `isTerminal`, `evaluate`).
3. A heuristic `evaluate()` scoring partial progress toward a win, with
   terminal results scored `±(WIN - ply)` so faster wins/slower losses win out.
4. A `tuning.ts` difficulty table, e.g. `{ depth, blunderChance }` per level,
   with an injectable RNG for testable "occasionally play a random legal move."
5. Call the shared `searchBestMove` from the adapter; don't reimplement search.

## 10. Window resizing / responsiveness

Handled at two layers:

- **Shell chrome** (camera framing, launcher/game region split): centralized
  in `ArcadeScreen.svelte` + `world.ts` — `updateLayout(pixelW, pixelH)`,
  `gameView()`/`launcherView()`, `gameVisibleRect`/`launcherVisibleRect`
  (canvas-aspect-adopting visible rects), `coverView(...)` for cover-fit
  backgrounds. A new game does not need to wire this itself.
- **Per-game overlay anchor**: your root component's `resize` handler (see §3)
  repositions the DOM-anchor node and `gameRect`, which cascades to
  `domAnchor`-pinned overlays and rebuilds the menu preview.
- **Gameplay geometry**: neither existing game reflows mid-match. `layout.ts`
  computes zone/board geometry once from `bounds` when a match/session starts;
  a resize during play is deliberately deferred to the next match start. Don't
  try to live-relayout a running board/field — recompute on next `startMatch`.

## 11. How-to-play / tutorial

Contract (`web/src/displays/arcade/tutorial/types.ts`):

```ts
type DemoBuilder = (stage: Stage, host: EngineHost) => DemoHandle // { destroy(): void }
interface TutorialCard {
  title: string
  body: string
  build: DemoBuilder
}
type TutorialSpec = TutorialCard[]
```

Every demo builds against a **fixed 1000×750 world viewport**
(`DEMO_VIEWPORT` in `tutorial/DemoStage.ts`) — lay out against that constant
rect, not the primary canvas size. Reuse the real node/animation code (not the
session/turn machinery) so the tutorial visually matches gameplay — see
`game/demo.ts` in either existing game.

Render via the shared `HowToPlay.svelte`, passing the one arcade-wide
pre-warmed `demoStage` prop (never create your own `DemoStage`). Copy comes
from your own `strings.ts`, not the shared i18n store. Use `FingerHintNode.ts`
for tap/flick gesture cues in demos.

## 12. Splash-screen backdrop animation (`menuPreview.ts`)

Standalone, engine-only animated background shown behind the splash screen —
built/destroyed by the `$effect` in your root component whenever the splash
is visible or the viewport changes. Pattern:

- Own root `Node2D` directly under `host.engine.scene.root`.
- Own isolated `PhysicsWorldBehavior` world if simulation is involved.
- Reuse the real game's constants/scene helpers (tuning, wall builders) but
  not its session/input machinery — script the animation directly.
- Return `{ destroy() }`; the root component calls this before rebuilding.

### Backdrops that draw outside their rect

Both regions live in ONE world, a band of sky apart. A backdrop drawn past its
own rect does not disappear, it appears in the launcher's view: content hanging
into the launcher from above, popping in and out as the cull rect catches it.
Nothing about being "off screen" for the game camera makes it off screen for the
launcher camera.

Drawing past the rect is often the right call, so there are two ways to keep it:

- **Stay inside the budget.** The sky band carries
  `PREVIEW_BLEED_BUDGET_FRAC` of the cover height for exactly this. Express your
  over-draw as a fraction of the height you map onto, export it, and assert it
  against the budget in a test, so the failure lands on your constant rather
  than on the launcher.
- **Crop.** Past the budget, clip. `gfx.setClip` is analytic and needs no
  texture, but it applies to the draws of the node that sets it, NOT to
  descendants: there is no subtree clip. So this only works where one node draws
  the whole backdrop, wrapping its draw in `save` / `setClip` / `restore`. A
  backdrop made of many independent nodes has to use the budget instead.

Two related traps if elements are staged off the rect before drifting in:

- Derive the staging distance and the despawn margin from the SAME constant. Two
  separate numbers drift, and if the staging band ends up outside the despawn
  margin, every element is culled the frame after it spawns: one drawn frame,
  entrance animation and all, out where it should not be visible at all.
- Measure the over-draw from the outermost thing drawn, not the element's own
  radius. A spawn burst emitting on a ring around the element reaches further
  out than the element does.

## 13. i18n

Each game owns a flat `strings.ts`:

```ts
export const GAME_STRINGS = { title: '...', loading: '...', modes: {...}, pause: {...}, tutorial: {...} } as const
```

Imported directly by the game's Svelte components — games do **not** use the
shared arcade `t`/i18n store (`i18n/en.ts`, `i18n/types.ts`); that store is
reserved for shell-level chrome copy (launcher, escape hatch, tutorial modal
frame). This keeps each game self-contained.

## 14. Reference implementations

- `web/src/displays/arcade/games/orbo/` — continuous-physics game (flick,
  scoring bands, gesture-driven pause, particle explosions). Best reference
  for anything involving `RigidBodyBehavior`/`PhysicsWorldBehavior`.
- `web/src/displays/arcade/games/connect-four/` — turn-based board game with
  an AI opponent, no physics simulation. Best reference for `session.ts`
  state-machine shape, AI adapters, and board-geometry `layout.ts`.
- `web/src/displays/arcade/games/GameModule.ts` — the contract.
- `web/src/displays/arcade/ArcadeScreen.svelte`, `world.ts` — shell state
  machine, camera regions, centralized resize.
- `web/src/displays/arcade/menu/`, `web/src/displays/arcade/tutorial/`,
  `web/src/displays/arcade/theme.ts` — shared UI infra to reuse, not rebuild.
