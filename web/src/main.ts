import { mount } from 'svelte'
import '@src/styles/global.sass'
import App from './App.svelte'
import { applyTheme } from '@src/core/theme'
import { setActiveDisplay } from '@src/core/display'
import { registerDisplayLocales } from '@src/i18n'
import { displayRegistry } from '@src/displayRegistry'
import { renderFatalError, renderLanding, type DisplayLink } from '@src/fatalError'

const target = document.getElementById('app')
if (!target) {
  throw new Error('Root element #app not found')
}

const params = new URLSearchParams(window.location.search)

// The engine's built-in demo router (`?demo=…`) still needs to boot, but a
// dedicated demo run doesn't need a display. Fall back to Stallwächter as the
// theme host for demos so the palette is populated.
const demoName = params.get('demo')
const displayId = params.get('display')

function knownDisplayLinks(): DisplayLink[] {
  return Object.keys(displayRegistry).map((id) => ({
    id,
    href: `?display=${encodeURIComponent(id)}`,
  }))
}

/**
 * Resolve the active display: the URL parameter is authoritative. Missing or
 * unknown ids render a landing / error page — no default fallback, so a
 * mis-configured kiosk fails loudly.
 */
async function boot(): Promise<void> {
  const id = displayId ?? (demoName ? 'stallwaechter' : null)
  if (!id) {
    renderLanding(target!, knownDisplayLinks())
    return
  }
  const factory = displayRegistry[id]
  if (!factory) {
    renderFatalError(
      target!,
      `Unknown display "${id}".`,
      knownDisplayLinks(),
    )
    return
  }
  const manifest = await factory()
  applyTheme(manifest.theme)
  registerDisplayLocales(manifest.locales, manifest.defaultLanguage)
  setActiveDisplay(manifest)
  mount(App, { target: target!, props: { display: manifest } })
}

void boot()
