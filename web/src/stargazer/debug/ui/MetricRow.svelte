<script lang="ts">
  import { TONE_COLORS, type Tone } from '../thresholds'
  import Tooltip from './Tooltip.svelte'
  import type { TipSpec } from './tip'

  interface Props {
    label: string
    /** The reading, already formatted, with its unit. */
    value: string | number
    tone?: Tone
    /** What the number counts and when it is bad. Shown on hover. */
    tip?: TipSpec | string
    /**
     * A fraction in `[0, 1]` for a thin bar under the row, for example the
     * value against its warning threshold. Omit for none.
     */
    fill?: number
    /** A short dim note after the label, such as `cumulative`. */
    note?: string
  }

  const { label, value, tone = 'neutral', tip, fill, note }: Props = $props()
</script>

<Tooltip {tip} {label}>
  <div class="metric-row">
    <div class="line">
      <span class="label">
        {label}
        {#if note}<span class="note">{note}</span>{/if}
      </span>
      <span class="value" style:color={TONE_COLORS[tone]}>{value}</span>
    </div>
    {#if fill !== undefined}
      <div class="bar">
        <div
          class="bar-fill"
          style:width="{Math.max(0, Math.min(1, fill)) * 100}%"
          style:background={TONE_COLORS[tone]}
        ></div>
      </div>
    {/if}
  </div>
</Tooltip>

<style lang="sass">
  .metric-row
    padding: 2px 0
    cursor: default

  .line
    display: flex
    justify-content: space-between
    align-items: baseline
    gap: 8px

  .label
    opacity: 0.7
    min-width: 0

  .note
    margin-left: 4px
    font-size: 9px
    opacity: 0.6

  .value
    font-weight: 600
    text-align: right
    white-space: nowrap

  .bar
    height: 2px
    margin-top: 1px
    background: rgba(255, 255, 255, 0.07)
    border-radius: 1px
    overflow: hidden

  .bar-fill
    height: 100%
    opacity: 0.8
</style>
