<script lang="ts">
  import { TONE_COLORS, type Tone } from '../thresholds'
  import type { SeriesSource } from '../RingSeries'
  import Sparkline from './Sparkline.svelte'
  import Tooltip from './Tooltip.svelte'
  import type { TipSpec } from './tip'

  interface Props {
    label: string
    /** The reading. A number is shown as is, a string is shown whole. */
    value: string | number
    /** Shown small and dim after the value. */
    unit?: string
    tone?: Tone
    /** What the number counts and when it is bad. Shown on hover. */
    tip?: TipSpec | string
    /** A short line under the label, such as `peak 120`. */
    note?: string
    /** Recent history, drawn behind the value. */
    series?: SeriesSource
    /** Bump this to redraw `series`. */
    revision?: number
    /** Value at the top of the sparkline. */
    seriesMax?: number
    seriesScale?: number
  }

  const {
    label,
    value,
    unit = '',
    tone = 'neutral',
    tip,
    note,
    series,
    revision = 0,
    seriesMax,
    seriesScale,
  }: Props = $props()
</script>

<Tooltip {tip} {label}>
  <div
    class="stat-card"
    class:good={tone === 'good'}
    class:warn={tone === 'warn'}
    class:bad={tone === 'bad'}
    style:--tone={TONE_COLORS[tone]}
  >
    <div class="reading">
      <span class="value">{value}</span>
      {#if unit}<span class="unit">{unit}</span>{/if}
    </div>
    <div class="label">{label}</div>
    {#if note}<div class="note">{note}</div>{/if}
    {#if series}
      <div class="spark">
        <Sparkline
          source={series}
          {revision}
          {tone}
          max={seriesMax}
          scale={seriesScale}
          height={16}
        />
      </div>
    {/if}
  </div>
</Tooltip>

<style lang="sass">
  .stat-card
    position: relative
    box-sizing: border-box
    display: flex
    flex-direction: column
    height: 100%
    min-width: 0
    padding: 5px 7px 5px 9px
    background: rgba(255, 255, 255, 0.05)
    border: 1px solid rgba(255, 255, 255, 0.1)
    border-radius: 3px
    overflow: hidden
    cursor: default

    // The tone shows as a stripe down the left edge, so a column of cards
    // reads as a row of lights.
    &::before
      content: ''
      position: absolute
      left: 0
      top: 0
      bottom: 0
      width: 3px
      background: var(--tone)

    &.bad
      background: rgba(248, 113, 113, 0.1)
      border-color: rgba(248, 113, 113, 0.4)

    &.warn
      background: rgba(251, 191, 36, 0.07)

  .reading
    display: flex
    align-items: baseline
    gap: 3px
    line-height: 1.1

  .value
    font-size: 17px
    font-weight: 700
    color: var(--tone)

  .unit
    font-size: 10px
    opacity: 0.55

  .label
    margin-top: 2px
    font-size: 9px
    letter-spacing: 0.02em
    text-transform: uppercase
    opacity: 0.6
    white-space: nowrap
    overflow: hidden
    text-overflow: ellipsis

  .note
    font-size: 9px
    opacity: 0.45

  .spark
    margin: 3px -7px -5px -9px
    opacity: 0.9
    flex-grow: 1
    display: flex
    flex-direction: column
    justify-content: flex-end
</style>
