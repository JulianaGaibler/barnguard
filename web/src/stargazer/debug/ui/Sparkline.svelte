<script lang="ts">
  import { onMount } from 'svelte'
  import { foldWorst, type SeriesSource } from '../RingSeries'
  import { TONE_COLORS, type Tone } from '../thresholds'

  interface Props {
    source: SeriesSource
    /** Bump this to redraw. The hub's rAF poll increments it. */
    revision: number
    /** Multiplied into every sample, for example 1000 to show seconds as ms. */
    scale?: number
    /**
     * Value at the top of the graph. Default: the largest sample, with
     * headroom.
     */
    max?: number
    tone?: Tone
    /** CSS height. Default 18. */
    height?: number
    /** Skip redraws when false. */
    active?: boolean
  }

  const {
    source,
    revision,
    scale = 1,
    max,
    tone = 'neutral',
    height = 18,
    active = true,
  }: Props = $props()

  let canvas = $state<HTMLCanvasElement | null>(null)
  let ctx: CanvasRenderingContext2D | null = null
  let dpr = 1
  let cssW = 0
  let cssH = 0
  let scratch = new Float32Array(0)
  let folded = new Float32Array(0)

  function syncSize(): void {
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const w = Math.max(1, Math.round(rect.width))
    const h = Math.max(1, Math.round(rect.height))
    const d = window.devicePixelRatio || 1
    if (w === cssW && h === cssH && d === dpr && ctx !== null) return
    cssW = w
    cssH = h
    dpr = d
    canvas.width = Math.round(w * d)
    canvas.height = Math.round(h * d)
    ctx = canvas.getContext('2d')
  }

  function draw(): void {
    if (!canvas) return
    syncSize()
    if (!ctx) return
    const cap = source.capacity
    if (scratch.length !== cap) {
      scratch = new Float32Array(cap)
      folded = new Float32Array(cap)
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    const n = source.readOrdered(scratch)
    if (n === 0) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const cols = foldWorst(scratch, n, cssW, folded)
    let top = max
    if (top === undefined) {
      top = 0
      for (let c = 0; c < cols; c++) if (folded[c] > top) top = folded[c]
      top = Math.max(top * 1.15, 1e-6)
    } else {
      top = top / scale
    }
    const xStart = cssW - cols
    const color = TONE_COLORS[tone]
    ctx.beginPath()
    ctx.moveTo(xStart, cssH)
    for (let c = 0; c < cols; c++) {
      const y = cssH - Math.min(1, folded[c] / top) * (cssH - 1)
      ctx.lineTo(xStart + c, y)
    }
    ctx.lineTo(xStart + cols - 1, cssH)
    ctx.closePath()
    ctx.globalAlpha = 0.18
    ctx.fillStyle = color
    ctx.fill()
    ctx.globalAlpha = 1
    ctx.beginPath()
    for (let c = 0; c < cols; c++) {
      const y = cssH - Math.min(1, folded[c] / top) * (cssH - 1) + 0.5
      if (c === 0) ctx.moveTo(xStart, y)
      else ctx.lineTo(xStart + c, y)
    }
    ctx.lineWidth = 1.25
    ctx.lineJoin = 'round'
    ctx.strokeStyle = color
    ctx.stroke()
  }

  onMount(() => {
    syncSize()
    draw()
    const ro = new ResizeObserver(() => {
      syncSize()
      draw()
    })
    if (canvas) ro.observe(canvas)
    return () => ro.disconnect()
  })

  $effect(() => {
    void revision
    void scale
    void max
    void tone
    if (!active) return
    draw()
  })
</script>

<canvas class="sparkline" style:height="{height}px" bind:this={canvas}></canvas>

<style lang="sass">
  .sparkline
    display: block
    width: 100%
    box-sizing: border-box
</style>
