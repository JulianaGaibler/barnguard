<script lang="ts">
  import type { Snippet } from 'svelte'
  import { TONE_COLORS } from '../thresholds'
  import { asTip, type TipSpec } from './tip'

  interface Props {
    /** What to show. With nothing, the children render alone. */
    tip?: TipSpec | string
    /** The title given to a tip that is bare text. */
    label?: string
    /** Size the anchor to its content instead of the full width. */
    inline?: boolean
    children: Snippet
  }

  const { tip, label, inline = false, children }: Props = $props()

  const spec = $derived.by(() => {
    const s = asTip(tip)
    return s && label && !s.title ? { ...s, title: label } : s
  })

  let anchor = $state<HTMLElement | null>(null)
  let pop = $state<HTMLElement | null>(null)
  let open = $state(false)
  let timer: ReturnType<typeof setTimeout> | null = null

  const WIDTH = $derived(spec?.table ? 340 : 260)
  const GAP = 6
  const MARGIN = 8

  /** Place the popover under the anchor, or over it when there is no room. */
  function place(): void {
    if (!anchor || !pop) return
    const a = anchor.getBoundingClientRect()
    const h = pop.offsetHeight
    let left = a.left
    left = Math.max(MARGIN, Math.min(left, window.innerWidth - WIDTH - MARGIN))
    let top = a.bottom + GAP
    if (top + h > window.innerHeight - MARGIN && a.top - GAP - h > MARGIN) {
      top = a.top - GAP - h
    }
    pop.style.left = `${left}px`
    pop.style.top = `${Math.max(MARGIN, top)}px`
  }

  function show(): void {
    if (!spec || !pop) return
    if (!open) {
      open = true
      pop.showPopover()
    }
    place()
  }

  function hide(): void {
    if (timer) clearTimeout(timer)
    timer = null
    if (open && pop) {
      pop.hidePopover()
      open = false
    }
  }

  function enter(e: PointerEvent): void {
    // A touch has no hover, so it toggles on tap instead.
    if (e.pointerType === 'touch') return
    if (timer) clearTimeout(timer)
    timer = setTimeout(show, 180)
  }

  function tap(e: MouseEvent): void {
    const pointer = e as MouseEvent & { pointerType?: string }
    if (pointer.pointerType === 'touch' || e.detail === 0) {
      if (open) hide()
      else show()
    }
  }

  function key(e: KeyboardEvent): void {
    if (e.key === 'Escape') hide()
  }

  // A scale's marker position, as a percentage of the bar.
  const pct = (v: number, max: number): number =>
    Math.max(0, Math.min(100, (v / Math.max(max, 1e-9)) * 100))

  const zones = $derived.by(() => {
    const s = spec?.scale
    if (!s) return []
    const g = pct(s.good, s.max)
    const w = pct(s.warn, s.max)
    return s.lowIsBad
      ? [
          { from: 0, to: w, color: TONE_COLORS.bad },
          { from: w, to: g, color: TONE_COLORS.warn },
          { from: g, to: 100, color: TONE_COLORS.good },
        ]
      : [
          { from: 0, to: g, color: TONE_COLORS.good },
          { from: g, to: w, color: TONE_COLORS.warn },
          { from: w, to: 100, color: TONE_COLORS.bad },
        ]
  })
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="tip-anchor"
  class:inline
  bind:this={anchor}
  onpointerenter={enter}
  onpointerleave={hide}
  onfocusin={show}
  onfocusout={hide}
  onclick={tap}
  onkeydown={key}
