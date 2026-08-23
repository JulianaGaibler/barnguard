<script lang="ts">
  import { onMount } from 'svelte'
  import { locale } from '@src/i18n'
  import {
    BOOTH_CORNER_SIZE_PX,
    initBoothMenuToggle,
  } from '@src/core/attendant/boothMenuToggle'
  import { coverScreen } from '@src/stores/coverScreen'
  import CoverScreen from '@src/core/attendant/CoverScreen.svelte'
  import BoothMenu from '@src/core/attendant/BoothMenu.svelte'
  import PrinterPanel from '@src/core/attendant/PrinterPanel.svelte'
  import GamesPanel from '@src/core/attendant/GamesPanel.svelte'
  import LeaderboardPanel from '@src/core/attendant/LeaderboardPanel.svelte'
  import BackgroundLayer from '@src/core/ui/BackgroundLayer.svelte'
  import TopBar from '@src/core/attendant/TopBar.svelte'
  import type { DisplayManifest } from '@src/core/display'

  interface Props {
    display: DisplayManifest
  }
  let { display }: Props = $props()

  const DisplayRoot = $derived(display.root)

  // Keep the document language in sync with the active locale (accessibility).
  $effect(() => {
    document.documentElement.lang = $locale
  })

  // Attach the booth-menu gestures (corner double-tap + Ctrl+Shift+D
  // dev backdoor) for the lifetime of the app. The corner size goes onto the
  // root as a CSS variable so DOM chrome can keep out of the gesture's boxes
  // without restating the number.
  onMount(() => {
    document.documentElement.style.setProperty(
      '--booth-corner-size',
      `${BOOTH_CORNER_SIZE_PX}px`,
    )
    return initBoothMenuToggle()
  })
</script>

<BackgroundLayer />

<DisplayRoot />

<TopBar />

{#if $coverScreen.visible}
  <CoverScreen />
{/if}

<BoothMenu />
<PrinterPanel />
<GamesPanel />
{#if display.leaderboardIds?.length}
  <LeaderboardPanel />
{/if}
