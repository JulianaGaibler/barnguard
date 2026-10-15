---
title: Animation
group: Features
order: 7
---

# Animation and async lifecycle

Stargazer animates with tweens. A tween moves numeric properties from their current values to target values over a duration, and returns a Promise that resolves when it ends. You chain animations with `await`, and you cancel them with an `AbortSignal`.

The engine's {@link Animator} runs every tween and wait. It advances them once per frame in engine time, so they stop while the engine is paused. You rarely call the animator directly. Nodes have helpers that tie a tween to the node's lifetime, so destroying the node cancels its tweens.

You need an {@link Engine} and a node attached to one of its scenes. See [Setup](/guides/setup) and [Scene graph](/guides/scene). The `?demo=anim` dev demo runs a looping timeline and shows cancellation and the overlap warning.

## Basic usage

This example scales a node up, waits half a second, then fades it out:

```ts
import { easings, ignoreAbort } from '@src/stargazer'

async function popAndFade(node: Node2D): Promise<void> {
  await node.tween(
    { scaleX: 1.5, scaleY: 1.5 },
    { duration: 0.3, easing: easings.outBack },
  )
  await node.wait(0.5)
  await node.tween({ alpha: 0 }, { duration: 0.4 })
}

popAndFade(node).catch(ignoreAbort)
```

Each `await` resumes on the frame the step finishes. If the node is destroyed during the sequence, the pending step rejects with an `AbortError`. {@link ignoreAbort} swallows that error and rethrows any other.

### Animate a node's transform

