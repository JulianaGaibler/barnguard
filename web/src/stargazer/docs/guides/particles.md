# Particles

A pooled particle system with baked kinematics. Allocation happens once, at emitter construction; the per-frame emit, update, and draw are allocation-free.

This covers the baked, sprite-based system. For particles that need per-piece vector shapes (mixed triangles and line shards in one burst, multi-stage spin, non-speed despawn rules) — cases this system's fixed sprite/field model structurally can't cover — see the [Vector particles](./vector-particles.md) guide.

## Layout

- `ParticleEmitterNode`, the scene-graph wrapper. `onUpdate` ticks the emitter, and `draw` iterates the live particles and draws each sprite.
- `ParticleEmitter`, the pool plus kinematics: `emit` / `burst` / `setOrigin` / `clear` / `update` / `waitUntilEmpty`.
- `ParticlePool`, parallel typed arrays for position, velocity, rotation, life, and size, with a freelist.

## The emitter config

```ts
interface ParticleEmitterConfig {
  capacity: number
  ratePerSec: number
  lifetimeSec: readonly [number, number]
  speedWorld: readonly [number, number]
  spreadRad: number
  emitDirectionRad?: number
  sizeWorld: readonly [number, number]
  palette: readonly string[]
  spriteStyle?: 'gradient' | 'disc' | 'hexagon' | 'square' | 'triangle'
  blend?: 'lighter' | 'source-over'
  dampingPerSec?: number
  accelerationWorld?: Vec2
  scaleOverLife?: readonly [number, number]
  alphaOverLife?: readonly [number, number]
  spinRadPerSec?: readonly [number, number]
  scaleBy?: 'life' | 'speed'
  minSpeedFrac?: number
}
```

Ranges (`lifetimeSec`, `speedWorld`, `sizeWorld`) sample uniformly at emit time. `emitDirectionRad` is the cone axis in radians; leave it undefined for full 360° emission. `spreadRad` is the half-angle of the cone, so `Math.PI` means any direction for a directional emitter.

## Two emission modes

```ts
const emitter = new ParticleEmitter({ capacity: 500, ratePerSec: 90, ... })

// Continuous stream: set the origin and let it accumulate over time.
emitter.setOrigin(worldX, worldY)

// One-shot burst: N particles from (x, y) right now.
emitter.burst(500, worldX, worldY)

// Optionally override the cone axis for this burst.
emitter.burst(200, worldX, worldY, Math.PI / 4)
```

`ratePerSec: 0` disables the continuous stream, so the emitter fires only on explicit `burst(...)` calls. A continuous stream and bursts can run together.

## Kinematics

`ParticleEmitter.update(dt)` runs each render frame:

```
speedFactor = exp(-dampingPerSec * dt)      // exponential drag
vx *= speedFactor                           // damp
vy *= speedFactor
vx += acceleration.x * dt                   // constant acceleration
vy += acceleration.y * dt
x += vx * dt                                // integrate
y += vy * dt
life -= dt
```

`dampingPerSec: 0` (default) means no damping; larger values pull particles to a stop faster after they spawn. `accelerationWorld` is optional gravity or wind; leave it undefined for none.

At draw time each particle's `t = 1 − life/maxLife` (0 at spawn, 1 at death) blends the scale and alpha curves:

```
drawScale = size * lerp(scaleOverLife[0], scaleOverLife[1], t)
drawAlpha =         lerp(alphaOverLife[0], alphaOverLife[1], t)
```

Defaults are `[1, 1]` and `[1, 0]`: constant size, alpha fading to zero.

## Rotation

`spinRadPerSec` (e.g. `[-6, 6]` for a symmetric tumble) samples a constant per-particle angular velocity at spawn and integrates it every frame, applied at draw time as a sprite rotation. Omit it (the default) for no rotation — `ParticleEmitterNode.draw` then skips the rotate transform entirely, so emitters that never spin pay nothing for the feature. The GPU backend carries rotation as a free per-instance affine transform; on a per-particle basis this is cheap even for rotating bursts, since burst counts here are typically in the dozens to low hundreds.

## Scale driven by speed, not life

