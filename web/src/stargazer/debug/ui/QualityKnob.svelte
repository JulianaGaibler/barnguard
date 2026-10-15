<script lang="ts" module>
  export interface KnobOption {
    /**
     * The value passed back through `onChange`. `'auto'` is the engine's own
     * choice.
     */
    value: string
    label: string
  }

  /** What the value in effect costs and changes, already worded. */
  export interface KnobImpact {
    /** The look at this value. */
    look: string
    /** Render-target memory, already formatted, or `null`. */
    memory: string | null
    /** Share of native pixel work, in `[0, 1]`, or `null`. */
    pixelShare: number | null
    /** A measured saving, with its reference hardware. */
    reference: string | null
    /** Why the setting changes nothing right now. */
    inert: string | null
  }
</script>

<script lang="ts">
  import { TONE_COLORS } from '../thresholds'
  import DebugSelect from './DebugSelect.svelte'
  import Tooltip from './Tooltip.svelte'
  import type { TipSpec } from './tip'

  interface Props {
    label: string
    options: readonly KnobOption[]
    /** `'auto'` or the value held. */
    selected: string
    onChange: (value: string) => void
    /** The value in effect now, such as `0.85×`. */
    now: string
    /** In auto, what the engine lowered it from, such as `1×`. */
    loweredFrom?: string | null
    impact: KnobImpact
    tip?: TipSpec | string
  }

  const {
    label,
    options,
    selected,
    onChange,
    now,
    loweredFrom,
    impact,
    tip,
  }: Props = $props()

  const auto = $derived(selected === 'auto')
  const lowered = $derived(auto && loweredFrom != null)
</script>

<Tooltip {tip} {label}>
  <div class="knob">
    <div class="top">
      <span class="name">{label}</span>
      <span
        class="badge"
        class:auto
        style:--tone={auto ? TONE_COLORS.neutral : TONE_COLORS.warn}
      >
        {auto ? 'AUTO' : 'FIXED'}
      </span>
      <span class="now" class:lowered>{now}</span>
    </div>
    {#if lowered}
      <div class="lowered">lowered from {loweredFrom}</div>
    {/if}
    <DebugSelect label="" value={selected} {options} {onChange} />
    <div class="impact" class:inert={impact.inert !== null}>
      {#if impact.inert}
        <div class="inert-note">{impact.inert}</div>
      {:else}
        <div class="look">{impact.look}</div>
        <div class="facts">
          {#if impact.pixelShare !== null}
            <span class="fact">
              <span class="bar"
                ><span
                  class="bar-fill"
                  style:width="{Math.min(1, impact.pixelShare) * 100}%"
                ></span></span
              >
              {Math.round(impact.pixelShare * 100)}% px
            </span>
          {/if}
          {#if impact.memory}
            <span class="fact">
              {impact.memory}
            </span>
          {/if}
        </div>
        {#if impact.reference}
          <div class="reference">{impact.reference}</div>
        {/if}
      {/if}
    </div>
  </div>
</Tooltip>

<style lang="sass">
  .knob
    display: flex
    flex-direction: column
    gap: 3px
    padding: 5px 0 7px
    border-bottom: 1px solid rgba(255, 255, 255, 0.07)

    &:last-child
      border-bottom: none

  .top
    display: flex
    align-items: baseline
    gap: 6px

  .name
    font-weight: 600

  .badge
    padding: 0 5px
    font-size: 9px
    font-weight: 700
    letter-spacing: 0.04em
    color: var(--tone)
    border: 1px solid var(--tone)
    border-radius: 3px

  .now
    margin-left: auto
    font-weight: 700
    color: #fff

    &.lowered
      color: #fbbf24

  .lowered
    font-size: 9px
    color: #fbbf24
    opacity: 0.85

  .impact
    font-size: 10px
    line-height: 1.35
    opacity: 0.85

    &.inert
      opacity: 0.55

  .inert-note
    font-style: italic

  .look
    opacity: 0.8

  .facts
    display: flex
    flex-wrap: wrap
    gap: 4px 10px
    margin-top: 1px

  .fact
    display: inline-flex
    align-items: center
    gap: 4px
    opacity: 0.75

  .bar
    display: inline-block
    width: 36px
    height: 4px
    background: rgba(255, 255, 255, 0.12)
    border-radius: 2px
    overflow: hidden

  .bar-fill
    display: block
    height: 100%
    background: #60a5fa

  .reference
    margin-top: 1px
    font-size: 9px
    opacity: 0.55
</style>
