/**
 * Sprite cache for particle rendering. Each (color, style) pair produces one
 * pre-rendered tile, cached indefinitely (palette sizes are small).
 *
 * Three built-in styles:
 *
 * - `'gradient'`, soft radial fade from opaque center to transparent edge. Pair
 *   with `blend: 'lighter'` (default) for classic additive bloom, or with
 *   `blend: 'source-over'` for softer non-bloomed glow.
 * - `'disc'` , solid color with a 1-px anti-aliased edge. Pair with `blend:
 *   'source-over'` for sharp, non-bloomed particles (small projectiles, sparks,
 *   confetti). Additive blends (`'lighter'`) still bloom brightly on overlap
 *   even with `'disc'`.
 * - `'hexagon'` , solid filled hexagon, flat-topped (vertex-up), centered on the
 *   sprite. Sized to ~85% of the tile for a small AA safety margin. Pair with
 *   `blend: 'source-over'` for a crisp "small packet" look; additive blends
 *   still bloom on overlap.
 */

export type ParticleSpriteStyle = 'gradient' | 'disc' | 'hexagon'

const SPRITE_SIZE = 64
const spriteCache = new Map<string, HTMLCanvasElement>()

export function getParticleSprite(
  color: string,
  style: ParticleSpriteStyle = 'gradient',
): HTMLCanvasElement {
  const key = `${style}:${color}`
  const cached = spriteCache.get(key)
  if (cached) return cached

  const canvas = document.createElement('canvas')
  canvas.width = SPRITE_SIZE
  canvas.height = SPRITE_SIZE
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('getParticleSprite: 2D context unavailable')

  const mid = SPRITE_SIZE / 2

  if (style === 'hexagon') {
    // Solid filled hex, vertex-up (matches PacketNode's orientation basis
    // so all hexagons in the game share a visual language). Radius ~85%
    // of the half-size, leaves a small AA safety margin at the tile
    // edge so drawImage-scaling doesn't clip corners.
    const r = mid * 0.85
    ctx.fillStyle = color
    ctx.beginPath()
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI / 3) * i - Math.PI / 6
      const px = mid + Math.cos(angle) * r
      const py = mid + Math.sin(angle) * r
      if (i === 0) ctx.moveTo(px, py)
      else ctx.lineTo(px, py)
    }
    ctx.closePath()
    ctx.fill()
    tagAsParticleAtlasCandidate(canvas)
    spriteCache.set(key, canvas)
    return canvas
  }

  const grad = ctx.createRadialGradient(mid, mid, 0, mid, mid, mid)
  if (style === 'disc') {
    // Solid color out to ~94% of the radius, quick AA fade to zero in the
    // last ~6%, reads as a hard-edged disc at any target size.
    grad.addColorStop(0, color)
    grad.addColorStop(0.94, color)
    grad.addColorStop(1, withAlpha(color, 0x00))
  } else {
    grad.addColorStop(0, color)
    grad.addColorStop(0.5, withAlpha(color, 0x80))
    grad.addColorStop(1, withAlpha(color, 0x00))
  }
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, SPRITE_SIZE, SPRITE_SIZE)
  tagAsParticleAtlasCandidate(canvas)
  spriteCache.set(key, canvas)
  return canvas
}

/**
 * Mark a canvas as an atlasable particle sprite so the WebGL2 `TextureManager`
 * can pack it into the shared 1024×1024 atlas on first draw. The property is a
 * plain boolean; the marker name lives in `TextureManager` to keep the two
 * halves of the contract in one place.
 */
function tagAsParticleAtlasCandidate(canvas: HTMLCanvasElement): void {
  ;(canvas as unknown as Record<string, unknown>).__isParticleAtlasCandidate =
    true
}

/** For tests + tear-down; the engine itself doesn't need to touch this. */
export function clearParticleSpriteCache(): void {
  spriteCache.clear()
}

function withAlpha(color: string, alphaByte: number): string {
  const a = clampByte(alphaByte).toString(16).padStart(2, '0')
  if (color.startsWith('#')) {
    if (color.length === 4) {
      const r = color[1]
      const g = color[2]
      const b = color[3]
      return `#${r}${r}${g}${g}${b}${b}${a}`
    }
    if (color.length === 7) return `${color}${a}`
    if (color.length === 9) return `${color.slice(0, 7)}${a}`
  }
  return color
}

function clampByte(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)))
}

export const PARTICLE_SPRITE_SIZE = SPRITE_SIZE
