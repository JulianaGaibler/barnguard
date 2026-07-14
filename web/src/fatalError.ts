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
    'background: #1c1c1c',
    'color: #ffd34d',
    'font-family: -apple-system, "Segoe UI", "Helvetica Neue", Arial, sans-serif',
    'padding: 2rem',
    'text-align: center',
  ].join(';')
  return wrap
}

function heading(text: string): HTMLHeadingElement {
  const h1 = document.createElement('h1')
  h1.textContent = text
  h1.style.cssText = 'font-size: 2rem; margin-bottom: 1rem; font-weight: 700'
  return h1
}

function paragraph(text: string): HTMLParagraphElement {
  const p = document.createElement('p')
  p.textContent = text
  p.style.cssText =
    'font-size: 1rem; max-width: 40rem; line-height: 1.5; margin-bottom: 1.5rem'
  return p
}

function displayList(displays: DisplayLink[]): HTMLUListElement {
  const ul = document.createElement('ul')
  ul.style.cssText =
    'list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 0.5rem'
  for (const d of displays) {
    const li = document.createElement('li')
    const a = document.createElement('a')
    a.href = d.href
    a.textContent = d.id
    a.style.cssText = [
      'color: #ffd34d',
      'background: rgba(255, 211, 77, 0.08)',
      'padding: 0.75rem 1.5rem',
      'border-radius: 6px',
      'text-decoration: none',
      'font-size: 1.125rem',
      'font-weight: 600',
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
