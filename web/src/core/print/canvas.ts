/**
 * Generic 2D canvas primitives shared by every display's label renderer. No
 * game/display-specific knowledge lives here — colors, layout, and asset
 * bindings belong to each display's `label.ts`.
 */

/** Brother VC-500W resolution (~317 lpi vivid). */
export const PIXELS_PER_MM = 12.48
/** Fallback tape width when the printer's is unknown (common CZ-1004 ≈ 25mm). */
export const DEFAULT_TAPE_WIDTH_MM = 25

/** Square edge in px for a given tape width, falling back to a safe default. */
export function squarePxFrom(
  tapeWidthMm?: number | null,
  density: number = PIXELS_PER_MM,
): number {
  const mm =
    tapeWidthMm && tapeWidthMm > 0 ? tapeWidthMm : DEFAULT_TAPE_WIDTH_MM
  return Math.round(mm * density)
}

export type Ctx2D = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D

const imageCache = new Map<string, Promise<HTMLImageElement>>()

export function loadImage(url: string): Promise<HTMLImageElement> {
  const cached = imageCache.get(url)
  if (cached) return cached
  const promise = new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`loadImage: failed to load ${url}`))
    img.src = url
  })
  imageCache.set(url, promise)
  return promise
}

export interface FontRequest {
  family: string
  url: string
  weight?: string
  style?: string
}

/**
 * Register the given fonts with `document.fonts`, keyed by their url so the
 * same URL isn't loaded twice across renderers. Font-load failures are logged
 * and swallowed — labels then fall back to default sans-serif, which is still
 * legible if off-brand.
 */
const loadedFonts = new Set<string>()

export async function ensureFontsLoaded(fonts: FontRequest[]): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return
  const pending: Promise<void>[] = []
  for (const f of fonts) {
    const key = `${f.family}|${f.url}|${f.weight ?? ''}|${f.style ?? ''}`
    if (loadedFonts.has(key)) continue
    loadedFonts.add(key)
    const face = new FontFace(f.family, `url(${f.url})`, {
      weight: f.weight,
      style: f.style,
    })
    pending.push(
      face
        .load()
        .then((loaded) => {
          document.fonts.add(loaded)
        })
        .catch((err) => {
          console.warn('[canvas] font load failed:', err)
        }),
    )
  }
  await Promise.all(pending)
}

/**
 * Emulate CSS `linear-gradient(angleDeg, ...stops)` on a 2D canvas. `stops` are
 * given in CSS percent (may lie outside [0,1] to signal "past the edges"); this
 * helper picks canvas endpoints extended far enough to cover them and
 * normalises the stop positions into [0,1] on that extended axis.
 */
export function drawCssGradient(
  ctx: Ctx2D,
  w: number,
  h: number,
  angleDeg: number,
  stops: readonly { pos: number; color: string }[],
): void {
  const angleRad = (angleDeg * Math.PI) / 180
  const dx = Math.sin(angleRad)
  const dy = -Math.cos(angleRad)

  const length = Math.abs(w * dx) + Math.abs(h * dy)
  const cx = w / 2
  const cy = h / 2

  const p0x = cx - (length / 2) * dx
  const p0y = cy - (length / 2) * dy

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
 * Draw `photo` clipped to the silhouette of `mask` at `alpha`. Uses a scratch
 * offscreen for `destination-in` masking so main canvas pixels outside the mask
 * are untouched.
 */
export function drawMaskedImage(
  ctx: Ctx2D,
  w: number,
  h: number,
  mask: HTMLImageElement,
  maskX: number,
  maskY: number,
  maskW: number,
  maskH: number,
  photo: HTMLImageElement,
  photoX: number,
  photoY: number,
  photoW: number,
  photoH: number,
  alpha: number,
): void {
  if (typeof OffscreenCanvas === 'undefined') return
  const scratch = new OffscreenCanvas(w, h)
  const sctx = scratch.getContext('2d')
  if (!sctx) return
  drawCover(sctx, photo, photoX, photoY, photoW, photoH)
  sctx.globalCompositeOperation = 'destination-in'
  sctx.drawImage(mask, maskX, maskY, maskW, maskH)
  sctx.globalCompositeOperation = 'source-over'
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.drawImage(scratch, 0, 0)
  ctx.restore()
}

/** `object-fit: cover` for a 2D canvas: fill the box, centre-crop the source. */
export function drawCover(
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
    sw = Math.round(img.naturalHeight * dstRatio)
    sx = Math.round((img.naturalWidth - sw) / 2)
  } else {
    sh = Math.round(img.naturalWidth / dstRatio)
    sy = Math.round((img.naturalHeight - sh) / 2)
  }
  ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh)
}

/** Trace a rounded-rectangle path (no fill/stroke — the caller decides). */
export function roundRectPath(
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
