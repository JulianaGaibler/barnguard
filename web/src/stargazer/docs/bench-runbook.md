---
title: Running the benchmarks
group: Internals
order: 25
---

# Running the benchmarks on a machine

This is the checklist for collecting one machine's numbers. The bench lives at
`?demo=bench`, and `dev/bench.ts` explains every parameter.

## Before you start

- Plug the machine in, close other apps, and use one display at its native
  resolution.
- Keep the browser window in front and visible for the whole run. A hidden or
  covered window is throttled, and a case that gets no frame for 10 seconds is
  recorded as stalled.
- Use a window of the same size in every browser, ideally maximized.
- Pick a label for the machine, such as `m2max`, `iris550` or `rtx4080`, and add
  it as `&label=` to every URL below. The report records it.

## Browser setup

**Chrome.** Nothing to set. It reports GPU time on both WebGL2 and WebGPU.

**Firefox.** Create a separate profile for benchmarking in `about:profiles`, so
the settings below do not touch the profile you browse with. In that profile,
set these in `about:config`:

| Setting                               | Value   | What it gives                                      |
| ------------------------------------- | ------- | -------------------------------------------------- |
| `privacy.reduceTimerPrecision`        | `false` | Frame times that are not rounded                   |
| `privacy.reduceTimerPrecision.jitter` | `false` | Frame times without added noise                    |
| `dom.webgpu.timestamp-queries.enable` | `true`  | GPU time on WebGPU                                 |
| `webgl.enable-privileged-extensions`  | `true`  | GPU time on WebGL2, where the platform supports it |

Firefox on macOS does not expose the WebGL2 timer query even with the last
setting, so its WebGL2 runs report no GPU time there. Check
`environment.timerQueryWebGL2` and `environment.timestampQueryWebGPU` in a
report to see what a machine offers.

**Safari.** WebGL2 runs need nothing. Check whether `?demo=bench&gfx=webgpu`
falls back (the report's `webgpuFallback` field) before running the WebGPU
suites. Safari exposes no GPU timer, so its reports have no GPU time.

## What to run

Run each URL to the end. The report box appears with Copy and Download buttons.
Download each report. The file name already holds the suite, browser, backend
and time.

Every machine, in every browser it has:

```
?demo=bench&suite=baseline&label=<machine>
?demo=bench&suite=baseline&label=<machine>&gfx=webgpu
?demo=bench&suite=paint&label=<machine>
?demo=bench&suite=layers&label=<machine>
?demo=bench&suite=layers&label=<machine>&gfx=webgpu
?demo=bench&suite=layers&label=<machine>&msaa=1
```

Machines whose 3D cost is in question, at least the weak GPU:

```
?demo=bench&suite=costs3d&label=<machine>
?demo=bench&suite=costs3d&label=<machine>&gfx=webgpu
```

`baseline` takes about four minutes, the others one to two. To repeat a few
cases without the whole suite, add `&only=<text>` with part of the case name.

## What to read in a report

- `frameMs.p95` and `fps`: whether the frame holds. Frame times include waiting
  for the display, so a case that keeps up reports the refresh interval.
- `jsMs`: the main thread's time per frame.
- `gpuMs` with `gpuKind`: GPU time per frame where the browser reports it.
- `drawCalls`, `drawCallsMean`, `passCount` and `offscreenBytes`: what the
  frame did, which should match across machines for the same case.
- `warning`: `nothing drawn` means the case did not render and its numbers are
  void.
- A case with `stalled` or `error` did not finish. Rerun it with `&only=`.
