# Vector particles

`VectorParticleNode` is a `Node2D` base class for physics-driven particle bursts whose pieces need custom vector shapes — mixed triangles and line shards in one burst, multi-stage spin, or a despawn rule that isn't a simple speed threshold. It's the open counterpart to the baked, sprite-based [particle system](./particles.md): `ParticleEmitterNode` draws one raster sprite style per emitter, `VectorParticleNode` calls back into your own per-particle draw code, in local space, for anything `Gfx2D` can draw.

Reach for `ParticleEmitterNode` first. Reach for `VectorParticleNode` when a burst genuinely needs heterogeneous shapes or per-piece kinematics beyond a single spin + speed-coupled shrink.

## What the base class owns

`x, y, vx, vy, angle, speed0` typed arrays, sized to a fixed `capacity`, plus the freelist bookkeeping (via the same `SlotPool` the baked system's `ParticlePool` uses). Every frame, `onUpdate` integrates standard damped kinematics for every live particle — `v *= exp(-dampingPerSec*dt); v += accelerationWorld*dt; p += v*dt` — the same math as `ParticleEmitter.update`.

What it does NOT own: rotation speed, shape kind, or any other per-burst-specific field. A subclass declares its own additional typed arrays (a `spin: Float32Array`, a `kind: Uint8Array`, whatever it needs), sized to `this.capacity`, and indexes them with the same particle index the base class hands to every hook below.

## The four hooks

```ts
abstract class VectorParticleNode extends Node2D {
  protected abstract spawnParticle(i: number, out: VectorParticleSpawnInit): void
  protected abstract drawParticle(gfx: Gfx2D, i: number, camera: Camera): void
  protected updateExtra(i: number, dt: number): void // default no-op
  protected shouldDespawn(i: number): boolean // default false
}
```

- **`spawnParticle(i, out)`** — called once per particle from `burst(count)`. Fill `out.x/y/vx/vy/angle/speed0` (node-local space); `out` is reused scratch, so copy values out rather than retaining the reference. This is also where you populate your own extra typed arrays for slot `i`.
- **`drawParticle(gfx, i, camera)`** — the base class has already `save()`'d and positioned/rotated the local origin to `(x[i], y[i], angle[i])` before calling this, and calls `restore()` after it returns. Draw as if the particle were at `(0, 0)` facing angle `0`: `gfx.fillConvexPoly(triPts, 3, color)` for a triangle, `gfx.strokeLine(-h, 0, h, 0, style)` for a line shard. `camera` is forwarded for anything that needs `camera.strokeSpaceScale()` (a screen-constant stroke width).
- **`updateExtra(i, dt)`** — called once per live particle per frame, after the base class integrates position, before the despawn check. This is where a subclass integrates its own extra fields (additional spin, a decaying transient value, whatever `spawnParticle` set up).
- **`shouldDespawn(i)`** — checked once per live particle per frame, after `updateExtra`. Defaults to always `false`: a subclass that never overrides this produces **permanent** particles, cleaned up only by an external `destroy()` (or a bulk `destroyChildren()` sweep on a parent layer) — this is the right default for debris that's meant to settle into a permanent scatter, not vanish on its own.

## Two lifecycle shapes

**Self-destroying burst** — override `shouldDespawn` (e.g. a speed-threshold check), then pair with `waitUntilEmpty()` and the existing `Node2D.autoDestroy` idiom, exactly like the baked system:

```ts
class ShrapnelBurst extends VectorParticleNode {
  constructor(center: Vec2, count: number) {
    super({ capacity: count, dampingPerSec: 3 })
    this.transform.x = center.x
    this.transform.y = center.y
    this.burst(count)
    void this.autoDestroy(this.waitUntilEmpty())
  }
  protected override shouldDespawn(i: number): boolean {
    const speed0 = this.speed0[i]
    return speed0 > 0 && Math.hypot(this.vx[i], this.vy[i]) < 0.02 * speed0
  }
  // ...spawnParticle / drawParticle
}
```

`waitUntilEmpty()` resolves once `aliveCount` is 0 — same contract as the baked system's `ParticleEmitter.waitUntilEmpty`: call it right after the `burst()` you want it to track, in the same synchronous span, since it reflects live state at call time with no memory of past cycles.

**Permanent debris** — don't override `shouldDespawn`, don't call `waitUntilEmpty`/`autoDestroy`. Add the node to a layer that gets bulk-cleared on some external event instead (a level reset, a round end):

```ts
class DebrisBurst extends VectorParticleNode {
  constructor(opts: DebrisBurstOptions) {
    super({ capacity: opts.count, dampingPerSec: opts.dampingPerSec })
    this.burst(opts.count)
    // no autoDestroy — the caller's `packetLayer.destroyChildren()` sweep
    // cleans this up at the next reset.
  }
  // shouldDespawn intentionally not overridden
}
```

## Staging per-particle spawn state

`burst(count)` calls `spawnParticle` **synchronously**, once per claimed slot, before moving to the next slot. Subclasses that need something computed per-slot ahead of spawning (an evenly-spaced emission angle, say) stage it in a scratch field immediately before a `burst(1)` call and read it back inside `spawnParticle`:

```ts
const slot = (Math.PI * 2) / count
for (let i = 0; i < count; i++) {
  this.#pendingTheta = i * slot + jitter()
  this.burst(1) // spawnParticle(idx, out) runs before this call returns
}
```

`OrbExplodeNode` (orbo) and `DebrisBurstNode` (stallwaechter) both use this pattern for their evenly-spaced-with-jitter and cone emission modes — read either for a complete worked example with dual spin fields and a triangle/line shape mix.

## Reading state

`aliveCount` / `particleCount` mirror `ParticleEmitterNode`'s. There's no `availableCount` exposed on `VectorParticleNode` itself today — capacity minus `aliveCount` covers it.
