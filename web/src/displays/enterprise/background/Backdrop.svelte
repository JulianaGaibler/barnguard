<script lang="ts">
  /**
   * The brand background: a blurred, sliced, grained diagonal gradient, on its
   * own secondary stage so its post-effects cover the background only and leave
   * the map canvas crisp. See `SliceShift.ts` and `GradientBackdropNode.ts`.
   *
   * Every input is time-invariant (a fixed gradient, a fixed slice, grain at
   * `hz: 0`), so the stage renders one frame, then parks via `setActive(false)`
   * rather than repainting an identical image every frame. It wakes for exactly
   * one more frame on a resize or a context restore, then parks again.
   */
  import {
    mountStage,
    CameraNode2D,
    ignoreAbort,
    DualKawaseBlur,
    FilmGrain,
    type Engine,
    type Stage,
  } from '@src/stargazer'
  import { SliceShift } from './SliceShift'
  // import { FoxTailNode, loadFoxTail } from './FoxTailNode'
  import { GradientBackdropNode } from './GradientBackdropNode'

  interface Props {
    engine: Engine
    /** Which gradient shows. A change fades from one to the other. */
    variant?: 'diagonal' | 'radial'
  }
  let { engine, variant = 'diagonal' }: Props = $props()

  // The frame the fox-tail placement and the camera viewport are both
  // authored against, matching the brand composite reference.
  const FRAME_WIDTH = 1920
  const FRAME_HEIGHT = 1080
  const SLICE_COLUMNS = 11

  let stage: Stage | undefined
  let backdrop: GradientBackdropNode | undefined
  const FADE_SEC = 0.6
  let offFrame: (() => void) | null = null
  let offContextRestored: (() => void) | null = null

  function renderOnceThenPark(s: Stage): void {
    s.setActive(true)
    offFrame?.()
    const off = engine.events.on('frame', () => {
      off()
      offFrame = null
      s.setActive(false)
    })
    offFrame = off
  }

  async function onReady(s: Stage): Promise<void> {
    stage = s
    const cam = new CameraNode2D()
    cam.setViewport({ x: 0, y: 0, width: FRAME_WIDTH, height: FRAME_HEIGHT })
    s.tree.root.add(cam)
    cam.makeCurrent()

    backdrop = new GradientBackdropNode(FRAME_WIDTH, FRAME_HEIGHT)
    backdrop.radialMix = variant === 'radial' ? 1 : 0
    s.tree.root.add(backdrop)
    // const tail = new FoxTailNode(await loadFoxTail())
    // tail.transform.x = 697
    // tail.transform.y = -491.6
    // tail.transform.scaleX = 1.1568
    // tail.transform.scaleY = 1.1568
    // s.tree.root.add(tail)

    s.postProcess.add(new DualKawaseBlur({ levels: 6, offset: 3 }))
    s.postProcess.add(new SliceShift({ columns: SLICE_COLUMNS }))
    s.postProcess.add(new FilmGrain({ density: 0.1, opacity: 0.1, hz: 0 }))
    s.postProcess.warm()

    // A WebGL2 context loss is restorable in place, unlike the primary
    // canvas's WebGPU device loss (terminal, handled by `GameScreen`
    // remounting this component along with the game canvas). Nothing reacts
    // to the loss itself, only to the restore.
    offContextRestored = s.device.onContextRestored(() => {
      s.reacquireContext()
      renderOnceThenPark(s)
    })

    renderOnceThenPark(s)
  }

  // The stage is parked between renders, so a fade has to wake it for as long
  // as it runs and park it again after.
  $effect(() => {
    const target = variant === 'radial' ? 1 : 0
    const node = backdrop
    const s = stage
    if (!node || !s || node.radialMix === target) return
    s.setActive(true)
    engine
      .tween(node, { radialMix: target }, { duration: FADE_SEC, key: 'fade' })
      .catch(ignoreAbort)
      .finally(() => renderOnceThenPark(s))
  })

  function onResize(): void {
    // The ResizeObserver this fires from is set up inside `attachStage`
    // itself, so `onReady` (and the `stage` assignment above) has already run
    // by the time a real resize can reach here.
    if (stage) renderOnceThenPark(stage)
  }

  function onDestroy(): void {
    offFrame?.()
    offFrame = null
    offContextRestored?.()
    offContextRestored = null
    stage = undefined
  }
</script>

<canvas
  class="backdrop"
  use:mountStage={{
    engine,
    options: { transparent: false, clearColor: '#D1C3F4', onResize },
    onReady,
    onDestroy,
  }}
></canvas>

<style lang="sass">
  .backdrop
    position: absolute
    inset: 0
    width: 100%
    height: 100%
    display: block
    pointer-events: none
</style>
