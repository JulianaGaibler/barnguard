# Particles

Pooled particle system with baked kinematics. Allocation happens once at emitter construction; per-frame emit / update / draw are allocation-free.

## Layout

```
ParticleEmitterNode ; scene-graph wrapper: onUpdate ticks the emitter, draw
                       iterates alive slots and drawImage's the sprite
ParticleEmitter     ; owns a pool + kinematics; emit / burst / setOrigin /
                       clear / update
ParticlePool        ; parallel Float32Arrays for x, y, vx, vy, life, maxLife,
                       size + Uint8Array alive + Int32Array freelist
draw.ts             ; sprite cache keyed by (color, style); pre-rendered
                       radial gradients
```

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
  spriteStyle?: 'gradient' | 'disc'
  blend?: GlobalCompositeOperation
  dampingPerSec?: number
  accelerationWorld?: Vec2
  scaleOverLife?: readonly [number, number]
  alphaOverLife?: readonly [number, number]
}
```

Ranges (`lifetimeSec`, `speedWorld`, `sizeWorld`) sample uniformly at emit time. `emitDirectionRad` is the cone axis in radians; leave it `undefined` for full-radial 360° emission. `spreadRad` is the half-angle of the cone (so `Math.PI` means "any direction" for a directional emitter).

## Two emission modes

```ts
const emitter = new ParticleEmitter({ capacity: 500, ratePerSec: 90, ... })

// Continuous stream; set the origin and let it accumulate over time.
emitter.setOrigin(worldX, worldY)

// One-shot burst; 500 particles from (x, y) right now.
emitter.burst(500, worldX, worldY)

// Optionally override the cone axis for this burst.
emitter.burst(200, worldX, worldY, Math.PI / 4)
```

`ratePerSec: 0` disables the continuous stream; the emitter only fires on explicit `burst(...)` calls. `ratePerSec` and `burst` can coexist; the plan is that packet trails run continuous and collisions add a burst on top.

## Kinematics

`ParticleEmitter.update(dt)` runs on every render frame:

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

`dampingPerSec: 0` (default) means no damping. Values like `1.5` are a moderate drag; `3.0` is a hard stop after a bright expansion. `accelerationWorld` is optional gravity or wind; leave it undefined for no acceleration.

At draw time each particle's `t = 1 − life/maxLife` (0 at spawn, 1 at death) blends the scale and alpha curves:

```
drawScale = size * lerp(scaleOverLife[0], scaleOverLife[1], t)
drawAlpha =         lerp(alphaOverLife[0], alphaOverLife[1], t)
```

Defaults are `[1, 1]` and `[1, 0]`; same size, alpha fades to zero.

## Sprite style and blend

Two knobs decide how a particle looks:

`spriteStyle`:

- `'gradient'` (default); soft radial fade from opaque center to transparent edge.
- `'disc'`. Solid color with a 1-px anti-aliased edge.

`blend`:

- `'lighter'` (default); additive; overlapping particles add brightness.
- `'source-over'`. Alpha compositing; overlapping particles just paint over each other.

The four useful combinations:

| Sprite     | Blend         | Look                                                         |
| ---------- | ------------- | ------------------------------------------------------------ |
| `gradient` | `lighter`     | Classic soft additive bloom                                  |
| `gradient` | `source-over` | Soft glow without bloom stacking                             |
| `disc`     | `lighter`     | Hard particles that still bloom on overlap                   |
| `disc`     | `source-over` | Sharp, non-bloomed particles (sparks, projectiles, confetti) |

`?demo=particles` runs a bloomed gradient trail and a sharp-disc burst side by side so you can compare.

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

// Update the origin each frame, from wherever your logic wants the trail to be.
trail.emitter.setOrigin(pointerWorld.x, pointerWorld.y)
```

Particles live in the emitter's local coord space. If the emitter node is at the scene root with identity transform, that's world space. Attach the emitter as a child of a moving node and particles move with it (useful for a trail that follows a rotating ship; usually not what you want for a flight-path trail that should stay in world space).

## Draw path

`ParticleEmitterNode.draw` iterates alive slots up to `pool.highWaterIndex`, computes per-particle `alpha` and `scale` from the over-life curves, sets `ctx.globalAlpha`, and calls `ctx.drawImage(sprite, x − half, y − half, size, size)`. The sprite is a 64×64 pre-rendered canvas fetched from a `Map<colorKey, HTMLCanvasElement>` on first use of each `(color, style)` pair.

## Reading state

`emitter.aliveCount` gives the current live particle count; `pool.availableCount` gives free slots. `pool.highWaterIndex` is the highest slot ever occupied; set by `spawn()`, never shrinks until `clear()`.

For the debug HUD, `SceneNode.particleCount` is a getter overridden on `ParticleEmitterNode` to return `emitter.aliveCount`. `DebugController.snapshotStats` walks the scene and sums it, so the HUD's Scene section shows total alive particles across every emitter.

## Cleanup

`emitter.clear()` returns every slot to the freelist and resets the internal emission accumulator. `ParticleEmitterNode.destroy()` (via base `SceneNode.destroy`) removes the node from its parent; the emitter's typed arrays are dropped for GC.
