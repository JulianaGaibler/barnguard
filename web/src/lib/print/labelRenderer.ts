/**
 * Renders the game-over result to a JPEG for the label printer.
 *
 * The label is composed on a standalone {@link OffscreenCanvas} (2D); NOT a
 * snapshot of the live WebGL game canvas (which is created without
 * `preserveDrawingBuffer`, so reading it back yields a blank frame). A
 * dedicated offscreen surface also gives pixel-exact control over the print
 * dimensions independent of the display/DPR, and works headless in tests.
 *
 * The VC-500W tape is continuous: the image dimension _across_ the tape is
 * fixed by the loaded cassette width, the length is free. We render a SQUARE by
 * default (edge = tape width in px); the daemon sends `<print autofit=1>` so
 * the printer scales to the real tape while preserving the 1:1 aspect; a
 * slightly wrong size is corrected in hardware, never clipped.
 *
 * Layout: Firefox-Enterprise-branded card. Warm sunrise gradient background,
 * state name top-left, the label URL (from the daemon's `[client] label_url`,
 * via the `daemonConfig` store) top-right, huge score in Mozilla Slab Headline
 * Expanded centred, "Punkte"/"Points" beneath, an optional white "NEUER HIGH
 * SCORE" pill when the round set a record, a bottom navy wave, the state's
 * landscape photo peeking through a second (mask-only) copy of the wave
 * positioned just above the blue one at 66% opacity, and the horizontal Firefox
 * Enterprise logo bottom-left. All sizes are ratios of the label edge so it
 * scales cleanly across tape widths — the Figma comp was authored at 330×330
 * base.
 */

import { get } from 'svelte/store'
import type { GameOverReason, StateId } from '@src/game'
import type { HighScores } from '@src/lib/gameLogClient'
import type { Messages } from '@src/i18n'
import { STATE_PHOTOS } from '@src/game/data/statePhotos'
import { daemonConfig, DEFAULT_LABEL_URL } from '@src/stores/daemonConfig'

import headlineFontUrl from '@src/assets/fonts/MozillaHeadlineExtended-Bold.woff2?url'
import textFontUrl from '@src/assets/fonts/MozillaText-Regular.woff2?url'
import textBoldFontUrl from '@src/assets/fonts/MozillaText-Bold.woff2?url'
import waveUrl from '@src/assets/wave-label.svg?url'
import firefoxLogoUrl from '@src/assets/firefox-enterprise-logo-horizontal.png?url'

/** Brother VC-500W resolution (~317 lpi vivid). */
export const PIXELS_PER_MM = 12.48
/** Fallback tape width when the printer's is unknown (common CZ-1004 ≈ 25mm). */
export const DEFAULT_TAPE_WIDTH_MM = 25

/** Font family names registered with `document.fonts` by `renderLabel`. */
const FONT_HEADLINE = 'Mozilla Slab Headline Expanded'
const FONT_TEXT = 'Mozilla Text'

/** Everything the label needs; exactly the `gameOver` payload plus a time. */
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
  /** Resolved locale strings; passed in so the renderer has no store dependency. */
  messages: Messages
  /**
   * Square edge in px. Defaults to the tape width in px (see
   * DEFAULT_TAPE_WIDTH_MM).
   */
  size?: number
  /** Non-square escape hatch (overrides `size`). */
  width?: number
  height?: number
  /** JPEG quality 0..1. */
  quality?: number
  /** Pixels per mm (defaults to the VC-500W's). */
  pixelDensity?: number
}

/** Square edge in px for a given tape width, falling back to a safe default. */
export function squarePxFrom(
  tapeWidthMm?: number | null,
  density: number = PIXELS_PER_MM,
): number {
  const mm =
    tapeWidthMm && tapeWidthMm > 0 ? tapeWidthMm : DEFAULT_TAPE_WIDTH_MM
  return Math.round(mm * density)
}

type Ctx2D = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D

// -----------------------------------------------------------------------------
// Asset loading (fonts, images). Cached at module scope so subsequent renders
// are synchronous once everything has loaded once. Everything is browser-only
// and lazy: `drawLabel` itself never touches these caches, so unit tests that
// import `drawLabel` directly stay hermetic.
// -----------------------------------------------------------------------------

let fontsReadyPromise: Promise<void> | null = null

