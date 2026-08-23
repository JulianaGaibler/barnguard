/**
 * A brief whole-screen lens fringe, for the moments worth looking up from your
 * own board for.
 *
 * Post-processing is engine-wide, which is why this is owned by the component
 * rather than by a board: in versus, two sessions each adding their own effect
 * would double the pass and let one player's merge flash away the other's
 * concentration. This just fires; the caller decides who is allowed to.
 *
 * The effect is added disabled and only enabled for the length of a pulse, so
 * an idle game pays nothing: `PostProcessPipeline.active` is false while every
 * effect is disabled, and the whole post pass is skipped.
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
 *   const pulse = createScreenPulse(host)
 *   pulse.fire()
 *   pulse.destroy()
 */
import { ChromaticAberration, type EngineHost } from '@src/stargazer'
import { ANIM } from './tuning'

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

export function createScreenPulse(host: EngineHost): ScreenPulse {
  const effect = new ChromaticAberration({ amount: 0, enabled: false })
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
      if (priming === 0 && !running) effect.enabled = false
      return
    }
    if (!running) return
    elapsed += e.dt
    const t = elapsed / ANIM.caPulse
    if (t >= 1) {
      running = false
      effect.enabled = false
      effect.amount = 0
      return
    }
    // Snap up, ease down: a fringe that faded in as slowly as it faded out
    // would read as a wobble rather than as an impact.
    const shape = t < ATTACK ? t / ATTACK : 1 - (t - ATTACK) / (1 - ATTACK)
    effect.amount = peak * shape
  })

  return {
    fire(strength = 1) {
      peak = ANIM.caAmount * strength
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
