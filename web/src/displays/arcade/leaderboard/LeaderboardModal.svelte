<!-- Standalone leaderboard viewer, opened from a game's menu. -->
<script lang="ts">
  import { onMount } from 'svelte'
  import Overlay from '@src/core/ui/Overlay.svelte'
  import Surface from '@src/core/ui/Surface.svelte'
  import IconButton from '@src/core/ui/IconButton.svelte'
  import {
    fetchLeaderboard,
    type LeaderboardEntry,
  } from '@src/core/leaderboard/leaderboardClient'
  import { t } from '../i18n'
  import LeaderboardList from './LeaderboardList.svelte'
  import LeaderboardIcon from './LeaderboardIcon.svelte'
  import closeIconRaw from '@src/assets/icons/close-16.svg?raw'

  interface Props {
    display: string
    onClose: () => void
  }
  const { display, onClose }: Props = $props()

  let entries = $state<LeaderboardEntry[]>([])
  let loading = $state(true)

  onMount(() => {
    fetchLeaderboard(display, 50)
      .then((e) => (entries = e))
      .catch(() => (entries = []))
      .finally(() => (loading = false))
  })
</script>

<Overlay scrim center onscrimclick={onClose}>
  <div class="lb-frame">
    <!-- Plain spacer: no background of its own, so the frame's own gradient
         (its `background`, painted once) shows through as the "header" —
         no second gradient paint to keep in sync with the border's. -->
    <div class="lb__header"></div>
    <div class="lb__close">
      <IconButton
        label={$t.arcade.leaderboard.close}
        tone="surface"
        onclick={onClose}
      >
        <span class="lb__close-icon">{@html closeIconRaw}</span>
      </IconButton>
    </div>
    <div class="lb__badge">
      <LeaderboardIcon size={48} filled gold />
    </div>
    <Surface tone="light" radius="panel" class="lb__surface">
      <div class="lb__body">
        <h2 class="lb__title">{$t.arcade.leaderboard.title}</h2>
        {#if !loading}
          <div class="lb__list">
            <LeaderboardList {entries} />
          </div>
        {/if}
      </div>
    </Surface>
  </div>
</Overlay>

<style lang="sass">
  .lb-frame
    // Above the Overlay's full-screen scrim-dismiss button, which would
    // otherwise sit on top of this and swallow every click (see HowToPlay's
    // `.htp` for the same fix).
    position: relative
    z-index: 1
    display: flex
    flex-direction: column
    padding: 3px
    border-radius: var(--radius-panel)
    // The one and only gradient paint: the thin 3px margin around `Surface`
    // reads as a border, and the `.lb__header` spacer (no fill of its own)
    // exposes the same paint above it as the "header" band.
    background: var(--color-gradient-leaderboard-border)
    // Concentric with the outer radius: inner corner = outer corner - padding.
    --surface-radius-override: calc(var(--radius-panel) - 3px)
    max-width: 92vw
    width: 32rem
    --lb-header-h: 5.5rem
    --lb-badge-size: 5.5rem

  .lb__close-icon
    display: inline-flex
    :global(svg)
      width: 20px
      height: 20px
      fill: currentColor
      display: block

  .lb__header
    flex-shrink: 0
    height: var(--lb-header-h)

  .lb__close
    position: absolute
    inset-block-start: var(--space-16)
    inset-inline-end: var(--space-16)
    // Above `.lb__badge`, which sits later in the DOM and could otherwise
    // paint over this if the two ever overlapped.
    z-index: 1

  // Same fill as the body behind it, straddling the header/body seam — reads
  // as a notch cut into the header without any masking.
  .lb__badge
    position: absolute
    inset-inline: 0
    inset-block-start: calc(var(--lb-header-h) - var(--lb-badge-size) / 2)
    margin-inline: auto
    width: var(--lb-badge-size)
    height: var(--lb-badge-size)
    border-radius: var(--radius-pill)
    background: var(--color-surface-card)
    box-shadow: 0 0 0 var(--space-8) color-mix(in srgb, var(--color-surface-card) 50%, transparent)
    display: flex
    align-items: center
    justify-content: center

  .lb-frame :global(.lb__surface)
    box-shadow: none

  .lb__body
    display: flex
    flex-direction: column
    align-items: center
    gap: var(--space-16)
    padding: var(--space-24)
    padding-block-start: calc(var(--lb-badge-size) / 2 + var(--space-16))

  .lb__title
    margin: 0
    @include tint.type-class(headline)
    color: var(--color-text)

  .lb__list
    width: 100%
    max-height: 50vh
    overflow-y: auto
</style>
