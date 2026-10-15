import type { CameraView2D } from '../../camera/CameraView2D'
import type { Rect } from '../../math/Rect'
import type {
  Gfx2D,
  GfxBlend,
  GfxClipShape,
  GfxFill,
  GfxImageOptions,
  GfxStrokeStyle,
  GfxShadowStyle,
  GfxTextStyle,
} from '../gfx/Gfx2D'

/** A stroke width that stays this many CSS pixels wide at any zoom. */
export interface ScreenWidth {
  screen: number
}

/** A stroke style whose width may be a {@link ScreenWidth}. */
export type CanvasStrokeStyle = Omit<GfxStrokeStyle, 'width'> & {
  width: number | ScreenWidth
}

/** Anything with a `version` that changes when what a picture drew from does. */
export interface Versioned {
  readonly version: number
}

/** The recorded operations. A picture stores one of these per call. */
export const Op = {
  save: 0,
  restore: 1,
  translate: 2,
  rotate: 3,
  scale: 4,
  transform: 5,
  setAlpha: 6,
  setBlend: 7,
  setClipMask: 8,
  setClip: 9,
  clipPath: 10,
  fillRect: 11,
  fillRoundRect: 12,
  strokeRoundRect: 13,
  fillAndStrokeRoundRect: 14,
  fillCircle: 15,
  fillAndStrokeCircle: 16,
  strokeCircle: 17,
  fillConvexPoly: 18,
  fillPath2D: 19,
  fillPath: 20,
  strokePath: 21,
  strokePath2D: 22,
  strokeLine: 23,
  strokeQuadratic: 24,
  strokePolyline: 25,
  fillCircleRadialGradient: 26,
  fillMaskedRadialGradient: 27,
  fillPolyLinearGradient: 28,
  drawShaderQuad: 29,
  shadowRoundRect: 30,
  shadowCircle: 31,
  shadowPath2D: 32,
  drawImage: 33,
  fillText: 34,
  fillEllipse: 35,
  strokeEllipse: 36,
  fillAndStrokeEllipse: 37,
} as const

/**
 * One node's recorded drawing: the calls its `paint` made, in order, with their
 * arguments copied, plus what the engine needs to know about them. Replaying it
 * re-issues the calls into a {@link Gfx2D}, so everything that depends on the
 * transform or scale (text rasters, curve flattening, stroke widths, shadows)
 * resolves at replay, at the scale the node is drawn at now.
 */
export class Picture {
  readonly ops: number[] = []
  readonly args: unknown[][] = []
  /** A resolved stroke style per op, for screen-space widths. */
  readonly #resolved: ({ scale: number; style: GfxStrokeStyle } | null)[] = []

  /** Local-space bounds of what was drawn, once anything bounded was. */
  minX = Infinity
  minY = Infinity
  maxX = -Infinity
  maxY = -Infinity
  /** Something was drawn whose extent is not known, so there are no bounds. */
  unbounded = false
  /** CSS pixels of reach beyond the local bounds (screen-space strokes). */
  screenPad = 0

  /** The picture depends on the device scale (text, snapped lengths). */
  scaleDependent = false
  /** The device scale it was recorded at. */
  paintedScale = 0
  /** The picture read the camera's visible rect, recorded here. */
  usesCamera = false
  cameraX = 0
  cameraY = 0
  cameraW = 0
  cameraH = 0
  /** The picture read the world size of a CSS pixel, recorded here. */
  usesScreenScale = false
  screenScale = 1

  /**
   * Counts the times the picture was recorded again. Anything that has to know
   * whether a node's drawing changed compares it, rather than the picture.
   */
  generation = 0

  /** What the picture was recorded from, and the versions it saw. */
  readonly deps: Versioned[] = []
  readonly depVersions: number[] = []

  clear(): void {
    this.ops.length = 0
    this.args.length = 0
    this.#resolved.length = 0
    this.minX = Infinity
    this.minY = Infinity
    this.maxX = -Infinity
    this.maxY = -Infinity
    this.unbounded = false
    this.screenPad = 0
    this.scaleDependent = false
    this.usesCamera = false
    this.usesScreenScale = false
    this.deps.length = 0
    this.depVersions.length = 0
  }

