<script lang="ts">
  /**
   * One leaderboard row: place, flag, name and score in a pill. The player's
   * own pending row is highlighted, and tapping it asks for the keyboard. The
   * name is shown capitalised, since the server stores it in lowercase.
   */
  import { t } from '@src/displays/enterprise/i18n'
  import { EU_REGION_META } from '@src/displays/enterprise/game/maps/eu/regionMeta'
  import {
    monoChars,
    splitScore,
  } from '@src/displays/enterprise/format/splitScore'
  import { flagFor } from './flags'
  import MonoDigits from './MonoDigits.svelte'
  import type { LeaderboardRow } from './leaderboardRows'

  interface Props {
    row: LeaderboardRow
    mapId: string
    /** Whether the keyboard is up for the pending row. */
    editing?: boolean
    onEdit?: () => void
  }
  let { row, mapId, editing = false, onEdit }: Props = $props()

  /**
   * The region's flag as a CSS image. Painted as a background so the rounded
   * corners clip it smoothly, where clipping inline markup with `overflow:
   * hidden` under the anchor's transform leaves a hard edge.
   */
  function flagOf(region: string): string | null {
    if (mapId !== 'eu') return null
    const meta = EU_REGION_META[region]
    const svg = meta ? flagFor(meta.iso2) : null
    return svg ? `url("data:image/svg+xml,${encodeURIComponent(svg)}")` : null
  }

  const rank = (n: number): string => String(n).padStart(2, '0')
  const flag = $derived(flagOf(row.region))
</script>

<li
  class="row"
  class:row--pending={row.pending}
  class:row--editing={row.pending && editing}
>
  {#if row.pending && onEdit}
    <button class="row__hit" onclick={onEdit} aria-label={$t.game.enterName}
    ></button>
  {/if}
  <span class="row__rank">
    <MonoDigits chars={monoChars(rank(row.rank))} family="text" />
  </span>
  <span class="row__who">
    {#if flag}
      <span class="row__flag" aria-hidden="true" style:background-image={flag}
      ></span>
    {:else if row.region}
      <span class="row__code">{row.region}</span>
    {/if}
    {#if row.anonymous}
      <span class="row__name row__name--unnamed">{$t.game.unnamed}</span>
    {:else if row.pending && !row.name}
      <span class="row__name row__name--placeholder">{$t.game.enterName}</span>
    {:else}
      <span class="row__name">{row.name}</span>
    {/if}
  </span>
  <span class="row__score">
    <MonoDigits chars={splitScore(row.score)} family="text" />
  </span>
</li>

<style lang="sass">
  .row
    position: relative
    box-sizing: border-box
    display: flex
    align-items: center
    gap: 14px
    height: 37px
    padding: 4px 8px
    border-radius: 999px
    font-family: var(--font-mozilla-text)
    font-size: 24px

  .row--pending
    background: #efe8ff
    border: 1px solid #2600a5
    color: #2600a5

  .row--editing
    box-shadow: 0 0 0 3px rgba(38, 0, 165, 0.25)

  // The whole pending row is the tap target, over its contents.
  .row__hit
    position: absolute
    inset: 0
    appearance: none
    border: 0
    padding: 0
    background: transparent
    border-radius: inherit
    cursor: pointer
    pointer-events: auto

  .row__rank
    font-weight: 700

  .row__who
    display: flex
    align-items: center
    gap: 8px
    flex: 1 0 0
    min-width: 0
    font-weight: 500

  .row__flag
    flex: none
    width: 36px
    height: 24px
    border-radius: 999px
    background-size: cover
    background-position: center

  .row__code
    flex: none
    width: 36px
    font-weight: 700
    font-size: 18px
    text-align: center

  .row__name
    overflow: hidden
    white-space: nowrap
    text-overflow: ellipsis
    text-transform: capitalize

  .row__name--placeholder
    opacity: 0.25
    text-transform: none

  .row__name--unnamed
    opacity: 0.5
    text-transform: none

  .row__score
    font-weight: 400
</style>
