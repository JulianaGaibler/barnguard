// Flat 3D mesh program. Positions go to world space via the per-object
// model matrix, then to clip via the camera view-projection. The world-space
// normal (via the model's upper 3×3) feeds lighting. Non-uniform scale skews it,
// uniform scale + rotation are exact. World position passes through for fog.
//
// `u_flags.x` (lit) selects flat unlit color or one directional light + ambient.
// `u_flags.y` (useTexture) swaps in a sampled texture (a Viewport2DNode's 2D
// surface), V-flipped from y-down 2D content, taken as already-premultiplied.
// Output is premultiplied to match the engine's framebuffer.
//
// Bindings: a_position/a_normal/a_uv at LOC_POSITION/NORMAL/UV (0/1/2), FlatFrame
// at CAMERA3D_UBO_BINDING (1), FlatObject at MESH_OBJECT_UBO_BINDING (5),
// u_texture at unit 0 (U_TEX).

struct FlatFrame {
  viewProj: mat4x4<f32>,
  eyePos: vec4<f32>,
  ambient: vec4<f32>,
  fogColor: vec4<f32>,
  fogParams: vec4<f32>,
  lightDir: vec4<f32>,   // xyz: direction the light travels
  lightColor: vec4<f32>, // xyz: rgb
  debug: vec4<f32>,      // x = debug mode
};
@group(0) @binding(1) var<uniform> frame: FlatFrame;

struct FlatObject {
  model: mat4x4<f32>,
  color: vec4<f32>,      // straight (non-premultiplied) rgba
  flags: vec4<f32>,      // x = lit, y = useTexture
};
@group(1) @binding(5) var<uniform> obj: FlatObject;

@group(1) @binding(0) var u_texture: texture_2d<f32>;
@group(1) @binding(16) var u_textureSamp: sampler;

struct VOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) worldPos: vec3<f32>,
  @location(1) normal: vec3<f32>,
  @location(2) uv: vec2<f32>,
};

// Upper-left 3×3 of a mat4 (for normals / rotation).
fn mat3of(m: mat4x4<f32>) -> mat3x3<f32> {
  return mat3x3<f32>(m[0].xyz, m[1].xyz, m[2].xyz);
}

@vertex
fn vs_main(
  @location(0) a_position: vec3<f32>,
  @location(1) a_normal: vec3<f32>,
  @location(2) a_uv: vec2<f32>,
) -> VOut {
  var out: VOut;
  let worldPos = obj.model * vec4<f32>(a_position, 1.0);
  out.worldPos = worldPos.xyz;
  out.pos = frame.viewProj * worldPos;
  out.normal = mat3of(obj.model) * a_normal;
  out.uv = a_uv;
  return out;
}

// Blend `color` (display-space rgb) toward the fog tint by camera distance.
// Fog rides on rgb only, alpha is untouched, so premultiply still holds after.
fn applyFog(color: vec3<f32>, worldPos: vec3<f32>) -> vec3<f32> {
  if (frame.fogColor.w < 0.5) {
    return color;
  }
  let dist = length(frame.eyePos.xyz - worldPos);
  var f: f32;
  if (frame.fogParams.x < 0.5) {
    f = 1.0 - exp(-frame.fogParams.y * dist); // exp
  } else {
    f = clamp((dist - frame.fogParams.z) / max(frame.fogParams.w - frame.fogParams.z, 1e-4),
              0.0, 1.0); // linear
  }
  return mix(color, frame.fogColor.rgb, f);
}

@fragment
fn fs_main(in: VOut) -> @location(0) vec4<f32> {
  // Sample the surface texture unconditionally (uniform control flow, V-flipped
  // from the y-down 2D content) and select on the useTexture flag below.
  let tex = textureSample(u_texture, u_textureSamp, vec2<f32>(in.uv.x, 1.0 - in.uv.y));

  let a = obj.color.a;
  let debugMode = frame.debug.x;
  let lit = obj.flags.x;
  let useTexture = obj.flags.y;

  // Normals view applies to all geometry regardless of texture/lighting.
  if (debugMode > 1.5) {
    let n = normalize(in.normal);
    return vec4<f32>((n * 0.5 + 0.5) * a, a);
  }
  if (useTexture > 0.5) {
    // The 2D surface is premultiplied. Un-premultiply to fog the straight color,
    // then re-apply alpha.
    let straight = select(tex.rgb, tex.rgb / tex.a, tex.a > 0.0);
    return vec4<f32>(applyFog(straight, in.worldPos) * tex.a, tex.a) * obj.color.a;
  }
  let base = obj.color.rgb;
  var shaded: vec3<f32>;
  // Unshaded view (debugMode == 1) forces flat albedo even for lit materials.
  if (lit > 0.5 && debugMode < 0.5) {
    let n = normalize(in.normal);
    let ndl = max(dot(n, -normalize(frame.lightDir.xyz)), 0.0);
    shaded = base * (frame.ambient.xyz + frame.lightColor.xyz * ndl);
  } else {
    shaded = base;
  }
  return vec4<f32>(applyFog(shaded, in.worldPos) * a, a);
}
