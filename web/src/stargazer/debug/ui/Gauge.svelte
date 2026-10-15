<script lang="ts">
  import { TONE_COLORS, type Tone } from '../thresholds'
  import Tooltip from './Tooltip.svelte'
  import type { TipSpec } from './tip'

  interface Props {
    label: string
    /** The text shown at the right, already formatted. */
    reading: string
    /** The value, on the same scale as `max` and the zones. */
    value: number
    /** The value at the right end of the bar. */
    max: number
    /**
     * Where the good and warning zones end, on the same scale. With `lowIsBad`
     * the zones run the other way: bad up to `warn`, then warning up to
     * `good`.
     */
    good?: number
    warn?: number
    lowIsBad?: boolean
    tone?: Tone
    /** A mark for the highest value seen, on the same scale. */
    peak?: number
    tip?: TipSpec | string
  }

  const {
    label,
    reading,
    value,
    max,
    good,
    warn,
    lowIsBad = false,
    tone = 'neutral',
    peak,
    tip,
  }: Props = $props()

  const pct = (v: number): number =>
    Math.max(0, Math.min(100, (v / Math.max(max, 1e-9)) * 100))

  // Zone boundaries as percentages of the bar, in drawing order.
  const zones = $derived.by(() => {
    if (good === undefined || warn === undefined) return null
    if (lowIsBad) {
      return [
        { to: pct(warn), color: TONE_COLORS.bad },
        { to: pct(good), color: TONE_COLORS.warn },
        { to: 100, color: TONE_COLORS.good },
      ]
    }
    return [
      { to: pct(good), color: TONE_COLORS.good },
      { to: pct(warn), color: TONE_COLORS.warn },
      { to: 100, color: TONE_COLORS.bad },
    ]
  })
</script>

<Tooltip {tip} {label}>
  <div class="gauge">
    <div class="head">
      <span class="label">{label}</span>
      <span class="reading" style:color={TONE_COLORS[tone]}>{reading}</span>
    </div>
    <div class="track">
      {#if zones}
        <div class="zones">
          {#each zones as z, i (i)}
            <span
              class="zone"
              style:left="{i === 0 ? 0 : zones[i - 1].to}%"
              style:width="{z.to - (i === 0 ? 0 : zones[i - 1].to)}%"
              style:background={z.color}
            ></span>
          {/each}
        </div>
      {/if}
      <div
        class="fill"
        style:width="{pct(value)}%"
        style:background={TONE_COLORS[tone]}
      ></div>
      {#if peak !== undefined}
        <div class="peak" style:left="{pct(peak)}%"></div>
      {/if}
    </div>
  </div>
</Tooltip>

<style lang="sass">
  .gauge
    padding: 2px 0
    cursor: default

  .head
    display: flex
    justify-content: space-between
    gap: 8px
    line-height: 1.3

  .label
    opacity: 0.7

  .reading
    font-weight: 600

  .track
    position: relative
    height: 7px
    margin-top: 2px
    background: rgba(255, 255, 255, 0.07)
    border-radius: 3px
    overflow: hidden

  // The zones sit behind the fill as a faint scale, so the fill's end shows
  // which band the value is in.
  .zones
    position: absolute
    inset: 0
    opacity: 0.16

  .zone
    position: absolute
    top: 0
    bottom: 0

  .fill
    position: absolute
    left: 0
    top: 1px
    bottom: 1px
    border-radius: 2px
    transition: width 0.08s linear

  .peak
    position: absolute
    top: 0
    bottom: 0
    width: 2px
    margin-left: -1px
    background: rgba(255, 255, 255, 0.85)
</style>
