import { createEngineHost } from '../engine/EngineHost'
import { VectorParticleNode } from '../nodes/VectorParticleNode'
import type { Camera } from '../camera/Camera'
import type { Gfx2D } from '../render/gfx/Gfx2D'
import type { Vec2 } from '../math/Vec2'
import type { VectorParticleSpawnInit } from '../nodes/VectorParticleNode'
import type { DemoFn } from './types'

const TRI_SCRATCH = new Float32Array(6)
const COUNT = 22
const TRIANGLE_FRACTION = 0.6
const SPEED_RANGE: readonly [number, number] = [80, 220]
const DAMPING_PER_SEC = 3
const SPIN_MAX_RAD_PER_SEC = 8
const TRIANGLE_SIDE = 16
const LINE_HALF = 14
const MIN_SPEED_FRAC = 0.02

/**
 * `VectorParticleNode` showcase: a burst of mixed triangle/line pieces, drawn
 * via per-particle `gfx.fillConvexPoly`/`strokeLine` rather than a baked
 * sprite. Click to spawn a self-destroying burst (despawns + `autoDestroy`
 * once every piece has settled); shift-click for a permanent variant (no
 * `shouldDespawn` override) that lingers until "reset" clears the layer —
 * demonstrating both lifecycle modes from the vector-particles guide.
 */
class ShrapnelBurst extends VectorParticleNode {
  readonly #spin: Float32Array
  readonly #kind: Uint8Array
  readonly #color: string
  readonly #permanent: boolean

  constructor(center: Vec2, color: string, permanent: boolean) {
    super({ id: 'shrapnel-burst', capacity: COUNT, dampingPerSec: DAMPING_PER_SEC })
    this.transform.x = center.x
    this.transform.y = center.y
    this.#spin = new Float32Array(COUNT)
    this.#kind = new Uint8Array(COUNT)
    this.#color = color
    this.#permanent = permanent
    this.burst(COUNT)
    if (!permanent) void this.autoDestroy(this.waitUntilEmpty())
  }

  protected override spawnParticle(i: number, out: VectorParticleSpawnInit): void {
    const theta = Math.random() * Math.PI * 2
    const [speedMin, speedMax] = SPEED_RANGE
    const speed = speedMin + Math.random() * (speedMax - speedMin)
    out.x = 0
    out.y = 0
    out.vx = Math.cos(theta) * speed
    out.vy = Math.sin(theta) * speed
    out.angle = Math.random() * Math.PI * 2
    out.speed0 = speed
    this.#spin[i] = (Math.random() * 2 - 1) * SPIN_MAX_RAD_PER_SEC
    this.#kind[i] = Math.random() < TRIANGLE_FRACTION ? 0 : 1
  }

  protected override updateExtra(i: number, dt: number): void {
    this.angle[i] += this.#spin[i] * dt
  }

  protected override shouldDespawn(i: number): boolean {
    if (this.#permanent) return false
    const speed0 = this.speed0[i]
    return speed0 > 0 && Math.hypot(this.vx[i], this.vy[i]) < MIN_SPEED_FRAC * speed0
  }

  protected override drawParticle(gfx: Gfx2D, i: number, camera: Camera): void {
    const scale = this.#permanent
      ? 1
      : Math.min(1, Math.hypot(this.vx[i], this.vy[i]) / this.speed0[i])
    if (scale <= 0.02) return
    gfx.scale(scale, scale)
    if (this.#kind[i] === 0) {
      const height = TRIANGLE_SIDE * (Math.sqrt(3) / 2)
      TRI_SCRATCH[0] = 0
      TRI_SCRATCH[1] = -height * (2 / 3)
      TRI_SCRATCH[2] = TRIANGLE_SIDE * 0.5
      TRI_SCRATCH[3] = height * (1 / 3)
      TRI_SCRATCH[4] = -TRIANGLE_SIDE * 0.5
      TRI_SCRATCH[5] = height * (1 / 3)
      gfx.fillConvexPoly(TRI_SCRATCH, 3, this.#color)
    } else {
      gfx.strokeLine(-LINE_HALF, 0, LINE_HALF, 0, {
        color: this.#color,
        width: 2 * camera.strokeSpaceScale(),
        cap: 'round',
      })
    }
  }
}

const PALETTE = ['#ff6bd6', '#89d5ff', '#ffd34d', '#7bffb0']

const runDemo: DemoFn = async ({ canvas, signal, attach }) => {
  const host = createEngineHost({
    canvas,
    clearColor: '#0d1a2c',
    initialViewport: { x: 0, y: 0, width: 1920, height: 1080 },
  })
  attach?.(host)

  await host.loadScene(() => {})
  host.start()

  let colorIdx = 0
  const onDown = (e: PointerEvent): void => {
    const rect = canvas.getBoundingClientRect()
    const w = host.engine.activeCamera.screenToWorld(
      e.clientX - rect.left,
      e.clientY - rect.top,
    )
    const color = PALETTE[colorIdx % PALETTE.length]
    colorIdx++
    host.engine.scene.root.add(new ShrapnelBurst(w, color, e.shiftKey))
  }
  // "r" clears every permanent burst still lingering (self-destroying bursts
  // are already gone by the time this matters).
  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'r') host.engine.scene.root.destroyChildren()
  }
  canvas.addEventListener('pointerdown', onDown)
  window.addEventListener('keydown', onKeyDown)

  const stop = (): void => {
    canvas.removeEventListener('pointerdown', onDown)
    window.removeEventListener('keydown', onKeyDown)
    host.destroy()
  }
  signal.addEventListener('abort', stop, { once: true })
  return stop
}

export default runDemo
