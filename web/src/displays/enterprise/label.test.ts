import { describe, it, expect, vi } from 'vitest'
import {
  ImageNode,
  Layer,
  Node2D,
  Path2DNode,
  ShapeNode,
  TextNode,
} from '@src/stargazer'
import {
  buildLabelScene,
  ellipseOfMatrix,
  labelPicksOf,
  LABEL_SLICE_COLUMNS,
  PURPLE_GRADIENT_MATRIX,
  type LabelInput,
  type LabelSceneExtras,
} from './label'
import { SliceShift } from './background/SliceShift'
import {
  squarePxFrom,
  PIXELS_PER_MM,
  DEFAULT_TAPE_WIDTH_MM,
} from '@src/core/print/canvas'
import { DEFAULT_LABEL_URL } from '@src/stores/daemonConfig'
import { en } from './i18n/en'

// happy-dom has no text shaping, so a stand-in gives each character a fixed
// share of the font size.
vi.mock('@src/stargazer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@src/stargazer')>()
  return {
    ...actual,
    measureText: (text: string, style: { font: string }) => {
      const size = Number(/([\d.]+)px/.exec(style.font)?.[1] ?? 0)
      return {
        ...actual.measureText(text, style as never),
        advance: text.length * size * 0.6,
      }
    },
  }
})

const base: LabelInput = {
  reason: 'collision',
  stateId: 'BW',
  mapId: 'de',
  score: 42,
  isOverallHigh: false,
  isStateHigh: false,
  highScores: { display: 'enterprise', byMap: {}, byState: {} },
}

/** Every node of the label, built at the default tape size. */
function scene(input: LabelInput = base, extras?: LabelSceneExtras): Node2D[] {
  const root = new Node2D('root')
  buildLabelScene(root, input, en, 312, 312, extras)
  const all: Node2D[] = []
  const walk = (node: Node2D) => {
    for (const child of node.children as Node2D[]) {
      all.push(child)
      walk(child)
    }
  }
  walk(root)
  return all
}

function texts(nodes: Node2D[]): string[] {
  return nodes
    .filter((n): n is TextNode => n instanceof TextNode)
    .map((n) => n.text)
}

function byId<T extends Node2D>(nodes: Node2D[], id: string): T | undefined {
  return nodes.find((n) => n.id === id) as T | undefined
}

describe('squarePxFrom', () => {
  const def = Math.round(DEFAULT_TAPE_WIDTH_MM * PIXELS_PER_MM)

  it('uses the tape width when provided', () => {
    expect(squarePxFrom(25)).toBe(Math.round(25 * PIXELS_PER_MM))
    expect(squarePxFrom(50)).toBe(Math.round(50 * PIXELS_PER_MM))
  })

  it('falls back to the default when the width is unknown', () => {
    expect(squarePxFrom(undefined)).toBe(def)
    expect(squarePxFrom(null)).toBe(def)
    expect(squarePxFrom(0)).toBe(def)
  })
})

