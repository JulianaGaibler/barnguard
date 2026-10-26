/**
 * The three vote buttons, and the scale they turn into when the answer shows.
 *
 * The scene hands in the three segments already blended between the two shapes.
 * The outline firms up from a faint edge to a solid line as the segments close
 * into one pill, and the white thumbs take their rating colors.
 */
import { definePaintProps, Node2D, type Canvas } from 'stargazer'
import { LEVELS, type Level } from '../../game/contrast'
import { PALETTE } from '../../theme'
import type { Segment } from '../layout'
import { clamp01, lerp } from '../motion'
import { drawThumbs, LEVEL_COLORS } from './thumbs'

const BUTTON_THUMB = 60
const SCALE_THUMB = 30
const PRESSED = '#2b2b2b'

export class VoteScaleNode extends Node2D {
  declare segments: readonly Segment[]
  /** 0 for three buttons, 1 for the scale. */
  declare morph: number
  /** The segment being pressed, or -1. */
  declare pressed: number
  /** 0 to 1 along the pulse that points at the answer, which is idle at 0 and 1. */
  declare pulse: number
  /** The segment the pulse is for, or -1. */
  declare pulseAt: number
  declare pulseColor: string

  constructor() {
    super('vote-scale')
    definePaintProps(this, {
      segments: [],
      morph: 0,
      pressed: -1,
      pulse: 0,
      pulseAt: -1,
      pulseColor: PALETTE.white,
    })
  }

  override paint(canvas: Canvas): void {
    const { segments, morph } = this
    const edgeAlpha = lerp(0.25, 1, morph)
    const edge = {
      color: `rgba(255, 255, 255, ${edgeAlpha})`,
      width: { screen: 1 },
    }
    const thumb = lerp(BUTTON_THUMB, SCALE_THUMB, morph)
    const glowing = this.pulse > 0 && this.pulse < 1 && segments.length > 0
    segments.forEach((s, i) => {
      canvas.fillAndStrokeRoundRect(
        s.x,
        s.y,
        s.width,
        s.height,
        s.radii as number[],
        i === this.pressed ? PRESSED : PALETTE.ink,
        edge,
      )
      if (glowing && i === this.pulseAt) {
        // The right answer lights up and fades.
        canvas.setAlpha(0.4 * (1 - this.pulse) ** 2)
        canvas.fillRoundRect(
          s.x,
          s.y,
          s.width,
          s.height,
          s.radii as number[],
          this.pulseColor,
        )
        canvas.setAlpha(1)
      }
      const level = LEVELS[i] as Level
      drawThumbs(
        canvas,
        level,
        s.x + s.width / 2,
        s.y + s.height / 2,
        thumb,
        PALETTE.white,
        LEVEL_COLORS[level],
        morph,
      )
    })
    if (glowing) this.#paintRings(canvas)
  }

  /** Two rings leave the scale one after the other, growing as they fade. */
  #paintRings(canvas: Canvas): void {
    const first = this.segments[0]!
    const last = this.segments[this.segments.length - 1]!
    const width = last.x + last.width - first.x
    const rings = [
      { start: 0, strength: 0.85 },
      { start: 0.18, strength: 0.5 },
    ]
    for (const ring of rings) {
      const t = clamp01((this.pulse - ring.start) / (1 - ring.start))
      if (t <= 0 || t >= 1) continue
      const grown = 1 - (1 - t) ** 3
      const grow = 4 + 40 * grown
      const height = first.height + grow * 2
      canvas.setAlpha(ring.strength * (1 - t))
      canvas.strokeRoundRect(
        first.x - grow,
        first.y - grow,
        width + grow * 2,
        height,
        height / 2,
        { color: this.pulseColor, width: { screen: 3 } },
      )
    }
    canvas.setAlpha(1)
  }
}