  /** The local-space bounds, or `null` when nothing bounded was drawn. */
  get bounds(): Rect | null {
    if (this.unbounded || this.minX > this.maxX) return null
    return {
      x: this.minX,
      y: this.minY,
      width: this.maxX - this.minX,
      height: this.maxY - this.minY,
    }
  }

  /** Whether a resource the picture drew from has changed since. */
  depsChanged(): boolean {
    const deps = this.deps
    for (let i = 0; i < deps.length; i++) {
      if (deps[i].version !== this.depVersions[i]) return true
    }
    return false
  }

  /**
   * Re-issue the recorded calls. Alpha set inside the picture is relative to
   * the alpha in effect when the replay starts, which is the node's cascaded
   * alpha, and every other state change is undone at the end.
   */
  replay(gfx: Gfx2D, view: CameraView2D): void {
    const base = gfx.getAlpha()
    gfx.save()
    const ops = this.ops
    const args = this.args
    for (let i = 0; i < ops.length; i++) {
      const a = args[i]
      switch (ops[i]) {
        case Op.save:
          gfx.save()
          break
        case Op.restore:
          gfx.restore()
          break
        case Op.translate:
          gfx.translate(a[0] as number, a[1] as number)
          break
        case Op.rotate:
          gfx.rotate(a[0] as number)
          break
        case Op.scale:
          gfx.scale(a[0] as number, a[1] as number)
          break
        case Op.transform:
          gfx.transform(
            a[0] as number,
            a[1] as number,
            a[2] as number,
            a[3] as number,
            a[4] as number,
            a[5] as number,
          )
          break
        case Op.setAlpha:
          gfx.setAlpha(base * (a[0] as number))
          break
        case Op.setBlend:
          gfx.setBlend(a[0] as GfxBlend)
          break
        case Op.setClipMask:
          gfx.setClipMask(a[0] as Parameters<Gfx2D['setClipMask']>[0])
          break
        case Op.setClip:
          gfx.setClip(a[0] as GfxClipShape | null)
          break
        case Op.clipPath:
          gfx.clipPath(
            a[0] as Parameters<Gfx2D['clipPath']>[0],
            a[1] as Parameters<Gfx2D['clipPath']>[1],
          )
          break
        case Op.fillRect:
          gfx.fillRect(
            a[0] as number,
            a[1] as number,
            a[2] as number,
            a[3] as number,
            a[4] as GfxFill,
          )
          break
        case Op.fillRoundRect:
          gfx.fillRoundRect(
            a[0] as number,
            a[1] as number,
            a[2] as number,
            a[3] as number,
            a[4] as Parameters<Gfx2D['fillRoundRect']>[4],
            a[5] as GfxFill,
            a[6] as number,
          )
          break
        case Op.strokeRoundRect:
          gfx.strokeRoundRect(
            a[0] as number,
            a[1] as number,
            a[2] as number,
            a[3] as number,
            a[4] as Parameters<Gfx2D['strokeRoundRect']>[4],
            this.#stroke(i, a[5] as CanvasStrokeStyle, view),
            a[6] as number,
          )
          break
        case Op.fillAndStrokeRoundRect:
          gfx.fillAndStrokeRoundRect(
            a[0] as number,
            a[1] as number,
            a[2] as number,
            a[3] as number,
            a[4] as Parameters<Gfx2D['fillAndStrokeRoundRect']>[4],
            a[5] as GfxFill,
            this.#stroke(i, a[6] as CanvasStrokeStyle, view),
            a[7] as number,
          )
          break
        case Op.fillCircle:
          gfx.fillCircle(
            a[0] as number,
            a[1] as number,
            a[2] as number,
            a[3] as GfxFill,
          )
          break
        case Op.fillAndStrokeCircle:
          gfx.fillAndStrokeCircle(
            a[0] as number,
            a[1] as number,
            a[2] as number,
            a[3] as GfxFill,
            this.#stroke(i, a[4] as CanvasStrokeStyle, view),
          )
          break
        case Op.fillEllipse:
          gfx.fillEllipse(
            a[0] as number,
            a[1] as number,
            a[2] as number,
            a[3] as number,
            a[4] as GfxFill,
          )
          break
        case Op.strokeEllipse:
          gfx.strokeEllipse(
            a[0] as number,
            a[1] as number,
            a[2] as number,
            a[3] as number,
            this.#stroke(i, a[4] as CanvasStrokeStyle, view),
          )
          break
        case Op.fillAndStrokeEllipse:
          gfx.fillAndStrokeEllipse(
            a[0] as number,
            a[1] as number,
            a[2] as number,
            a[3] as number,
            a[4] as GfxFill,
            this.#stroke(i, a[5] as CanvasStrokeStyle, view),
          )
          break
        case Op.strokeCircle:
          gfx.strokeCircle(
            a[0] as number,
            a[1] as number,
            a[2] as number,
            this.#stroke(i, a[3] as CanvasStrokeStyle, view),
          )
          break
        case Op.fillConvexPoly:
          gfx.fillConvexPoly(
            a[0] as ArrayLike<number>,
            a[1] as number,
            a[2] as GfxFill,
          )
          break
        case Op.fillPath2D:
          gfx.fillPath2D(a[0] as Path2D, a[1] as GfxFill)
          break
        case Op.fillPath:
          gfx.fillPath(
            a[0] as Parameters<Gfx2D['fillPath']>[0],
            a[1] as GfxFill,
            a[2] as Parameters<Gfx2D['fillPath']>[2],
          )
          break
        case Op.strokePath:
          gfx.strokePath(
            a[0] as Parameters<Gfx2D['strokePath']>[0],
            this.#stroke(i, a[1] as CanvasStrokeStyle, view),
          )
          break
        case Op.strokePath2D:
          gfx.strokePath2D(
            a[0] as Path2D,
            this.#stroke(i, a[1] as CanvasStrokeStyle, view),
          )
          break
        case Op.strokeLine:
          gfx.strokeLine(
            a[0] as number,
            a[1] as number,
            a[2] as number,
            a[3] as number,
            this.#stroke(i, a[4] as CanvasStrokeStyle, view),
          )
          break
        case Op.strokeQuadratic:
          gfx.strokeQuadratic(
            a[0] as number,
            a[1] as number,
            a[2] as number,
            a[3] as number,
            a[4] as number,
            a[5] as number,
            this.#stroke(i, a[6] as CanvasStrokeStyle, view),
          )
          break
        case Op.strokePolyline:
          // The recorded points stay the same until the picture is painted
          // again, so the renderer may keep what it builds from them.
          gfx.replaySource?.(a)
          gfx.strokePolyline(
            a[0] as ArrayLike<number>,
            a[1] as number,
            this.#stroke(i, a[2] as CanvasStrokeStyle, view),
          )
          gfx.replaySource?.(null)
          break
        case Op.fillCircleRadialGradient:
          gfx.fillCircleRadialGradient(
            a[0] as number,
            a[1] as number,
            a[2] as number,
            a[3] as Parameters<Gfx2D['fillCircleRadialGradient']>[3],
          )
          break
        case Op.fillMaskedRadialGradient:
          gfx.fillMaskedRadialGradient(
            a[0] as CanvasImageSource,
            a[1] as number,
            a[2] as number,
            a[3] as number,
            a[4] as number,
            a[5] as number,
            a[6] as number,
            a[7] as number,
            a[8] as Parameters<Gfx2D['fillMaskedRadialGradient']>[8],
          )
          break
        case Op.fillPolyLinearGradient:
          gfx.fillPolyLinearGradient(
            a[0] as ArrayLike<number>,
            a[1] as number,
            a[2] as number,
            a[3] as number,
            a[4] as number,
            a[5] as number,
            a[6] as string,
            a[7] as string,
          )
          break
        case Op.drawShaderQuad:
          gfx.drawShaderQuad(
            a[0] as Parameters<Gfx2D['drawShaderQuad']>[0],
            a[1] as number,
            a[2] as number,
            a[3] as number,
            a[4] as number,
          )
          break
        case Op.shadowRoundRect:
          gfx.shadowRoundRect(
            a[0] as number,
            a[1] as number,
            a[2] as number,
            a[3] as number,
            a[4] as Parameters<Gfx2D['shadowRoundRect']>[4],
            a[5] as GfxShadowStyle,
            a[6] as number,
          )
          break
        case Op.shadowCircle:
          gfx.shadowCircle(
            a[0] as number,
            a[1] as number,
            a[2] as number,
            a[3] as GfxShadowStyle,
          )
          break
        case Op.shadowPath2D:
          gfx.shadowPath2D(a[0] as Path2D, a[1] as GfxShadowStyle)
          break
        case Op.drawImage:
          gfx.drawImage(
            a[0] as CanvasImageSource,
            a[1] as number,
            a[2] as number,
            a[3] as number,
            a[4] as number,
            a[5] as GfxImageOptions | undefined,
          )
          break
        case Op.fillText:
          gfx.fillText(
            a[0] as string,
            a[1] as number,
            a[2] as number,
            a[3] as GfxTextStyle,
          )
          break
      }
    }
    gfx.restore()
  }

