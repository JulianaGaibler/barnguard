import { mount } from 'svelte'
import { preloadFonts } from '@src/core/fonts'
import { startUiScale } from '@src/core/ui/uiScale'

/**
 * Mounts a dev surface when the URL asks for one, and reports whether it did.
 * None of these is a display:
 *
 * - `?fonts` is the type specimen, for judging the shipped faces and the role
 *   each is bound to.
 * - `?backdrop` previews the Enterprise brand background composite (blur, slice
 *   shift, grain) in isolation.
 * - `?dither` previews the dither effect on a few sources, with every setting.
 *
 * A single-display build replaces this module with `boot.stub.ts`, so none of
 * it ships there.
 */
export async function bootDevSurface(
  params: URLSearchParams,
  target: HTMLElement,
): Promise<boolean> {
  if (params.has('fonts')) {
    startUiScale()
    const [{ default: FontSpecimen }, { EXTRA_FONT_SPECS }] = await Promise.all(
      [import('@src/dev/FontSpecimen.svelte'), import('@src/core/fonts/extra')],
    )
    await preloadFonts(EXTRA_FONT_SPECS)
    mount(FontSpecimen, { target })
    return true
  }
  if (params.has('backdrop')) {
    startUiScale()
    const { default: BackdropPreview } =
      await import('@src/displays/enterprise/background/BackdropPreview.svelte')
    mount(BackdropPreview, { target })
    return true
  }
  if (params.has('dither')) {
    startUiScale()
    const { default: DitherPreview } =
      await import('@src/dev/DitherPreview.svelte')
    mount(DitherPreview, { target })
    return true
  }
  return false
}
