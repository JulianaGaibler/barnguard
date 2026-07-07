<script lang="ts">
  import Wave from './decor/Wave.svelte'
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
    background: linear-gradient(299deg, #243B67 19.93%, #223663 75.96%), #263860
    pointer-events: none

  .bg__wave
    position: absolute
    inset: 0
</style>
