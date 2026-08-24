/**
 * The monster's lower lip and its tongue, as 2D paths.
 *
 * @remarks
 *   Paths rather than textures, because these are flat vector shapes that fill
 *   the bottom band of the frame at whatever size the booth screen is. A
 *   rasterised lip would have to be authored for the largest screen and would
 *   still soften on it.
 *
 *   They are 2D and everything they cover is 3D, which is the point: the 2D
 *   layers draw over the whole 3D pass, so the lip lands in front of the near
 *   end of the table and the tongue in front of the lip, with no depth to
 *   arrange.
 */
import { AssetLoader, parseSvgPaths } from '@src/stargazer'
import { COLORS } from '../tuning'
import lipSvg from '../../assets/red-area.svg?raw'
import tongueSvg from '../../assets/tongue.svg?raw'

/** A path and the colour it is painted, in the order they are drawn. */
export interface BannerShape {
  path: Path2D
  color: string
}

export interface BannerArt {
  lip: BannerShape
  /** Two paths: the shaded underside, then the tongue over it. */
  tongue: readonly BannerShape[]
}

const loader = new AssetLoader()

/**
 * Tessellated on parse, which is what the GPU backend needs before `fillPath2D`
 * will draw anything: an unregistered path renders nothing and reports
 * nothing.
 */
export async function loadBannerArt(): Promise<BannerArt> {
  return loader.load('monsters-int:banner', () => {
    const lip = parseSvgPaths(lipSvg, { tessellate: true })
    const tongue = parseSvgPaths(tongueSvg, { tessellate: true })
    const get = (map: ReturnType<typeof parseSvgPaths>, id: string): Path2D => {
      const entry = map.paths.get(id)
      if (!entry) throw new Error(`monsters-int: no path '${id}' in the art`)
      return entry.path
    }
    return Promise.resolve({
      lip: { path: get(lip, 'lip'), color: COLORS.skin },
      tongue: [
        { path: get(tongue, 'shade'), color: COLORS.tongueShade },
        { path: get(tongue, 'tongue'), color: COLORS.tongue },
      ],
    })
  })
}
