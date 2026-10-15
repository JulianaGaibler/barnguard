---
title: Particles
group: Features
order: 13
---

# Particles

{@link ParticleEmitterNode} draws many small sprites that move, fade, and die on their own: trails, sparks, explosions, confetti. Each particle is one baked sprite, scaled and faded by curves you set in a {@link ParticleEmitterConfig}.

The node wraps a {@link ParticleEmitter}, which owns a fixed-size {@link ParticlePool}. The pool allocates all its storage when you build the emitter. Emitting and updating particles after that allocates nothing.

For particles that need their own vector shapes, such as triangles and line shards mixed in one burst, see [Vector particles](/guides/vector-particles).

## Basic usage

The example below adds a continuous trail to the scene and moves its emission point each frame.

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

// Each frame, from wherever your logic wants the trail.
trail.emitter.setOrigin(pointerWorld.x, pointerWorld.y)
```

The node spawns 90 particles per second at the origin. Each one gets a random lifetime, speed, size, and palette color from the ranges. It slows down, shrinks to 30% of its size, and fades out before it dies. With no `emitDirectionRad`, particles leave in every direction.

The node updates the emitter in `onUpdate` and paints the live particles. It repaints every frame while any particle is alive, and once more after the last one dies.

### Bursts

A burst emits a number of particles at one point right away. Set `ratePerSec: 0` for an emitter that only fires bursts.

```ts
const sparks = new ParticleEmitterNode({
  config: {
    capacity: 300,
    ratePerSec: 0,
    lifetimeSec: [0.4, 0.9],
    speedWorld: [200, 400],
    spreadRad: Math.PI,
    sizeWorld: [6, 12],
    palette: ['#ffffff', '#89d5ff'],
    dampingPerSec: 4,
    spriteStyle: 'disc',
    blend: 'source-over',
  },
})
scene.root.add(sparks)

