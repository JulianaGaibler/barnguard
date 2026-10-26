/**
 * A tap button drawn by the engine: a rounded shape with a label. The corners
 * are set per button, so a pair can be cut from one pill like the vote
 * buttons.
 */
import {
  definePaintProps,
  Node2D,
  type Canvas,
  type PointerEvent2D,
} from 'stargazer'
import { CAP_HEIGHT } from '../text'

export interface ButtonLook {
  label: string
  font: string
  /** Font size, so the label can be centered on the height of a capital. */
  size: number
  fill: string
  /** The fill while it is pressed. */
  pressedFill: string
  textColor: string
  /** The outline, or null for none. */
  edge: string | null
}

export interface ButtonOptions extends ButtonLook {
  onClick: () => void
  enabled?: () => boolean
}

export class ButtonNode extends Node2D {
  declare width: number
  declare height: number
  declare radii: readonly number[]
  declare pressed: boolean
  declare look: ButtonLook

  constructor(options: ButtonOptions) {
    super('button')
    const { onClick, enabled, ...look } = options
    definePaintProps(this, {
      width: 0,
      height: 0,
      radii: [0] as readonly number[],
      pressed: false,
      look,
    })
    // The button is pressed while a finger that went down on it is over it, so
    // sliding off un-presses it and letting go off it does nothing.
    const isEnabled = (): boolean => enabled?.() ?? true
    let held = false
    this.bindPointer({
      singlePointer: true,
      down: () => {
        if (!isEnabled()) return
        held = true
        this.pressed = true
      },
      move: (e) => {
        if (held) this.pressed = this.#over(e)
      },
      up: (e) => {
        const click = held && this.#over(e) && isEnabled()
        held = false
        this.pressed = false
        if (click) onClick()
      },
      cancel: () => {
        held = false
        this.pressed = false
      },
    })
    this.a11y({ role: 'button', label: look.label, onActivate: onClick })
  }

  /** Whether the pointer is over the button, in the button's own space. */
  #over(e: PointerEvent2D): boolean {
    const p = e.localTo(this)
    return p.x >= 0 && p.x <= this.width && p.y >= 0 && p.y <= this.height
  }

  setShape(width: number, height: number, radii: readonly number[]): void {
    this.width = width
    this.height = height
    this.radii = radii
    this.boundsOverride = { x: 0, y: 0, width, height }
  }

  override paint(canvas: Canvas): void {
    const { width: w, height: h, look } = this
    if (w <= 0 || h <= 0) return
    const fill = this.pressed ? look.pressedFill : look.fill
    const radii = this.radii as number[]
    if (look.edge) {
      canvas.fillAndStrokeRoundRect(0, 0, w, h, radii, fill, {
        color: look.edge,
        width: { screen: 1 },
      })
    } else {
      canvas.fillRoundRect(0, 0, w, h, radii, fill)
    }
    canvas.fillText(look.label, w / 2, h / 2 + (look.size * CAP_HEIGHT) / 2, {
      font: look.font,
      color: look.textColor,
      align: 'center',
      baseline: 'alphabetic',
    })
  }
}
