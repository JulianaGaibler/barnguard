<!--
  One mark per screen shown so far: a circle for a scene or choice, a star for
  a moment, the current one filled. It never shows how far is left, since
  paths differ in length.
-->
<script lang="ts">
  import type { ProgressMark } from '../story/run'
  import { MARK_SIZE, trailGeometry } from './progressTrail'

  interface Props {
    marks: readonly ProgressMark[]
    /** The widest the row may draw, in design pixels. */
    maxWidth: number
    label: string
  }
  const { marks, maxWidth, label }: Props = $props()

  const geometry = $derived(trailGeometry(marks, maxWidth))
  const MID = MARK_SIZE / 2
  /** The stroke sits inside each mark's box. */
  const STROKE = 3
  /** A four-point star filling the mark's box. */
  const STAR =
    'M18 0L24.364 11.636L36 18L24.364 24.364L18 36L11.636 24.364L0 18L11.636 11.636Z'
</script>

<svg
  class="trail"
  role="img"
  aria-label={label}
  width={geometry.width}
  height={geometry.height}
  viewBox="0 0 {geometry.naturalWidth} {MARK_SIZE}"
>
  <defs>
    <clipPath id="trail-star">
      <path d={STAR} />
    </clipPath>
  </defs>
  {#each geometry.links as link, i (i)}
    <path class="trail__link" d="M{link.x1} {MID}H{link.x2}" />
  {/each}
  {#each geometry.marks as { x, mark }, i (i)}
    <g transform="translate({x} 0)">
      {#if mark.kind === 'moment'}
        <!-- Clipped to the star at double width, so the stroke lies inside
             it, as in the design. -->
        <path
          class="trail__mark"
          class:trail__mark--current={mark.current}
          d={STAR}
          stroke-width={STROKE * 2}
          clip-path="url(#trail-star)"
        />
      {:else}
        <circle
          class="trail__mark"
          class:trail__mark--current={mark.current}
          cx={MID}
          cy={MID}
          r={MID - STROKE / 2}
          stroke-width={STROKE}
        />
      {/if}
    </g>
  {/each}
</svg>

<style lang="sass">
  .trail
    display: block
    overflow: visible

  .trail__link
    stroke: var(--color-accent)
    stroke-width: 3
    opacity: 0.1

  .trail__mark
    fill: none
    stroke: var(--color-accent)

  .trail__mark--current
    fill: var(--color-accent)
</style>
