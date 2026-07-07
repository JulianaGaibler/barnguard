/**
 * Renders the game-over result to a JPEG for the label printer.
 *
 * The label is composed on a standalone {@link OffscreenCanvas} (2D); NOT a
 * snapshot of the live WebGL game canvas (which is created without
 * `preserveDrawingBuffer`, so reading it back yields a blank frame). A
 * dedicated offscreen surface also gives pixel-exact control over the print
 * dimensions independent of the display/DPR, and works headless in tests.
 *
 * The VC-500W tape is continuous: the image dimension *across* the tape is
 * fixed by the loaded cassette width, the length is free. We render a SQUARE by
 * default (edge = tape width in px); the daemon sends `<print autofit=1>` so the
 * printer scales to the real tape while preserving the 1:1 aspect; a slightly
 * wrong size is corrected in hardware, never clipped.
 */

import type { GameOverReason, StateId } from '@src/game'
import type { HighScores } from '@src/lib/gameLogClient'
import type { Messages } from '@src/i18n'

/** Brother VC-500W resolution (~317 lpi vivid). */
export const PIXELS_PER_MM = 12.48
/** Fallback tape width when the printer's is unknown (common CZ-1004 ≈ 25mm). */
export const DEFAULT_TAPE_WIDTH_MM = 25

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
  /** Square edge in px. Defaults to the tape width in px (see DEFAULT_TAPE_WIDTH_MM). */
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
  const mm = tapeWidthMm && tapeWidthMm > 0 ? tapeWidthMm : DEFAULT_TAPE_WIDTH_MM
  return Math.round(mm * density)
}

type Ctx2D = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D

/**
 * Render the label and encode it as a JPEG blob. Throws if the runtime lacks
 * `OffscreenCanvas` (i.e. outside a browser); the pure {@link drawLabel} is the
 * unit-testable part.
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

  const canvas = new OffscreenCanvas(width, height)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('renderLabel: could not get a 2D context')

  drawLabel(ctx, width, height, input, opts.messages)

  return canvas.convertToBlob({
    type: 'image/jpeg',
    quality: opts.quality ?? 0.92,
  })
}

/**
 * PLACEHOLDER LAYOUT; final design TBD by design. This draws all the available
 * data (state, score, high-score badge, branding, date, a reserved QR area) so
 * the pipeline is exercised end-to-end; the visual composition will be replaced.
 *
 * Pure and store-free (takes resolved `messages`) so it can be unit-tested with
 * a stub 2D context.
 */
export function drawLabel(
  ctx: Ctx2D,
  w: number,
  h: number,
  input: LabelInput,
  messages: Messages,
): void {
  const pad = Math.round(w * 0.06)
  const isHigh = input.isOverallHigh || input.isStateHigh

  // Background.
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, w, h)

  // Header band with the state.
  ctx.fillStyle = '#010612'
  ctx.fillRect(0, 0, w, Math.round(h * 0.18))
  ctx.fillStyle = '#ffffff'
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  ctx.font = `bold ${Math.round(h * 0.09)}px sans-serif`
  ctx.fillText(input.stateId.toUpperCase(), pad, Math.round(h * 0.09))
  ctx.textAlign = 'right'
  ctx.font = `${Math.round(h * 0.05)}px sans-serif`
  ctx.fillText(messages.states[input.stateId], w - pad, Math.round(h * 0.09))

  // Score; the hero element.
  ctx.fillStyle = '#010612'
  ctx.textAlign = 'center'
  ctx.font = `bold ${Math.round(h * 0.34)}px sans-serif`
  ctx.fillText(String(input.score), w / 2, Math.round(h * 0.46))
  ctx.font = `${Math.round(h * 0.06)}px sans-serif`
  const pointsLabel = input.score === 1 ? messages.game.point : messages.game.points
  ctx.fillText(pointsLabel.toUpperCase(), w / 2, Math.round(h * 0.64))

  // New-high-score badge.
  if (isHigh) {
    ctx.fillStyle = '#f60'
    ctx.font = `bold ${Math.round(h * 0.045)}px sans-serif`
    ctx.fillText(
      messages.game.newHighScoreBanner.toUpperCase(),
      w / 2,
      Math.round(h * 0.735),
    )
  }

  // Footer: branding + date (left) and a reserved QR area (right).
  const footerY = Math.round(h * 0.9)
  ctx.fillStyle = '#010612'
  ctx.textAlign = 'left'
  ctx.font = `bold ${Math.round(h * 0.04)}px sans-serif`
  ctx.fillText(messages.app.title, pad, footerY)
  const date = input.printedAt ?? new Date()
  ctx.font = `${Math.round(h * 0.032)}px sans-serif`
  ctx.fillText(date.toLocaleDateString(), pad, footerY + Math.round(h * 0.05))

  // Reserved QR square (placeholder outline).
  const qr = Math.round(h * 0.14)
  ctx.strokeStyle = '#010612'
  ctx.lineWidth = Math.max(1, Math.round(h * 0.004))
  ctx.strokeRect(w - pad - qr, footerY - Math.round(qr * 0.4), qr, qr)
  ctx.textAlign = 'center'
  ctx.font = `${Math.round(h * 0.03)}px sans-serif`
  ctx.fillText('QR', w - pad - qr / 2, footerY + Math.round(qr * 0.1))
}
