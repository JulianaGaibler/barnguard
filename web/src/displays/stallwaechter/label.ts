/**
 * Stallwächter's game-over label. Renders the German-states scoreboard (state
 * photo behind a wave, big score, "Punkte" caption, high-score pill, Firefox
 * Enterprise logo) to a JPEG for the label printer.
 *
 * Composed on a standalone OffscreenCanvas, NOT the live WebGL canvas (created
 * without `preserveDrawingBuffer`, readback is blank). Also gives pixel-exact
 * control independent of DPR and works headless in tests.
 *
 * VC-500W tape is continuous, only the cross-tape dimension is fixed. We render
 * square (edge = tape width px), daemon sends `<print autofit=1>` so hardware
 * corrects any small size mismatch without clipping.
 *
 * All layout sizes are ratios of the label edge (Figma comp is 330×330).
 */

import { get } from 'svelte/store'
import { fontMetrics } from '@src/stargazer'
import type { GameOverReason, StateId } from './game'
import type { StallwaechterHighScores as HighScores } from './game-log'
import type { StallwaechterMessages } from './i18n/types'
import { STATE_PHOTOS } from './game/data/statePhotos'
import { daemonConfig, DEFAULT_LABEL_URL } from '@src/stores/daemonConfig'
import {
  drawCssGradient,
  drawMaskedImage,
  loadImage,
  roundRectPath,
  type Ctx2D,
} from '@src/core/print/canvas'
import { preloadFonts } from '@src/core/fonts'

import waveUrl from './assets/wave-label.svg?url'
import firefoxLogoUrl from './assets/firefox-enterprise-logo-horizontal.png?url'

/**
 * Font families the label draws with. Declared as `@font-face` in
 * `styles/fonts.scss` and awaited at boot by `core/fonts`, so these are plain
 * references to faces the document already has.
 */
const FONT_HEADLINE = 'Mozilla Headline Extended'
const FONT_TEXT = 'Mozilla Text'

/** Everything the label needs, exactly the `gameOver` payload plus a time. */
export interface LabelInput {
  reason: GameOverReason
  stateId: StateId
  score: number
  isOverallHigh: boolean
  isStateHigh: boolean
  highScores: HighScores
  escapeHeadingRad?: number
  printedAt?: Date
}

export interface LabelRenderOptions {
  /** Resolved locale strings, passed in so the renderer has no store dependency. */
  messages: StallwaechterMessages
  /** Square edge in px. */
  size: number
  /** Non-square escape hatch (overrides `size`). */
  width?: number
  height?: number
  /** JPEG quality 0..1. */
  quality?: number
}

interface LabelAssets {
  wave: HTMLImageElement
  logo: HTMLImageElement
  photo: HTMLImageElement
}

async function loadAssets(stateId: StateId): Promise<LabelAssets> {
  const [wave, logo, photo] = await Promise.all([
    loadImage(waveUrl),
    loadImage(firefoxLogoUrl),
    loadImage(STATE_PHOTOS[stateId].url),
  ])
  return { wave, logo, photo }
}

/**
 * Render the label and encode it as a JPEG blob. Awaits fonts + image assets,
 * then delegates to the pure {@link drawLabel}. Throws if the runtime lacks
 * `OffscreenCanvas` (i.e. outside a browser).
 */
export async function renderLabel(
  input: LabelInput,
  opts: LabelRenderOptions,
): Promise<Blob> {
  if (typeof OffscreenCanvas === 'undefined') {
    throw new Error('renderLabel requires OffscreenCanvas (browser only)')
  }
  const width = opts.width ?? opts.size
  const height = opts.height ?? opts.size

  const [assets] = await Promise.all([
    loadAssets(input.stateId),
    // Boot already awaited these; re-awaiting is cheap and keeps the renderer
    // correct if it is ever driven outside the normal boot path.
    preloadFonts(),
  ])

  const canvas = new OffscreenCanvas(width, height)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('renderLabel: could not get a 2D context')

  drawLabel(
    ctx,
    width,
    height,
    input,
    opts.messages,
    assets,
    get(daemonConfig).labelUrl,
  )

  return canvas.convertToBlob({
    type: 'image/jpeg',
    quality: opts.quality ?? 0.92,
  })
}

// Design-space ratios. All positions/sizes below are fractions of the label
// edge so the layout scales cleanly from the Figma 330×330 base to whatever
// pixel size the tape resolves to.
const R = {
  scoreFont: 138 / 330,
  captionFont: 21 / 330,
  pillFont: 14 / 330,
  headerFont: 14 / 330,
  waveHeightPct: 123 / 330,
  waveGap: 16 / 330,
  edgePad: 16 / 330,
  headerTopPad: 22 / 330,
  logoHeight: 26 / 330,
  captionGapAfterScore: -10 / 330,
  pillGapAfterCaption: 10 / 330,
  pillPadY: 8 / 330,
  pillPadX: 16 / 330,
  pillRadius: 999,
}

