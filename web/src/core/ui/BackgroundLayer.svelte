<script lang="ts">
  import Wave from '@src/core/ui/decor/Wave.svelte'
</script>

<div class="bg" aria-hidden="true">
  <div class="bg__wave">
    <Wave />
  </div>
</div>

<style lang="sass">
  .bg
    position: fixed
    inset: 0
    z-index: 0
    background: var(--color-app-backdrop)
    pointer-events: none

  .bg__wave
    position: absolute
    inset: 0
</style>
