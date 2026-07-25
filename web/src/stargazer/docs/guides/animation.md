# Animation and async lifecycle

The `Animator` owns every active tween and wait. It's ticked once per render frame by `Engine.frame(dt)`, right after `input.beforeFrame()` and before the update pass, so behaviors read fresh tweened values.

## tween, wait, animate

The three primitives, all Promise-returning:

```ts
import { easings, ignoreAbort } from '@src/stargazer'

// Tween any number of numeric properties on any object.
await engine.tween(
  target,
  { x: 100, y: 200 },
  { duration: 0.5, easing: easings.outCubic },
)

// Engine-clock delay. Freezes if the ticker stops.
await engine.wait(1.2)

// Tween a node's transform, auto-scoped to node.abortSignal.
await engine.animate(node, { alpha: 0 }, { duration: 0.3 })
```

`engine.tween` and `engine.wait` are direct pass-throughs to `engine.animation.tween` and `engine.animation.wait`. `engine.animate` combines `node.abortSignal` with the caller's `opts.signal` via `combineAbortSignals` and disposes the combined listener on completion.

For node-scoped operations, prefer the methods on the node; they auto-scope to `node.abortSignal`:

```ts
await node.tween(
  { scaleX: 2, scaleY: 2 },
  { duration: 0.3, easing: easings.outBack },
)
await node.wait(0.5)
```

Non-number properties in `to` are silently ignored at runtime. TypeScript accepts `Partial<T>` for the `to` argument.

`tween` animates the node's own `transform`; `tweenTo(target, to, opts)` animates numeric fields on any object (a `{ frac: 0 }` reveal knob, a physics body's position, a custom `{ width }` used by a `draw`), while still scoping to the node's signal. Reach for `tweenTo` whenever the thing you're animating isn't a transform property.

## Fire-and-forget: play / playTo

Awaiting a tween means you care when it ends and want the `AbortError` to unwind your sequence. Many tweens are the opposite: kick off a pop or a fade and move on, and if the node dies mid-flight that's fine. For those, `node.play` / `node.playTo` are the un-awaited forms of `tween` / `tweenTo`: they return `void` and swallow the abort internally, so you stop writing `.catch(ignoreAbort)` on every un-awaited call.

```ts
node.play({ scaleX: 1.1, scaleY: 1.1 }, { duration: 0.15 })
node.playTo(ring, { width: 12 }, { duration: 0.2, easing: easings.outBack })
```

## Self-cancelling restarts: the tween key

A re-triggerable animation (a scoring ring that pops on band-enter, a glow that restarts each hit) needs to cancel its previous run before starting the next, or the two fight last-writer-wins. Instead of tracking an `AbortController` by hand, give the tween a `key`: starting a keyed tween aborts any running tween with the same `key` on the same target first.

```ts
// Each call cleanly replaces the previous ring animation on this node.
node.playTo(ring, { width }, { duration: 0.2, key: 'ring' })
```

Keyed starts also skip the dev-time overlap warning, since the replacement is intentional.

## Re-abortable scopes

`AbortScope` is a cancellation handle that hands out a fresh signal per "epoch" and aborts the previous one when the next begins. It replaces the generation-counter pattern — a `moveGen` you bump and then check with `if (gen !== moveGen) return` after every `await`. Get one scoped to a node with `node.scope()` (destroying the node aborts it):

```ts
const scope = node.scope()

function startMatch(): void {
  const signal = scope.reset() // aborts the previous match's in-flight awaits
  void (async () => {
    await revealOpen(signal)
    await playMatch(signal)
    await returnToMenu(signal)
  })().catch(ignoreAbort) // catch once, at the boundary
}
```

Capture `scope.reset()`'s return value at the top of the sequence and thread it into the inner tweens/waits (`{ signal }`). When the next `reset()` fires, those awaits reject with `AbortError`, the async function unwinds on its own, and the single `.catch(ignoreAbort)` at the boundary keeps it quiet — no per-await guard, no per-tween catch. `reset()` opens a new epoch; `abort()` cancels without opening one; `dispose()` cancels and retires the scope.

## Timeline

