// Development preview for the 14x14 portraits, served by Vite at
// `/portraits.html`. Not part of the game build: nothing in `src` imports it.
//
// It renders three things — every card in deck order, the layer library on its
// own, and the skin ramp — so a tweak to one hair style can be judged both on
// the card that wears it and in isolation.

import { DECK, type Group } from '../game/rules/deck'
import { COLORS, GROUP_COLORS } from '../game/tuning'
import {
  LIBRARY,
  PORTRAITS,
  PORTRAIT_SIZE,
  type PortraitSpec,
  renderPortrait,
} from './portraits'

const BACKGROUNDS = {
  paper: COLORS.board,
  dark: '#22201c',
  checker: 'transparent',
} as const

let scale = 8
let background: keyof typeof BACKGROUNDS = 'paper'

const swatch = (pixels: (string | null)[][]): HTMLCanvasElement => {
  const canvas = document.createElement('canvas')
  canvas.width = PORTRAIT_SIZE
  canvas.height = PORTRAIT_SIZE
  const gfx = canvas.getContext('2d')!
  for (let r = 0; r < PORTRAIT_SIZE; r++) {
    for (let c = 0; c < PORTRAIT_SIZE; c++) {
      const colour = pixels[r]![c]
      if (!colour) continue
      gfx.fillStyle = colour
      gfx.fillRect(c, r, 1, 1)
    }
  }
  canvas.className = 'pixels'
  return canvas
}

const tile = (
  pixels: (string | null)[][],
  label: string,
  note = '',
): HTMLElement => {
  const cell = document.createElement('figure')
  cell.className = 'tile'
  cell.append(swatch(pixels))
  const caption = document.createElement('figcaption')
  caption.textContent = label
  cell.append(caption)
  if (note) {
    const sub = document.createElement('span')
    sub.className = 'note'
    sub.textContent = note
    cell.append(sub)
  }
  return cell
}

const section = (title: string): HTMLElement => {
  const heading = document.createElement('h2')
  heading.textContent = title
  document.body.append(heading)
  const grid = document.createElement('div')
  grid.className = 'grid'
  document.body.append(grid)
  return grid
}

const DEMO_GROUPS: Group[] = ['product', 'design']

function render(): void {
  document.body.innerHTML = ''
  document.body.style.setProperty('--scale', `${PORTRAIT_SIZE * scale}px`)
  document.body.dataset.bg = background

  const bar = document.createElement('header')
  bar.innerHTML = `
    <strong>Office Overtime portraits</strong>
    <label>zoom <input type="range" min="4" max="20" value="${scale}" /></label>
    <label>background
      <select>${Object.keys(BACKGROUNDS)
        .map(
          (k) => `<option ${k === background ? 'selected' : ''}>${k}</option>`,
        )
        .join('')}</select>
    </label>`
  document.body.append(bar)
  bar.querySelector('input')!.addEventListener('input', (e) => {
    scale = Number((e.target as HTMLInputElement).value)
    render()
  })
  bar.querySelector('select')!.addEventListener('change', (e) => {
    background = (e.target as HTMLSelectElement)
      .value as keyof typeof BACKGROUNDS
    render()
  })

  for (const floor of ['management', 'ic'] as const) {
    const grid = section(floor === 'management' ? 'Management' : 'IC')
    for (const card of DECK.filter((c) => c.floor === floor)) {
      const spec = PORTRAITS[card.id]!
      const cell = tile(
        renderPortrait(spec, card.groups),
        card.name,
        `${card.cost}k · ${card.groups.join(' + ')}`,
      )
      for (const group of new Set(card.groups)) {
        const dot = document.createElement('i')
        dot.style.background = GROUP_COLORS[group].fill
        cell.append(dot)
      }
      grid.append(cell)
    }
  }

  const hair = section('Hair')
  for (const style of Object.keys(LIBRARY.HAIR)) {
    const spec = [3, style, 'black', 'tee'] as PortraitSpec
    hair.append(tile(renderPortrait(spec, DEMO_GROUPS), style))
  }

  const garments = section('Garments')
  for (const garment of Object.keys(LIBRARY.GARMENTS)) {
    const spec = [3, 'short', 'black', garment] as PortraitSpec
    garments.append(tile(renderPortrait(spec, DEMO_GROUPS), garment))
  }

  const extras = section('Extras')
  for (const extra of Object.keys(LIBRARY.EXTRAS)) {
    const spec = [3, 'short', 'black', 'tee', [extra]] as PortraitSpec
    extras.append(tile(renderPortrait(spec, DEMO_GROUPS), extra))
  }

  const skins = section('Skin ramp')
  for (let i = 0; i < LIBRARY.SKINS.length; i++) {
    const spec = [i, 'short', 'black', 'tee'] as PortraitSpec
    skins.append(tile(renderPortrait(spec, DEMO_GROUPS), `skin ${i}`))
  }
}

render()
