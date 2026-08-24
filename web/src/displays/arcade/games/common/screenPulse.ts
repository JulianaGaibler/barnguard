/**
 * A brief whole-screen lens fringe, for the moments worth looking up from your
 * own board for.
 *
 * Post-processing is engine-wide, which is why this belongs to a game's
 * component rather than to a board: in a two-player game, two sessions each
 * adding their own effect would double the pass and let one player's
 * celebration flash away the other's concentration. This just fires, and the
 * caller decides who is allowed to.
 *
 * The effect is added disabled and only enabled for the length of a pulse, so
 * an idle game pays nothing: `PostProcessPipeline.active` is false while every
 * effect is disabled, and the whole post pass is skipped. A game that asks for
 * a `baseline` gives that up deliberately and pays for the pass every frame,
 * which is the price of a screen that reads as a live monitor rather than as a
 * flat panel.
 *
 * It is primed up front all the same. Turning an effect on for the first time
 * costs more than compiling its shaders, which `postProcess.warm()` covers: the
 * stage leaves its direct present path, the pipeline allocates its first
 * ping-pong render target, and the driver validates a route it has never taken.
 * Paid at the first pulse that lands as a visible stall. So the effect is run
 * for a few frames at zero strength while the game is still mounting, where it
 * is invisible and nothing is moving yet. Zero amount makes the shader a
 * mathematical no-op: all three channel taps read the same texel.
 *
 * @example
 *   const pulse = createScreenPulse(host, {
 *     durationSec: 0.45,
 *     amount: 0.007,
 *   })
 *   pulse.fire()
 *   pulse.destroy()
 */
import { ChromaticAberration, type EngineHost } from '@src/stargazer'

/** How one pulse is shaped. Both belong in the calling game's tuning table. */
export interface ScreenPulseOptions {
  /** Seconds one pulse lasts, rise and fall together. */
  durationSec: number
  /** Peak channel separation at `strength` 1, in uv units. */
  amount: number
  /**
   * Separation the effect rests at between pulses, in the same units.
   *
   * Zero, the default, means the pass is skipped entirely while nothing is
   * firing. Anything above it keeps the pass running for the life of the game,
   * so only ask when the constant fringe is part of the look.
   */
  baseline?: number
}

export interface ScreenPulse {
  /** Flash once. Re-firing mid-pulse restarts it rather than stacking. */
  fire(strength?: number): void
  destroy(): void
}

/** Fraction of the pulse spent ramping up. The rest is the longer fall-off. */
const ATTACK = 0.18
/**
 * Frames the effect is held on at zero strength at startup. More than one so
 * the pool's target is acquired, released and reused at least once.
 */
const PRIME_FRAMES = 3

export function createScreenPulse(
  host: EngineHost,
  opts: ScreenPulseOptions,
): ScreenPulse {
  const rest = opts.baseline ?? 0
  const effect = new ChromaticAberration({ amount: rest, enabled: false })
  host.engine.postProcess.add(effect)
  // Compile now, while the arcade is still panning into the game. Left to the
  // first pulse, the shader build lands mid-celebration and stalls the frame
  // long enough to read as the screen flickering.
  host.engine.postProcess.warm()

  let elapsed = 0
  let peak = 0
  let running = false
  let priming = PRIME_FRAMES
  effect.enabled = true

  const off = host.engine.events.on('frame', (e) => {
    if (priming > 0) {
      priming -= 1
      if (priming === 0 && !running) {
        effect.enabled = rest > 0
        effect.amount = rest
      }
      return
    }
    if (!running) return
    elapsed += e.dt
    const t = elapsed / opts.durationSec
    if (t >= 1) {
      running = false
      effect.enabled = rest > 0
      effect.amount = rest
      return
    }
    // Snap up, ease down: a fringe that faded in as slowly as it faded out
    // would read as a wobble rather than as an impact.
    const shape = t < ATTACK ? t / ATTACK : 1 - (t - ATTACK) / (1 - ATTACK)
    effect.amount = rest + peak * shape
  })

  return {
    fire(strength = 1) {
      peak = opts.amount * strength
      elapsed = 0
      running = true
      priming = 0
      effect.enabled = true
    },
    destroy() {
      off()
      host.engine.postProcess.remove(effect)
    },
  }
}
