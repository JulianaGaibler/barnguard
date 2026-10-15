// Test helper: paint every visible layer of a renderer into one target, each
// under its own matrix, the way the scene places them as nodes.

import type { CComp, LottieRenderer, PaintTarget } from './LottieRenderer'

export function paintAll(renderer: LottieRenderer, target: PaintTarget): void {
  const visit = (comp: CComp): void => {
    // The first layer in the file is the topmost, so paint from the end.
    for (let i = comp.layers.length - 1; i >= 0; i--) {
      const layer = comp.layers[i]
      if (!layer.visible || layer.matteOnly) continue
      const m = layer.matrix
      target.save()
      target.transform(m[0], m[1], m[2], m[3], m[4], m[5])
      renderer.paintLayer(layer, target)
      if (layer.inner) visit(layer.inner)
      target.restore()
    }
  }
  visit(renderer.comp)
}