`scaleOverLife` normally interpolates by lifetime fraction. Set `scaleBy: 'speed'` to drive the SAME curve by `1 - clamp(currentSpeed / speed0, 0, 1)` instead — a particle still moving fast reads at `scaleOverLife[0]`, one that's nearly stopped reads at `scaleOverLife[1]`, regardless of remaining lifetime. Use this for a burst that should visually dissolve as it decelerates (debris settling) rather than fade on a fixed clock. `alphaOverLife` always stays life-driven, even when `scaleBy: 'speed'` is set.

## Early despawn: `minSpeedFrac`

Set `minSpeedFrac` (e.g. `0.02`) to kill a particle once its current speed drops below that fraction of its own launch speed, even if `life` hasn't run out — useful paired with `scaleBy: 'speed'` so a burst's node can clean itself up (see [Cleanup](#cleanup)) as soon as it's visually settled, rather than waiting out a worst-case lifetime. `lifetimeSec`'s upper bound remains the safety backstop either way.

## Sprite style and blend

Two knobs decide how a particle looks.

`spriteStyle`:

- `'gradient'` (default), a soft radial fade from an opaque center to a transparent edge.
- `'disc'`, a solid color with an anti-aliased edge.
- `'hexagon'`, a solid flat-topped hexagon with an anti-aliased edge.
- `'square'`, a solid centered square with an anti-aliased edge, for debris or data-style trails.
- `'triangle'`, a solid apex-up equilateral triangle with an anti-aliased edge. Baked at one fixed orientation — pair it with `spinRadPerSec` to have it tumble convincingly, since the draw-time rotation does the work a second baked pose would otherwise need to.

`blend`:

- `'lighter'` (default), additive; overlapping particles add brightness.
- `'source-over'`, alpha compositing; overlapping particles paint over each other.

The four combinations:

| Sprite     | Blend         | Look                                                         |
| ---------- | ------------- | ------------------------------------------------------------ |
| `gradient` | `lighter`     | Soft additive bloom                                          |
| `gradient` | `source-over` | Soft glow without bloom stacking                             |
| `disc`     | `lighter`     | Hard particles that still bloom on overlap                   |
| `disc`     | `source-over` | Sharp, non-bloomed particles (sparks, projectiles, confetti) |

## Attaching to the scene

```ts
import { ParticleEmitterNode } from '@src/stargazer'

const trail = new ParticleEmitterNode({
  config: {
    capacity: 500,
    ratePerSec: 90,
    lifetimeSec: [0.5, 1.1],
    speedWorld: [10, 40],
    spreadRad: Math.PI * 0.35,
    sizeWorld: [12, 24],
    palette: ['#ffd34d', '#ffb347', '#ff8f6b'],
    dampingPerSec: 1.6,
    scaleOverLife: [1, 0.3],
    alphaOverLife: [1, 0],
  },
})
scene.root.add(trail)

// Update the origin each frame, from wherever your logic wants the trail.
trail.emitter.setOrigin(pointerWorld.x, pointerWorld.y)
```

Particles live in the emitter's local coord space. If the emitter node sits at the scene root with an identity transform, that's world space. Attach the emitter under a moving node and the particles move with it, which suits a trail bound to a moving object but not one that should stay put in the world.

## Reading state

`emitter.aliveCount` is the current live count, and `pool.availableCount` is the free-slot count. `Node2D.particleCount` is a getter (overridden on `ParticleEmitterNode` to return `aliveCount`) for tooling that sums particles across the scene.

## Cleanup

`emitter.clear()` returns every slot to the freelist and resets the emission accumulator. `ParticleEmitterNode.destroy()` removes the node from its parent, and the emitter's typed arrays are dropped for GC.

For a one-shot burst that should remove its own node once it's done, pair `emitter.waitUntilEmpty()` with the existing `Node2D.autoDestroy` idiom:

```ts
const burst = new ParticleEmitterNode({ config })
burst.emitter.burst(count, worldX, worldY)
scene.root.add(burst)
void burst.autoDestroy(burst.emitter.waitUntilEmpty())
```

`waitUntilEmpty()` resolves once `aliveCount` is 0 — immediately if it already is, else the next time every particle dies (naturally via `life`, or early via `minSpeedFrac`). Call it right after the `burst()` you want it to track, in the same synchronous span; it reflects live state with no memory of past cycles, so an emitter reused for a later, unrelated burst works with no manual reset — but calling it _before_ the burst you care about can observe a stale "already empty" from a previous cycle.
