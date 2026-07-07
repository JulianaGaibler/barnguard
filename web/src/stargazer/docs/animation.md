# Animation and async lifecycle

The `Animator` owns every active tween and wait. It's ticked once per render frame by `Engine.frame(dt)`, right after `input.beforeFrame()` and before the update pass, so behaviours read fresh tweened values.

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

## Timeline

`Timeline` chains steps sequentially, with `parallel(...)` batches for concurrent steps:

```ts
import { Timeline } from '@src/stargazer'

await new Timeline()
  .add(() =>
    node.tween(
      { scaleX: 1, scaleY: 1 },
      { duration: 0.35, easing: easings.outBack },
    ),
  )
  .add(() =>
    node.tween({ x: 400 }, { duration: 0.5, easing: easings.inOutQuad }),
  )
  .parallel(
    () => node.tween({ alpha: 0 }, { duration: 0.4 }),
    () => node.tween({ y: 100 }, { duration: 0.4 }),
  )
  .run(node.abortSignal)
```

Steps are `() => Promise<void>`. Timeline doesn't thread its own signal into inner tweens; the inner tweens are expected to be pre-scoped (via `node.tween`, or by closing over an outer signal). `Timeline.run(signal)` only checks the outer signal between steps; when it aborts, the currently-running inner tween rejects on its own scope and the outer `await` throws.

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

Point 3 is what keeps hours-of-play sessions from leaking listeners on long-lived node signals. `Animator.tween`, `wait`, `combineAbortSignals`, and everything built on them explicitly `removeEventListener` in their success paths. The `Animator.test.ts` suite verifies listener parity across a batch of tweens.

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