  /**
   * The stroke style to draw op `i` with: the recorded one when its width is in
   * local units, otherwise a copy with the screen width resolved at the
   * camera's current scale, kept until that scale changes.
   */
  #stroke(
    i: number,
    style: CanvasStrokeStyle,
    view: CameraView2D,
  ): GfxStrokeStyle {
    if (typeof style.width === 'number') return style as GfxStrokeStyle
    const scale = view.strokeSpaceScale()
    let held = this.#resolved[i]
    if (!held || held.scale !== scale) {
      held = {
        scale,
        style: { ...style, width: style.width.screen * scale },
      }
      this.#resolved[i] = held
    }
    return held.style
  }

  /**
   * Whether `other` recorded the same calls with the same arguments. A resource
   * (an image, a path) is the same if it is the same object, and plain styles
   * and arrays are compared by their contents.
   */
  equals(other: Picture): boolean {
    if (this.ops.length !== other.ops.length) return false
    for (let i = 0; i < this.ops.length; i++) {
      if (this.ops[i] !== other.ops[i]) return false
      const a = this.args[i]
      const b = other.args[i]
      if (a.length !== b.length) return false
      for (let k = 0; k < a.length; k++)
        if (!sameValue(a[k], b[k], 0)) return false
    }
    return true
  }

  /** Index of the first op that differs from `other`, or -1. */
  firstDifference(other: Picture): number {
    const n = Math.min(this.ops.length, other.ops.length)
    for (let i = 0; i < n; i++) {
      if (this.ops[i] !== other.ops[i]) return i
      const a = this.args[i]
      const b = other.args[i]
      if (a.length !== b.length) return i
      for (let k = 0; k < a.length; k++) if (!sameValue(a[k], b[k], 0)) return i
    }
    return this.ops.length === other.ops.length ? -1 : n
  }
}

function sameValue(a: unknown, b: unknown, depth: number): boolean {
  if (Object.is(a, b)) return true
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return false
  if (depth > 3) return false
  if (Array.isArray(a) || ArrayBuffer.isView(a)) {
    const x = a as ArrayLike<unknown>
    const y = b as ArrayLike<unknown>
    if (Array.isArray(a) !== Array.isArray(b) || x.length !== y.length)
      return false
    for (let i = 0; i < x.length; i++)
      if (!sameValue(x[i], y[i], depth + 1)) return false
    return true
  }
  const proto = Object.getPrototypeOf(a)
  if (
    (proto !== Object.prototype && proto !== null) ||
    Object.getPrototypeOf(b) !== proto
  ) {
    return false
  }
  const ka = Object.keys(a)
  if (ka.length !== Object.keys(b).length) return false
  for (const k of ka) {
    if (
      !sameValue(
        (a as Record<string, unknown>)[k],
        (b as Record<string, unknown>)[k],
        depth + 1,
      )
    ) {
      return false
    }
  }
  return true
}
