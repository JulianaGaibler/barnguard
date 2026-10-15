<script lang="ts">
  import { TONE_COLORS, type Tone } from '../thresholds'
  import Tooltip from './Tooltip.svelte'
  import type { TipSpec } from './tip'

  interface Issue {
    label: string
    tone: Tone
    detail: string
  }

  interface Props {
    /** The readings that are not good, worst first. Empty means all is well. */
    issues: readonly Issue[]
  }

  const { issues }: Props = $props()

  const tone = $derived<Tone>(
    issues.some((i) => i.tone === 'bad')
      ? 'bad'
      : issues.length > 0
        ? 'warn'
        : 'good',
  )
  const text = $derived(
    issues.length === 0
      ? 'OK'
      : issues.length === 1
        ? issues[0].label
        : `${issues[0].label} +${issues.length - 1}`,
  )
  const tip = $derived<TipSpec>(
    issues.length === 0
      ? {
          title: 'Status',
          value: 'OK',
          tone: 'good',
          body: 'Every watched reading is in its good range.',
        }
      : {
          title: 'Status',
          value: `${issues.length} to look at`,
          tone,
          body: 'Readings outside their good range, worst first.',
          facts: issues.map((i) => ({
            label: i.label,
            value: i.detail,
            tone: i.tone,
          })),
        },
  )
</script>

<Tooltip {tip} inline>
  <span class="chip" style:--tone={TONE_COLORS[tone]}>
    <span class="dot"></span>{text}
  </span>
</Tooltip>

<style lang="sass">
  .chip
    display: inline-flex
    align-items: center
    gap: 5px
    font-size: 10px
    font-weight: 700
    color: var(--tone)
    white-space: nowrap

  .dot
    width: 7px
    height: 7px
    border-radius: 50%
    background: var(--tone)
    box-shadow: 0 0 5px var(--tone)
</style>
