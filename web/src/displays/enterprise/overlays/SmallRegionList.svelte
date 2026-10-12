<script lang="ts">
  import { t, regionName } from '@src/displays/enterprise/i18n'
  import { namespaceForMap, type RegionId } from '@src/displays/enterprise/game'

  interface Props {
    /** Regions too small to tap, from `session.smallRegionIds`. */
    regionIds: readonly RegionId[]
    mapId: string
    onPick: (id: RegionId) => void
  }

  const { regionIds, mapId, onPick }: Props = $props()

  const entries = $derived(
    regionIds
      .map((id) => ({ id, name: regionName($t, namespaceForMap(mapId), id) }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  )
</script>

<!--
  The map is the primary way to choose a region. This covers the ones the map
  cannot offer: at kiosk size several European countries are narrower than the
  3 px border drawn around them, so no amount of aiming would hit them.
-->
{#if entries.length > 0}
  <aside class="small-regions" aria-label={$t.game.confirmStateTitle}>
    <ul class="small-regions__list">
      {#each entries as entry (entry.id)}
        <li>
          <button
            class="small-regions__item"
            type="button"
            onclick={() => onPick(entry.id)}
          >
            {entry.name}
          </button>
        </li>
      {/each}
    </ul>
  </aside>
{/if}

<style lang="sass">
  .small-regions
    position: absolute
    // Shares the game screen's bottom-right corner stack, sitting above the
    // mission copy rather than on top of it.
    inset-inline-end: var(--corner-inset)
    inset-block-end: calc(var(--corner-inset) + var(--corner-copy-height))
    z-index: var(--z-overlay)
    max-width: 30%

  .small-regions__list
    display: flex
    flex-wrap: wrap
    justify-content: flex-end
    gap: var(--space-8)
    margin: 0
    padding: 0
    list-style: none

  .small-regions__item
    // Reads as part of the glass map rather than booth chrome: the same
    // translucent white the regions themselves are filled with.
    border: 1px solid rgba(255, 255, 255, 0.9)
    border-radius: var(--radius-pill)
    background: rgba(255, 255, 255, 0.5)
    color: var(--color-text)
    padding: var(--space-8) var(--space-16)
    font: inherit
    font-weight: 600
    cursor: pointer
    touch-action: manipulation

    &:active
      background: rgba(255, 255, 255, 0.9)
</style>
