<script lang="ts">
  /**
   * Full-viewport takeover. Toggled by the attendant to hide the game while the
   * booth is off-duty. See `web/src/stores/coverScreen.ts` for the mode/text
   * state; this component just paints the branded card.
   *
   * Layered above `TopBar` (z=100) but below `DraggableWindow`s (z≥200), so
   * BoothMenu and PrinterPanel remain reachable to toggle the cover off.
   */
  import { fade } from 'svelte/transition'
  import { locale, t } from '@src/i18n'
  import { coverScreen } from '@src/stores/coverScreen'
  import Wave from '@src/core/ui/decor/Wave.svelte'
  import { theme } from '@src/core/theme'

  // `custom` with empty (or whitespace-only) text silently falls back to the
  // theme's brand headline so the operator can't accidentally push a blank
  // screen.
  const headline = $derived.by(() => {
    const brandHeadline = $theme?.cover.headline ?? ''
    if ($coverScreen.mode === 'brand') return brandHeadline
    if ($coverScreen.mode === 'backSoon') return $t.cover.backSoon
    const trimmed = $coverScreen.customText.trim()
    return trimmed.length > 0 ? $coverScreen.customText : brandHeadline
  })

  const backgroundColor = $derived($theme?.cover.backgroundColor ?? '#000000')
</script>

<div
  class="cover"
  role="presentation"
  style:background-color={backgroundColor}
  in:fade={{ duration: 220 }}
  out:fade={{ duration: 160 }}
>
  <div class="cover__wave" aria-hidden="true">
    <Wave />
  </div>

  {#if $theme?.assets.coverAccent}
    <img
      class="cover__accent"
      src={$theme.assets.coverAccent}
      alt=""
      aria-hidden="true"
      draggable="false"
    />
  {/if}

  {#if $theme?.assets.coverLogo}
    <img
      class="cover__logo"
      src={$theme.assets.coverLogo}
      alt=""
      draggable="false"
    />
  {/if}

  <h1 class="cover__headline" lang={$locale}>{headline}</h1>
</div>

<style lang="sass">
  // The Mozilla Headline Extended font is registered on `document.fonts`
  // programmatically by the label renderer. Declare it here as a proper
  // @font-face so plain DOM text can use it without depending on the print
  // path being initialised first.
  @font-face
    font-family: 'Mozilla Headline Extended'
    src: url('@src/assets/fonts/MozillaHeadlineExtended-Bold.woff2') format('woff2')
    font-weight: 700
    font-style: normal
    font-display: swap

  .cover
    position: fixed
    inset: 0
    z-index: var(--z-cover)
    overflow: hidden
    // Catch every pointer event so the game underneath is unreachable.
    pointer-events: auto
    user-select: none
    display: grid
    grid-template-columns: 1fr auto
    grid-template-rows: auto 1fr auto
    align-items: stretch

  // The gradient wave that ships with BackgroundLayer, dimmed so it reads
  // as a subtle backdrop under the navy rather than the primary surface.
  .cover__wave
    position: absolute
    inset: 0
    opacity: 0.35
    pointer-events: none

  .cover__accent
    position: absolute
    inset-block-start: 0
    inset-inline-end: 0
    height: 100%
    width: auto
    pointer-events: none
    // Kill iOS' image-drag ghost + long-press callout.
    -webkit-user-drag: none
    -webkit-touch-callout: none

  .cover__logo
    position: relative
    grid-column: 1
    grid-row: 1
    justify-self: start
    margin-block-start: tint.$size-48
    margin-inline-start: tint.$size-48
    margin-inline-end: tint.$size-48
    // 1.5× the ambient logo size elsewhere in the app — set on `height` (not
    // `transform: scale`) so the browser rasterises the SVG/PNG at the
    // target resolution and it stays crisp, instead of upscaling a
    // 1×-rasterised bitmap.
    height: clamp(3rem, 5.4vw, 5.25rem)
    width: auto
    // The PNG has embedded transparency; let it composite over the navy
    // background as-is (no filter).
    pointer-events: none

  .cover__headline
    position: relative
    grid-column: 1
    grid-row: 3
    // Anchor to the block-end / inline-start corner; leaves the middle row
    // as breathing room.
    justify-self: start
    align-self: end
    margin-inline-start: tint.$size-48
    margin-inline-end: tint.$size-48
    margin-block-end: tint.$size-48
    font-family: 'Mozilla Headline Extended', tint.$mozilla-headline, sans-serif
    font-weight: 700
    color: var(--color-text-inverse)
    // Bespoke fluid brand headline (viewport-driven), intentionally not a type
    // token; it scales with the cover, not the UI-scale knob.
    font-size: clamp(3rem, 6vw, 6rem)
    line-height: 1.05
    // `pre-wrap` honours explicit `\n`s from the custom-text textarea while
    // still wrapping long lines at word boundaries. The enterprise + backSoon
    // presets have no newlines and just wrap as usual.
    white-space: pre-wrap
    max-width: 60vw
    // The inline-end edge of the flame graphic starts around 30% of the
    // viewport in, so ensure the text never runs under it.
    padding-inline-end: 4vw
</style>
