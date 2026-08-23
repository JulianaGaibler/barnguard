<script lang="ts">
  /**
   * The full-viewport layer behind everything: the `appBackdrop` palette role,
   * plus the active display's optional `backdrop` component on top. A display
   * that ships no backdrop gets the flat neutral color and nothing else, so
   * branded chrome stays with the display that owns it.
   */
  import { activeDisplay } from '@src/core/display'

  const Backdrop = $derived($activeDisplay?.backdrop)
</script>

<div class="bg" aria-hidden="true">
  {#if Backdrop}
    <div class="bg__decor">
      <Backdrop />
    </div>
  {/if}
</div>

<style lang="sass">
  .bg
    position: fixed
    inset: 0
    z-index: 0
    background: var(--color-app-backdrop)
    pointer-events: none

  .bg__decor
    position: absolute
    inset: 0
</style>