`Timeline` chains steps sequentially, with `parallel(...)` batches for concurrent steps. It's for linear choreography — a fixed sequence of tweens. Branching control flow, loops, and state changes between steps read better as a plain `async` function with `scope.signal` threaded through (see below).

```ts
import { Timeline } from '@src/stargazer'

await new Timeline()
  .add((s) =>
    node.tween(
      { scaleX: 1, scaleY: 1 },
      { duration: 0.35, easing: easings.outBack, signal: s },
    ),
  )
  .add((s) =>
    node.tween(
      { x: 400 },
      { duration: 0.5, easing: easings.inOutQuad, signal: s },
    ),
  )
  .parallel(
    (s) => node.tween({ alpha: 0 }, { duration: 0.4, signal: s }),
    (s) => node.tween({ y: 100 }, { duration: 0.4, signal: s }),
  )
  .run(scope.signal)
```

Steps are `(signal?) => Promise<void>`. `run(signal)` checks the signal between steps and forwards it into each step, so a step can scope its tween to it (`{ signal: s }`) — cancelling `run`'s signal aborts the running step too. Steps that are already node-scoped can ignore the argument. Use `node.tween` / `node.tweenTo` for steps (they return the Promise `Timeline` awaits); the fire-and-forget `node.play` / `node.playTo` return `void` and aren't valid steps.

## Easings

Built-in easings are re-exported as a namespace:

```ts
import { easings } from '@src/stargazer'

easings.linear
easings.inQuad / easings.outQuad / easings.inOutQuad
easings.inCubic / easings.outCubic / easings.inOutCubic
easings.outQuint
easings.outBack
easings.outElastic
```

Any function of type `(t: number) => number` where `t ∈ [0, 1]` works; write your own if the built-ins don't fit.

## Abort contract

Every helper that accepts a `signal` follows the same pattern:

1. If the signal is already aborted at call time, the returned Promise rejects synchronously (well, on the next microtask) with `DOMException('Aborted', 'AbortError')`.
2. If the signal aborts mid-operation, the Promise rejects with the same AbortError.
3. On natural completion, the abort listener is removed from the signal.

Point 3 is what keeps long sessions from leaking listeners on long-lived node signals. `Animator.tween`, `wait`, `combineAbortSignals`, and everything built on them remove their listeners in the success path.

Swallow AbortError with `ignoreAbort`:

```ts
import { ignoreAbort } from '@src/stargazer'

await node.tween({ alpha: 0 }, { duration: 0.3 }).catch(ignoreAbort)
```

`ignoreAbort(err)` returns cleanly for AbortError and rethrows everything else. That's the idiomatic "the node might die mid-tween and that's fine" shape.

## Combining signals

`combineAbortSignals(...signals)` returns `{ signal, dispose }`. The combined signal aborts when any source aborts; `dispose()` removes the listeners it installed on the sources. Call `dispose()` in a `.finally(...)` when your operation completes:

```ts
import { combineAbortSignals } from '@src/stargazer'

const combined = combineAbortSignals(node.abortSignal, opts.signal)
try {
  await engine.animation.tween(target, to, { ...opts, signal: combined.signal })
} finally {
  combined.dispose()
}
```

`engine.animate` and the node-scoped helpers already do this internally.

Sources that are already aborted at call time propagate immediately and skip listener installation, so `dispose()` is a no-op in that case.

## Overlap warning

When two tweens run on the same target with an overlapping key set, both continue to their configured duration; the later one wins on each tick because it iterates last. In dev, the Animator logs a `console.warn` the first time it sees an overlap:

```
[stargazer] overlapping tween on the same target key 'x'.
Last-writer wins per tick; cancel the earlier tween to avoid drift.
```

Pass an `AbortController` to the first tween and abort it before starting the second if you want clean handoff.

## What happens on engine destroy

`Engine.destroy()` calls `animation.cancelAll()` before it tears down the scene. Every outstanding tween and wait rejects with AbortError; abort listeners are removed. Then the scene root is destroyed, which cascades AbortErrors through node-scoped promises. Any `.catch(ignoreAbort)` you've written keeps quiet; anything without is your problem to surface.
