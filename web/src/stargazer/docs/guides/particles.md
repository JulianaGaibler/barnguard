# Particles

A pooled particle system with baked kinematics. Allocation happens once, at emitter construction; the per-frame emit, update, and draw are allocation-free.

## Layout

- `ParticleEmitterNode`, the scene-graph wrapper. `onUpdate` ticks the emitter, and `draw` iterates the live particles and draws each sprite.
- `ParticleEmitter`, the pool plus kinematics: `emit` / `burst` / `setOrigin` / `clear` / `update`.
- `ParticlePool`, parallel typed arrays for position, velocity, life, and size, with a freelist.

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
  spriteStyle?: 'gradient' | 'disc' | 'hexagon'
  blend?: 'lighter' | 'source-over'
  dampingPerSec?: number
  accelerationWorld?: Vec2
  scaleOverLife?: readonly [number, number]
  alphaOverLife?: readonly [number, number]
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

## Sprite style and blend

Two knobs decide how a particle looks.

`spriteStyle`:

- `'gradient'` (default), a soft radial fade from an opaque center to a transparent edge.
- `'disc'`, a solid color with an anti-aliased edge.
- `'hexagon'`, a solid flat-topped hexagon with an anti-aliased edge.

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

`emitter.aliveCount` is the current live count, and `pool.availableCount` is the free-slot count. `SceneNode.particleCount` is a getter (overridden on `ParticleEmitterNode` to return `aliveCount`) for tooling that sums particles across the scene.

## Cleanup

`emitter.clear()` returns every slot to the freelist and resets the emission accumulator. `ParticleEmitterNode.destroy()` removes the node from its parent, and the emitter's typed arrays are dropped for GC.
