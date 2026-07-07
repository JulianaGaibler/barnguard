<script lang="ts">
  import { onMount } from 'svelte'
  import { locale } from '@src/i18n'
  import { initBoothMenuToggle } from './lib/boothMenuToggle'
  import GameScreen from './lib/GameScreen.svelte'
  import BoothMenu from './lib/BoothMenu.svelte'
  import PrinterPanel from './lib/PrinterPanel.svelte'
  import BackgroundLayer from './lib/BackgroundLayer.svelte'
  import TopBar from './lib/TopBar.svelte'
  import DemoRouter from './stargazer/dev/DemoRouter.svelte'

  const demoName = new URLSearchParams(window.location.search).get('demo')

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
  <GameScreen />
{/if}

<TopBar />
<BoothMenu />
<PrinterPanel />
