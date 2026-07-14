<script lang="ts">
  import { onMount } from 'svelte'
  import { locale } from '@src/i18n'
  import { initBoothMenuToggle } from '@src/core/attendant/boothMenuToggle'
  import { coverScreen } from '@src/stores/coverScreen'
  import CoverScreen from '@src/core/attendant/CoverScreen.svelte'
  import BoothMenu from '@src/core/attendant/BoothMenu.svelte'
  import PrinterPanel from '@src/core/attendant/PrinterPanel.svelte'
  import GamesPanel from '@src/core/attendant/GamesPanel.svelte'
  import BackgroundLayer from '@src/core/ui/BackgroundLayer.svelte'
  import TopBar from '@src/core/attendant/TopBar.svelte'
  import DemoRouter from './stargazer/dev/DemoRouter.svelte'
  import type { DisplayManifest } from '@src/core/display'

  interface Props {
    display: DisplayManifest
  }
  let { display }: Props = $props()

  const demoName = new URLSearchParams(window.location.search).get('demo')
  const DisplayRoot = $derived(display.root)

  // Keep the document language in sync with the active locale (accessibility).
  $effect(() => {
    document.documentElement.lang = $locale
  })

  // Attach the booth-menu gestures (corner double-tap + Ctrl+Shift+D
  // dev backdoor) for the lifetime of the app.
  onMount(() => initBoothMenuToggle())
</script>

<BackgroundLayer />

{#if demoName}
  <DemoRouter {demoName} />
{:else}
  <DisplayRoot />
{/if}

<TopBar />

{#if $coverScreen.visible}
  <CoverScreen />
{/if}

<BoothMenu />
<PrinterPanel />
<GamesPanel />
