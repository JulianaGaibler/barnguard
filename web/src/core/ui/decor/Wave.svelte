<script lang="ts">
  // Reusable decorative wave shape (16:9, viewBox 1920×1080). The shape lives
  // in `./assets/wave.svg`; the multi-stop radial gradient is the default
  // surface treatment used by BackgroundLayer. Consumers that want a
  // different fill can drop this component and inline the shape directly.
  //
  // Uses `preserveAspectRatio="xMidYMid slice"` so it behaves like
  // `object-fit: cover`; the shape always fills the box, cropping the
  // unused margin on off-aspect viewports.
  import waveRaw from './assets/wave.svg?raw'
</script>

<div class="wave">
  {@html waveRaw}
</div>

<style lang="sass">
  .wave
    display: block
    width: 100%
    height: 100%

    :global(svg)
      display: block
      width: 100%
      height: 100%
</style>
