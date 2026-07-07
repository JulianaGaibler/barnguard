<script lang="ts">
  // Reusable decorative wave shape (16:9, viewBox 1920×1080). The shape lives
  // here; the multi-stop radial gradient is the default surface treatment
  // used by BackgroundLayer. Consumers that want a different fill can target
  // `.wave path` (or drop this component and inline the path directly).
  //
  // Uses `preserveAspectRatio="xMidYMid slice"` so it behaves like
  // `object-fit: cover`; the shape always fills the box, cropping the
  // unused margin on off-aspect viewports.
</script>

<svg
  class="wave"
  viewBox="0 0 1920 1080"
  preserveAspectRatio="xMidYMid slice"
  fill="none"
  xmlns="http://www.w3.org/2000/svg"
  aria-hidden="true"
  focusable="false"
>
  <defs>
    <radialGradient
      id="wave-gradient"
      cx="0"
      cy="0"
      r="1"
      gradientTransform="matrix(1921.5 851 -850.9 1921.31 -4.5 256)"
      gradientUnits="userSpaceOnUse"
    >
      <stop stop-color="#243A66" />
      <stop offset="0.25" stop-color="#172440" />
      <stop offset="0.5" stop-color="#243A66" />
      <stop offset="0.75" stop-color="#1A2949" />
      <stop offset="1" stop-color="#243A66" />
    </radialGradient>
  </defs>
  <path
    d="M0 250.631C56.0458 273.395 121.966 311.884 166.746 375.533C259.129 506.845 395.274 492.26 538.711 460.658C682.148 429.056 842.604 436.349 966.592 562.756C1079.32 677.68 1114.89 832.585 1326.4 810.707C1517.73 790.916 1672.23 800.983 1798.11 967.5C1836.92 1018.83 1880.91 1051.78 1920 1072.87V1080H0V250.631Z"
    fill="url(#wave-gradient)"
    fill-opacity="0.66"
  />
</svg>

<style lang="sass">
  .wave
    display: block
    width: 100%
    height: 100%
</style>
