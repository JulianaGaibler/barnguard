/**
 * Plain-DOM landing / error screens rendered before Svelte mounts. Used when
 * the `?display=<id>` URL parameter is missing (landing) or unknown
 * (fatal-error) — we never fall back to a default display, so a mis-configured
 * kiosk fails loudly instead of quietly booting into the wrong event.
 */

export interface DisplayLink {
  id: string
  href: string
}

// Rendered before any display theme is applied, so only the neutral defaults
// from scale.sass are live — the same tokens every display then overrides.
// `--color-app-backdrop` is the token reserved for chrome behind the
// canvas-less DOM (see BackgroundLayer.svelte), which is exactly this screen.

function baseWrap(): HTMLDivElement {
  const wrap = document.createElement('div')
  wrap.setAttribute('role', 'alert')
  wrap.style.cssText = [
    'position: fixed',
    'inset: 0',
    'display: flex',
    'flex-direction: column',
    'align-items: center',
    'justify-content: center',
    'background: var(--color-app-backdrop)',
    'color: var(--color-text-inverse)',
    'padding: var(--space-32)',
    'text-align: center',
  ].join(';')
  return wrap
}

function heading(text: string): HTMLHeadingElement {
  const h1 = document.createElement('h1')
  h1.textContent = text
  h1.className = 'type-headline'
  h1.style.cssText = 'margin-bottom: var(--space-16)'
  return h1
}

function paragraph(text: string): HTMLParagraphElement {
  const p = document.createElement('p')
  p.textContent = text
  p.className = 'type-body-large'
  p.style.cssText = 'max-width: 40rem; margin-bottom: var(--space-24)'
  return p
}

function displayList(displays: DisplayLink[]): HTMLUListElement {
  const ul = document.createElement('ul')
  ul.style.cssText =
    'list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: var(--space-8)'
  for (const d of displays) {
    const li = document.createElement('li')
    const a = document.createElement('a')
    a.href = d.href
    a.textContent = d.id
    a.className = 'type-button'
    a.style.cssText = [
      'color: var(--color-text)',
      'background: var(--color-surface)',
      'box-shadow: var(--color-shadow-card)',
      'padding: var(--space-12) var(--space-24)',
      'border-radius: var(--radius-card)',
      'text-decoration: none',
      'display: inline-block',
      'min-width: 16rem',
    ].join(';')
    li.appendChild(a)
    ul.appendChild(li)
  }
  return ul
}

/**
 * Landing screen shown when no `?display=` param is present. Lists every
 * registered display as a link so an attendant / dev can pick one without
 * remembering the URL scheme.
 */
export function renderLanding(
  target: HTMLElement,
  displays: DisplayLink[],
): void {
  target.innerHTML = ''
  const wrap = baseWrap()
  wrap.append(
    heading('Barnguard'),
    paragraph(
      displays.length > 0
        ? 'Pick a display to launch. Bookmark the direct URL for kiosk use.'
        : 'No displays are registered.',
    ),
    displayList(displays),
  )
  target.append(wrap)
}

/**
 * Fatal error shown for an unknown `?display=<id>` value. Lists the known
 * displays as links so the operator can recover without hand-editing the URL.
 */
export function renderFatalError(
  target: HTMLElement,
  message: string,
  displays: DisplayLink[] = [],
): void {
  target.innerHTML = ''
  const wrap = baseWrap()
  wrap.append(heading('Barnguard'), paragraph(message))
  if (displays.length > 0) {
    wrap.append(paragraph('Known displays:'), displayList(displays))
  }
  target.append(wrap)
}
