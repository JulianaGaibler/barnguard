/**
 * A short-lived particle burst fired where a wall segment is destroyed. Shards
 * fly outward, spin, damp exponentially, and shrink as they slow; the node
 * self-destructs once every shard has faded. Allocation-free (parallel typed
 * arrays), in the house style adapted from Orbo's explosion.
 */
import { SceneNode, type Gfx2D } from '@src/stargazer'

const DAMPING_PER_SEC = 3.4
const MAX_LIFE_SEC = 0.9
const STOP_SPEED = 12

export class BurstNode extends SceneNode {
  readonly #n: number
  readonly #px: Float32Array
  readonly #py: Float32Array
  readonly #vx: Float32Array
  readonly #vy: Float32Array
  readonly #ang: Float32Array
  readonly #spin: Float32Array
  readonly #size: Float32Array
  readonly #color: string
  #life = 0

  constructor(x: number, y: number, color: string, count = 14) {
    super('burst')
    this.renderLayer = 'dynamic'
    this.transform.x = x
    this.transform.y = y
    this.#color = color
    this.#n = count
    this.#px = new Float32Array(count)
    this.#py = new Float32Array(count)
    this.#vx = new Float32Array(count)
    this.#vy = new Float32Array(count)
    this.#ang = new Float32Array(count)
    this.#spin = new Float32Array(count)
    this.#size = new Float32Array(count)
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.6
      const sp = 180 + Math.random() * 220
      this.#vx[i] = Math.cos(a) * sp
      this.#vy[i] = Math.sin(a) * sp
      this.#ang[i] = Math.random() * Math.PI * 2
      this.#spin[i] = (Math.random() - 0.5) * 12
      this.#size[i] = 5 + Math.random() * 5
    }
  }

  override onUpdate(dt: number): void {
    this.#life += dt
    const damp = Math.exp(-DAMPING_PER_SEC * dt)
    let alive = false
    for (let i = 0; i < this.#n; i++) {
      this.#px[i] += this.#vx[i] * dt
      this.#py[i] += this.#vy[i] * dt
      this.#vx[i] *= damp
      this.#vy[i] *= damp
      this.#ang[i] += this.#spin[i] * dt
      const speed = Math.hypot(this.#vx[i], this.#vy[i])
      if (speed > STOP_SPEED) alive = true
    }
    if ((!alive || this.#life > MAX_LIFE_SEC) && !this.isDestroyed) {
      this.destroy()
    }
  }

  override draw(gfx: Gfx2D): void {
    const fade = Math.max(0, 1 - this.#life / MAX_LIFE_SEC)
    gfx.setAlpha(fade)
    const tri = new Float32Array(6)
    for (let i = 0; i < this.#n; i++) {
      const speed = Math.hypot(this.#vx[i], this.#vy[i])
      const s = this.#size[i] * Math.min(1, 0.3 + speed / 260)
      const a = this.#ang[i]
      for (let k = 0; k < 3; k++) {
        const t = a + (k / 3) * Math.PI * 2
        tri[k * 2] = this.#px[i] + Math.cos(t) * s
        tri[k * 2 + 1] = this.#py[i] + Math.sin(t) * s
      }
      gfx.fillConvexPoly(tri, 3, this.#color)
    }
    gfx.setAlpha(1)
  }
}
