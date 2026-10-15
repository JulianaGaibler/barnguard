// Places a compiled Lottie animation as a tree of nodes.
//
// Every layer is a node. Its matrix is the node's transform, so a layer that
// only moves repaints nothing. What a layer paints is one picture, repainted
// only when the layer's content can change from frame to frame. A layer that
// needs a surface (exact opacity, a blend, masks or a matte) uses the node
// properties that composite one, and a precomposition holds its inner layers as
// child nodes.

import type { Transform2D } from '../../math/Transform2D'
import type { Node } from '../../scene/Node'
import { Node2D } from '../../scene/Node2D'
import type { GfxPath } from '../../render/gfx/GfxPath'
import type { Canvas } from '../../render/picture/Canvas'
import type { LottieMask } from '../model/types'
import type { Affine } from './affine'
import type { CComp, CLayer, LottieRenderer } from './LottieRenderer'

/**
 * How each mask mode combines its coverage with the running one. Lighten takes
 * the larger, which a union matches for hard edges. Difference keeps what is in
 * one and not the other. Darken takes the smaller.
 */
const MASK_BLEND: Record<
  string,
  'source-over' | 'destination-out' | 'destination-in' | 'xor'
> = {
  add: 'source-over',
  lighten: 'source-over',
  subtract: 'destination-out',
  intersect: 'destination-in',
  darken: 'destination-in',
  difference: 'xor',
}

/** A node that records its picture with a function. */
class PictureNode extends Node2D {
  readonly #paint: (canvas: Canvas) => void

  constructor(id: string, paint: (canvas: Canvas) => void) {
    super(id)
    this.#paint = paint
  }

  override paint(canvas: Canvas): void {
    this.#paint(canvas)
  }
}

/** One mask's painted coverage, repainted when its opacity changes. */
interface MaskPart {
  node: Node2D
  mask: LottieMask
  opacity: number
}

interface LayerNodes {
  layer: CLayer
  /** The node that carries the layer's matrix, group and matte properties. */
  node: Node2D
  /** The node that paints the layer's own content, when it has any. */
  painter: Node2D | null
  /** The coverage of the layer's masks, drawn as the matte of its content. */
  maskRoot: Node2D | null
  maskParts: MaskPart[]
  inner: SceneComp | null
}

interface SceneComp {
  node: Node2D
  layers: LayerNodes[]
}

/**
 * The node tree of one animation. `root` is the composition. `apply` copies an
 * evaluated frame onto the nodes.
 *
 * @internal
 */
export class LottieScene {
  readonly root: Node2D
  readonly #renderer: LottieRenderer
  readonly #comp: SceneComp
  readonly #width: number
  readonly #height: number

  constructor(renderer: LottieRenderer, width: number, height: number) {
    this.#renderer = renderer
    this.#width = width
    this.#height = height
    this.#comp = this.#build(renderer.comp, width, height, 'lottie')
    this.root = this.#comp.node
  }

  /**
   * Copy the evaluated `frame` onto the nodes: where each layer is, whether it
   * shows, how it composites, and which pictures must paint again.
   */
  apply(frame: number): void {
    this.#applyComp(this.#comp, frame)
    // Layers move during the compose walk, after the tree composed its
    // transforms, so bring every node of the animation up to date now.
    ensureWorld(this.root)
  }

  /** Paint every picture again, after a theme or slot changed what they show. */
  repaintAll(): void {
    const visit = (comp: SceneComp): void => {
      for (const ln of comp.layers) {
        ln.painter?.markNeedsPaint()
        for (const part of ln.maskParts) part.node.markNeedsPaint()
        if (ln.inner) visit(ln.inner)
      }
    }
    visit(this.#comp)
  }

  // --- build -----------------------------------------------------------------

  #build(comp: CComp, w: number, h: number, id: string): SceneComp {
    const node = new Node2D(id)
    const layers: LayerNodes[] = []
    const byLayer = new Map<CLayer, LayerNodes>()
    // The first layer in the file is the topmost, so add from the end.
    for (let i = comp.layers.length - 1; i >= 0; i--) {
      const layer = comp.layers[i]
      const ln = this.#buildLayer(layer, w, h, `${id}/${layer.model.name || i}`)
      byLayer.set(layer, ln)
      layers.push(ln)
      if (ln.maskRoot) node.add(ln.maskRoot)
      node.add(ln.node)
    }
    for (const ln of layers) {
      const layer = ln.layer
      if (!layer.matteSource || layer.matteOnly) continue
      const source = byLayer.get(layer.matteSource)
      if (!source) continue
      ln.node.matte = source.node
      ln.node.matteMode =
        layer.model.matteMode === 'none' ? 'alpha' : layer.model.matteMode
    }
    return { node, layers }
  }