const COL = {
  bg: '#25365C',
  ink: '#010612',
  wave: '#25365C',
  gradient: [
    { pos: -0.3028, color: '#FFEB49' },
    { pos: 1.1937, color: '#FF6600' },
    { pos: 2.3227, color: '#FB2872' },
  ] as const,
}

/**
 * Pure, store-free draw. Tests can pass a stub 2D context, omit `assets` (image
 * steps skip) and rely on the `labelUrl` default.
 */
export function drawLabel(
  ctx: Ctx2D,
  w: number,
  h: number,
  input: LabelInput,
  messages: StallwaechterMessages,
  assets?: LabelAssets,
  labelUrl: string = DEFAULT_LABEL_URL,
): void {
  const edge = Math.min(w, h)
  const isHigh = input.isOverallHigh || input.isStateHigh

  ctx.fillStyle = COL.bg
  ctx.fillRect(0, 0, w, h)

  drawCssGradient(ctx, w, h, 75, COL.gradient)

  const waveH = edge * R.waveHeightPct
  const waveGap = edge * R.waveGap
  const blueWaveY = h - waveH
  const maskWaveY = blueWaveY - waveGap
  if (assets) {
    drawMaskedImage(
      ctx,
      w,
      h,
      assets.wave,
      0,
      maskWaveY,
      w,
      waveH,
      assets.photo,
      0,
      maskWaveY,
      w,
      h - maskWaveY,
      0.66,
    )
  }

  if (assets) {
    ctx.drawImage(assets.wave, 0, blueWaveY, w, waveH)
  }

  const pad = Math.round(edge * R.edgePad)
  const headerY = Math.round(edge * R.headerTopPad)
  const headerPx = Math.round(edge * R.headerFont)
  ctx.fillStyle = COL.ink
  ctx.textBaseline = 'top'
  ctx.font = `700 ${headerPx}px "${FONT_TEXT}", sans-serif`

  ctx.textAlign = 'left'
  ctx.fillText(messages.states[input.stateId], pad, headerY)

  ctx.textAlign = 'right'
  ctx.fillText(labelUrl, w - pad, headerY)

  const scorePx = Math.round(edge * R.scoreFont)
  const captionPx = Math.round(edge * R.captionFont)
  const captionGap = Math.round(edge * R.captionGapAfterScore)
  const pillGap = Math.round(edge * R.pillGapAfterCaption)
  const pillPx = Math.round(edge * R.pillFont)
  const pillPadY = Math.round(edge * R.pillPadY)
  const pillH = Math.round(pillPx + pillPadY * 2)

  // Stacked on measured heights rather than on the requested font sizes. A
  // font's drawn height is its ascent plus its descent, which is not its px
  // size, and using the size as a stand-in drifts the block off centre.
  const scoreFont = `700 ${scorePx}px "${FONT_HEADLINE}", sans-serif`
  const captionFont = `400 ${captionPx}px "${FONT_TEXT}", sans-serif`
  const scoreM = fontMetrics(scoreFont)
  const captionM = fontMetrics(captionFont)
  const scoreH = scoreM.ascent + scoreM.descent
  const captionH = captionM.ascent + captionM.descent

  const blockH = scoreH + captionGap + captionH + (isHigh ? pillGap + pillH : 0)
  const blockTop = Math.round((h - blockH) / 2)

  ctx.fillStyle = COL.ink
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  ctx.font = scoreFont
  ctx.fillText(String(input.score), w / 2, blockTop + scoreM.ascent)

  const captionY = blockTop + scoreH + captionGap
  ctx.font = captionFont
  const pointsLabel =
    input.score === 1 ? messages.game.point : messages.game.points
  ctx.fillText(pointsLabel, w / 2, captionY + captionM.ascent)

  if (isHigh) {
    const pillPadX = Math.round(edge * R.pillPadX)
    const pillText = messages.game.newHighScoreBanner.toUpperCase()

    ctx.font = `700 ${pillPx}px "${FONT_TEXT}", sans-serif`
    const textWidth = ctx.measureText(pillText).width
    const pillW = Math.round(textWidth + pillPadX * 2)
    const pillY = captionY + captionH + pillGap
    const pillX = Math.round((w - pillW) / 2)
    const radius = Math.min(R.pillRadius, pillH / 2)

    ctx.fillStyle = '#ffffff'
    roundRectPath(ctx, pillX, pillY, pillW, pillH, radius)
    ctx.fill()

    ctx.fillStyle = COL.ink
    ctx.textBaseline = 'middle'
    ctx.fillText(pillText, w / 2, pillY + pillH / 2)
  }

  if (assets) {
    const logoTargetH = Math.round(edge * R.logoHeight)
    const ratio = assets.logo.naturalWidth / assets.logo.naturalHeight
    const logoW = Math.round(logoTargetH * ratio)
    const logoX = pad
    const logoY = h - pad - logoTargetH
    ctx.drawImage(assets.logo, logoX, logoY, logoW, logoTargetH)
  }
}
