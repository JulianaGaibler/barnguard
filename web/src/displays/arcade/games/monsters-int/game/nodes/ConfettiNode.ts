/**
 * Every particle the table throws, from one permanently mounted node.
 *
 * @remarks
 *   Built on `VectorParticleNode` rather than the baked `ParticleEmitterNode`
 *   because gravity, drag and flutter are per particle here, not per node. A
 *   baked emitter fixes acceleration, damping and its palette in one config, so
 *   one emitter is one feel in one set of colours, and this table wants a heavy
 *   shatter and a weightless float live at the same moment.
 *
 *   `VectorParticleNode` takes the same two as constructor options, so the base
 *   is built with both at zero and `updateExtra` applies each piece's own.
 *
 *   Particles are spawned in absolute layout coordinates and the node's own
 *   transform stays at the origin. Layout space is world space, so a burst
 *   placed at a card's position lands on that card.
 * @example
 *   for (const spec of burstFor({ kind: 'bust', at })) confetti.play(spec)
 */
import {
  VectorParticleNode,
  type Gfx2D,
  type VectorParticleSpawnInit,
} from '@src/stargazer'
import type { BurstSpec } from '../flourish'

/**
 * Live pieces at once. The seven throws seven cards' worth back to back and
 * every one of them outlives the wave, which is the busiest the table gets.
 */
const CAPACITY = 320

/** How fast a fluttering piece crosses its drift, in radians per second. */
const FLUTTER_RATE = 7

/**
 * Share of a piece's life spent fading out.
 *
 * Over half of it, because a piece lives long enough to arc and come back down,
 * and something falling for a second at full strength reads as litter.
 */
const FADE = 0.55

function between(range: readonly [number, number]): number {
  return range[0] + Math.random() * (range[1] - range[0])
}

function pick<T>(from: readonly T[]): T {
  return from[Math.floor(Math.random() * from.length)]!
}

export class ConfettiNode extends VectorParticleNode {
  /** Written once per piece at spawn, so drawing allocates nothing. */
  readonly #color: string[] = new Array<string>(CAPACITY).fill('#000000')
  readonly #size = new Float32Array(CAPACITY)
  readonly #life = new Float32Array(CAPACITY)
  readonly #maxLife = new Float32Array(CAPACITY)
  readonly #gravity = new Float32Array(CAPACITY)
  readonly #damp = new Float32Array(CAPACITY)
  readonly #flutter = new Float32Array(CAPACITY)
  readonly #phase = new Float32Array(CAPACITY)
  /** The burst being spawned, read back by `spawnParticle`. */
  #pending: BurstSpec | null = null

  constructor() {
    super({ id: 'monsters-int-confetti', capacity: CAPACITY })
    // Over the 3D pass, and added to the tree ahead of the HUD so the lip draws
    // over anything that falls to the bottom of the frame.
    this.renderLayer = 'dynamic'
  }

  /** Fire one burst. Silently drops pieces once the pool is full. */
  play(spec: BurstSpec): void {
    this.#pending = spec
    this.burst(spec.count)
    this.#pending = null
  }

  /**
   * Drop every live piece at once, for a table being taken down mid-burst.
   *
   * The node outlives a round, so confetti thrown at a win would otherwise
   * still be falling across the menu the player quit to.
   */
  clear(): void {
    for (let i = 0; i < CAPACITY; i++) this.kill(i)
  }

  protected override spawnParticle(
    i: number,
    out: VectorParticleSpawnInit,
  ): void {
    const spec = this.#pending
    if (!spec) return
    const heading =
      spec.axis === undefined
        ? Math.random() * Math.PI * 2
        : spec.axis + (Math.random() * 2 - 1) * spec.spread
    const speed = between(spec.speed)
    const across = spec.spawnWidth ?? 0
    out.x = spec.x + (Math.random() * 2 - 1) * across * 0.5
    out.y = spec.y
    out.vx = Math.cos(heading) * speed
    out.vy = Math.sin(heading) * speed
    out.angle = Math.random() * Math.PI * 2
    out.speed0 = speed

    const life = between(spec.life)
    this.#color[i] = pick(spec.palette)
    this.#size[i] = between(spec.size)
    this.#life[i] = life
    this.#maxLife[i] = life
    this.#gravity[i] = spec.gravity
    this.#damp[i] = spec.damp
    this.#flutter[i] = spec.flutter
    this.#phase[i] = Math.random() * Math.PI * 2
  }

  /**
   * A piece's own gravity, drag, tumble and flutter.
   *
   * The base class has already integrated its position by the time this runs,
   * so a change made here reaches the position on the next frame rather than
   * this one. One frame of a burst therefore flies straight, which is 16ms and
   * invisible, and it is the price of having these per particle at all.
   */
  protected override updateExtra(i: number, dt: number): void {
    if (this.#damp[i]! > 0) {
      const factor = Math.exp(-this.#damp[i]! * dt)
      this.vx[i] *= factor
      this.vy[i] *= factor
    }
    this.vy[i] += this.#gravity[i]! * dt
    if (this.#flutter[i] !== 0) {
      this.#phase[i] += FLUTTER_RATE * dt
      // On the position rather than the velocity, so the drift keeps its width
      // however much drag has already taken off the piece. Adding it to `vx`
      // would let damping flatten the flutter out exactly as a piece slows into
      // the part of its fall where paper wanders most.
      this.x[i] += Math.sin(this.#phase[i]!) * this.#flutter[i]! * dt
    }
    this.#life[i] -= dt
  }

  protected override shouldDespawn(i: number): boolean {
    return this.#life[i]! <= 0
  }

  protected override drawParticle(gfx: Gfx2D, i: number): void {
    const left = this.#life[i]! / this.#maxLife[i]!
    gfx.setAlpha(Math.min(1, left / FADE))
    // Every piece is a disc, so nothing here reads a rotation and none is
    // integrated. The base class still applies `angle`, which stays at zero.
    gfx.fillCircle(0, 0, this.#size[i]! * 0.5, this.#color[i]!)
  }
}