>
  {@render children()}
  {#if spec}
    <div class="tip" popover="manual" bind:this={pop} style:width="{WIDTH}px">
      {#if spec.title || spec.value}
        <div class="head">
          {#if spec.title}<span class="title">{spec.title}</span>{/if}
          {#if spec.value}
            <span
              class="value"
              style:color={TONE_COLORS[spec.tone ?? 'neutral']}
            >
              {spec.value}
            </span>
          {/if}
        </div>
      {/if}
      {#if spec.body}<p class="body">{spec.body}</p>{/if}
      {#if spec.scale}
        {@const s = spec.scale}
        <div class="scale">
          <div class="bar">
            {#each zones as z, i (i)}
              <span
                class="zone"
                style:left="{z.from}%"
                style:width="{z.to - z.from}%"
                style:background={z.color}
              ></span>
            {/each}
            <span class="marker" style:left="{pct(s.value, s.max)}%"></span>
          </div>
          <div class="ticks">
            <span style:left="{pct(s.lowIsBad ? s.warn : s.good, s.max)}%">
              {s.format(s.lowIsBad ? s.warn : s.good)}
            </span>
            <span style:left="{pct(s.lowIsBad ? s.good : s.warn, s.max)}%">
              {s.format(s.lowIsBad ? s.good : s.warn)}
            </span>
          </div>
          <div class="legend">
            <span class="dot" style:background={TONE_COLORS.good}></span>good
            <span class="dot" style:background={TONE_COLORS.warn}></span>watch
            <span class="dot" style:background={TONE_COLORS.bad}></span>high
          </div>
        </div>
      {/if}
      {#if spec.facts}
        <dl class="facts">
          {#each spec.facts as f, i (i)}
            <dt>{f.label}</dt>
            <dd style:color={f.tone ? TONE_COLORS[f.tone] : undefined}>
              {f.value}
            </dd>
          {/each}
        </dl>
      {/if}
      {#if spec.table}
        {@const t = spec.table}
        <table class="table">
          <thead>
            <tr>
              {#each t.head as h, i (i)}<th>{h}</th>{/each}
            </tr>
          </thead>
          <tbody>
            {#each t.rows as row, i (i)}
              <tr class:current={t.current === i}>
                {#each row as cell, c (c)}<td>{cell}</td>{/each}
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    </div>
  {/if}
</div>

<style lang="sass">
  .tip-anchor
    display: block
    min-width: 0

    &.inline
      display: inline-block

  // The popover sits in the top layer, so no panel's scrolling clips it. It
  // is placed by script, so the browser's default centring is cleared.
  .tip
    position: fixed
    inset: auto
    margin: 0
    padding: 8px 10px
    box-sizing: border-box
    max-width: calc(100vw - 16px)
    color: #fff
    background: rgba(12, 14, 20, 0.97)
    border: 1px solid rgba(255, 255, 255, 0.28)
    border-radius: 4px
    box-shadow: 0 6px 22px rgba(0, 0, 0, 0.55)
    font-family: 'SF Mono', 'Monaco', 'Inconsolata', 'Roboto Mono', 'Courier New', monospace
    font-size: 10px
    line-height: 1.45
    font-variant-numeric: slashed-zero tabular-nums
    pointer-events: none
    overflow: visible

  .head
    display: flex
    justify-content: space-between
    align-items: baseline
    gap: 8px

  .title
    font-weight: 700
    font-size: 11px

  .value
    font-weight: 700
    font-size: 11px

  .body
    margin: 4px 0 0
    opacity: 0.8

  .scale
    margin-top: 8px

  .bar
    position: relative
    height: 8px
    border-radius: 3px
    overflow: hidden
    background: rgba(255, 255, 255, 0.08)

  .zone
    position: absolute
    top: 0
    bottom: 0
    opacity: 0.55

  .marker
    position: absolute
    top: -1px
    bottom: -1px
    width: 3px
    margin-left: -1.5px
    background: #fff
    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.6)

  .ticks
    position: relative
    height: 12px
    margin-top: 2px
    opacity: 0.6

    span
      position: absolute
      transform: translateX(-50%)
      font-size: 9px
      white-space: nowrap

  .legend
    display: flex
    align-items: center
    gap: 4px
    font-size: 9px
    opacity: 0.6

    .dot
      width: 6px
      height: 6px
      border-radius: 50%
      margin-left: 4px

      &:first-child
        margin-left: 0

  .facts
    display: grid
    grid-template-columns: auto 1fr
    gap: 2px 10px
    margin: 6px 0 0

    dt
      opacity: 0.6

    dd
      margin: 0
      text-align: right
      font-weight: 600

  .table
    width: 100%
    margin-top: 6px
    border-collapse: collapse

    th
      text-align: left
      font-weight: 600
      opacity: 0.55
      padding: 1px 4px 2px 0

    td
      padding: 1px 6px 1px 0
      white-space: nowrap

      &:last-child
        white-space: normal

    tr.current td
      color: #fbbf24
      font-weight: 700
</style>