[`Node2D.tween`](/module/scene/node2d#tween) animates fields of the node's {@link Transform2D}: `x`, `y`, `scaleX`, `scaleY`, `rotation`, `skew`, `skewAxis`, `originX`, `originY` and `alpha`. It returns a Promise. When you don't need to wait for the end, use [`play`](/module/scene/node2d#play). It takes the same arguments, returns nothing, and swallows the `AbortError` for you.

```ts
// Await the move, then continue.
await node.tween({ x: 400, y: 200 }, { duration: 0.5 })

// Start a short pop and move on.
node.play({ scaleX: 1.1, scaleY: 1.1 }, { duration: 0.15 })
```

A {@link Node3D} has its own [`tween`](/module/scene/node3d#tween) and [`play`](/module/scene/node3d#play). They take a {@link Node3DTweenTo} with `position`, `rotation` (a quaternion), `scale` and `alpha`. Position, scale and alpha interpolate linearly. Rotation uses spherical interpolation.

```ts
await pivot.tween(
  { position: { x: 0, y: 2, z: 0 }, scale: { x: 2, y: 2, z: 2 } },
  { duration: 0.6, easing: easings.inOutCubic },
)
```

### Animate any object

[`tweenTo`](/module/scene/node#tweento) animates numeric fields on any object and still cancels when the node is destroyed. Use it for anything that is not a transform field, such as a paint property, a physics body's position, or a plain `{ progress: 0 }` value that your code reads. [`playTo`](/module/scene/node#playto) is the version you don't await.

```ts
const reveal = { progress: 0 }
await node.tweenTo(reveal, { progress: 1 }, { duration: 0.8 })

node.playTo(ring, { width: 12 }, { duration: 0.2, easing: easings.outBack })
```

Only properties that hold a number in both the target and `to` are animated. Other properties are ignored.

[`engine.tween`](/module/engine/engine#tween) and [`engine.wait`](/module/engine/engine#wait) do the same work without a node. Nothing cancels them except a `signal` you pass, or engine destroy. [`engine.animate`](/module/engine/engine#animate) tweens a `Node2D`'s transform and cancels with that node.

```ts
await engine.tween(fx, { intensity: 1 }, { duration: 0.3 })
await engine.wait(1.2)
await engine.animate(node, { alpha: 0 }, { duration: 0.3 })
```

### Wait

[`node.wait(seconds)`](/module/scene/node#wait) resolves after that many seconds of engine time and rejects with `AbortError` if the node is destroyed first. Engine time stops while the engine is paused or its ticker is stopped, so waits stop too. A wait of `0` resolves on the next frame. An optional second argument is an extra `AbortSignal` that also cancels the wait.

### Run steps in order with a timeline

A {@link Timeline} runs steps one after another. [`parallel`](/module/anim/timeline#parallel) adds one step that runs several steps at the same time and ends when all of them end. [`node.timeline()`](/module/scene/node#timeline) is shorthand for `new Timeline()`.

```ts
await node
  .timeline()
  .add((s) =>
    node.tween(
      { scaleX: 1, scaleY: 1 },
      { duration: 0.35, easing: easings.outBack, signal: s },
    ),
  )
  .add((s) => node.tween({ x: 400 }, { duration: 0.5, signal: s }))
  .parallel(
    (s) => node.tween({ alpha: 0 }, { duration: 0.4, signal: s }),
    (s) => node.tween({ y: 100 }, { duration: 0.4, signal: s }),
  )
  .run(scope.signal)
```

A step is a {@link TimelineStep}: a function that receives the signal given to [`run`](/module/anim/timeline#run) and returns a Promise. `run` checks the signal before each step and passes it into the step, so a step that forwards it as `{ signal: s }` stops mid-tween when the signal aborts. Steps must return a Promise, so use `tween` and `tweenTo`, not `play` and `playTo`.

A timeline suits a fixed sequence. For branches, loops or state changes between steps, write a plain `async` function and pass the signal to each call.

### Easings

An easing maps progress from 0 to 1 onto the eased value. The default is linear. The built-in easings are in the {@link easings} namespace:

```ts
import { easings } from '@src/stargazer'

easings.linear
easings.inQuad // also outQuad, inOutQuad
easings.inCubic // also outCubic, inOutCubic
easings.outQuint
easings.outBack // overshoots past 1, then settles
easings.outElastic // rings around 1 before settling
easings.outBounce // bounces against 1 as a floor
easings.cubicBezier(0.42, 0, 0.58, 1) // same as CSS ease-in-out
easings.makeOutBack(3) // outBack with a larger overshoot
easings.makeOutBounce(0.5, 0.2, 3) // elasticity, first bounce height, bounces
```

In `cubicBezier(x1, y1, x2, y2)`, `x1` and `x2` must be between 0 and 1. `y1` and `y2` can go outside that range to overshoot. Any function of type {@link Easing}, `(t: number) => number`, works as an easing.

## Advanced usage

This section covers tween options, cancellation in detail, frame timing and costs.

### Tween options

Every tween helper takes a {@link TweenOptions} object:

| Option     | Type          | Default  | Meaning                                                                                   |
| ---------- | ------------- | -------- | ----------------------------------------------------------------------------------------- |
| `duration` | `number`      | required | Length in seconds. `0` completes on the next frame.                                       |
| `delay`    | `number`      | `0`      | Seconds to wait before the tween starts moving.                                           |
| `easing`   | `Easing`      | linear   | Maps progress to the eased value.                                                         |
| `signal`   | `AbortSignal` | none     | Aborting it rejects the Promise with `AbortError`. Node helpers combine it with the node. |
| `onUpdate` | `() => void`  | none     | Called every frame after the tween writes its values.                                     |
| `key`      | `string`      | none     | Cancels a running tween with the same key on the same target. See below.                  |

The tween reads its start values when you call it, before any `delay`. A change to the target during the delay is overwritten when the tween starts moving.

### Restart an animation with a key

An animation that can retrigger, such as a glow on each hit, must cancel its previous run first. Otherwise two tweens write the same field. Give the tween a `key`. Starting a keyed tween aborts any running tween with the same `key` on the same target, and the aborted one rejects with `AbortError`.

```ts
// Each call replaces the previous ring animation on this node.
node.playTo(ring, { width }, { duration: 0.2, key: 'ring' })
```

The animator matches the key and the target object. If you call `tweenTo` or `playTo` with a new object each time, the key never matches and does nothing. Pass the same object every time. `Node2D.tween` always targets the node's own transform, and `Node3D.tween` keeps one internal target per key, so `key` works on both as written.

### Cancel a sequence with a scope

An {@link AbortScope} hands out one signal per run of a sequence. Calling [`reset()`](/module/anim/abortscope#reset) aborts the previous run's signal and returns a fresh one. Use it for a sequence that must stop as soon as the next one starts, such as a round of a card game. [`node.scope()`](/module/scene/node#scope) creates a scope that the node's destruction aborts and disposes.

```ts
const scope = node.scope()

function startRound(): void {
  const signal = scope.reset() // aborts the previous round
  void (async () => {
    await dealCards(signal)
    await playRound(signal)
    await showResult(signal)
  })().catch(ignoreAbort)
}
```

Read `scope.reset()` once at the top of the sequence and pass that signal into every tween and wait inside it (`{ signal }`). When the next `reset()` runs, those calls reject with `AbortError`, the async function unwinds, and the one `.catch(ignoreAbort)` keeps it quiet. You need no check after each `await`.

A scope has three ways to end a run:

- `reset()` aborts the current signal and starts a new one.
- `abort()` aborts the current signal and starts nothing until the next `reset()`.
- `dispose()` aborts the current signal and makes the scope unusable.

### Repeat work while a node lives

[`node.loop(body)`](/module/scene/node#loop) runs an async `body` again and again until the node is destroyed. `body` receives `{ node, signal, iteration, nextFrame }`. `nextFrame()` resolves on the next frame. The loop swallows `AbortError` and stops on any other error after logging it with `console.error`. The first run starts a microtask later, so a behavior can call `loop` from `onAttach`.

```ts
node.loop(async ({ signal }) => {
  await node.tween({ y: 10 }, { duration: 1, signal })
  await node.tween({ y: 0 }, { duration: 1, signal })
})
```

[`node.autoDestroy(promise)`](/module/scene/node#autodestroy) destroys the node when the Promise settles. Use it for a node that only exists for one animation, such as a floating score label. A rejection other than `AbortError` is logged with `console.warn`, and the node is still destroyed.

### Abort contract

Every helper that takes a `signal` behaves the same way:

1. If the signal is already aborted when you call the helper, the Promise rejects with `DOMException('Aborted', 'AbortError')`.
2. If the signal aborts while the helper runs, the Promise rejects with the same error.
3. When the helper finishes normally, it removes its listener from the signal.

Point 3 keeps a long session from piling up listeners on a node's signal, which lives as long as the node. {@link isAbortError} tests for the error without swallowing it, and {@link abortError} creates one, for your own async helpers.

### Destroyed or never attached

The node helpers reach the engine through the node's owner. When there is no engine, the rejection says why:

- If the node is destroyed, the Promise rejects with `AbortError`. A sequence that outlives its node is a normal cancellation, whether the node died during an `await` or before the call.
- If the node was never attached, the Promise rejects with a plain `Error`. This is a setup mistake, so `ignoreAbort` rethrows it.

This applies to `wait`, `tweenTo`, `Node2D.tween`, `Node3D.tween`, [`CameraNode2D.animateTo`](/module/camera/cameranode2d#animateto) and [`CameraNode3D.animateProjection`](/module/camera/cameranode3d#animateprojection). It lets a sequence of several awaits with no guard between them unwind through one `ignoreAbort`.

### Combine signals

{@link combineAbortSignals} returns a {@link CombinedAbort}, `{ signal, dispose }`. The combined signal aborts when any source aborts. `dispose()` removes the listeners it added to the sources. Call it when your operation ends:

```ts
import { combineAbortSignals } from '@src/stargazer'

const combined = combineAbortSignals(node.abortSignal, opts.signal)
try {
  await engine.tween(target, to, { ...opts, signal: combined.signal })
} finally {
  combined.dispose()
}
```

The node helpers and `engine.animate` do this already. Sources that are `undefined` or `null` are skipped. If a source is already aborted, the combined signal aborts at once and `dispose()` does nothing.

### Overlapping tweens

When two tweens without a `key` animate the same field of the same target, both run to the end. The one started later writes last on each frame, so its value wins. The animator logs a warning when the second one starts:

```
[stargazer] overlapping tween on the same target key 'x'. Last-writer wins per tick; cancel the earlier tween to avoid drift.
```

To hand over cleanly, give both tweens the same `key`, or pass a `signal` to the first and abort it before you start the second.

### What a tween repaints

A tween of a transform field or of `alpha` never repaints the node. It only changes the matrix the renderer applies. A tween of a property declared with {@link definePaintProps} marks the node for repaint on every frame the value changes. Tween the transform when the effect allows it. See [Drawing](/guides/drawing).

### Frame order and pausing

Each frame, the engine runs before-frame hooks ([`onBeforeFrame`](/module/engine/engine#onbeforeframe)), then input, then the animator, then each node's `onUpdate`. Your `onUpdate` code therefore reads the values the tweens wrote this frame. A tween started during the animator's pass first moves on the next frame.

While [`engine.setPaused(true)`](/module/engine/engine#setpaused) is in effect, the animator does not advance. Tweens and waits hold where they are and continue when you unpause.

### Engine destroy

[`engine.destroy()`](/module/engine/engine#destroy) calls [`animation.cancelAll()`](/module/anim/animator#cancelall) before it tears down any scene. Every pending tween and wait rejects with `AbortError`, and later calls on that animator reject at once. Then the scenes are destroyed, which aborts every node signal. A `.catch(ignoreAbort)` keeps each of these quiet. A Promise without one surfaces as an unhandled rejection.

### Keyframe animation from glTF

Tweens are separate from keyframe playback. An {@link AnimationPlayer} plays an {@link AnimationClip} loaded from a glTF file. See [3D](/guides/3d).

## See also

- {@link Animator}: the engine's tween and wait runner
- {@link TweenOptions}: options for every tween helper
- {@link Timeline}: sequential and parallel steps
- {@link AbortScope}: one cancel signal per run of a sequence
- {@link combineAbortSignals}: merge abort signals with cleanup
- {@link easings}: built-in easing functions
- [Scene graph](/guides/scene): node lifetime and `abortSignal`
- [Camera](/guides/camera): camera pan and zoom animation
- [3D](/guides/3d): glTF keyframe playback
