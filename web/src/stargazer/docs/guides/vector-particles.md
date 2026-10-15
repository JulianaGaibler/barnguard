---
title: Vector particles
group: Features
order: 14
---

# Vector particles

{@link VectorParticleNode} is a base class for particle bursts where each piece is drawn with your own vector code. Use it when one burst mixes shapes, such as triangles and line shards, or when pieces need their own spin or despawn rules.

The base class stores position, velocity, and angle for a fixed number of particles and moves them every frame. Your subclass spawns each particle and paints it with the {@link Canvas} drawing calls.

Try [particles](/guides/particles) first. {@link ParticleEmitterNode} draws one baked sprite style per emitter and needs no subclass.

## Basic usage

The example below is a burst of triangles and line shards that slows down, despawns, and then removes its node.

```ts
import { VectorParticleNode } from '@src/stargazer'
import type { Canvas, Vec2, VectorParticleSpawnInit } from '@src/stargazer'

const TRI = new Float32Array([0, -6, 5, 3, -5, 3])

class ShrapnelBurst extends VectorParticleNode {
  readonly #kind: Uint8Array

  constructor(center: Vec2, count: number) {
    super({ capacity: count, dampingPerSec: 3 })
    this.#kind = new Uint8Array(count)
    this.transform.x = center.x
    this.transform.y = center.y
    this.burst(count)
    void this.autoDestroy(this.waitUntilEmpty())
  }

  protected override spawnParticle(
    i: number,
    out: VectorParticleSpawnInit,
  ): void {
    const theta = Math.random() * Math.PI * 2
    const speed = 100 + Math.random() * 100
    out.vx = Math.cos(theta) * speed
    out.vy = Math.sin(theta) * speed
    out.angle = theta
    out.speed0 = speed
    this.#kind[i] = Math.random() < 0.6 ? 0 : 1
  }

  protected override paintParticle(canvas: Canvas, i: number): void {
    if (this.#kind[i] === 0) {
      canvas.fillConvexPoly(TRI, 3, '#ffd34d')
    } else {
      canvas.strokeLine(-6, 0, 6, 0, { color: '#ffd34d', width: { screen: 2 } })
    }
  }

  protected override shouldDespawn(i: number): boolean {
    const speed0 = this.speed0[i]
    return speed0 > 0 && Math.hypot(this.vx[i], this.vy[i]) < 0.02 * speed0
  }
}

scene.root.add(new ShrapnelBurst({ x: 400, y: 300 }, 24))
```

The constructor spawns 24 pieces at the node's origin. Each frame the base class applies drag and moves them. A piece despawns once its speed falls below 2% of its launch speed. When none are left, `waitUntilEmpty()` resolves and `autoDestroy` removes the node.

### The hooks

A subclass implements two hooks and can override two more. The base class calls all of them with the particle's slot index `i`.

- `spawnParticle(i, out)` runs once per particle during `burst(count)`. Fill `out` with the node-local `x`, `y`, `vx`, `vy`, `angle`, and `speed0`. Every field starts at 0.
- `paintParticle(canvas, i)` paints one particle. The base class has already moved the origin to the particle's position and rotated it by its angle, so paint around `(0, 0)` facing angle 0.
- `updateExtra(i, dt)` runs once per live particle per frame, after the base class moves it. The default does nothing.
- `shouldDespawn(i)` runs after `updateExtra`. Return `true` to kill the particle. The default returns `false`.

`out` is one reused object, so copy values out of it and don't keep a reference. Set `speed0` to the launch speed when `shouldDespawn` or `paintParticle` compares against it.

### Extra per-particle data

The base class owns only the `x`, `y`, `vx`, `vy`, `angle`, `speed0`, and `alive` arrays. Add your own typed arrays sized to `capacity` for anything else, and index them with the same `i`.

The example below adds a spin per particle.

```ts
readonly #spin = new Float32Array(this.capacity)

// In spawnParticle:
this.#spin[i] = (Math.random() * 2 - 1) * 8

protected override updateExtra(i: number, dt: number): void {
  this.angle[i] += this.#spin[i] * dt
}
```

The base class doesn't change `angle` on its own, so without `updateExtra` each piece keeps its spawn angle.

### Permanent debris

If you don't override `shouldDespawn`, particles never despawn. They settle and stay until something destroys the node. Don't call `waitUntilEmpty` for such a node, because it never resolves.

Put permanent bursts under one parent node. To clear them, for example at a level reset, call [`destroyChildren`](/module/scene/node#destroychildren) on the parent.

## Advanced usage

This section covers the motion model, spawn order, paint cost, and state.

### Motion model

[`onUpdate`](/module/nodes/vectorparticlenode#onupdate) runs this for each live particle, then calls `updateExtra` and `shouldDespawn`:

```
v *= exp(-dampingPerSec * dt)
v += accelerationWorld * dt
p += v * dt
```

{@link VectorParticleNodeOptions} sets `capacity`, `dampingPerSec` (default 0), and `accelerationWorld` (default none). This is the same math as {@link ParticleEmitter}, without lifetime or spin.

### Bursts and capacity

`burst(count)` and `kill(i)` are protected, so only the subclass calls them. Expose a public method if outside code needs to trigger more bursts. `burst` stops early when every slot is in use.

### Spawn order

`burst(count)` calls `spawnParticle` synchronously for each slot before it claims the next one. To give each particle a value computed outside, set a field and call `burst(1)` in a loop:

```ts
const step = (Math.PI * 2) / count
for (let k = 0; k < count; k++) {
  this.#pendingTheta = k * step
  this.burst(1) // spawnParticle reads this.#pendingTheta
}
```

### Waiting for a burst

[`waitUntilEmpty()`](/module/nodes/vectorparticlenode#waituntilempty) resolves when the live count reaches 0, or right away if it's already 0. Call it right after the `burst()` it should track, with no `await` in between. Destroying the node kills every particle and resolves a pending promise.

### Paint cost

The node repaints every frame while any particle is alive, and once more after the last one dies. Each repaint records every live particle again. If the pieces only need to move and never change shape, one child node per piece is cheaper, because moving a node doesn't repaint it.

### Reading state

[`aliveCount`](/module/nodes/vectorparticlenode#alivecount) and `particleCount` return the live particle count. Free slots are `capacity` minus `aliveCount`.

## See also

- {@link VectorParticleNode}: base class with the spawn, paint, update, and despawn hooks
- {@link VectorParticleSpawnInit}: spawn state filled by `spawnParticle`
- {@link VectorParticleNodeOptions}: capacity, damping, and acceleration
- {@link Canvas}: drawing calls for `paintParticle`
- [Particles](/guides/particles): the baked sprite particle system
- [Drawing](/guides/drawing): the `Canvas` recorder and `paint`
