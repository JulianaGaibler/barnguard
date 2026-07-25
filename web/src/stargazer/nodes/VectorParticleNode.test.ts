import { describe, expect, it } from 'vitest'
import {
  VectorParticleNode,
  type VectorParticleSpawnInit,
} from './VectorParticleNode'
import type { Camera } from '../camera/Camera'
import type { Gfx2D } from '../render/gfx/Gfx2D'

type LoggedCall = readonly [string, ...unknown[]]

/** Minimal `Gfx2D` test double: logs the calls this suite cares about, no-ops the rest. */
function recordingGfx(): { gfx: Gfx2D; calls: LoggedCall[] } {
  const calls: LoggedCall[] = []
  const gfx: Gfx2D = {
    setBaseTransform: () => {},
    save: () => calls.push(['save']),
    restore: () => calls.push(['restore']),
    translate: (x, y) => calls.push(['translate', x, y]),
    rotate: (rad) => calls.push(['rotate', rad]),
    scale: (sx, sy) => calls.push(['scale', sx, sy]),
    setAlpha: () => {},
    setBlend: () => {},
    setClipMask: () => {},
    fillRect: () => {},
    fillRoundRect: () => {},
    strokeRoundRect: () => {},
    fillCircle: (cx, cy, r) => calls.push(['fillCircle', cx, cy, r]),
    fillConvexPoly: () => {},
    fillPath2D: () => {},
    fillCircleRadialGradient: () => {},
    fillMaskedRadialGradient: () => {},
    fillPolyLinearGradient: () => {},
    strokeCircle: () => {},
    strokeLine: () => {},
    strokeQuadratic: () => {},
    strokePolyline: () => {},
    strokePath2D: () => {},
    drawImage: () => {},
    fillText: () => {},
  }
  return { gfx, calls }
}

const fakeCamera = {} as Camera

/** Trivial concrete subclass exposing hook call logs + protected fields for assertions. */
class TestParticleNode extends VectorParticleNode {
  readonly spawnLog: number[] = []
  readonly drawLog: number[] = []
  /** Position read INSIDE `updateExtra`, to verify it runs after integration. */
  readonly xAtUpdateExtra: number[] = []
  despawnPredicate: (i: number) => boolean = () => false

  triggerBurst(count: number): void {
    this.burst(count)
  }
  triggerKill(idx: number): void {
    this.kill(idx)
  }
  get xs(): Float32Array {
    return this.x
  }
  get vxs(): Float32Array {
    return this.vx
  }
  get aliveFlags(): Uint8Array {
    return this.alive
  }

  protected override spawnParticle(i: number, out: VectorParticleSpawnInit): void {
    out.x = 0
    out.y = 0
    out.vx = 100
    out.vy = 0
    out.angle = 0
    out.speed0 = 100
    this.spawnLog.push(i)
  }

  protected override drawParticle(gfx: Gfx2D): void {
    this.drawLog.push(1)
    gfx.fillCircle(0, 0, 1, '#fff')
  }

  protected override updateExtra(i: number, _dt: number): void {
    this.xAtUpdateExtra.push(this.x[i])
  }

  protected override shouldDespawn(i: number): boolean {
    return this.despawnPredicate(i)
  }
}

/** Never overrides `shouldDespawn` at all, to test the BASE class's own default. */
class PermanentTestNode extends VectorParticleNode {
  triggerBurst(count: number): void {
    this.burst(count)
  }
  protected override spawnParticle(_i: number, out: VectorParticleSpawnInit): void {
    out.vx = 10
  }
  protected override drawParticle(): void {}
}

