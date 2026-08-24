/**
 * The loop a tutorial card's animation runs in.
 *
 * Exists because the obvious way to write one swallows its own failures. A card
 * is a bare `async` function with no caller, so anything it throws becomes an
 * unhandled rejection and the card simply stops moving. Two of the calls it
 * makes throw for reasons that have nothing to do with the card being wrong:
 *
 * A card torn down mid-animation aborts whatever it was awaiting, which is
 * routine and must stay quiet. Anything else is a real fault, the card will
 * stop, and it should say why rather than going dark.
 *
 * Teardown also has to unwind the body IMMEDIATELY rather than being swallowed
 * step by step. A gesture is several tweens in a row with no checks between
 * them, so a body that carried on would run a whole pass against a dead node.
 *
 * @example
 *   runDemoLoop(root, 'flush', async ({ wait, alive }) => {
 *     reset()
 *     await wait(0.5)
 *     if (!alive()) return
 *   })
 */
import { isAbortError, type Node2D } from '@src/stargazer'
import { demoLogFirst } from '../../tutorial/demoDebug'

/** What a card's body is handed to pace itself and to bail out cleanly. */
export interface DemoLoopContext {
  /** Sleep, in seconds of engine time. Freezes with the engine. */
  wait(seconds: number): Promise<void>
  /** False once the card has been torn down. Check after every `await`. */
  alive(): boolean
  /** Await an animation, treating teardown as an ordinary stop. */
  play(step: Promise<void>): Promise<void>
}

/**
 * Run `body` over and over until `root` is destroyed.
 *
 * Returns immediately. One pass of `body` is one cycle of the card, so a body
 * that returns early simply starts again.
 */
export function runDemoLoop(
  root: Node2D,
  name: string,
  body: (ctx: DemoLoopContext) => Promise<void>,
): void {
  const alive = (): boolean => !root.isDestroyed

  /** Unwinds the body when the card goes away, quietly. */
  class Torn extends Error {}

  const settle = async (step: Promise<void>): Promise<void> => {
    try {
      await step
    } catch (e) {
      // Teardown, by either route: the call aborted, or the node was already
      // gone when it was made.
      if (isAbortError(e) || !alive()) throw new Torn()
      console.warn(`[demo:${name}] stopped`, e)
      throw e
    }
  }

  const ctx: DemoLoopContext = {
    wait: (seconds) => {
      demoLogFirst(`${name} wait`, 4, { seconds })
      return settle(root.wait(seconds))
    },
    alive,
    play: (step) => settle(step),
  }

  void (async () => {
    try {
      let pass = 0
      while (alive()) {
        demoLogFirst(`${name} pass`, 3, { pass: ++pass })
        await body(ctx)
      }
      demoLogFirst(`${name} loop stopped, node destroyed`, 1)
    } catch (e) {
      if (e instanceof Torn || isAbortError(e)) return
      console.warn(`[demo:${name}] loop ended`, e)
    }
  })()
}
