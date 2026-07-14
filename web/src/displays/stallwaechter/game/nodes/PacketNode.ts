import { Path2DNode, type Rect } from '@src/stargazer'
import { tessellateContours } from '@src/stargazer/assets/SvgPathContours'
import { registerPathTessellation } from '@src/stargazer/render/gfx/PathTessellationRegistry'
import { TUNING } from '../data/tuning'

const HEX_STROKE_DEFAULT = '#D84EFF'
const HEX_FILL_DEFAULT = '#ffffff'

/**
 * A regular hexagon "data packet". Extends `Path2DNode` so it renders +
 * hit-tests through the same primitive as any Path2D-based node, but the hex
 * geometry is built once at construction from the tuning radius.
 *
 * Hit mode is `'circle'` with `hitRadiusWorld = radius + hitPadding` so the
 * finger target stays generous even when the visible hex is small.
 */
export class PacketNode extends Path2DNode {
  readonly radius: number

  constructor(opts: { id?: string; radius?: number } = {}) {
    const radius = opts.radius ?? TUNING.packet.radius
    const path = buildHexagonPath(radius)
    super({
      id: opts.id ?? 'packet',
      path,
      fill: HEX_FILL_DEFAULT,
      stroke: HEX_STROKE_DEFAULT,
      lineWidth: 1.5,
      hitMode: 'circle',
      hitRadiusWorld: radius + TUNING.packet.hitPadding,
      debugBounds: hexBounds(radius),
    })
    this.radius = radius
  }
}

function buildHexagonPath(radius: number): Path2D {
  const p = new Path2D()
  // Regular hexagon, flat-topped (looks like the mockup). Vertex 0 is at
  // angle -30° from +x so the top edge is horizontal.
  const contour = new Float32Array(12)
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i - Math.PI / 6
    const x = Math.cos(a) * radius
    const y = Math.sin(a) * radius
    contour[i * 2] = x
    contour[i * 2 + 1] = y
    if (i === 0) p.moveTo(x, y)
    else p.lineTo(x, y)
  }
  p.closePath()
  // Register the hex tessellation so the GPU backend's `fillPath2D` +
  // `strokePath2D` find geometry. The static-bake path (Canvas 2D) ignores
  // the registration.
  const triangles = tessellateContours([contour])
  registerPathTessellation(p, triangles, [contour])
  return p
}

function hexBounds(r: number): Rect {
  return { x: -r, y: -r, width: r * 2, height: r * 2 }
}
