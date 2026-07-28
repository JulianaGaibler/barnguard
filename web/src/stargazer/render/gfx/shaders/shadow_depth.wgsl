// Depth-only shadow caster. Transforms positions into the light's clip space
// during the shadow pre-pass. The framebuffer has only a depth attachment, so
// the fragment stage writes nothing.
//
// Bindings: a_position at LOC_POSITION (0), ShadowCam at CAMERA3D_UBO_BINDING
// (1), ShadowObject at MESH_OBJECT_UBO_BINDING (5). Coordinate space kept as
// authored (the light-space projection targets GL clip-Z).

struct ShadowCam {
  shadowViewProj: mat4x4<f32>,
};
@group(0) @binding(1) var<uniform> cam: ShadowCam;

struct ShadowObject {
  model: mat4x4<f32>,
};
@group(1) @binding(5) var<uniform> obj: ShadowObject;

@vertex
fn vs_main(@location(0) a_position: vec3<f32>) -> @builtin(position) vec4<f32> {
  return cam.shadowViewProj * obj.model * vec4<f32>(a_position, 1.0);
}

@fragment
fn fs_main() {
}
