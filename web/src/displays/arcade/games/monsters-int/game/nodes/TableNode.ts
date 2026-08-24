/**
 * The table: one unbroken surface, the mouth the deck is dealt from, and the
 * lettering under the buttons.
 *
 * @remarks
 *   Everything here lies on the `y = 0` plane and everything is unlit, painted at
 *   the colors the art draws. The mockup shades nothing, so neither does this.
 *
 *   Ground art is authored in the reference's screen space, which is not the
 *   space it is laid down in: a metre of table running away from the camera
 *   covers less than a metre of screen. Every quad below is therefore built
 *   `groundDepthForScreenHeight` deep so the projection cancels the stretch and
 *   the art lands on screen at the size it was drawn.
 */
import {
  MeshNode,
  Node3D,
  createQuadGeometry,
  type MaterialTexture,
} from '@src/stargazer'
import {
  PX_TO_M,
  groundDepthForScreenHeight,
  groundFromLayout,
} from '../project'
import { COLORS, MOUTH, TABLE, material } from '../tuning'
import type { WordArt } from '../art/tableTextures'

/**
 * A quarter turn about X, which lays a quad down onto the table plane.
 *
 * Scale is applied before rotation, so a quad has to be BUILT at its finished
 * size. Scaling one of these afterwards moves its normal, not its depth, and
 * leaves the art stretched over whatever the unscaled height happened to be.
 */
const LIE_FLAT = [-Math.SQRT1_2, 0, 0, Math.SQRT1_2] as const

/** A quad lying on the table, sized in layout px and placed by its centre. */
function groundQuad(
  widthPx: number,
  heightPx: number,
  layoutX: number,
  layoutY: number,
  lift: number,
  material: ConstructorParameters<typeof MeshNode>[1],
): MeshNode {
  const mesh = new MeshNode(
    createQuadGeometry({
      width: widthPx * PX_TO_M,
      height: groundDepthForScreenHeight(heightPx),
    }),
    material,
  )
  const centre = groundFromLayout(layoutX, layoutY)
  mesh.transform.setPosition(centre.x, lift, centre.z)
  mesh.transform.setRotation(...LIE_FLAT)
  return mesh
}

/**
 * The cream table.
 *
 * One surface rather than a disc over a backdrop. The art frames the cream with
 * the monster's skin, but a band behind a flat table only reads as a horizon
 * under a camera that has one, and this one is orthographic. Oversized so no
 * canvas aspect and no point in the launcher pan brings an edge into frame.
 */
export class TableNode extends Node3D {
  constructor() {
    super('monsters-int-table')
    const top = new MeshNode(
      createQuadGeometry({ width: TABLE.size, height: TABLE.size }),
      { lit: false, color: material(COLORS.cream), castShadow: false },
    )
    const centre = groundFromLayout(TABLE.centerX, TABLE.centerY)
    top.transform.setPosition(centre.x, 0, centre.z)
    top.transform.setRotation(...LIE_FLAT)
    this.add(top)
  }
}

/**
 * A word lying flat on the table, sized by its cap height in layout px.
 *
 * By height rather than width, so HIT and STAY are lettered at one size and the
 * shorter word is simply shorter. The art is cropped to its own glyphs, which
 * is what makes its aspect the thing to size against.
 */
export function createWordNode(
  art: WordArt,
  layoutX: number,
  layoutY: number,
  heightPx: number,
): MeshNode {
  return groundQuad(heightPx * art.aspect, heightPx, layoutX, layoutY, 0.0008, {
    lit: false,
    color: [1, 1, 1, 1],
    baseColorTex: art.texture,
    alphaMode: 'MASK',
    alphaCutoff: 0.4,
    castShadow: false,
  })
}

/**
 * The mouth, lying flat where the art draws it.
 *
 * It spills past the near edge of the table, which is why it sits above the
 * surface rather than being painted into it.
 */
export function createMouthNode(texture: MaterialTexture): MeshNode {
  return groundQuad(
    MOUTH.radiusX * 2,
    MOUTH.radiusY * 2,
    MOUTH.centerX,
    MOUTH.centerY,
    0.0004,
    {
      lit: false,
      color: [1, 1, 1, 1],
      baseColorTex: texture,
      alphaMode: 'MASK',
      alphaCutoff: 0.5,
      castShadow: false,
    },
  )
}
