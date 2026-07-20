<!-- The arcade robot glyph, `currentColor`-filled. Shared by the launcher return
     pills and the swipe-down escape hatch. -->
<script lang="ts">
  interface Props {
    size?: number
  }
  const { size = 18 }: Props = $props()
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 32 32"
  fill="none"
  aria-hidden="true"
>
  <path
    fill="currentColor"
    d="M11.637 29.09H5.818v-2.908h5.819zm14.545 0h-5.819v-2.908h5.819zM5.818 26.183H2.91v-2.91h2.91zm14.545 0h-8.726v-2.91h8.726zm8.728 0h-2.91v-2.91h2.91zm-26.182-2.91H0V11.638h2.91zm29.091 0h-2.91V11.638H32zm-20.363-8.726h2.909v2.908h-2.91v2.91H8.729v-2.91h-2.91v-2.908h2.91v-2.91h2.909zm11.636 5.817h-2.91v-2.909h2.91zm-2.91-2.909h-2.909v-2.908h2.91zm5.819 0h-2.91v-2.908h2.91zm-2.91-2.908h-2.909v-2.91h2.91zm-17.454-2.91H2.91V8.729h2.91zm23.273 0h-2.91V8.729h2.91zm-2.91-2.908H5.819v-2.91h8.728V2.91h2.908v2.91h8.728z"
  />
</svg>