sparks.emitter.burst(200, x, y)
// Override the cone axis for this burst only.
sparks.emitter.burst(100, x, y, Math.PI / 4)
```

[`burst`](/module/particles/particleemitter#burst) stops when the pool is full, so a burst never emits more than `capacity` minus the live count. A continuous stream and bursts can share one emitter.

### Removing a burst when it's done

For a one-shot burst, pair [`waitUntilEmpty`](/module/particles/particleemitter#waituntilempty) with [`autoDestroy`](/module/scene/node#autodestroy). The node destroys itself once its last particle dies.

```ts
const burst = new ParticleEmitterNode({ config })
burst.emitter.burst(count, x, y)
scene.root.add(burst)
void burst.autoDestroy(burst.emitter.waitUntilEmpty())
```

Call `waitUntilEmpty()` right after the `burst()` it should track, with no `await` in between. It resolves when the live count reaches 0, or right away if it's already 0. It has no memory of earlier bursts, so a call before the burst can resolve at once.

### Coordinate space

Particles live in the node's local space, and `setOrigin` takes a local point. A node at `scene.root` with no transform uses world coordinates.

If you add the node under a moving node, the particles move with it. That suits a glow that stays attached to an object. For a trail that stays behind in the world, add the node to the root and move the origin instead.

## Advanced usage

This section lists every config option and covers the motion model, rotation, speed-driven scale, early despawn, sprite styles, and cleanup.

### Config options

All ranges are `[min, max]` and sampled uniformly once, when the particle spawns.

| Option              | Type                           | Default      | Meaning                                                      |
| ------------------- | ------------------------------ | ------------ | ------------------------------------------------------------ |
| `capacity`          | `number`                       | required     | Maximum live particles                                       |
| `ratePerSec`        | `number`                       | required     | Continuous emissions per second, 0 for bursts only           |
| `lifetimeSec`       | `[number, number]`             | required     | Lifetime range in seconds                                    |
| `speedWorld`        | `[number, number]`             | required     | Launch speed range in world units per second                 |
| `spreadRad`         | `number`                       | required     | Half-angle of the emission cone in radians                   |
| `emitDirectionRad`  | `number`                       | none         | Cone axis in radians, 0 is +x. Unset emits in all directions |
| `sizeWorld`         | `[number, number]`             | required     | Sprite size range in world units                             |
| `palette`           | `string[]`                     | required     | Colors, each particle picks one at random                    |
| `spriteStyle`       | {@link ParticleSpriteStyle}    | `'gradient'` | Sprite shape                                                 |
| `blend`             | `'lighter'` or `'source-over'` | `'lighter'`  | Composite mode                                               |
| `dampingPerSec`     | `number`                       | `0`          | Exponential drag per second                                  |
| `accelerationWorld` | {@link Vec2}                   | none         | Constant acceleration, such as gravity or wind               |
| `scaleOverLife`     | `[number, number]`             | `[1, 1]`     | Size multiplier at spawn and at death                        |
| `alphaOverLife`     | `[number, number]`             | `[1, 0]`     | Alpha at spawn and at death                                  |
| `spinRadPerSec`     | `[number, number]`             | none         | Angular velocity range in radians per second                 |
| `scaleBy`           | `'life'` or `'speed'`          | `'life'`     | What drives `scaleOverLife`                                  |
| `minSpeedFrac`      | `number`                       | none         | Kill a particle below this fraction of its launch speed      |

With `emitDirectionRad` unset, the emitter ignores `spreadRad`. With an axis set, `spreadRad: Math.PI` also covers every direction.

### Motion model

[`update(dt)`](/module/particles/particleemitter#update) runs once per frame. It first emits `ratePerSec * dt` particles, carrying the fraction over to the next frame. Then it moves each live particle:

```
v *= exp(-dampingPerSec * dt)   // drag
v += accelerationWorld * dt     // gravity, wind
p += v * dt                     // move
angle += spin * dt              // rotation
life -= dt
```

A particle dies when `life` reaches 0. Higher `dampingPerSec` values stop particles sooner after they spawn.

At paint time, `t = 1 - life / maxLife` runs from 0 at spawn to 1 at death. The node draws each particle at `size * lerp(scaleOverLife, t)` with alpha `lerp(alphaOverLife, t)`. It skips particles whose alpha or size is 0 or less.

### Rotation

`spinRadPerSec` gives each particle a constant angular velocity, sampled with its sign. `[-6, 6]` makes particles tumble both ways. Without it, the node draws every sprite unrotated and skips the rotate transform.

### Scale driven by speed

With `scaleBy: 'speed'`, the scale curve follows `t = 1 - clamp(speed / launchSpeed, 0, 1)` instead of lifetime. A fast particle draws at `scaleOverLife[0]` and a nearly stopped one at `scaleOverLife[1]`. Use it for debris that should shrink away as it settles. Alpha still follows lifetime.

### Early despawn

`minSpeedFrac` kills a particle once its speed drops below that fraction of its own launch speed, even if its lifetime hasn't run out. `0.02` is a typical value. Paired with `scaleBy: 'speed'` and `waitUntilEmpty`, a burst removes itself as soon as it has settled. The upper bound of `lifetimeSec` still kills particles that never slow down.

### Sprite styles and blend

`spriteStyle` picks the sprite shape. Each style is a 64-pixel square tile that the node scales to the particle's size, so all styles cost the same. These are the five styles:

- `'gradient'`: a soft radial fade from an opaque center to a clear edge
- `'disc'`: a solid disc with an anti-aliased edge
- `'hexagon'`: a solid flat-topped hexagon
- `'square'`: a solid centered square
- `'triangle'`: a solid equilateral triangle, apex up, best paired with `spinRadPerSec`

`blend: 'lighter'` adds overlapping particles together, so dense areas glow brighter. `blend: 'source-over'` paints particles over each other. The table shows the four common pairings.

| Sprite     | Blend         | Look                                        |
| ---------- | ------------- | ------------------------------------------- |
| `gradient` | `lighter`     | Soft additive bloom                         |
| `gradient` | `source-over` | Soft glow without bloom stacking            |
| `disc`     | `lighter`     | Hard particles that still bloom on overlap  |
| `disc`     | `source-over` | Sharp particles, such as sparks or confetti |

{@link getParticleSprite} returns the cached tile for a color and style. The cache keeps each tile for the life of the page. {@link clearParticleSpriteCache} empties it, for tests and teardown.

### Reading state

The emitter's `aliveCount` is the live particle count. `emitter.pool.availableCount` is the number of free slots. [`particleCount`](/module/scene/node2d#particlecount) on any `Node2D` is 0, and the particle nodes return their live count. The debug HUD sums it across the scene.

### Cleanup

[`clear()`](/module/particles/particleemitter#clear) kills every particle and resets the emission accumulator. Destroying the node also clears the emitter, so a pending `waitUntilEmpty()` promise resolves.

## See also

- {@link ParticleEmitterNode}: scene node that updates and paints an emitter
- {@link ParticleEmitter}: pool, emission, and motion
- {@link ParticleEmitterConfig}: every emitter option
- {@link ParticlePool}: typed-array storage with a free list
- {@link VectorParticleNode}: particles with custom vector shapes
- [Vector particles](/guides/vector-particles): per-particle shapes and despawn rules
- [Scene](/guides/scene): nodes, `onUpdate`, and `autoDestroy`
- [Debugging](/guides/debugging): the HUD's particle count
