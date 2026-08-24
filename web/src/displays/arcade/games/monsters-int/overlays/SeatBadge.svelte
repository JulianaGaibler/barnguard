<!--
  A seat's identity as DOM: its shape in its color.

  The same pairing the table markers use, read from the same constant, so a
  player matches the chip in front of them to the token on the table. Shape as
  well as color, since two of the five accents are not separable for everyone.
-->
<script lang="ts">
  import { SEATS } from '../game'

  interface Props {
    seat: number
    size?: number
  }
  const { seat, size = 24 }: Props = $props()

  const identity = $derived(SEATS[seat % SEATS.length]!)

  /** A regular polygon inscribed in the box, pointing up. */
  function points(sides: number): string {
    const r = 50
    return Array.from({ length: sides }, (_, i) => {
      const a = -Math.PI / 2 + (i / sides) * Math.PI * 2
      return `${50 + Math.cos(a) * r},${50 + Math.sin(a) * r}`
    }).join(' ')
  }
</script>

<svg
  class="mi-badge"
  width={size}
  height={size}
  viewBox="0 0 100 100"
  aria-hidden="true"
>
  {#if identity.shape === 'circle'}
    <circle cx="50" cy="50" r="50" fill={identity.color} />
  {:else}
    <polygon points={points(identity.sides)} fill={identity.color} />
  {/if}
</svg>

<style lang="sass">
  .mi-badge
    display: block
    flex: none
</style>
