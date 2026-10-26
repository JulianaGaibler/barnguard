import type { DisplayInstall } from '@src/core/display'

/**
 * Whether the page runs as an installed app, opened from the home screen with
 * no browser around it, and not in a browser tab.
 */
export function isInstalledApp(win: Window = window): boolean {
  const standalone = (win.navigator as Navigator & { standalone?: boolean })
    .standalone
  if (standalone === true) return true
  return (
    win.matchMedia?.('(display-mode: standalone)').matches === true ||
    win.matchMedia?.('(display-mode: fullscreen)').matches === true
  )
}

/** Finds the element selected by `selector`, or adds one to the head. */
function headElement<T extends HTMLElement>(
  doc: Document,
  tag: string,
  selector: string,
): T {
  const found = doc.head.querySelector<T>(selector)
  if (found) return found
  const created = doc.createElement(tag) as T
  doc.head.append(created)
  return created
}

/**
 * Points the page at the manifest, the touch icon and the app title of
 * `displayId`, so adding the page to a home screen installs that display. The
 * paths are relative to the page, which keeps a copy deployed in a folder
 * working. The files are `manifest-<id>.webmanifest` and `icons/<id>-180.png`
 * in `public/`.
 */
export function linkInstallMetadata(
  displayId: string,
  title: string,
  install: DisplayInstall,
  doc: Document = document,
): void {
  const manifest = headElement<HTMLLinkElement>(
    doc,
    'link',
    'link[rel="manifest"]',
  )
  manifest.rel = 'manifest'
  manifest.href = `./manifest-${displayId}.webmanifest`

  const icon = headElement<HTMLLinkElement>(
    doc,
    'link',
    'link[rel="apple-touch-icon"]',
  )
  icon.rel = 'apple-touch-icon'
  icon.href = `./icons/${displayId}-180.png`

  const statusBar = install.statusBarStyle
  if (statusBar) {
    const bar = headElement<HTMLMetaElement>(
      doc,
      'meta',
      'meta[name="apple-mobile-web-app-status-bar-style"]',
    )
    bar.name = 'apple-mobile-web-app-status-bar-style'
    bar.content = statusBar
  }

  const appTitle = headElement<HTMLMetaElement>(
    doc,
    'meta',
    'meta[name="apple-mobile-web-app-title"]',
  )
  appTitle.name = 'apple-mobile-web-app-title'
  appTitle.content = title
}
