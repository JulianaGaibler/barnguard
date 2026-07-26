<!-- The square-in-circle motif from the in-game LVL/PTS badges (see
     `game/nodes/BadgeNode.ts`), brought to DOM for the final score display. -->
<script lang="ts">
  import { formatScore } from '@src/displays/arcade/leaderboard/formatScore'
  import { JEZZBALL_STRINGS as t } from '../strings'

  interface Props {
    score: number
    color: string
  }
  const { score, color }: Props = $props()
</script>

<div class="frame">
  <div class="frame__square"></div>
  <div class="frame__circle"></div>
  <div class="frame__content">
    <span class="frame__label">{t.gameOver}</span>
    <span class="frame__value" style="color: {color}">{formatScore(score)}</span
    >
  </div>
</div>

<style lang="sass">
  // Square sits top-aligned and narrower; the circle is wider, bottom-aligned,
  // and starts lower than the square's top — so it bulges past the square's
  // sides and bottom without reaching above it. Not concentric, unlike the
  // in-game HUD badges this motif is based on.
  .frame
    position: relative
    width: 12rem
    height: 14rem
    flex-shrink: 0

  .frame__square
    position: absolute
    inset-block-start: 0
    inset-inline-start: 50%
    width: 9rem
    height: 9rem
    transform: translateX(-50%)
    border: 2px solid var(--color-border)

  .frame__circle
    position: absolute
    inset-block-end: 0
    inset-inline-start: 50%
    width: 12rem
    height: 12rem
    transform: translateX(-50%)
    border-radius: 50%
    border: 2px solid var(--color-border)

  // Content sizes to its own width rather than the frame's — the display-size
  // score number regularly renders wider than the decorative shapes, and
  // should overflow them rather than get clipped or wrap.
  .frame__content
    position: absolute
    inset-inline-start: 50%
    inset-block-start: 38%
    transform: translateX(-50%)
    width: max-content
    display: flex
    flex-direction: column
    align-items: center
    gap: var(--space-4)

  .frame__label
    @include tint.type-class(ui-small-bold)
    text-transform: uppercase
    letter-spacing: 0.08em
    color: var(--color-text-secondary)

  .frame__value
    @include tint.type-class(display)
    font-weight: 800
    white-space: nowrap
</style>
