<script lang="ts">
  import { TONE_COLORS, type Tone } from '../thresholds'
  import Tooltip from './Tooltip.svelte'
  import type { TipSpec } from './tip'

  interface Props {
    text: string
    tone?: Tone
    tip?: TipSpec | string
  }

  const { text, tone = 'neutral', tip }: Props = $props()
</script>

<Tooltip {tip} label={text} inline>
  <span class="pill" style:--tone={TONE_COLORS[tone]}>{text}</span>
</Tooltip>

<style lang="sass">
  .pill
    display: inline-block
    padding: 1px 7px
    font-size: 10px
    font-weight: 700
    line-height: 1.5
    color: var(--tone)
    border: 1px solid var(--tone)
    border-radius: 9px
    background: rgba(255, 255, 255, 0.04)
    white-space: nowrap
</style>
