import { mount } from 'svelte'
import '@src/styles/global.sass'
import App from './App.svelte'
import { applyTheme } from '@src/core/theme'
import { preloadFonts } from '@src/core/fonts'
import { startUiScale } from '@src/core/ui/uiScale'
import { setActiveDisplay } from '@src/core/display'
import { registerDisplayLocales } from '@src/i18n'
import { displayRegistry } from '@src/displayRegistry'
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

// `?demo=…` is the engine's demo stage, its own surface, not a kiosk display.
// It has no theme, no locales and no booth chrome, so it bypasses `App`
// entirely rather than borrowing a display to host it.
const isDemoRun = params.has('demo')
// `?fonts` is the type specimen: a dev surface for judging the shipped faces
// and the role each is bound to. Like the demo stage, it is not a display.
const isFontRun = params.has('fonts')
const displayId = params.get('display')

function knownDisplayLinks(): DisplayLink[] {
  return Object.keys(displayRegistry).map((id) => ({
    id,
    href: `?display=${encodeURIComponent(id)}`,
  }))
}

/**
 * Pick the surface to mount: the demo stage when `?demo=` is present, otherwise
 * the display named by `?display=`. A missing or unknown display id renders a
 * landing / error page. There is no default fallback, so a mis-configured kiosk
 * fails loudly instead of quietly booting into the wrong event.
 */
async function boot(): Promise<void> {
  if (isFontRun) {
    startUiScale()
    const { default: FontSpecimen } =
      await import('@src/dev/FontSpecimen.svelte')
    await preloadFonts()
    mount(FontSpecimen, { target: target! })
    return
  }
  if (isDemoRun) {
    startUiScale()
    // Dynamic so a kiosk build never carries the demo stage or the debug HUD
    // it pulls in.
    const { default: DemoRouter } =
      await import('@src/stargazer/dev/DemoRouter.svelte')
    await preloadFonts()
    mount(DemoRouter, { target: target! })
    return
  }
  const id = displayId
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
  // Hold the mount until the webfonts have settled. The engine bakes canvas
  // text into a texture atlas on first draw and caches it by font string, so a
  // label drawn before its face arrives keeps the fallback glyphs. The fetch
  // overlaps the display-module import above, so this costs little in practice.
  await preloadFonts()
  mount(App, { target: target!, props: { display: manifest } })
}

void boot()
