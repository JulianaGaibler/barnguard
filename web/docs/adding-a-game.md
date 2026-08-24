# Adding a game to the arcade

Orientation for a developer implementing a new arcade game. It covers the render
engine, the arcade shell, the conventions every game follows, the pieces a game can
opt into, and the house writing style. It is a map, not a reference: every section
points at the real files, and those are the authority.

## First rule: look before you build

Almost everything a game needs already exists. Before writing a component,
a helper or a node, search for it. The pieces that get rebuilt most often by
mistake:

| You want                                             | Use                                                                  |
| ---------------------------------------------------- | -------------------------------------------------------------------- |
| A title screen with a button stack                   | `src/displays/arcade/menu/MenuScreen.svelte`                         |
| A how-to-play screen                                 | `src/displays/arcade/tutorial/HowToPlay.svelte` + a `TutorialSpec`   |
| A pause menu                                         | `src/displays/arcade/menu/PauseMenu.svelte`                          |
| A game-over card with a high-score flow              | `src/displays/arcade/leaderboard/GameOverPanel.svelte`               |
| A two-player result with two name entries            | `src/displays/arcade/leaderboard/GameOverVersusPanel.svelte`         |
| A leaderboard view                                   | `src/displays/arcade/leaderboard/LeaderboardModal.svelte`            |
| A button, card, overlay, counter, on-screen keyboard | `src/core/ui/`                                                       |
| A backdrop behind your board                         | `common/GradientBackgroundNode.ts` or `common/FlatBackgroundNode.ts` |
| Text measurement, wrapping, fitting                  | `src/stargazer` text helpers, all memoized                           |
| Layout of boxes and rows                             | The layout system, opt-in per root                                   |
| Tweening, waiting, sequencing                        | `node.tween`, `engine.wait`, `Timeline`                              |
| An adversarial search for an AI opponent             | `src/stargazer/ai/minimax.ts`                                        |
| A color palette applied to your DOM chrome           | `GameMeta.themeTokens` + `themeScope`                                |
| A font stack for canvas and DOM                      | `src/core/theme/fonts.ts`                                            |
| Score persistence                                    | The leaderboard and game-log clients                                 |
| A seeded random generator                            | `src/displays/arcade/games/common/rng.ts`                            |
| The region rect, its anchor node, resize             | `GameProps.region`                                                   |
| A write that must survive a forced exit              | `registerExitTask` in `src/displays/arcade/exitTasks.ts`             |

If a shared component almost fits, extend it or add a prop rather than forking it.
Two of the shared components exist because a game generalized its own version.

The habit that matters most: read a neighbouring game's directory before starting.
The file layout, the naming and the split between pure logic and scene nodes are
conventions, and following them is what makes your game testable and reviewable.

---

## The engine: stargazer

`src/stargazer/` is a 2D-first retained-mode scene graph with an immediate-mode
drawing facade, plus an optional depth-tested 3D pass. Import from
`@src/stargazer` only. Internal subpaths are not public API.

Two GPU backends sit behind one device seam, WebGPU and WebGL2, with no canvas-2D
fallback. `'auto'` probes WebGPU and falls back. You do not pick a backend. The
arcade already handles selection and context-loss recovery, and `?gfx=` overrides it.

### How a frame runs

