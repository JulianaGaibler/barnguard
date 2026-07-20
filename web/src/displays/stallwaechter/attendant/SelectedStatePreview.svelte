<script lang="ts">
  import { t } from '@src/displays/stallwaechter/i18n'
  import { selectedStateId } from '@src/stores/gameSelection'
  import { STATE_PHOTOS } from '@src/displays/stallwaechter/game/data/statePhotos'
  import type { StateId } from '@src/displays/stallwaechter/game'
  import { DebugSection } from '@src/stargazer/debug/ui'

  // The store carries an opaque id; narrow to the display's StateId here.
  const id = $derived($selectedStateId as StateId | null)
  const selectedPhoto = $derived(id !== null ? STATE_PHOTOS[id] : null)
</script>

{#if id !== null && selectedPhoto !== null}
  <DebugSection title="Selected state" open>
    <img
      class="state-photo"
      src={selectedPhoto.url}
      alt={selectedPhoto.location}
    />
    <div class="debug-row">
      <span class="label">State</span>
      <span class="state-name"
        >{$t.states[id]}
        <span class="dim">({id})</span></span
      >
    </div>
    <div class="debug-row">
      <span class="label">Landmark</span>
      <span>{selectedPhoto.location}</span>
    </div>
    <div class="debug-row">
      <span class="label">Photo</span>
      <span class="dim">{selectedPhoto.photographer}</span>
    </div>
  </DebugSection>
{/if}

<style lang="sass">
  .state-photo
    width: 100%
    height: auto
    border-radius: 4px
    margin-bottom: 8px
    display: block
  .debug-row
    display: flex
    justify-content: space-between
    gap: 8px
    padding: 4px 0
  .label
    color: var(--color-text-secondary)
  .state-name
    font-weight: 600
  .dim
    color: var(--color-text-secondary)
    font-weight: 400
</style>