describe('buildLabelScene', () => {
  it('shows the score, the points caption, and the default URL', () => {
    const shown = texts(scene())
    expect(shown).toContain('42')
    expect(shown).toContain(en.game.points)
    expect(shown).toContain(DEFAULT_LABEL_URL)
  })

  it('shows the label URL it is given', () => {
    const shown = texts(scene(base, { labelUrl: 'mzl.la/booth' }))
    expect(shown).toContain('mzl.la/booth')
    expect(shown).not.toContain(DEFAULT_LABEL_URL)
  })

  it('uses the singular "point" when the score is exactly 1', () => {
    const shown = texts(scene({ ...base, score: 1 }))
    expect(shown).toContain(en.game.point)
    expect(shown).not.toContain(en.game.points)
  })

  it('replaces the caption with the high score banner for a record', () => {
    const banner = en.game.newHighScoreBanner.toUpperCase()
    expect(texts(scene())).not.toContain(banner)
    for (const high of [{ isOverallHigh: true }, { isStateHigh: true }]) {
      const shown = texts(scene({ ...base, ...high }))
      expect(shown).toContain(banner)
      expect(shown).not.toContain(en.game.points)
    }
  })

  it('shows the name on a pill only when there is one', () => {
    const plain = scene()
    expect(byId(plain, 'label-name-pill')).toBeUndefined()
    expect(byId(scene({ ...base, name: '  ' }), 'label-name')).toBeUndefined()

    const named = scene({ ...base, name: 'juliana' })
    expect(byId<TextNode>(named, 'label-name')?.text).toBe('JULIANA')
    const pill = byId<ShapeNode>(named, 'label-name-pill')!
    expect(pill).toBeDefined()
    // Centered on the comp's x.
    const geometry = pill.geometry as { width: number }
    expect(pill.transform.x + geometry.width / 2).toBeCloseTo(156)
  })

  it('slices the background with the backdrop slice shift', () => {
    const layer = scene().find((n): n is Layer => n instanceof Layer)!
    expect(layer.region).toEqual({ x: 0, y: 0, width: 312, height: 312 })
    const [slice] = layer.effects
    expect(slice).toBeInstanceOf(SliceShift)
    expect((slice as SliceShift).columns).toBe(LABEL_SLICE_COLUMNS)
    expect((slice as SliceShift).shift).toBe(new SliceShift().shift)
  })

  it('fills each variant with its own gradient', () => {
    const fill = (variant: LabelInput['variant']) =>
      byId<ShapeNode>(scene({ ...base, variant }), 'label-gradient')!.fill as {
        kind: string
        stops: readonly { color: string }[]
      }
    expect(fill(undefined).kind).toBe('radial')
    expect(fill('purple').stops[0].color).toBe('#F5F4F9')
    expect(fill('orange').kind).toBe('linear')
    expect(fill('orange').stops[0].color).toBe('#FFDDAB')
    expect(fill('pink').stops[0].color).toBe('#F585B6')
  })

  it('draws six packets with inside strokes and inset shadows', () => {
    const packets = scene().filter(
      (n): n is Path2DNode => n instanceof Path2DNode,
    )
    expect(packets).toHaveLength(6)
    for (const packet of packets) {
      expect(packet.lineAlign).toBe('inside')
      const shadows = packet.shadow as readonly { inset?: boolean }[]
      expect(shadows).toHaveLength(2)
      expect(shadows.every((s) => s.inset)).toBe(true)
    }
  })

  it('shrinks a long score to fit the label', () => {
    const size = (score: number) =>
      byId<TextNode>(scene({ ...base, score }), 'label-score')!.fontSize
    expect(size(12345678)).toBeLessThan(size(4))
  })

  it('draws the icon only when given the assets', () => {
    const icon = document.createElement('canvas')
    const isIcon = (n: Node2D) => n instanceof ImageNode
    expect(scene().some(isIcon)).toBe(false)
    const node = scene(base, { assets: { icon } }).find(
      (n): n is ImageNode => n instanceof ImageNode,
    )!
    // 48 at (266, 266) in the 330 comp, on a 312 edge.
    expect(node.width).toBe(45)
    expect(node.x).toBe(251)
    expect(node.y).toBe(251)
  })
})

describe('ellipseOfMatrix', () => {
  it('maps the circle onto the same ellipse as the gradient matrix', () => {
    const m = PURPLE_GRADIENT_MATRIX
    const { rotation, scaleX, scaleY } = ellipseOfMatrix(m)
    const cos = Math.cos(rotation)
    const sin = Math.sin(rotation)
    for (let i = 0; i < 16; i++) {
      const t = (i / 16) * Math.PI * 2
      // A point of the matrix's ellipse, carried back through the rotation and
      // the scales, lands on the unit circle.
      const x = m.a * Math.cos(t) + m.c * Math.sin(t)
      const y = m.b * Math.cos(t) + m.d * Math.sin(t)
      const lx = (x * cos + y * sin) / scaleX
      const ly = (-x * sin + y * cos) / scaleY
      expect(Math.hypot(lx, ly)).toBeCloseTo(1, 6)
    }
  })
})

describe('labelPicksOf', () => {
  it('prints a record again with the label it was printed with', () => {
    expect(
      labelPicksOf({ labelVariant: 'pink', labelName: 'Juliana' }),
    ).toEqual({ variant: 'pink', name: 'Juliana' })
  })

  it('falls back to purple with no name', () => {
    expect(labelPicksOf({})).toEqual({ variant: 'purple', name: undefined })
  })
})
