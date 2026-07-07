<script lang="ts">
  import { onMount } from 'svelte'
  import type { FrameStats } from '../FrameStats'

  interface Props {
    stats: FrameStats
    /** Bump this to trigger a redraw. Parent's rAF poll increments it. */
    revision: number
    /** CSS height of the graph. Default 40. */
    height?: number
    /**
     * Frame-time threshold (ms) below which bars render green. Default 16.7 (60
     * fps).
     */
    goodMs?: number
    /**
     * Frame-time threshold (ms) below which bars render orange. Default 33 (30
     * fps).
     */
    badMs?: number
    /** Skip redraw when false. Set from the parent's <details> open state. */
    active?: boolean
  }

  const {
    stats,
    revision,
    height = 40,
    goodMs = 16.7,
    badMs = 33,
    active = true,
  }: Props = $props()

  const COLOR_GOOD = '#4ade80'
  const COLOR_WARN = '#fbbf24'
  const COLOR_BAD = '#f87171'
  const COLOR_GOOD_LINE = 'rgba(74, 222, 128, 0.25)'
  const COLOR_WARN_LINE = 'rgba(251, 191, 36, 0.25)'
  const COLOR_FILL = 'rgba(96, 165, 250, 0.12)'
  const COLOR_BG = 'rgba(255, 255, 255, 0.04)'

  let canvas = $state<HTMLCanvasElement | null>(null)
  let ctx: CanvasRenderingContext2D | null = null
  let dpr = 1
  let cssW = 0
  let cssH = 0
  // Grown lazily in draw() to match stats.capacity, avoids reading a
  // possibly-reactive prop at module init.
  let scratch = new Float32Array(0)
  let xs = new Float32Array(0)
  let ys = new Float32Array(0)
  let msBuf = new Float32Array(0)

  function syncSize(): boolean {
    if (!canvas) return false
    const rect = canvas.getBoundingClientRect()
    const newCssW = Math.max(1, Math.round(rect.width))
    const newCssH = Math.max(1, Math.round(rect.height))
    const newDpr = window.devicePixelRatio || 1
    if (
      newCssW === cssW &&
      newCssH === cssH &&
      newDpr === dpr &&
      ctx !== null
    ) {
      return false
    }
    cssW = newCssW
    cssH = newCssH
    dpr = newDpr
    canvas.width = Math.round(cssW * dpr)
    canvas.height = Math.round(cssH * dpr)
    // getContext returns the same instance on repeat calls, but if a hot
    // reload swapped the canvas we may need to re-fetch, cheap either way.
    ctx = canvas.getContext('2d')
    return true
  }

  function draw(): void {
    if (!canvas) return
    // Re-check every frame, cheaper than trying to catch every path that can
    // change the panel width (details toggle, drag, DPR shift, browser zoom).
    syncSize()
    if (!ctx) return

    const cap = stats.capacity
    if (scratch.length !== cap) {
      scratch = new Float32Array(cap)
      xs = new Float32Array(cap)
      ys = new Float32Array(cap)
      msBuf = new Float32Array(cap)
    }

    const devW = canvas.width
    const devH = canvas.height
    // Vertical scale ceiling. Anything worse than ~16 fps saturates the top.
    const scaleMs = Math.max(goodMs * 3, 30)

    // 1) Clear + subtle background. clearRect first, the bg fill is
    //    semi-transparent and would accumulate otherwise.
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, devW, devH)
    ctx.fillStyle = COLOR_BG
    ctx.fillRect(0, 0, devW, devH)

    // 2) Switch to CSS-px coordinates for all vector work. lineWidth=1 stays
    //    1 CSS px regardless of DPR; the DPR baseline handles the crispness.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    // 3) Threshold guide lines + y-axis labels. Labels sit at the left edge,
    //    just above their line, oldest-data side, so they overlap least with
    //    the newest samples' motion.
    const goodY = Math.round(cssH - (goodMs / scaleMs) * cssH) + 0.5
    const badY = Math.round(cssH - (badMs / scaleMs) * cssH) + 0.5
    ctx.lineWidth = 1
    ctx.setLineDash([2, 3])
    if (goodY > 0 && goodY < cssH) {
      ctx.strokeStyle = COLOR_GOOD_LINE
      ctx.beginPath()
      ctx.moveTo(0, goodY)
      ctx.lineTo(cssW, goodY)
      ctx.stroke()
    }
    if (badY > 0 && badY < cssH) {
      ctx.strokeStyle = COLOR_WARN_LINE
      ctx.beginPath()
      ctx.moveTo(0, badY)
      ctx.lineTo(cssW, badY)
      ctx.stroke()
    }
    ctx.setLineDash([])

    ctx.font = '9px "SF Mono", "Monaco", "Roboto Mono", monospace'
    ctx.textBaseline = 'bottom'
    ctx.textAlign = 'left'
    ctx.fillStyle = 'rgba(255, 255, 255, 0.55)'
    ctx.fillText(`${goodMs.toFixed(1)}ms`, 2, goodY - 1)
    ctx.fillText(`${badMs.toFixed(0)}ms`, 2, badY - 1)

    // 4) Read samples and lay one point per CSS column, filling the full width
    //    once we've accumulated cssW samples. Fractional stride, a fixed
    //    integer stride would leave a gap on the right whenever `n` isn't a
    //    clean multiple of the available column count.
    const n = stats.readOrdered(scratch)
    if (n === 0) return
    const drawCount = Math.min(cssW, n)
    const xStart = cssW - drawCount
    for (let c = 0; c < drawCount; c++) {
      // Sample range [startIdx, endIdx) for this column. When n <= drawCount,
      // this simplifies to a single sample per column.
      const startIdx = Math.floor((c * n) / drawCount)
      const endIdx = Math.min(
        n,
        Math.max(startIdx + 1, Math.floor(((c + 1) * n) / drawCount)),
      )
      // Worst-of-slice makes spikes survive folding, better perf diagnostic
      // than averaging, which smooths spikes away.
      let worst = 0
      for (let i = startIdx; i < endIdx; i++) {
        const v = scratch[i]
        if (v > worst) worst = v
      }
      const ms = worst * 1000
      const clamped = Math.min(Math.max(0, ms), scaleMs)
      xs[c] = xStart + c
      ys[c] = cssH - (clamped / scaleMs) * cssH
      msBuf[c] = ms
    }

    // 5) Subtle fill under the line, single tint so the health cue stays on
    //    the line color, not on the fill.
    ctx.fillStyle = COLOR_FILL
    ctx.beginPath()
    ctx.moveTo(xs[0], cssH)
    for (let c = 0; c < drawCount; c++) ctx.lineTo(xs[c], ys[c])
    ctx.lineTo(xs[drawCount - 1], cssH)
    ctx.closePath()
    ctx.fill()

    // 6) Line stroke, segments grouped by health tier and batched into three
    //    stroke calls. Segment tier = max(endpoint) so a spike from good to
    //    warn strokes as warn (visible), not as good (hidden).
    ctx.lineWidth = 2
    ctx.lineJoin = 'round'
    ctx.lineCap = 'butt'

    if (drawCount === 1) {
      const ms = msBuf[0]
      ctx.fillStyle =
        ms < goodMs ? COLOR_GOOD : ms < badMs ? COLOR_WARN : COLOR_BAD
      ctx.fillRect(xs[0] - 1, ys[0] - 1, 2, 2)
      return
    }

    strokeTier(drawCount, COLOR_GOOD, (m) => m < goodMs)
    strokeTier(drawCount, COLOR_WARN, (m) => m >= goodMs && m < badMs)
    strokeTier(drawCount, COLOR_BAD, (m) => m >= badMs)
  }

  function strokeTier(
    drawCount: number,
    color: string,
    include: (worstMs: number) => boolean,
  ): void {
    if (!ctx) return
    ctx.beginPath()
    let pen = -1 // index of the last point the pen was moved to
    for (let c = 1; c < drawCount; c++) {
      const worst = msBuf[c - 1] > msBuf[c] ? msBuf[c - 1] : msBuf[c]
      if (!include(worst)) continue
      if (pen !== c - 1) ctx.moveTo(xs[c - 1], ys[c - 1])
      ctx.lineTo(xs[c], ys[c])
      pen = c
    }
    ctx.strokeStyle = color
    ctx.stroke()
  }

  onMount(() => {
    if (!canvas) return
    syncSize()
    draw()
    const ro = new ResizeObserver(() => {
      syncSize()
      draw()
    })
    ro.observe(canvas)
    return () => ro.disconnect()
  })

  $effect(() => {
    // Track prop for reactivity.
    void revision
    if (!active) return
    draw()
  })
</script>

<canvas class="frame-graph" style:height="{height}px" bind:this={canvas}
></canvas>
<div class="frame-graph-legend">
  <span class="dot" style:background={COLOR_GOOD}></span>
  <span>&lt;{goodMs.toFixed(1)}</span>
  <span class="dot" style:background={COLOR_WARN}></span>
  <span>&lt;{badMs.toFixed(0)}</span>
  <span class="dot" style:background={COLOR_BAD}></span>
  <span>&gt;={badMs.toFixed(0)}</span>
  <span class="unit">ms</span>
</div>

<style lang="sass">
  .frame-graph
    display: block
    width: 100%
    box-sizing: border-box
    border: 1px solid rgba(255, 255, 255, 0.1)
    border-radius: 2px

  .frame-graph-legend
    display: flex
    align-items: center
    gap: 4px
    padding: 3px 0 1px
    font-size: 9px
    color: rgba(255, 255, 255, 0.55)

    .dot
      width: 7px
      height: 7px
      border-radius: 50%
      flex-shrink: 0

    .unit
      margin-left: auto
      opacity: 0.7
</style>