describe('VectorParticleNode', () => {
  it('burst spawns up to capacity, extra spawns are silently dropped', () => {
    const n = new TestParticleNode({ capacity: 3 })
    n.triggerBurst(5)
    expect(n.aliveCount).toBe(3)
    expect(n.spawnLog.length).toBe(3)
  })

  it('spawnParticle is invoked synchronously per burst(1) call (the contract OrbExplodeNode/DebrisBurstNode rely on)', () => {
    // Stage a value ahead of each burst(1) call and read it back inside
    // spawnParticle, exactly like the migrated nodes do for per-particle
    // emission angles.
    class StagedNode extends VectorParticleNode {
      pending = -1
      seen: number[] = []
      stageAndBurst(value: number): void {
        this.pending = value
        this.burst(1)
      }
      protected override spawnParticle(_i: number, out: VectorParticleSpawnInit): void {
        this.seen.push(this.pending)
        out.vx = 1
      }
      protected override drawParticle(): void {}
    }
    const n = new StagedNode({ capacity: 3 })
    n.stageAndBurst(10)
    n.stageAndBurst(20)
    n.stageAndBurst(30)
    expect(n.seen).toEqual([10, 20, 30])
  })

  it('onUpdate integrates damped kinematics (damp -> accel -> integrate), matching ParticleEmitter', () => {
    const n = new TestParticleNode({
      capacity: 1,
      dampingPerSec: Math.log(4),
      accelerationWorld: { x: 0, y: 200 },
    })
    n.triggerBurst(1)
    expect(n.vxs[0]).toBeCloseTo(100, 5)
    n.onUpdate(0.5)
    // vx: 100 * exp(-ln4 * 0.5) = 100/2 = 50
    expect(n.vxs[0]).toBeCloseTo(50, 3)
  })

  it('updateExtra runs once per live particle per frame, after position integration', () => {
    const n = new TestParticleNode({ capacity: 2 })
    n.triggerBurst(2)
    n.onUpdate(0.5)
    // vx=100 undamped, dt=0.5 -> x should be 50 by the time updateExtra reads it
    expect(n.xAtUpdateExtra).toEqual([50, 50])
    n.onUpdate(0.5)
    expect(n.xAtUpdateExtra).toEqual([50, 50, 100, 100])
  })

  it("shouldDespawn defaults to false on the base class — particles never auto-despawn without an override", () => {
    const n = new PermanentTestNode({ capacity: 4 })
    n.triggerBurst(4)
    for (let i = 0; i < 50; i++) n.onUpdate(1)
    expect(n.aliveCount).toBe(4)
  })

  it('an overridden shouldDespawn kills a particle, and waitUntilEmpty resolves once every particle is gone', async () => {
    const n = new TestParticleNode({ capacity: 2 })
    n.triggerBurst(2)
    n.despawnPredicate = (i) => i === 0
    let resolved = false
    void n.waitUntilEmpty().then(() => {
      resolved = true
    })
    n.onUpdate(0.1)
    expect(n.aliveCount).toBe(1)
    await Promise.resolve()
    expect(resolved).toBe(false)
    n.despawnPredicate = () => true
    n.onUpdate(0.1)
    expect(n.aliveCount).toBe(0)
    await Promise.resolve()
    expect(resolved).toBe(true)
  })

  it('waitUntilEmpty on a reused node tracks a SECOND burst with no manual reset', async () => {
    const n = new TestParticleNode({ capacity: 1 })
    n.despawnPredicate = () => true
    n.triggerBurst(1)
    n.onUpdate(0.1) // first cycle fully drains
    expect(n.aliveCount).toBe(0)

    n.despawnPredicate = () => false
    n.triggerBurst(1) // second cycle, still alive
    let resolved = false
    void n.waitUntilEmpty().then(() => {
      resolved = true
    })
    await Promise.resolve()
    expect(resolved).toBe(false)
    n.despawnPredicate = () => true
    n.onUpdate(0.1)
    await Promise.resolve()
    expect(resolved).toBe(true)
  })

  it('destroying the node resolves any pending waitUntilEmpty (never leaves an await hanging)', async () => {
    const n = new TestParticleNode({ capacity: 1 })
    n.triggerBurst(1) // never despawns on its own
    let resolved = false
    void n.waitUntilEmpty().then(() => {
      resolved = true
    })
    await Promise.resolve()
    expect(resolved).toBe(false)
    n.destroy()
    await Promise.resolve()
    expect(resolved).toBe(true)
  })

  it('particleCount getter mirrors aliveCount', () => {
    const n = new TestParticleNode({ capacity: 3 })
    expect(n.particleCount).toBe(0)
    n.triggerBurst(2)
    expect(n.particleCount).toBe(2)
  })

  it('draw calls save/translate/rotate/drawParticle/restore per live particle, skips dead ones', () => {
    const n = new TestParticleNode({ capacity: 2 })
    n.triggerBurst(2)
    n.triggerKill(0)
    const { gfx, calls } = recordingGfx()
    n.draw(gfx, fakeCamera, 0)
    expect(calls.filter((c) => c[0] === 'save').length).toBe(1)
    expect(calls.filter((c) => c[0] === 'restore').length).toBe(1)
    expect(calls.filter((c) => c[0] === 'translate').length).toBe(1)
    expect(calls.filter((c) => c[0] === 'rotate').length).toBe(1)
    expect(n.drawLog.length).toBe(1)
  })
})
