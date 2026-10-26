/**
 * White sparks thrown out in every direction from a point, for the moment a new
 * high score lands. Diamonds and short streaks fly out fast, slow down, drift
 * under a light gravity, spin, and fade, then the node removes itself. Each
 * spark carries a violet edge, so white reads on the pale map as well as on the
 * sea.
 *
 * Positions and sizes are in the parent's units, design pixels on the UI layer.
 */
import {
  VectorParticleNode,
  type Canvas,
  type Vec2,
  type VectorParticleSpawnInit,
} from 'stargazer'

/** Sparks in one burst. */
export const CONFETTI_COUNT = 90

const SPEED_MIN = 500
const SPEED_MAX = 1500
const LIFE_MIN = 0.9
const LIFE_MAX = 1.8
const SPIN_MAX = 9
/** Size of a diamond spark's long axis, from this to this. */
const SIZE_MIN = 24
const SIZE_MAX = 54
/** Share of the sparks drawn as streaks rather than diamonds. */
const STREAK_SHARE = 0.35
/** The edge drawn under each spark, so white reads on a pale background. */
const EDGE = 'rgba(98, 70, 200, 0.6)'
/** How far the edge reaches past the spark, in the parent's units. */
const EDGE_WIDTH = 2.5
/** Width of a streak spark, in screen pixels. */
const STREAK_WIDTH = 9

export class ConfettiBurst extends VectorParticleNode {
  readonly #life: Float32Array
  readonly #age: Float32Array
  readonly #spin: Float32Array
  readonly #size: Float32Array
  readonly #streak: Uint8Array
  readonly #random: () => number
  readonly #diamond = new Float32Array(8)

  constructor(at: Vec2, random: () => number = Math.random) {
    super({
      id: 'confetti-burst',
      capacity: CONFETTI_COUNT,
      dampingPerSec: 2.4,
      accelerationWorld: { x: 0, y: 420 },
    })
    this.#random = random
    this.#life = new Float32Array(this.capacity)
    this.#age = new Float32Array(this.capacity)
    this.#spin = new Float32Array(this.capacity)
    this.#size = new Float32Array(this.capacity)
    this.#streak = new Uint8Array(this.capacity)
    this.transform.x = at.x
    this.transform.y = at.y
    this.burst(CONFETTI_COUNT)
    void this.autoDestroy(this.waitUntilEmpty())
  }

  protected override spawnParticle(
    i: number,
    out: VectorParticleSpawnInit,
  ): void {
    const r = this.#random
    const theta = r() * Math.PI * 2
    const speed = SPEED_MIN + r() * (SPEED_MAX - SPEED_MIN)
    out.x = 0
    out.y = 0
    out.vx = Math.cos(theta) * speed
    out.vy = Math.sin(theta) * speed
    out.angle = r() * Math.PI * 2
    out.speed0 = speed
    this.#life[i] = LIFE_MIN + r() * (LIFE_MAX - LIFE_MIN)
    this.#age[i] = 0
    this.#spin[i] = (r() * 2 - 1) * SPIN_MAX
    this.#size[i] = SIZE_MIN + r() * (SIZE_MAX - SIZE_MIN)
    this.#streak[i] = r() < STREAK_SHARE ? 1 : 0
  }

  protected override updateExtra(i: number, dt: number): void {
    this.#age[i] += dt
    this.angle[i] += this.#spin[i] * dt
  }

  protected override shouldDespawn(i: number): boolean {
    return this.#age[i] >= this.#life[i]
  }

  protected override paintParticle(gfx: Canvas, i: number): void {
    const fade = 1 - this.#age[i] / this.#life[i]
    if (fade <= 0) return
    gfx.setAlpha(fade * fade)
    const s = this.#size[i]
    if (this.#streak[i]) {
      gfx.strokeLine(-s * 0.6, 0, s * 0.6, 0, {
        color: EDGE,
        width: { screen: STREAK_WIDTH + EDGE_WIDTH * 2 },
        cap: 'round',
      })
      gfx.strokeLine(-s * 0.6, 0, s * 0.6, 0, {
        color: '#ffffff',
        width: { screen: STREAK_WIDTH },
        cap: 'round',
      })
      return
    }
    this.#fillDiamond(gfx, s + EDGE_WIDTH * 2, EDGE)
    this.#fillDiamond(gfx, s, '#ffffff')
  }

  /** A diamond `size` long and half as wide, centred on the origin. */
  #fillDiamond(gfx: Canvas, size: number, color: string): void {
    const d = this.#diamond
    d[0] = size / 2
    d[1] = 0
    d[2] = 0
    d[3] = size / 4
    d[4] = -size / 2
    d[5] = 0
    d[6] = 0
    d[7] = -size / 4
    gfx.fillConvexPoly(d, 4, color)
  }

  /** Test seam: how many sparks are still flying. */
  get flying(): number {
    return this.aliveCount
  }
}
