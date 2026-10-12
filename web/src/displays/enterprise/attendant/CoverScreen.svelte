<script lang="ts">
  /**
   * Full-viewport takeover. Toggled by the attendant (see
   * `SelectedStatePreview.svelte`'s "Cover screen" section) to hide the game
   * while the booth is off-duty. See `./coverState.ts` for the mode/text state.
   * This component just paints the branded card: a solid color and a headline,
   * pending a full rebuild of this surface.
   *
   * Layered above `TopBar` (z=100) but below `DraggableWindow`s (z≥200), so
   * `BoothMenu` and `PrinterPanel` remain reachable to toggle the cover off.
   */
  import { fade } from 'svelte/transition'
  import { locale } from '@src/i18n'
  import { t } from '@src/displays/enterprise/i18n'
  import { coverScreen, BRAND_HEADLINE } from './coverState'

  // `custom` with empty (or whitespace-only) text silently falls back to the
  // brand headline so the operator can't accidentally push a blank screen.
  const headline = $derived.by(() => {
    if ($coverScreen.mode === 'brand') return BRAND_HEADLINE
    if ($coverScreen.mode === 'backSoon') return $t.cover.backSoon
    const trimmed = $coverScreen.customText.trim()
    return trimmed.length > 0 ? $coverScreen.customText : BRAND_HEADLINE
  })
</script>

<div
  class="cover"
  role="presentation"
  in:fade={{ duration: 220 }}
  out:fade={{ duration: 160 }}
>
  <h1 class="cover__headline" lang={$locale}>{headline}</h1>
</div>

<style lang="sass">
  .cover
    position: fixed
    inset: 0
    z-index: var(--z-cover)
    overflow: hidden
    background-color: #FDCC9B
    // Catch every pointer event so the game underneath is unreachable.
    pointer-events: auto
    user-select: none
    display: flex
    align-items: flex-end

  .cover__headline
    margin-inline-start: tint.$size-48
    margin-inline-end: tint.$size-48
    margin-block-end: tint.$size-48
    font-family: 'Mozilla Headline Extended', tint.$mozilla-headline, sans-serif
    font-weight: 700
    color: var(--color-text)
    // Bespoke fluid brand headline (viewport-driven), intentionally not a type
    // token. It scales with the cover, not the UI-scale knob.
    font-size: clamp(3rem, 6vw, 6rem)
    line-height: 1.05
    // `pre-wrap` honours explicit `\n`s from the custom-text textarea while
    // still wrapping long lines at word boundaries. The brand + backSoon
    // presets have no newlines and just wrap as usual.
    white-space: pre-wrap
    max-width: 60vw
</style>