function fontsReady(): Promise<void> {
  if (fontsReadyPromise) return fontsReadyPromise
  if (typeof document === 'undefined' || !document.fonts) {
    fontsReadyPromise = Promise.resolve()
    return fontsReadyPromise
  }
  fontsReadyPromise = (async () => {
    const headline = new FontFace(FONT_HEADLINE, `url(${headlineFontUrl})`, {
      weight: '700',
      style: 'normal',
    })
    const text = new FontFace(FONT_TEXT, `url(${textFontUrl})`, {
      weight: '400',
      style: 'normal',
    })
    const textBold = new FontFace(FONT_TEXT, `url(${textBoldFontUrl})`, {
      weight: '700',
      style: 'normal',
    })
    await Promise.all([headline.load(), text.load(), textBold.load()])
    document.fonts.add(headline)
    document.fonts.add(text)
    document.fonts.add(textBold)
  })().catch((err) => {
    // Fall through to default sans-serif so a font hiccup never blocks a
    // print; the label is still legible, just off-brand.
    console.warn('[labelRenderer] font load failed, falling back:', err)
  })
  return fontsReadyPromise
}

const imageCache = new Map<string, Promise<HTMLImageElement>>()

function loadImage(url: string): Promise<HTMLImageElement> {
  const cached = imageCache.get(url)
  if (cached) return cached
  const promise = new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () =>
      reject(new Error(`labelRenderer: failed to load ${url}`))
    img.src = url
  })
  imageCache.set(url, promise)
  return promise
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

// -----------------------------------------------------------------------------
// Entry point
// -----------------------------------------------------------------------------

/**
 * Render the label and encode it as a JPEG blob. Awaits fonts + image assets on
 * the first call, then delegates to the pure {@link drawLabel}. Throws if the
 * runtime lacks `OffscreenCanvas` (i.e. outside a browser).
 */
