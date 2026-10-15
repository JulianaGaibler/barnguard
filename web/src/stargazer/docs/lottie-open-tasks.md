# Lottie: open tasks (not performance)

Work still open for Lottie support, excluding performance. Performance work is
tracked in `lottie-performance-report.md` and `engine-architecture-review.md`.

Unsupported features are reported at load time as `unsupported-*` diagnostics
on `LottieNode.diagnostics`, so a file that uses one still loads.

## Suggested order

1. Fixture sweep against a reference renderer (it may surface correctness bugs).
2. Text animators and font registration (the largest visible feature gap).
3. Offset path and zig-zag.

## Features

### Shape modifiers

- [ ] Offset path: recursive cubic splitting, orientation from signed area,
      round, miter and bevel joins, transform carried through the chain.
- [ ] Zig-zag: ridges at each vertex plus `freq` per segment, at parametric `t`.
- [ ] Twist.
- [ ] Merge paths, subtract and intersect across several shapes. Union and
      exclude work. Subtract and intersect with a single shape do nothing and
      report `unsupported-merge-mode` for several shapes.
- [ ] Round corners on curved corners. Only straight corners are rounded now.

### Masks

- [ ] Mask expansion (`x`): offset path with round joins and miter 4. Depends on
      offset path.

### Text

- [ ] Animators and range selectors: shapes (square, ramps, triangle, round,
      smooth), mode, random order, ease high and low, amount. Position and
      rotation add, scale multiplies, opacity and colours blend.
- [ ] Text on a path, with glyphs rotated along the tangent.
- [ ] Glyph strokes.
- [ ] Box text wrapping, per word then per glyph.
- [ ] Keyframed text documents interpolate. Today a document holds until the
      next one.
- [ ] Font registration from the `.lottie` `f/` folder and from `fPath`, under
      scoped family names, removed on dispose. A font the page lacks currently
      falls back to `sans-serif`.
- [ ] A `fontRegistrar` seam, so registration can be replaced in tests.

### Themes and slots

- [ ] Theme colour alpha: the 4th component multiplies fill or stroke opacity
      (theme values only).
- [ ] Text and image slots.
- [ ] `LottieNode.setAnimation(id)` for archives with several animations. Today
      each animation needs a new node.

### Blending and effects

- [ ] Blend modes beyond normal, multiply, screen, add, lighten, darken and the
      destination modes. They fall back to normal with a diagnostic.
- [ ] Hard mix (17), currently normal with a diagnostic.
- [ ] Layer effects and styles (blur, drop shadow, tint, fill, tritone, stroke).
      Optional.

### Engine features Lottie relies on

- [ ] `Node2D.composite` and `groupOpacity`, so any scene subtree can fade or
      blend as one group. Lottie layers have exact opacity already.
- [ ] Scissor fast path for pixel-aligned rectangle clips, with a test for the
      switch between scissor and stencil when a clip starts rotating.

## Spec decisions to pin with fixtures

Each needs a fixture checked against a reference renderer, with the result
recorded in the plan's Lottie semantics section.

- [ ] Repeater copy count (currently rounds), opacity ramp, composite order.
- [ ] Trim wrapping across the path seam. A wrapped trim currently produces two
      open paths instead of one joined path.
- [ ] Easing solver minimum slope.
- [ ] Skew sign and axis at 0, 45 and 90 degrees.
- [ ] Start points of rectangle and ellipse paths under trim.

Hand-made fixtures planned but not added:

- [ ] Image layer with a 16 x 16 PNG.
- [ ] Skew at 0, 45 and 90 degrees.
- [ ] Repeater ordering and opacity.
- [ ] Mask inversion cases.
- [ ] Markers with `ip` other than 0.
- [ ] Trim start points for rectangle and ellipse.

## Verification

- [ ] Compare these fixtures side by side with a reference renderer:
      `focal_test`, `gradient_sleepy_loader`, `isometric`, `merging_shapes`,
      `polystar_anim`, `text`, `text_anim`, `waves`.
- [ ] Context loss in the middle of an animation, on both backends.
- [ ] Resize while offscreen surfaces are live.
- [ ] Device pixel ratio change (geometry re-buckets).
- [ ] `?msaa=1` and `?msaa=4` on both backends.

## Demos

- [ ] Nesting scene: a `LottieNode` inside a rotating, layout-managed parent
      with group opacity, next to a shape and a text node, inside a clipped
      scroll panel.
- [ ] Slot editor in `?demo=lottie` (the theme dropdown exists).

## Possible bugs to confirm

Noticed while reading the code, not reproduced.

- [ ] `Viewport2DNode`: the embedded scene may never get its transforms updated,
      which would leave world matrices stale. A `LottieNode` inside a 3D
      viewport would show it.
- [ ] `?msaa=2` on WebGPU: the value is passed through, but WebGPU accepts only
      1 or 4 samples.
- [ ] The label page can be wiped in the middle of a frame when full, which
      corrupts label draws already recorded that frame. Lottie text drawn with
      `fillText` goes through it.

## Housekeeping

- [ ] Commit the work. The working tree also holds unrelated uncommitted
      changes in the same files, so the split needs care.
- [ ] Update the plan's phase status lines for P4 to P7, which predate later
      changes.
- [ ] Existing formatting warnings in touched files (comment wraps) that predate
      this work.
