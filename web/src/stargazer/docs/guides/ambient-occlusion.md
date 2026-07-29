# Ambient occlusion

Ambient occlusion darkens the places light struggles to reach — the crease where a wall meets the
floor, the gap under a fridge, the contact seam where one object rests on another. Stargazer
estimates it in screen space each frame from the 3D pass's depth and normals, so it needs no baking
and works on any geometry, including glTF imports. It is off by default and opt-in per stage.

Reach the primary stage's controller through `engine.ambientOcclusion` (or `stage.ambientOcclusion`
for a secondary stage). It is created on first access and allocates nothing until enabled — a
2D-only stage that never touches it pays zero cost.

```ts
engine.ambientOcclusion.enabled = true
engine.ambientOcclusion.preset = 'high' // 'low' | 'medium' (default) | 'high'
```

That is the whole setup. AO then applies to every PBR and flat mesh in the 3D pass automatically.

## Presets

A preset sets the sample budget (how many directions and steps the horizon scan takes) and a default
strength. Higher presets resolve finer contact detail at more cost.

- **`low`** — 2 slices × 3 steps. Cheapest; smooth enough for kiosk-class hardware.
- **`medium`** — 3 slices × 4 steps. The default.
- **`high`** — 4 slices × 6 steps. Sharpest crevices.

## Tuning

Three fields override the preset's feel, all safe to set live (the debug HUD's rendering panel
drives the same knobs):

```ts
const ao = engine.ambientOcclusion
ao.intensity = 4 // occlusion strength; raise until crevices read, lower if it smudges
ao.radius = 0.6 // how far a surface looks for occluders, in world units
ao.directStrength = 0 // see below
```

- **`intensity`** scales the darkening. The physically-plausible range sits low, but a stylized look
  can push it much higher to force crevices toward black.
- **`radius`** is the view-space reach of the scan. Small radii catch tight contact seams; large
  radii darken broad concavities but cost precision.
- **`directStrength`** (`0`..`1`, default `0`) decides whether AO also dims _direct_ light. At `0`,
  AO is physical: it only attenuates the ambient (indirect) term, so a crevice under a bright, direct
  light stays bright — correct, but the occlusion can be hard to see on well-lit ground. Raising it
  folds AO into the diffuse direct lobe as well (never specular), a baked-AO look that makes contact
  darkening read everywhere. Treat it as an artistic dial, not a correctness setting.

## What it costs

AO adds a depth/normal prepass over the AO-receiving opaque meshes plus a generate-and-blur step, all
at the render resolution. On WebGPU the generate and blur run as compute dispatches; on WebGL2 they
run as fullscreen fragment passes. The preset's slice/step budget is the main lever — drop to `low`
if the prepass shows up in a frame budget.

## Known limitations

- **Ambient-only by default:** with `directStrength = 0`, AO modulates only the flat ambient term.
  The engine has no image-based lighting, so that term is a small constant; scenes lit mostly by
  direct light show AO faintly until you raise `intensity` or `directStrength`. See
  [Lighting](3d.md#lighting).
- **No temporal reuse:** AO is single-frame (spatial bilateral blur only, no TAA). Fast camera
  motion can shimmer slightly; the blur radius and preset are the knobs, not temporal accumulation.
- **MSAA silhouette rims:** the AO buffer is single-sample while the main pass is MSAA, so a
  foreground mesh over a distant background can leave a faint dark rim at its silhouette. AO is
  low-frequency and blurred, so this is normally unnoticeable.
- **Opaque meshes only:** transparent, emissive-only, and skybox meshes neither write the AO
  prepass nor receive occlusion.

## Maintainer notes

The controller lives in `render/gfx/ao/AmbientOcclusion.ts` and runs from `Stage` before
`beginFrame`, in the same pre-frame window as the shadow prepass. It picks the compute path when
`device.supportsCompute` is true and the fragment path otherwise; both share the horizon-scan and
depth-aware blur math. The mesh shaders sample the blurred result and modulate lighting per-fragment
inside the MSAA pass — a screen-space color multiply would darken the 2D overlay and cannot resolve
cleanly through MSAA. AO is the first client of the engine's WebGPU compute foundation
(`GfxDevice.supportsCompute` / `createComputePipeline` / `dispatchCompute`).