export async function renderLabel(
  input: LabelInput,
  opts: LabelRenderOptions,
): Promise<Blob> {
  if (typeof OffscreenCanvas === 'undefined') {
    throw new Error('renderLabel requires OffscreenCanvas (browser only)')
  }
  const density = opts.pixelDensity ?? PIXELS_PER_MM
  const edge = opts.size ?? Math.round(DEFAULT_TAPE_WIDTH_MM * density)
  const width = opts.width ?? edge
  const height = opts.height ?? edge

  const [assets] = await Promise.all([loadAssets(input.stateId), fontsReady()])

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

// -----------------------------------------------------------------------------
// Draw
// -----------------------------------------------------------------------------

// Design-space ratios. All positions/sizes below are fractions of the label
// edge so the layout scales cleanly from the Figma 330×330 base to whatever
// pixel size the tape resolves to.
const R = {
  /** Score number height (`138 / 330`). */
  scoreFont: 138 / 330,
  /** "Punkte" / "Points" caption height. */
  captionFont: 21 / 330,
  /** "Neuer High Score" pill text height. */
  pillFont: 14 / 330,
  /** State-name + URL text height (top-left / top-right). */
  headerFont: 14 / 330,
  /** Wave graphic aspect: source svg is 330×123, so height = width × 123/330. */
  waveHeightPct: 123 / 330,
  /** Distance the mask-wave sits above the blue wave (~16 / 330). */
  waveGap: 16 / 330,
  /** Padding from the label's edge for header text + logo. */
  edgePad: 16 / 330,
  /**
   * Extra breathing room above the top-row text (state name + URL). Larger than
   * `edgePad` so the header doesn't feel crammed against the top edge, and —
   * because the score block re-centres relative to the header — the whole
   * composition shifts down with it.
   */
  headerTopPad: 22 / 330,
  /** Firefox logo target height. */
  logoHeight: 26 / 330,
  /**
   * Vertical nudge applied to the score/caption/pill block AFTER it's been
   * centred on the label's midline. The block's own height includes the pill
   * when a high score is set, so the whole composition re-balances around `h/2`
   * automatically — this knob is a manual offset on top of that. Positive
   * values push the block downward, negative pull it up.
   */
  scoreGapAfterHeader: -20 / 330,
  /** Gap between the bottom of the score glyphs and the top of the caption. */
  captionGapAfterScore: -10 / 330,
  /** Gap between the bottom of the caption and the top of the pill. */
  pillGapAfterCaption: 10 / 330,
  /** Pill vertical padding. */
  pillPadY: 8 / 330,
  /** Pill horizontal padding. */
  pillPadX: 16 / 330,
  /** Pill corner radius (fully rounded — clamped to half height at draw time). */
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
 * Draw the label. Pure and store-free: takes resolved `messages`, the resolved
 * `labelUrl`, and pre-loaded `assets` so it can be exercised with a stub 2D
 * context in tests. Callers from tests may omit `assets` — the image-drawing
 * steps are then skipped — and `labelUrl`, which defaults to
 * {@link DEFAULT_LABEL_URL}. `renderLabel` passes the live value from
 * `daemonConfig`.
 */
export function drawLabel(
  ctx: Ctx2D,
  w: number,
  h: number,
  input: LabelInput,
  messages: Messages,
  assets?: LabelAssets,
  labelUrl: string = DEFAULT_LABEL_URL,
): void {
  const edge = Math.min(w, h)
  const isHigh = input.isOverallHigh || input.isStateHigh

  // 1. Solid backing under the gradient (so any gradient stops that don't
  //    quite reach a corner still land on a brand-safe colour).
  ctx.fillStyle = COL.bg
  ctx.fillRect(0, 0, w, h)

  // 2. Warm sunrise gradient. CSS `linear-gradient(75deg, ...)` — angle
  //    measured clockwise from "up", stops extending well past the box.
  drawCssGradient(ctx, w, h, 75, COL.gradient)

  // 3. Masked state photo — the photo pokes through the SAME wave shape as
  //    the blue wave, but shifted ~16px upward, at 66% opacity. Below the
  //    blue wave the photo is hidden; above the mask wave the label
  //    background shows.
  const waveH = edge * R.waveHeightPct
  const waveGap = edge * R.waveGap
  const blueWaveY = h - waveH
  const maskWaveY = blueWaveY - waveGap
  if (assets) {
    drawMaskedPhoto(ctx, w, h, assets.wave, assets.photo, maskWaveY, waveH)
  }

  // 4. Blue wave.
  if (assets) {
    ctx.drawImage(assets.wave, 0, blueWaveY, w, waveH)
  }

  // 5. Header text (state name TL, URL TR). Sits lower than the raw
  //    `edgePad` from the top so the label doesn't feel crammed.
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

  // 6-8. Score / caption / (optional) pill — top-anchored off the header row.
  //      Three tunable gaps (`scoreGapAfterHeader`, `captionGapAfterScore`,
  //      `pillGapAfterCaption`) drive the vertical rhythm; pill presence
  //      doesn't shift the score, keeping the composition stable.
  const scorePx = Math.round(edge * R.scoreFont)
  const captionPx = Math.round(edge * R.captionFont)
  const scoreGap = Math.round(edge * R.scoreGapAfterHeader)
  const captionGap = Math.round(edge * R.captionGapAfterScore)
  const pillGap = Math.round(edge * R.pillGapAfterCaption)
  const pillPx = Math.round(edge * R.pillFont)
  const pillPadY = Math.round(edge * R.pillPadY)
  const pillH = Math.round(pillPx + pillPadY * 2)

  // Centre the whole score / caption / (optional) pill block on the label's
  // midline, then apply the manual `scoreGapAfterHeader` offset. Because
  // `blockH` includes the pill only when it's shown, the composition
  // rebalances automatically when a high score drops in or out.
  const blockH =
    scorePx + captionGap + captionPx + (isHigh ? pillGap + pillH : 0)
  const blockTop = Math.round((h - blockH) / 2 + scoreGap)

  // Score.
  ctx.fillStyle = COL.ink
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  ctx.font = `700 ${scorePx}px "${FONT_HEADLINE}", sans-serif`
  ctx.fillText(String(input.score), w / 2, blockTop)

  // Caption "Punkte" / "Points".
  const captionY = blockTop + scorePx + captionGap
  ctx.font = `400 ${captionPx}px "${FONT_TEXT}", sans-serif`
  const pointsLabel =
    input.score === 1 ? messages.game.point : messages.game.points
  ctx.fillText(pointsLabel, w / 2, captionY)

  // High-score pill (rounded, white, black text).
  if (isHigh) {
    const pillPadX = Math.round(edge * R.pillPadX)
    const pillText = messages.game.newHighScoreBanner.toUpperCase()

    ctx.font = `700 ${pillPx}px "${FONT_TEXT}", sans-serif`
    const textWidth = ctx.measureText(pillText).width
    const pillW = Math.round(textWidth + pillPadX * 2)
    const pillY = captionY + captionPx + pillGap
    const pillX = Math.round((w - pillW) / 2)
    const radius = Math.min(R.pillRadius, pillH / 2)

    ctx.fillStyle = '#ffffff'
    roundRectPath(ctx, pillX, pillY, pillW, pillH, radius)
    ctx.fill()

    ctx.fillStyle = COL.ink
    ctx.textBaseline = 'middle'
    ctx.fillText(pillText, w / 2, pillY + pillH / 2)
  }

  // 9. Firefox Enterprise logo, bottom-left over the blue wave. Preserves
  //    the source image's aspect ratio.
  if (assets) {
    const logoTargetH = Math.round(edge * R.logoHeight)
    const ratio = assets.logo.naturalWidth / assets.logo.naturalHeight
    const logoW = Math.round(logoTargetH * ratio)
    const logoX = pad
    const logoY = h - pad - logoTargetH
    ctx.drawImage(assets.logo, logoX, logoY, logoW, logoTargetH)
  }
}

// -----------------------------------------------------------------------------
// Draw helpers
// -----------------------------------------------------------------------------

/**
 * Emulate CSS `linear-gradient(angleDeg, ...stops)` on a 2D canvas. `stops` are
 * given in CSS percent (may lie outside [0,1] to signal "past the edges"); this
 * helper picks canvas endpoints extended far enough to cover them and
 * normalises the stop positions into [0,1] on that extended axis.
 */
function drawCssGradient(
  ctx: Ctx2D,
  w: number,
  h: number,
  angleDeg: number,
  stops: readonly { pos: number; color: string }[],
): void {
  const angleRad = (angleDeg * Math.PI) / 180
  // CSS convention: angle measured clockwise from "up" (=north).
  const dx = Math.sin(angleRad)
  const dy = -Math.cos(angleRad)

  // Base "100 %" length: projection of the box onto the gradient axis.
  const length = Math.abs(w * dx) + Math.abs(h * dy)
  const cx = w / 2
  const cy = h / 2

  // The CSS 0% / 100% endpoints, centred on the box.
  const p0x = cx - (length / 2) * dx
  const p0y = cy - (length / 2) * dy

  // Extend to encompass every stop's position (in CSS-length units).
  const minPos = Math.min(0, ...stops.map((s) => s.pos))
  const maxPos = Math.max(1, ...stops.map((s) => s.pos))
  const range = maxPos - minPos

  const q0x = p0x + minPos * length * dx
  const q0y = p0y + minPos * length * dy
  const q1x = p0x + maxPos * length * dx
  const q1y = p0y + maxPos * length * dy

  const grad = ctx.createLinearGradient(q0x, q0y, q1x, q1y)
  for (const stop of stops) {
    const t = (stop.pos - minPos) / range
    grad.addColorStop(t, stop.color)
  }
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, w, h)
}

/**
 * Draw the state photo clipped to the silhouette of the wave graphic
 * (positioned at `waveY`, width `w`, height `waveH`) at 66 % opacity. Uses a
 * scratch offscreen canvas for `destination-in` masking so the composite
 * doesn't touch the main canvas' pixels outside the wave.
 */
function drawMaskedPhoto(
  ctx: Ctx2D,
  w: number,
  h: number,
  wave: HTMLImageElement,
  photo: HTMLImageElement,
  waveY: number,
  waveH: number,
): void {
  if (typeof OffscreenCanvas === 'undefined') return
  const scratch = new OffscreenCanvas(w, h)
  const sctx = scratch.getContext('2d')
  if (!sctx) return

  // Photo covers the bottom portion of the canvas from the mask-wave top
  // down to the label's bottom edge. `object-fit: cover` semantics:
  // scale to fill and centre-crop.
  const bandTop = waveY
  const bandH = h - bandTop
  drawCover(sctx, photo, 0, bandTop, w, bandH)

  // Keep only pixels inside the wave shape.
  sctx.globalCompositeOperation = 'destination-in'
  sctx.drawImage(wave, 0, waveY, w, waveH)
  sctx.globalCompositeOperation = 'source-over'

  ctx.save()
  ctx.globalAlpha = 0.66
  ctx.drawImage(scratch, 0, 0)
  ctx.restore()
}

/** `object-fit: cover` for a 2D canvas: fill the box, centre-crop the source. */
function drawCover(
  ctx: Ctx2D,
  img: HTMLImageElement,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
): void {
  const srcRatio = img.naturalWidth / img.naturalHeight
  const dstRatio = dw / dh
  let sx = 0
  let sy = 0
  let sw = img.naturalWidth
  let sh = img.naturalHeight
  if (srcRatio > dstRatio) {
    // Source is wider — crop sides.
    sw = Math.round(img.naturalHeight * dstRatio)
    sx = Math.round((img.naturalWidth - sw) / 2)
  } else {
    // Source is taller — crop top/bottom.
    sh = Math.round(img.naturalWidth / dstRatio)
    sy = Math.round((img.naturalHeight - sh) / 2)
  }
  ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh)
}

/** Trace a rounded-rectangle path (no fill/stroke — the caller decides). */
function roundRectPath(
  ctx: Ctx2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rad = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + rad, y)
  ctx.lineTo(x + w - rad, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + rad)
  ctx.lineTo(x + w, y + h - rad)
  ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h)
  ctx.lineTo(x + rad, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - rad)
  ctx.lineTo(x, y + rad)
  ctx.quadraticCurveTo(x, y, x + rad, y)
  ctx.closePath()
}
