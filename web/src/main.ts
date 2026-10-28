import { mount } from 'svelte'
import '@src/styles/global.sass'
import App from './App.svelte'
import { applyTheme } from '@src/core/theme'
import { preloadFonts } from '@src/core/fonts'
import { startUiScale } from '@src/core/ui/uiScale'
import { isInstalledApp, keepAwake, lockGestures } from '@src/core/pwa/appMode'
import { linkInstallMetadata } from '@src/core/pwa/installable'
import {
  registerServiceWorker,
  removeServiceWorker,
} from '@src/core/pwa/register'
import { setActiveDisplay } from '@src/core/display'
import { registerDisplayLocales } from '@src/i18n'
import { displayRegistry } from 'virtual:displays'
import { bootDevSurface } from '@src/dev/boot'
import {
  renderFatalError,
  renderLanding,
  type DisplayLink,
} from '@src/fatalError'

// A kiosk reload has to come up in its opening state. Left on `auto` the
// browser restores the scroll offsets the page had, including inside the
// launcher carousel, so a reload lands on whatever card the last visitor left
// centred. Set before `load` fires, which is when the restore would happen.
history.scrollRestoration = 'manual'

const target = document.getElementById('app')
if (!target) {
  throw new Error('Root element #app not found')
}

const params = new URLSearchParams(window.location.search)

function knownDisplayLinks(): DisplayLink[] {
  return Object.keys(displayRegistry).map((id) => ({
    id,
    href: `?display=${encodeURIComponent(id)}`,
  }))
}

/**
 * Pick the surface to mount. A single-display build always boots its display. A
 * full build mounts a dev surface (`?fonts`, `?backdrop`, `?dither`) when one
 * is asked for, otherwise the display named by `?display=`, and a missing or
 * unknown id renders a landing / error page. There is no default fallback, so a
 * mis-configured kiosk fails loudly instead of quietly booting into the wrong
 * event.
 */
async function boot(): Promise<void> {
  if (!__SINGLE_DISPLAY__ && (await bootDevSurface(params, target!))) return
  // A single build ignores `?display=`, so a copy installed from a full build
  // with `./?display=<id>` as its start URL still opens.
  const id = __SINGLE_DISPLAY__ ?? params.get('display')
  if (!id) {
    renderLanding(target!, knownDisplayLinks())
    return
  }
  const factory = displayRegistry[id]
  if (!factory) {
    renderFatalError(target!, `Unknown display "${id}".`, knownDisplayLinks())
    return
  }
  const manifest = await factory()
  applyTheme(manifest.theme)
  startUiScale()
  registerDisplayLocales(manifest.locales, manifest.defaultLanguage)
  setActiveDisplay(manifest)
  lockGestures()
  if (isInstalledApp()) keepAwake()
  if (manifest.install) {
    linkInstallMetadata(id, manifest.name, manifest.install)
    if (isInstalledApp()) registerServiceWorker()
  }
  // Only the installed app works offline. A browser tab drops the worker an
  // earlier visit set up, so it always loads the latest version.
  if (!isInstalledApp()) void removeServiceWorker().catch(() => {})
  // Hold the mount until the webfonts have settled. The engine bakes canvas
  // text into a texture atlas on first draw and caches it by font string, so a
  // label drawn before its face arrives keeps the fallback glyphs. The fetch
  // overlaps the display-module import above, so this costs little in practice.
  await preloadFonts(manifest.fontSpecs)
  mount(App, { target: target!, props: { display: manifest } })
}

void boot()