  #buildLayer(layer: CLayer, w: number, h: number, id: string): LayerNodes {
    const m = layer.model
    const hasContent =
      m.type === 'solid' ||
      m.type === 'shape' ||
      m.type === 'text' ||
      m.type === 'image'
    const masked = layer.maskPaths.length > 0 && !layer.matteOnly
    const renderer = this.#renderer
    const paintLayer = (canvas: Canvas): void =>
      renderer.paintLayer(layer, canvas)
    const inner = layer.inner
      ? this.#build(
          layer.inner,
          m.type === 'precomp' ? m.width : w,
          m.type === 'precomp' ? m.height : h,
          id,
        )
      : null
    if (inner && layer.boundsClip) inner.node.clip = layer.boundsClip
    const content: Node2D | null = hasContent
      ? new PictureNode(`${id}/paint`, paintLayer)
      : (inner?.node ?? null)
    let node: Node2D
    if (masked && content) {
      node = new Node2D(id)
      node.add(content)
    } else if (hasContent && content) {
      node = content
    } else {
      node = new Node2D(id)
      if (inner) node.add(inner.node)
    }
    if (layer.maskClip) node.clip = layer.maskClip
    if (!layer.matteOnly && layer.blend) node.compositeBlend = layer.blend
    const out: LayerNodes = {
      layer,
      node,
      painter: hasContent ? content : null,
      maskRoot: null,
      maskParts: [],
      inner,
    }
    if (masked && content) this.#buildMasks(out, content, w, h, id)
    return out
  }

  /**
   * The coverage of the layer's masks as a matte for `content`. The coverage
   * lives in the composition's space, and the paths in the layer's, so each
   * path's node follows the layer's matrix.
   */
  #buildMasks(
    out: LayerNodes,
    content: Node2D,
    w: number,
    h: number,
    id: string,
  ): void {
    const layer = out.layer
    const masks = layer.model.masks.filter((m) => m.mode !== 'none')
    const root = new Node2D(`${id}/mask`)
    const first = masks[0]?.mode
    // The running coverage starts full when the first mask subtracts,
    // intersects or darkens, empty otherwise.
    if (first === 'subtract' || first === 'intersect' || first === 'darken') {
      root.add(this.#cover(`${id}/mask-all`, w, h))
    }
    for (let i = 0; i < masks.length; i++) {
      const mask = masks[i]
      const path: GfxPath = layer.maskPaths[i]
      const blend = MASK_BLEND[mask.mode]
      const part: MaskPart = {
        node: new PictureNode(`${id}/mask-${i}`, (canvas) => {
          canvas.setAlpha(part.opacity)
          canvas.fillPath(path, '#ffffff', 'nonzero')
        }),
        mask,
        opacity: 1,
      }
      out.maskParts.push(part)
      if (mask.inverted) {
        // White everywhere except under the path, composited with the mode.
        const group = new Node2D(`${id}/mask-group-${i}`)
        group.compositeGroup = true
        group.compositeBlend = blend
        group.add(this.#cover(`${id}/mask-all-${i}`, w, h))
        const hole = new Node2D(`${id}/mask-hole-${i}`)
        hole.compositeGroup = true
        hole.compositeBlend = 'destination-out'
        hole.add(part.node)
        group.add(hole)
        root.add(group)
      } else if (blend === 'source-over') {
        root.add(part.node)
      } else {
        const group = new Node2D(`${id}/mask-group-${i}`)
        group.compositeGroup = true
        group.compositeBlend = blend
        group.add(part.node)
        root.add(group)
      }
    }
    content.compositeGroup = true
    content.matte = root
    content.matteMode = 'alpha'
    out.maskRoot = root
  }

  #cover(id: string, w: number, h: number): Node2D {
    return new PictureNode(id, (canvas) => {
      canvas.fillRect(0, 0, w, h, '#ffffff')
    })
  }

  // --- apply -----------------------------------------------------------------

  #applyComp(comp: SceneComp, frame: number): void {
    for (const ln of comp.layers) {
      const layer = ln.layer
      const node = ln.node
      node.visible = layer.visible
      if (ln.maskRoot) ln.maskRoot.visible = layer.visible
      if (!layer.visible) continue
      setTransformFromAffine(node.transform, layer.matrix)
      const surface = layer.surface && !layer.matteOnly
      node.transform.alpha = surface ? layer.surfaceOpacity : 1
      // A masked layer composites through its content node, so the layer's own
      // surface is only needed for what the content's does not cover.
      node.compositeGroup =
        surface &&
        (ln.maskRoot === null ||
          layer.matteSource !== null ||
          layer.blend !== null ||
          layer.surfaceOpacity < 0.999)
      if (ln.painter && !layer.contentStatic) ln.painter.markNeedsPaint()
      for (const part of ln.maskParts) {
        const opacity = Math.max(
          0,
          Math.min(1, part.mask.opacity.get(frame) / 100),
        )
        if (opacity !== part.opacity) {
          part.opacity = opacity
          part.node.markNeedsPaint()
        }
        setTransformFromAffine(part.node.transform, layer.matrix)
      }
      if (ln.inner) this.#applyComp(ln.inner, ln.layer.innerFrame)
    }
  }

  get size(): { width: number; height: number } {
    return { width: this.#width, height: this.#height }
  }
}

/** Compose the world transform of `node` and every node under it, parents first. */
function ensureWorld(node: Node): void {
  if (node.kind === '2d') (node as Node2D).ensureWorldTransform()
  const children = node.children
  for (let i = 0; i < children.length; i++) ensureWorld(children[i])
}

/**
 * Set `t` to the affine `m`, as `x`, `y`, a scale on each axis, a skew and a
 * rotation. The engine composes translate, rotate, skew and scale in that
 * order, which spans every affine matrix except a mirror with a skew.
 */
export function setTransformFromAffine(t: Transform2D, m: Affine): void {
  const a = m[0]
  const b = m[1]
  const c = m[2]
  const d = m[3]
  const sx = Math.hypot(a, b)
  if (sx === 0) {
    // A collapsed first axis leaves no direction to measure the rest from.
    t.rotation = 0
    t.scaleX = 0
    t.skew = 0
    t.scaleY = Math.hypot(c, d)
  } else {
    const rotation = Math.atan2(b, a)
    // The second column in the rotated frame: along the first axis, then across.
    const along = (a * c + b * d) / sx
    const across = (a * d - b * c) / sx
    t.rotation = rotation
    t.scaleX = sx
    t.scaleY = across
    t.skew = across === 0 ? 0 : Math.atan(along / across)
  }
  t.skewAxis = 0
  t.x = m[4]
  t.y = m[5]
}
