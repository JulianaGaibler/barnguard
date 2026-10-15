import { postShader, type PostEffect, type PostPass } from '../PostEffect'
import type { ShaderReflection } from '../../gfx/GfxDevice'
import wgsl from '../shaders/copy.wgsl?raw'
import vertSrc from '../shaders/copy.gen.vert.glsl?raw'
import fragSrc from '../shaders/copy.gen.frag.glsl?raw'
import reflect from '../shaders/copy.reflect.json'

/**
 * An effect that changes nothing. Its one pass copies the input to the output,
 * which gets a render into a target the caller owns when there is no real
 * effect to put it there. A cached layer without effects runs it.
 *
 * @internal
 */
export class Copy implements PostEffect {
  enabled = true
  readonly passes: readonly PostPass[] = [
    {
      shader: postShader(vertSrc, fragSrc, wgsl, reflect as ShaderReflection),
      paramsBytes: 0,
    },
  ]
}
