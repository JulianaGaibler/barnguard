<!--
  Booth-menu section for the attendant: picks the contrast algorithm the game
  rates with. Switching ends the game in progress, since a card rated under one
  algorithm may be a different answer under the other. The choice is kept on the
  device.
-->
<script lang="ts">
  import { DebugSection } from 'stargazer/debug-ui'
  import { ALGORITHMS, type Algorithm } from '../game/contrast'
  import { algorithm, setAlgorithm } from '../game/settings'
  import { t } from '../i18n'

  const names = $derived<Record<Algorithm, string>>({
    apca: $t.algorithmPanel.apca,
    wcag: $t.algorithmPanel.wcag,
  })
</script>

<DebugSection title={$t.algorithmPanel.algorithm} open>
  <div
    class="choice"
    role="radiogroup"
    aria-label={$t.algorithmPanel.algorithm}
  >
    {#each ALGORITHMS as option (option)}
      <button
        type="button"
        class="debug-btn"
        class:chosen={$algorithm === option}
        role="radio"
        aria-checked={$algorithm === option}
        onclick={() => setAlgorithm(option)}
      >
        {names[option]}
      </button>
    {/each}
  </div>
  <p class="note">{$t.algorithmPanel.note}</p>
</DebugSection>

<style lang="sass">
  .choice
    display: flex
    gap: 4px

    .debug-btn
      flex: 1

  .chosen
    outline: 2px solid currentColor
    outline-offset: -2px

  .note
    margin: 6px 0 0
    font-size: 11px
    opacity: 0.7
</style>
