<script lang="ts">
  // The Stallwächter backdrop shape (16:9, viewBox 1920×1080). The path lives
  // in `../assets/wave.svg`. The multi-stop radial gradient inside it is the
  // display's surface treatment, painted behind the DOM chrome by
  // `BackgroundLayer` and, dimmed, by `CoverScreen`.
  //
  // Uses `preserveAspectRatio="xMidYMid slice"` so it behaves like
  // `object-fit: cover`, the shape always fills the box, cropping the
  // unused margin on off-aspect viewports.
  import waveRaw from '../assets/wave.svg?raw'
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
