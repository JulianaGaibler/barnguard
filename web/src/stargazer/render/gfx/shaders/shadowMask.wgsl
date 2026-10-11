// Shadow-mask raster pass. Renders a path's own local-space triangles into a
// small offscreen target at twice the final mask resolution: solid white, no
// blending, so overlapping triangles from a self-intersecting path overwrite
// rather than accumulate into a brighter patch. `shadowBlur.wgsl`'s two passes
// blur and downsample this into the cached coverage mask.
//
// Standalone pipeline: `PathShadowCache` builds and runs this directly
// against `GfxDevice`, outside `GpuBatchContext`, so it carries no shared
// Frame UBO and no analytic clip.
//
// Bindings: Params at group 0 binding 0, a_pos at location 0.

struct Params {
  // Local path space -> this bake's clip space [-1,1] (column-major mat3,
  // homogeneous 2D), folding placement and scale into one matrix.
  xform: mat3x3<f32>,
};
@group(0) @binding(0) var<uniform> params: Params;

struct VOut {
  @builtin(position) pos: vec4<f32>,
};

@vertex
fn vs_main(@location(0) a_pos: vec2<f32>) -> VOut {
  var out: VOut;
  let clip = params.xform * vec3<f32>(a_pos, 1.0);
  out.pos = vec4<f32>(clip.xy, 0.0, 1.0);
  return out;
}

@fragment
fn fs_main(_in: VOut) -> @location(0) vec4<f32> {
  return vec4<f32>(1.0, 1.0, 1.0, 1.0);
}