`EngineHost` owns the page lifecycle and wraps `Engine`, which owns a primary
`Stage` (canvas, renderer, scene tree, cameras). Per frame, in order:
before-frame handlers, pointer reprojection, animation tick, the update walk
(`node.onUpdate` then each behavior's), the layout pass for dirty roots, transform
propagation, then rendering (3D passes, then the `static`, `above-static` and
`dynamic` 2D layers, then post-processing), then a `frame` event.

There is a fixed timestep alongside that, default 120 Hz, with an accumulator and a
per-frame cap. Physics worlds step first, then `onFixedStep` on nodes and behaviors.
Render `dt` is clamped and smoothed by default. Put anything that must be
framerate-independent in `onFixedStep`, and read `ticker.fixedAlpha` if you need to
interpolate between steps.

The three render layers are draw order only, not caching. You can mutate any of
them on any frame.

### The pieces you'll actually touch

Scene graph. `Node` is the non-spatial base (children, behaviors, events, an
`abortSignal`), and `Node2D` adds a transform. `destroy()` is idempotent, cascades
bottom-up and aborts the signal, which is what makes async work safe. Composition
is by `Behavior` subclasses (`onUpdate`, `onFixedStep`, pointer handlers) attached
to nodes. There is no prefab type: the unit of reuse is a builder function that
returns a subtree.

Drawable nodes: `ShapeNode` (circle or rect, with radii), `Path2DNode`,
`PolylineNode`, `TextNode`, `ParticleEmitterNode`, `VectorParticleNode`, and the
3D `MeshNode`. There is no sprite node. Images go through `gfx.drawImage` inside a
custom `draw`.

Immediate mode. Override `draw(gfx, camera, dt)` on a `Node2D` subclass. The layer
walker installs the combined device, camera and world transform plus the node's
alpha before calling you, so you draw in local coordinates. `Gfx2D` has fills
(`fillRect`, `fillRoundRect`, `fillCircle`, `fillConvexPoly`, `fillPath2D`, several
gradient fills), strokes (`strokeLine`, `strokeCircle`, `strokePolyline`,
`strokeRoundRect`, `strokeQuadratic`, `strokePath2D`), `drawImage`, `fillText`,
`warmText`, and state calls (`save`/`restore`, `translate`/`rotate`/`scale`,
`setAlpha`, `setBlend`, `setClip`, `setClipMask`). Style is passed per call, so there
is no sticky state.

Transforms are decomposed affine: `x`, `y`, `scaleX`, `scaleY`, `rotation`,
`originX`, `originY`, `alpha`. `transform.world` is filled by the propagation pass.
Math helpers (`Vec2`, `Rect`, `Mat3`, and the rest) are destination-first and
allocation-free.

Cameras are scene nodes and are never created for you. Add one and call
`makeCurrent()`. Rect framing (`setViewport`, `animateTo`) composes with the node
transform, so zoom and pan are separable. Useful queries: `worldToScreen`,
`screenToWorld`, `visibleWorldRect`, `screenPxPerWorldUnit`, `strokeSpaceScale`.
In the arcade the camera is shared and leased, so read the arcade section before
touching it.

### Input

Pointer only. The engine has no keyboard and no gamepad subsystem, so a game
needing keys owns those listeners itself. Three ways in:

- Poll `stage.input.pointers`, a map of snapshots with `screen` and `world`
  positions. `world` is reprojected every frame through the active camera, and
  synthetic moves are emitted when the camera drifts under a still finger.
- Subscribe to `pointerDown` / `pointerMove` / `pointerUp` / `pointerCancel` on
  `stage.events`. The primary stage forwards those four to `engine.events`.
- Per node: set `hitEnabled = true` and use `node.bindPointer({ down, move, up,
cancel, singlePointer })`, which returns an unbind. Or subclass
  `PointerBehavior` and return handlers from `handlers()` for automatic
  bind and unbind.

On pointer down the system captures the pointer on the canvas and walks painter
order back to front, so a finger sliding off the bezel keeps producing events and
two fingers can drive two different nodes. Touch slop defaults to 30 CSS px.
Destroying a captured node fires a synthetic cancel.

Above that sit `bindRegionGesture(engine, opts)` for a whole board region (with an
`onReject` hook for taps outside it), `ButtonBehavior` and `DraggableBehavior`.
There is no action or binding abstraction.

### Text

No SDF. Glyphs are shaped and rasterized by the platform Canvas 2D engine, then
uploaded as a bitmap and drawn as a textured quad, which is why kerning,
ligatures, complex scripts and color emoji all work. Color is baked into the
bitmap, not tinted in a shader.

Either `gfx.fillText(text, x, y, style)` in a `draw`, or a `TextNode` in the tree.
Labels are cached by text, font, alignment, color and a scale bucket, shelf-packed
into a 2048-square page under an LRU. Measurement and layout helpers are memoized:
`measureText`, `textWidth`, `textAdvance`, `wrapText`, `ellipsize`, `fitFontSize`,
`fitTextBlock`, and rich-text variants.

Gotchas the guide spells out. One line per `fillText`, no wrapping and no stroke.
Animating `color` re-rasterizes every frame it changes, while alpha is free.
`textWidth` (bitmap box) is not `textAdvance` (pen step), so stepping runs by width
leaves gaps. `baseline: 'middle'` centers the em box, not the cap height. And there
are no mipmaps, so a world-space label zoomed far out softens.

The webfont trap is worth internalizing: caches are keyed by the font _string_, not
by load state, so text drawn before its face arrives is both mis-styled and
mis-measured. The booth already handles this (`preloadFonts()` before mount and
`invalidateTextOnFontLoad(engine)`), but it is why fonts are gated at boot.

### Layout

Opt-in, Flutter-style constraints-down and sizes-up, single measure pass. Nothing
runs until you add a `LayoutRoot`, whose default bounds are the camera's visible
world rect, so content tracks the canvas on resize.

```ts
const root = new LayoutRoot({ camera })
root.setContent(new Column({ children: [...] }))
engine.tree.root.add(root)
```

Available: `Box`, `SizedBox`, `Padding`, `Align`, `Center`, `Flex` / `Row` /
`Column` with `Flexible` / `Expanded` / `Spacer`, `Stack`, `Scaffold`,
`AspectRatio`, `LayoutBuilder`. Custom nodes implement `Measurable`.

Two that bite: `SizedBox` requires both `width` and `height`, so use `Box` to fix
one axis and let the other shrink-wrap. `Row` and `Column` take a `gap`, so a
spacer child is rarely what you want, and `AspectRatio` already centres itself
inside the space it is offered.

Limits worth knowing before you commit: flex needs a bounded main axis, layout does
not measure text (wrap labels in a `SizedBox`), and there is no intrinsic sizing,
scrolling or clipping. Mutate through `add` / `insert` / `remove` / `setChildren`
rather than rebuilding a subtree, and animate transforms rather than layout sizes.

### Animation

`engine.tween(target, to, opts)`, `engine.wait(sec, signal)`, and the node-scoped
`node.tween(toTransform, opts)` / `node.tweenTo(target, to, opts)` / `node.wait(sec)`,
which auto-scope to the node's `abortSignal` and therefore cancel on destroy.
`node.play` / `playTo` are the fire-and-forget forms. A `key` in the options gives
self-cancelling restarts. `Timeline` (`add`, `parallel`, `run`) handles linear
choreography, and `AbortScope` (`node.scope()`) handles re-abortable async epochs.
Tweens run in engine time, so they freeze with the ticker. Easings live in the
`easings` namespace, and any `(t) => number` works.

Abort discipline matters: use `ignoreAbort` / `isAbortError` around awaited
sequences so a mid-animation teardown does not surface as an error.

### Physics

An opt-in 2D impulse-solver rigid body engine with no external dependency. Circle,
AABB and convex-polygon collision with rotation and friction. Static, dynamic and
kinematic bodies, forces and impulses, sensors and collision events, raycasts and
region queries, `moveAndSlide` sub-stepped kinematic sweeps, and sleeping. The broad
phase upgrades from brute force to a spatial hash above roughly 64 bodies.

`RigidBodyBehavior` mirrors bodies onto node transforms, interpolated by
`fixedAlpha`. Reach for physics when you need contact response, stacking, bouncing
or sweeps. For scripted motion, a behavior with `onUpdate` or a tween is cheaper
and far more controllable. Determinism is same-build only, and `maxLinearSpeed` is
a guard rather than continuous collision detection, so thin fast projectiles can
tunnel.

### The rest, in one line each

Post-processing: `engine.postProcess`, lazily created, free while empty. Built-ins
are `Vignette`, `ChromaticAberration` and `VignetteBlur`. A custom effect is a WGSL
module plus a `writeParams` callback.

Particles: a baked/sprite system (`ParticleEmitter` + `ParticleEmitterNode`) with
a pre-allocated pool and allocation-free per-frame work, and `VectorParticleNode`
as an abstract base for heterogeneous per-piece shapes. Reach for the baked one
first.

3D: `Node3D`, `MeshNode`, `CameraNode3D` with a continuous ortho-to-perspective
blend, a light family with shadows, glTF loading, fog, and `Viewport2DNode` for 2D
on a quad in 3D. All 3D renders behind all 2D. No game uses it yet.

Ambient occlusion: `engine.ambientOcclusion.enabled = true` plus a preset. Screen
space, from the 3D pass, so it is only relevant with 3D content.

Accessibility: entirely opt-in. `engine.a11y.attach(node, semantics)` or the
chainable `node.a11y({...})` mirrors nodes into a hidden screen-reader-readable DOM
tree, and unregistered nodes collapse out. Composite roles become a single tab stop
with arrow-key roving. `announce()` for live regions, `setInert()` for modals.

Secondary stages: `engine.attachStage(canvas, opts)` gives another canvas its own
renderer, scene, camera and (with `interactive: true`) input, sharing the ticker.

### DOM overlays

`engine.dom.attach(node, element, opts)`, or in Svelte
`use:domAnchor={{ engine, node, size }}`. Before the transform, one CSS pixel is
one world unit and the element's top-left is the node's local origin. Pass `size`
in world units for rect mode, where the element overlays the node's rect and the
camera scale sizes it through a CSS transform, so text stays crisp under zoom.
`cull: true` hides the element once its rect leaves the canvas, which is what turns
a camera pan into a whole view transition.

The overlay container must have the same bounding rect as the canvas with no
padding or border, be `pointer-events: none`, and have interactive children opt
back in. The engine writes only the transform, never reparents, and layering
follows DOM order rather than scene depth.

Use DOM for text-heavy or form-like UI: menus, pause screens, name entry, anything
wanting native focus, IME or accessibility for free. Draw in-engine for anything
that must batch with the scene, sit between layers, obey the analytic clip, or be
affected by post-processing.

### Performance

What is fast by construction: one command list and one submit per frame, with
batches flushing only on program, texture or blend change, or a layer boundary.
Alpha, color and transform changes fold into per-instance data and never flush.
Shapes are anti-aliased analytically in local space, so they stay crisp under any
transform. Particle sprites and text labels live in atlases so a screen of distinct
labels is one batch. Vertex streams are ring-buffered and double-buffered. Math and
pooling APIs are allocation-free by design. Post-processing, ambient occlusion,
accessibility, DOM sync, layout and physics all cost nothing until touched.

What to watch:

- Set `debugBounds` on anything expensive. Viewport culling skips a node whose
  world AABB leaves the visible rect, but a node without bounds always draws.
- Do not animate text color. It re-rasterizes and re-uploads the label every frame
  the value changes. Animate alpha instead, which rides the quad tint.
- `mixColor` and `withAlpha` return strings, so they allocate. Fine for values you
  compute once, wrong per-object per-frame. To cross-fade many things, draw the old
  color and then the new one under `setAlpha`: same result, no allocation, and
  alpha folds into the instance data without a flush.
- A shape drawn in more than one pass must not be translucent. Each pass blends
  separately, so wherever they overlap (the joint of a two-stroke chevron, the
  crossing of a plus built from two bars) the overlap blends twice and shows as a
  darker patch. Precompute the blend instead: `mixColor(background, ink, amount)`
  once at module load gives an opaque color that looks the same with nothing to
  double-blend. For the same reason, animate such a shape in by scaling it rather
  than fading it.
- Warm text before the first paint of a text-heavy scene. `gfx.warmText` moves the
  shape and upload cost off the first frame, but only after fonts have settled and
  only under the transform the text will be drawn with.
- Prefer screen-space labels for HUD. World-space labels re-rasterize a step at a
  time through zoom.
- Register a tessellation for any `Path2D` you fill or stroke. Without one the call
  silently no-ops and increments a counter in the debug HUD. For a large,
  long-lived path, register it as retained geometry so it uploads once and draws
  with a per-frame model matrix instead of being CPU-transformed every frame.
- Tween transforms, not layout sizes, and mutate layout subtrees rather than
  rebuilding them (rebuilding discards node instances and their running tweens).
- Do not bind a Svelte store to the `frame` or `pointerMove` event. Use
  `emitter.on` inside a `$effect`.
- Keep secondary stages cheap. They share the ticker and walk their own trees.
- Vertex stream overflow forces an extra flush and shows up as `overflowWarns` in
  the HUD, alongside label cache statistics. Page wipes are the expensive failure
  mode: one wipe re-rasterizes every label in the scene in a single frame.

`?debug=perf` wraps every node's update and draw in `performance` marks.
`engine.lastFrameWorkSec` is CPU work per frame, not the vsync interval.

### Where to learn more

Guides live in `src/stargazer/docs/guides/`. Read them in roughly this order:
`setup`, `architecture`, `scene`, `drawing`, `input`, `animation`, `camera`, `text`,
`layout`, then `assets`, `debugging`, `stages`, `particles`, `vector-particles`,
`physics`, `html-overlays`, `accessibility`, `post-processing`,
`ambient-occlusion`, `3d`, `ai` as needed.

`src/stargazer/README.md` is the overview, and `npm run docs:stargazer` builds the
typedoc reference into `src/stargazer/site/`, which is gitignored, so run it
locally when you want the browsable version. The barrel
files in `src/stargazer/modules/` are a good map of the public surface.

Runnable demos are in `src/stargazer/dev/`, registered in `dev/demos.ts`, reachable
as `?demo=<name>`: `loop`, `scene`, `input`, `anim`, `particles`, `camera`,
`stages`, and several 3D ones. `dev/demo-scene.ts` is the shortest end-to-end read.
About 120 colocated `*.test.ts` files serve as specs.

The debug HUD (`?debug=hud`, or `Y`) has scene tree, rendering, physics and input
panels.

If a guide and the code disagree, trust the code and fix the guide in the same pass.

Shaders: WGSL is the source of truth, and GLSL is generated by
`npm run gen:shaders`. Never hand-edit a `*.gen.*.glsl`.

---

## The arcade shell

The arcade is one of several displays. `src/displayRegistry.ts` maps `?display=<id>`
to a lazy `DisplayManifest` factory, `src/main.ts` resolves it, applies the theme,
registers locales, preloads fonts and mounts `App.svelte`. The arcade's manifest is
`src/displays/arcade/index.ts` and its root component is
`src/displays/arcade/ArcadeScreen.svelte`.

The world is two stacked 16:9 regions that one shared camera pans between
(`src/displays/arcade/world.ts`): the launcher below, the game region above, with a
sky gradient spanning both. There is no timed attract loop. The launcher _is_ the
idle state, and its ambience is a live sky that tracks the real sun over the booth
(`src/displays/arcade/background/`).

### Idle reset

The booth is public and unattended, so the arcade puts itself back after a
visitor walks off. Ten minutes without input anywhere on the screen returns it
to its opening state: a running game is quit, and the launcher comes back with
no filters and the Game of the Day at the left. The last thirty seconds show a
notice with a draining ring, which any touch cancels.

Two pieces: `src/core/activity.ts` holds the time since the last input (window
listeners at capture phase, since half of what a visitor touches is DOM overlays
the engine never sees), and `src/displays/arcade/idle.ts` holds the arcade's
timings. `ArcadeScreen` drives it and renders `IdleNotice.svelte`.

A shorter clock runs on the launcher's own state. Its filters and carousel
offset live in `launcher/browseState.svelte.ts` rather than in the component, so
someone shopping for a game can try one, back out, and still have their
shortlist. That state clears itself once a game has run for a minute, on the
grounds that whoever set it has settled in and the next person at the booth is
someone else.

What this means for a game: nothing, as long as anything a player can leave
behind reaches the server before teardown. See [Leaderboard](#leaderboard) for
the hook that guarantees that.

### Registering a game

Two files, and no auto-discovery:

1. Create `src/displays/arcade/games/<kebab-id>/meta.ts` exporting a `GameModule`
   as `<camelId>Module`.
2. Add it to the `GAMES` array in `src/displays/arcade/games/registry.ts`.

The array's order is the launcher's order, with one exception: each day one game
is pulled to the front and badged "Game of the Day". The pick walks the array,
one step per day, so a new entry joins the rotation on its own. See
`src/displays/arcade/launcher/gameOfTheDay.ts`.

The contract is `src/displays/arcade/games/GameModule.ts`:

```ts
export interface GameModule {
  meta: GameMeta
  component: Component<GameProps>
  renderLabelForRecord?(
    record: GameRecord,
    ctx: LabelRenderContext,
  ): Promise<Blob>
  renderPreviewLabel?(ctx: PreviewLabelContext): Promise<Blob>
}
```

`GameMeta` carries `id`, `title`, `description`, `playerCounts`, `thumbColor`,
`thumbImage?`, `themeTokens?`, `fontTokens?`, `leaderboards?`,
`supportsAi?`. Read the doc comments in that file before filling it in. Two things
worth knowing up front:

- `id` is the game-log `gameId` and the print-dispatch key. Pick it once,
  kebab-case. It is conventionally also the leaderboard key, but the boards are
  declared separately (see below).
- `playerCounts` is a set, not a range. `[2, 4]` renders as "2 or 4".
- `title` and `description` are literal strings on the module, not i18n keys.
- `supportsAi` only adds a launcher filter chip. Driving an opponent is your code.
- The launcher's leaderboard and AI chips exclude each other, because no game
  today does both. A game that ranks and plays against the machine makes that
  rule wrong, so drop it from `launcher/browseState.svelte.ts` when you add one.

### Lifecycle

`ArcadeScreen` mounts your component into the game region while the camera is still
on the launcher, then pans. It passes `GameProps`:

```ts
export interface GameProps {
  host: EngineHost // already started, background attached
  onExit: () => void // hand control back; arcade pans away and unmounts
  demoStage: DemoStageController | null // shared pre-warmed tutorial stage, null without WebGL2
  camera: ArcadeCamera // camera lease scoped to your region; most games ignore it
  region: GameRegion // your anchor node, visible rect and booth-corner inset
}
```

`region` (`src/displays/arcade/games/gameRegion.svelte.ts`) is the shell's
answer to geometry every game used to recompute:

```ts
region.anchor // Node2D at the region's top-left, already in the tree
region.rect // visible world rect at the current canvas aspect
region.cornerInset // world depth the booth's corner gesture reserves
region.cssPxInWorld // world units per canvas CSS pixel
region.onResize((rect) => ...) // relayout, region already up to date
```

Pin your overlays to `region.anchor` with `domAnchor`, size them to
`region.rect`, and relayout from `region.onResize`. Do not create your own
anchor node, subscribe to the engine's `resize`, or call `gameVisibleRect`.

There is no engine-owned score or game-over channel. The shell knows only
`onExit`. The convention every game follows:

- `onMount` calls your own async `startGame(host, region.rect, ...)` and
  subscribes to `region.onResize` for relayout.
- `startGame` returns a session object: `readonly events: Emitter<GameEvents>`,
  read-only state getters, imperative methods, and `destroy()`. The shape is a
  per-game convention, not a shared interface.
- The component subscribes to session events (`gameOver`, `roundOver`, `paused`,
  ...) and drives local `$state` for its overlays.
- Teardown is the `onMount` cleanup: unsubscribe and `session.destroy()`. The
  region's anchor belongs to the shell, so leave it alone. Guard the async start
  so a session resolving after unmount destroys itself immediately.

On exit the arcade force-resumes the engine (a paused engine would stall the camera
tween), releases the camera lease, runs the exit barrier, pans back, then unmounts.
`ArcadeCamera.release()` makes later framing calls no-op and settles pending
`animateTo` promises, so an awaited zoom cannot hang teardown.

The exit barrier is `src/displays/arcade/exitTasks.ts`. Anything that has to
reach the server before the game goes away registers there:

```ts
onMount(() => registerExitTask(saveIfNeeded))
```

`ArcadeScreen` starts every registered task alongside the camera pan and waits
for them, capped at three seconds. The shared game-over panels already do this,
so most games never touch it. Reach for it directly if your game holds anything
else a player can walk away from mid-edit.

### Directory layout

```
src/displays/arcade/games/<kebab-id>/
  meta.ts                  # the GameModule, the registry entry
  <PascalName>Game.svelte  # Component<GameProps>: wires session events to overlays
  strings.ts               # all copy, one frozen `as const` object
  fonts.ts                 # <NAME>_FONT_TOKENS + resolveFonts(...)
  tutorial.ts              # TutorialSpec
  assets/                  # thumb.png, art (import with ?url / ?raw)
  game/                    # the engine layer, no Svelte in here
    index.ts               # barrel; components import from './game', never deeper
    session.ts             # startGame(), events, state machine
    tuning.ts              # COLORS / RULES / ANIM feel knobs
    nodes/*Node.ts         # drawable Node2D subclasses
    *.test.ts              # colocated vitest specs
  overlays/                # SplashScreen, GameOver
```

Keep rules, scoring and layout in pure modules under `game/`, out of `*Node.ts` and
out of Svelte. That separation is what makes them testable, and every game that has
tests got them that way. `@src` is aliased to `src/`.

### Input

The hardware is a large touchscreen. There is no gamepad, joystick or button panel
anywhere in the tree, and the viewport is locked against pinch-zoom. Keyboard
handling exists only for a technician's keyboard and the on-screen keyboard.

Four idioms, all in use:

- Set `node.hitEnabled = true` and assign `onPointerDown` / `onPointerMove` /
  `onPointerUp`.
- Subclass `PointerBehavior` for drag-to-draw or tap-to-select behaviors.
- `ButtonBehavior` / `DraggableBehavior` for canvas buttons and draggable pieces.
- `bindRegionGesture(engine, opts)` from `src/stargazer/input/RegionGesture.ts` for
  a whole board region. Its `onReject` hook is the documented way to do
  "tap outside the board opens the menu".

DOM overlays use ordinary Svelte handlers. Overlay wrappers are
`pointer-events: none` with individual controls opting back in.

Three global gestures your game must not fight:

- Corner double-tap (top-left / top-right, 96 px) opens the attendant booth menu.
  It listens at capture phase and swallows the tap, so canvas handlers never see it.
- A swipe down from the middle third of the top 5% of the viewport reveals the
  return-to-launcher pill. The top corners are deliberately left free, which is
  where a game's own chrome (a pause button, say) belongs.
  Its listeners are passive, so a game cannot suppress it.
- Ten minutes without input quits the game and resets the launcher, with a
  thirty-second notice first. Nothing to wire up, but see the exit barrier under
  [Lifecycle](#lifecycle).
- Text entry never assumes a physical keyboard. Use
  `src/core/ui/OnScreenKeyboardField.svelte`.

### Coordinate space and scaling

Each region is 1920 × 1080 (`REGION_WIDTH` / `REGION_HEIGHT` in `world.ts`), fitted
aspect-preserving. On a non-16:9 canvas that reveals extra world, so do not hardcode
16:9. `region.rect` is the world rect actually visible at the current canvas aspect,
and that is the arcade's responsive coordinate space: size your overlay to it and
re-fit on `region.onResize`.

DOM UI scale is a single `--ui-scale` custom property times a `clamp()` root font
size (`src/core/ui/uiScale.ts`), tuned by the attendant. Every token is rem, so
size overlay chrome in rem or the `--space-*` tokens. Never in px.

---

## What every game has

### A distinct palette

A game declares a partial `ThemePalette` (`src/core/theme/types.ts`) on
`GameMeta.themeTokens`. `ArcadeScreen` applies it with the `themeScope` action to a
`display: contents` wrapper around your component, writing each role as a
`--color-*` custom property. All 30 roles are optional and every one has a neutral
default in `src/styles/scale.sass`, so nothing is ever undefined.

Roles group into surfaces (`surface`, `surfaceCard`, `surfaceInverse`, `scrim`),
text (`text`, `textSecondary`, `textAccent`, `textLink`, `textInverse`, `title`),
`border` / `accent`, `teamA` / `teamB`, ten action roles (primary and secondary,
each with fill, text, hover, active, disabled), `inputBg`, two shadows,
`appBackdrop`, and two decorative gradients.

Two things that matter in practice:

- `applyPalette` only ever sets, never removes. A partial override leaves the
  shell's values in place, which means the wrong card shadow and accent on your
  board. Override the roles you care about deliberately.
- Seed the palette from the same constants your canvas reads, usually a `COLORS`
  object in `game/tuning.ts` or a dedicated `palette.ts`. The canvas is a sibling
  of the scoped container and cannot read custom properties back, so one constant
  feeding both surfaces is the only way chrome and board stay in sync. Helpers:
  `withAlpha`, `mixColor`, `parseColor` from `@src/stargazer`.

Nothing enforces that two games look different, and `thumbColor` is the one
required per-game color. Contrast _is_ enforced for the display-level palettes in
`src/displays/arcade/theme.test.ts` (`AA = 4.5`, `AA_LARGE = 3`). Copy that file if
you want the same guarantee for yours. `src/displays/arcade/background/palette.ts`
exports `relativeLuminance` and `prefersDarkInk` for runtime decisions.

### A backdrop

The shared sky spans both regions, so your game must paint over it inside its own
region. Two nodes in `src/displays/arcade/games/common/` do it, sharing one
contract: a world rect, region-pinned so it scrolls in with the game instead of
covering the launcher mid-pan, with `setRect` to refit on resize. Add one as the
first child of your scene root.

- `GradientBackgroundNode` takes two corner colors and fills a diagonal gradient
  between them. Six games use it.
- `FlatBackgroundNode` takes one color and fills a rect. Reach for it when the
  backdrop is a solid, rather than passing the gradient two identical stops.

Hand-roll a backdrop node only if you zoom the camera, in which case you need to
fill `camera.visibleWorldRect()` every frame. Data Control is the one game that
does, and it pins its bottom edge to the region so the launcher below stays
uncovered.

`src/core/ui/BackgroundLayer.svelte` is the app-level DOM backdrop and is
display-level, not game-level. A game does not touch it.

### Fonts

Faces are declared in `src/styles/fonts.scss` and gated at boot by
`src/core/fonts/index.ts`, which awaits `preloadFonts()` before mount because the
engine caches rasterized text keyed by the font string.

There are exactly two themeable roles, `text` and `heading`
(`ThemeFonts` in `src/core/theme/fonts.ts`), and values are full CSS family stacks.
`src/core/theme/fonts.ts` also exports `FAMILIES` and `FONT_CATALOGUE`, 11 shipped
families tagged `body` / `display` / `mono`. Pick from the catalogue. A new face
has to fit an 820 KB budget enforced by test and needs a license file, so reach for
an existing family first.

The enforced convention is a `fonts.ts` per game:

```ts
export const MYGAME_FONT_TOKENS: ThemeFonts = {
  heading: FAMILIES.bungee,
  text: FAMILIES.mozillaText,
}
/** Resolved for `fontFor` inside the game's scene nodes. */
export const MYGAME_FONTS = resolveFonts(MYGAME_FONT_TOKENS)
```

Point `GameMeta.fontTokens` at the tokens for your DOM overlays, and use
`fontFor(fonts, role, weight, sizePx)` / `fontWith(stack, weight, sizePx)` in
canvas nodes. Both surfaces must resolve from the same constant. `fontWith` snaps
weights the family does not ship, warns once in dev, and quantizes the size so the
label cache key stays stable.

For DOM type, use `@include tint.type-class(<key>)` from
`src/styles/typography.scss` (`title-1`, `body`, `ui-small-bold`, `score`,
`card-title`, `display`, and others). SASS tokens are auto-prepended under the
`tint` namespace, so no `@use` in a component style block.

`src/core/theme/fonts.test.ts` scans `games/*/fonts.ts` from disk, so your game is
font-checked the moment the file exists. `?fonts` boots a specimen page.

### Copy

Copy about your game goes in a `strings.ts` as one frozen `as const` object,
imported directly (`import { MYGAME_STRINGS as t } from './strings'`). Copy about
the arcade shell does not: Paused, Resume, Quit to menu, How to play, Return to
Launcher, Leaderboard and Play again all live in `$t.arcade.*`
(`import { t as arcadeT } from '@src/displays/arcade/i18n'`), so every game says
them the same way. The arcade ships English only. The wider app has German and
English core locales.

This diverges from the top-level `web/README.md`, which describes the `$t.*` rule.
That rule holds for the arcade shell, not for game-local copy.

### The four screens

Shared components exist for all of them. Build config over them, not replacements.

Menu. `src/displays/arcade/menu/MenuScreen.svelte` is a left rail with the game
title, an optional running score, and a navigable button stack
(`MenuItem = MenuAction | MenuSubmenu`, with submenus swapping in place and getting
an auto Back button). Submenus are one level deep: `MenuSubmenu.items` is
`MenuAction[]`, so a game needing two axes of choice has to make one of them the
top-level list. The rail is capped at 42% width because the right side of the
region is reserved for an in-engine preview, conventionally
`game/menuPreview.ts` exporting `buildMyGameMenuPreview(host, view): MenuPreview`,
built while the menu is up and destroyed when it leaves.

Your `overlays/SplashScreen.svelte` should be thin config over it. The item order
every game uses: mode or player-count buttons (`variant: 'primary'`), then
`How to Play` (`variant: 'surface'`), then `Return to Launcher`
(`variant: 'surface'`, `icon: RobotIcon`) calling `onExit`.

Tutorial. `src/displays/arcade/tutorial/HowToPlay.svelte` takes
`{ cards, demoStage, onClose }` and renders a center-snapping card carousel tuned
for touch. You supply a `TutorialSpec`, an array of
`{ title, body, build: DemoBuilder }`, from `tutorial.ts`. Cards are animated
in-engine demos rather than static diagrams, ordered in play order: controls,
then the goal, then the failure state, then scoring. An action game needs three
or four. A game with a real ruleset needs one idea per card and more of them,
since somebody standing at a booth will swipe through small cards long before
reading dense ones. Where two ideas are really one, let them share a card:
Monsters, Int puts staying on the same card as hitting, because neither means
anything without the other. Where the goal is not
obvious, state it before the controls: a player who knows what they are
collecting understands a button the moment they see it.
`FingerHintNode.ts` is the shared pointer-gesture illustration. Demo builders read
the viewport as `stage.currentCamera2D.viewport`, not the renderer pixel size.

A demo can be 3D, and needs nothing from the stage to be. `Stage.render` reads
`SceneTree.has3D` every frame, attaches depth and builds a `MeshRenderer` the
moment a `Node3D` appears, and releases both when the last one goes, so a builder
adds its own `CameraNode3D` and is otherwise ordinary. Two things to know.
Geometry and textures are plain data rather than device handles, so a demo shares
the game's own meshes and card art rather than copying them. And fog lives on the
engine, not the stage, so a demo that reuses a game's fog node hazes the game
behind the modal. Monsters, Int's `game/demo.ts` is the worked example: it builds
the real table furniture and runs the real rules over a hand-stacked deck, so a
rule change cannot leave the tutorial explaining something the game no longer
does.

`demoStage` can be `null`. Hide the affordance rather than degrading it: pass
`onHowToPlay={demoStage ? () => (showTutorial = true) : undefined}` and only push
the menu item when that prop exists. Mount the modal as a sibling of your
`domAnchor` wrapper, not inside it, so its canvas renders at true resolution.

Pause. `src/displays/arcade/menu/PauseMenu.svelte` is the shared modal: a scrim,
a card, Resume and Quit. Its copy comes from `$t.arcade.pause`, so a game usually
mounts it with nothing but the two callbacks. Three optional props cover the
variations in use: `detail` is a snippet between the title and the buttons (a
match score), `extra` is a snippet on its own row below them for a way out that
is neither resume nor quit (Monsters, Int offers to score the match where it
stands), and `progress` is a 0-to-1 reveal for a menu the player drags open,
which stays non-interactive short of 1 so the gesture keeps reaching the canvas.
Pausing itself is `host.engine.setPaused(...)`.

Game over. `src/displays/arcade/leaderboard/GameOverPanel.svelte` is the shared
end-of-run shell for a scored run. You pass `display`, `score`, `onPlayAgain`,
`onMenu`, an optional `onFinalize`, and a `scoreDisplay` snippet holding your own
score presentation. It owns the card chrome, the qualify check, the windowed
leaderboard preview, name entry, and single-submit-on-exit. For a versus result
with no high score, build your own card from `Surface` and `Button` and pass no
`score`.

Both panels register their save with the exit barrier, so a score with a name
already typed reaches the server even when the swipe hatch or the idle reset
tears the card down. `onFinalize` may return a promise, which is waited on
alongside the score. A game whose end-of-run layout cannot fit inside
`GameOverPanel` composes `leaderboard/nameEntry.svelte.ts` instead: it owns the
fetch, the qualify check, the typed name and the submit-once guard, and leaves
the markup to the caller. Data Control is the one game that needs this.

For a versus result where BOTH players can post a score, use
`GameOverVersusPanel.svelte` instead. You pass `display`, two `VersusSide`
entries (`id`, `label`, `color`, `score`), and a `banner` snippet for the winner
line. It runs one leaderboard fetch for both columns, qualifies each side
separately, and submits each qualifying score once on exit.

The constraint it exists to hold: both columns share a SINGLE on-screen
keyboard. Each `OnScreenKeyboard` mounts its own `window` keydown listener, so
two open at once type every key into both names. The panel keeps one
`'a' | 'b' | null` focus value rather than a flag per side, which makes that
structural, and passes `focused` to the active column's `LeaderboardList` so the
row receiving keys is ringed. Pass `caption` to an `OnScreenKeyboardField` to
name whose entry it is.

### Shared UI primitives

Under `src/core/ui/`: `Button.svelte` (five variants, 48 px minimum touch target,
forced-colors support), `IconButton.svelte`, `ConfirmButton.svelte` (two-tap
destructive), `Surface.svelte` (the card, with an optional `blur` to separate it
from a moving canvas), `Overlay.svelte`, `Score.svelte`, `NumberCounter.svelte`
(tweened count-up), the three `OnScreenKeyboard*` files, `themeScope.ts`,
`uiScale.ts`.

Under `src/displays/arcade/`: `menu/MenuScreen.svelte`, `menu/PauseMenu.svelte`,
`menu/MatchScore.svelte`, the three `tutorial/` components, the
`leaderboard/` components, `RobotIcon.svelte`, and `ReturnToLauncherOverlay.svelte`
and `IdleNotice.svelte` (both already mounted for you).

Build against the token layer in `src/styles/scale.sass`: `--space-2` through
`--space-80`, `--radius-*`, `--z-overlay`, the `--color-*` roles, the `--font-*`
handles. No px, no hardcoded hex in overlay CSS.

### There is no audio

No `AudioContext`, no audio assets, no mute control, no volume token anywhere in
`src/`. A silent kiosk is the baseline. Adding sound is new infrastructure, not
adoption of a convention.

---

## Optional pieces

### Leaderboard

Declare the boards your game keeps:

```ts
leaderboards: [{ id: 'my-game', label: 'Scores' }]
```

One entry is the common case, and its `id` is conventionally the game's own
`id`. The manifest flat-maps every game's list into `leaderboardIds`, which adds
the gold top-score badge to your launcher card, enables the launcher filter, and
un-hides the attendant Leaderboard panel. `primaryBoard(meta)` in `GameModule.ts`
returns the first entry, and is also the test for "does this game rank at all".

A game whose modes are not comparable declares one board per mode. A two-minute
sprint and a forty-minute marathon on the same ladder would rank patience rather
than skill. `LeaderboardModal` takes the whole list and grows a switcher above
the rows once there is more than one; the launcher badge always reads the first.
Put the ids in one module the meta and the overlays both import, so the board a
game declares and the board it submits to cannot drift apart.

Client: `src/core/leaderboard/leaderboardClient.ts` with `fetchLeaderboard(display,
limit?)`, `submitScore(display, name, score)`, `deleteLeaderboardEntry(id)`. The
`display` argument is a board id. The server treats it as an opaque string with no
registry and no validation, which is why a second board needs no backend change at
all. It keeps the best score per `(display, normalized name)` and normalizes names
to trimmed lowercase, 6 characters. Failures are swallowed on purpose: a dead
daemon must not brick a game.

Do not hand-roll the flow. `GameOverPanel` (one score) and
`GameOverVersusPanel` (two) already do fetch, qualify (top 50), windowed
preview, on-screen-keyboard name entry, and submit-once-on-exit, including the
swipe-out and idle-reset teardown paths. A card with a layout neither panel can
hold composes `leaderboard/nameEntry.svelte.ts` and supplies its own markup. `LeaderboardModal.svelte` is the standalone viewer,
usually opened from a `trailing` icon button on the How to Play menu row.
`formatScore.ts` formats numbers. Copy keys already exist under
`$t.arcade.leaderboard.*`.

One row per name per board. `GameOverPanel` reads its `display` once on mount, so
a game whose board depends on the mode has to remount the panel (`{#key mode}`)
rather than retarget it.

### An AI opponent

Set `supportsAi: true` (launcher chip only) and read
`src/stargazer/docs/guides/ai.md`.

The engine offers exactly one thing, a negamax searcher in
`src/stargazer/ai/minimax.ts`:

```ts
interface AdversarialGame<S, M> {
  moves(state): M[]; makeMove(state, move): void; unmakeMove(state, move): void
  isTerminal(state): boolean; evaluate(state): number
}
searchBestMove<S, M>(game, state, opts: SearchOptions): SearchResult<M>
```

No MCTS, no chance nodes, no heuristic library. The rules that bite: mutate with
make/unmake instead of cloning (strict LIFO, exact inverse, no allocation per
node), keep `evaluate` side-to-move relative, return `-(WIN - ply)` at a terminal
state so faster wins are preferred, order `moves` best-guess-first, and pass a
seeded `random` for deterministic tests.

Adapt it in a `game/ai.ts` over your pure rules module, exposing one
`chooseMove(state, difficulty, random?)` that clones the live state once per
decision. If negamax genuinely does not fit, for instance because hidden
information means a chance node, a custom planner is fine, but say why in the
module header.

Conventions: `type Difficulty = 'easy' | 'medium' | 'hard'` in your own
`game/types.ts`, mode as a discriminated union
`{ kind: '2p' } | { kind: 'ai'; difficulty: Difficulty }`, and the tuning table in
`tuning.ts`, never in the engine. Difficulty is picked through a `MenuSubmenu`.
Add a short think delay before a move and a "Thinking" caption so the move reads
as deliberate. If your search is synchronous and slow, yield every few
milliseconds and await a frame between slices, and check the abort signal _after_
the search so a swipe-out cannot commit a move.

How weakness should feel is a live disagreement in the tree. The guide recommends a
flat blunder chance for the easiest level and warns against picking a near-best
move by score. One game argues the opposite for a richer state space: weakness from
playing a simpler game, not from throwing turns away, since a randomly blundering
opponent reads as broken rather than beatable. Softer knobs there are a uniform
pick among the N best moves, a `denial` weight that lets easy mode ignore the
opponent, and a wall-clock budget returning best-so-far. Pick per game and write
down which you chose.

### Printed labels

Implement `renderLabelForRecord` and `renderPreviewLabel` on your `GameModule` and
return a JPEG blob. The manifest dispatches on `record.gameId`, and their presence
is what makes a record printable in the attendant panel. No game implements them
today, so you would be the first. Helpers in `src/core/print/canvas.ts`
(`PIXELS_PER_MM`, `squarePxFrom`, `loadImage`, `drawCssGradient`, `drawCover`,
`roundRectPath`). `enqueuePrint(jpeg, meta)` in `printerClient.ts` prints directly
from gameplay if you need that instead.

### Game log

Nothing is automatic. Call `recordArcadeGame({ score, durationMs, gameId, mode,
winner?, playerName? })` from `src/displays/arcade/game-log.ts` once per finished
game, regardless of score. `mode` is a free-form tag (`'solo'`, `'versus'`, a level
id). `wasGameHigh` is snapshotted server-side per `gameId`. Records show up in the
attendant Games panel through the manifest's `formatGameRecord`, which needs no
change for a new game.

Because the player lingers on the game-over card, freeze `durationMs` at game-over
into a `pendingLog` and finalize it from `GameOverPanel`'s `onFinalize(name)`,
which fires exactly once. Return the `recordArcadeGame` promise from that handler:
the panel waits on it alongside the score, so the record survives an idle reset or
a swipe out.

### Local multiplayer

Declare the counts in `playerCounts` and handle seats yourself. Hot-seat and
shared-screen only, with no networked multiplayer. Simultaneous players work
because the engine's pointer pipeline is multi-touch per stage.
`menu/MatchScore.svelte` is the conventional running-series score.

### Engine features that cost nothing unused

Physics is off until enabled. The arcade's shared host does not enable stage
physics, so attach a `PhysicsWorldBehavior` to your own subtree, which becomes the
simulation boundary and unregisters on destroy. Post-processing is created on first
access of `engine.postProcess`. 3D nodes live in the same scene tree and a stage
with no 3D content runs the 2D pipeline unchanged. Accessibility is entirely
opt-in through `engine.a11y`. A secondary stage via `engine.attachStage(canvas,
opts)` shares the ticker but gets its own renderer, scene, camera and input.

### An attendant knob

There is no per-game attendant hook. The single slot,
`DisplayManifest.attendantPanel`, is already taken by the arcade's Sky panel. If a
game needs an operator control, put a writable store in
`src/displays/arcade/uiState.ts`, read it from the game, and add a section to that
panel using the debug UI primitives exported from
`src/stargazer/debug/ui/index.ts`. For a dev-facing knob,
`host.debug.registerPanel(spec)` contributes a HUD section and returns an
unregister function.

### There is no save state

No client-side per-game persistence exists. `localStorage` holds only operator and
device preferences. Cross-session state means the server: the leaderboard and the
game log, both of which survive restarts. In-session state lives in your session
object and dies with the unmount.

---

## Dev workflow

```bash
cargo run -p printer-daemon                              # backend on :9110
npm --prefix web install && npm --prefix web run dev     # then ?display=arcade
```

Scripts: `npm run dev`, `check` (svelte-check), `lint`, `prettier`, `test`
(vitest, watch), `test:run`, `docs:stargazer`. Prettier is no semicolons, single
quotes, printWidth 80.

Useful URL params: `?display=arcade`, `?debug=hud|perf`, `?gfx=webgpu|webgl2`,
`?msaa=0|2|4|8`, `?demo=<name>` for an engine sandbox scene, `?fonts` for the type
specimen, `?time=HH:MM` / `?date=MM-DD` / `?sun=<deg>` to pin the launcher sky.

There is no `?game=` deep link. You reach a game by tapping its launcher card. To
iterate on a scene in isolation, use `?demo=<name>` (which bypasses `App` entirely,
so no theme, locales or booth chrome) or your own tutorial demo builders. A
standalone Vite page is the precedent if you need a bespoke art harness.

Tests are vitest plus happy-dom, colocated with the logic they cover. The setup
shims `localStorage`, a stub 2D context and `Path2D`. Anything that actually
rasterizes is verified visually in a `?demo=` scene, not in a test. The attendant
booth menu (corner double-tap, or `Ctrl+Shift+D`) exposes UI scale, the debug HUD,
and the printer, games and leaderboard panels at runtime.

Debug hotkeys, when the HUD is on: `Y` HUD, `C` 2D debug camera, `V` 3D fly camera,
`O` outlines, `L` layout outlines, `G` follow, `X` grid, `P` pause.

---

## Writing style

Two house guides govern written text, one for comments and doc comments and one
for prose. They live outside the repo, so the rules that bear on code are
summarized here in full:

A comment is written for every future maintainer, never for a reviewer or a
conversation. "As requested", "as discussed" and "the user wants" are banned. If
something learned in a conversation matters, state the underlying technical fact.

Write a comment when the code is genuinely hard for a fluent developer to follow
from the code alone, and do not write one when it is not. In between, match the
file's existing density. Non-obvious rationale, invariants the type system cannot
express, spec links, surprising edge cases and cross-cutting consequences all clear
the bar. Restating the code does not. Before writing a "what" comment, check
whether a rename would remove the need.

Describe the code as it is, as if it had always been this way. No "changed to", no
"now uses", no "previously", no "Phase N", no changelog narration. `TODO(...)`
points forward and is fine. Do not narrate the writing process either: no "first
we", no "now we can".

No em dashes and no semicolons in comments. Rewrite as two sentences, or use a
comma, colon or parentheses. Wrap identifiers in backticks. No emoji, no ASCII art,
no decorative separators.

One line is the norm for a comment, one sentence for a doc comment. `@param` and
`@return` only when the name and type do not already say it. A good name removes
the need for a comment.

For user-facing API, lead with an explanation and an example, and put
developer-only detail below it so a caller can stop reading once they know how to
use the thing. Module headers carry the architecture overview.

Prose follows the same restraint. Sentence-case headings, no "crucial", "leverage",
"robust", "seamless" or "utilize", no rule-of-three filler, no summary paragraph at
the end of a section, no bold used as a highlighter.

Engine changes update the guides under `src/stargazer/docs/guides/` and the doc
comments in the same pass. Docs are part of done, not a follow-up, and a stale
guide tends to describe a missing feature as if it were a design choice.

---

## Checklist for a new game

1. `meta.ts` with a filled-in `GameMeta`, registered in `games/registry.ts`.
2. Palette in `themeTokens`, seeded from the same `tuning.ts` constants the canvas
   reads.
3. `fonts.ts` picking from `FAMILIES`, exporting both the tokens and
   `resolveFonts(...)`.
4. `GradientBackgroundNode` or `FlatBackgroundNode` as the first child of your
   scene root.
5. One `domAnchor` wrapper holding splash, pause and game over. Tutorial modal as a
   sibling.
6. `overlays/SplashScreen.svelte` as config over `MenuScreen`, plus an optional
   `game/menuPreview.ts` for the right half of the region.
7. `menu/PauseMenu.svelte` mounted with your resume and quit callbacks.
8. `tutorial.ts` with 2 to 5 cards backed by in-engine demo builders.
9. `overlays/GameOver.svelte` over `GameOverPanel` (or `GameOverVersusPanel`
   for a two-player result), plus one
   `recordArcadeGame(...)` call.
10. All copy in `strings.ts`. Rules, scoring and layout in pure modules under
    `game/`, with colocated tests.
11. `npm run check`, `npm run lint`, `npm run test:run`, `npm run prettier` clean.
