// stargazer, public entrypoint.
//
// Everything the game code touches is re-exported from here. Do not import
// from stargazer's internal subpaths, that surface is unstable.

// engine
export { createEngineHost } from './engine/EngineHost'
export type {
  EngineHost,
  EngineHostOptions,
  SceneBuilder,
} from './engine/EngineHost'
export { Engine } from './engine/Engine'
export type {
  EngineOptions,
  RegisteredPhysicsWorld,
  RegisterPhysicsWorldOptions,
} from './engine/Engine'
export { createTicker } from './engine/Ticker'
export type { Ticker, TickerOptions } from './engine/Ticker'

// events
export { createEmitter } from './events/Emitter'
export type { Emitter, EmitterHandler } from './events/Emitter'
export type { EngineEvents } from './events/EngineEvents'

// ai (adversarial game search)
export { searchBestMove } from './ai/minimax'
export type { AdversarialGame, SearchOptions, SearchResult } from './ai/minimax'

// scene
export { SceneTree } from './scene/SceneTree'
export { Node } from './scene/Node'
export type { NodeOwner, NodeEvents, NodeKind } from './scene/Node'
export { GroupNode } from './scene/GroupNode'
export { Node3D } from './scene/Node3D'
export type { Node3DTweenTo } from './scene/Node3D'
export type { RenderLayer, PointerHandlers } from './scene/Node2D'
export { Behavior } from './scene/Behavior'
export type { BehaviorCtor } from './scene/Behavior'
export { PointerBehavior } from './scene/PointerBehavior'
export { ButtonBehavior } from './scene/ButtonBehavior'
export type { ButtonOptions } from './scene/ButtonBehavior'
export { DraggableBehavior } from './scene/DraggableBehavior'
export type { DraggableOptions } from './scene/DraggableBehavior'
export { walkTree } from './scene/traverse'
export { hitTestCircle } from './scene/hitTest'
export { raycastWorld3D, raycastMesh, makeRay } from './scene/raycast3d'
export type { Raycast3DHit } from './scene/raycast3d'

// math
export { Transform2D } from './math/Transform2D'
export type { Vec2 } from './math/Vec2'
export {
  vec2,
  vec2Set,
  vec2Copy,
  vec2Add,
  vec2Sub,
  vec2Scale,
  vec2Length,
  vec2Distance,
  vec2DistanceSq,
  vec2Lerp,
  vec2Dot,
  vec2Cross,
  vec2CrossSV,
  vec2Perp,
  vec2Normalize,
  vec2Rotate,
  vec2Negate,
} from './math/Vec2'
export type { Rect } from './math/Rect'
export {
  rect,
  rectCopy,
  rectContains,
  rectIntersects,
  rectUnion,
  rectPointAt,
  rectPercentOf,
  rectMargins,
  clampRectToBounds,
} from './math/Rect'
// `MatrixPool` was previously exported here but is not consumed by the engine
// or any downstream game code, kept as an internal helper in `math/matrix.ts`
// so its tests still resolve; not part of the public API.
export {
  copyMatrix2D,
  multiplyMatrix2D,
  invertMatrix2D,
  transformPoint2D,
} from './math/matrix'
// 3D math
export { Transform3D } from './math/Transform3D'
export type { Vec3 } from './math/Vec3'
export {
  vec3,
  vec3Set,
  vec3Copy,
  vec3Add,
  vec3Sub,
  vec3Scale,
  vec3Length,
  vec3Distance,
  vec3DistanceSq,
  vec3Lerp,
  vec3Dot,
  vec3Cross,
  vec3Normalize,
  vec3Negate,
} from './math/Vec3'
export type { Quat } from './math/Quat'
export {
  quat,
  quatIdentity,
  quatCopy,
  quatFromAxisAngle,
  quatMultiply,
  quatNormalize,
  quatSlerp,
} from './math/Quat'
export type { Ray } from './math/Ray'
export { ray, rayAt } from './math/Ray'
export type { Mat4 } from './math/Mat4'
export {
  mat4,
  mat4Identity,
  mat4Copy,
  mat4Multiply,
  mat4Invert,
  mat4Perspective,
  mat4Ortho,
  mat4LookAt,
  mat4Compose,
  mat4TransformPoint,
  mat4TransformDir,
} from './math/Mat4'
export type { Mat3 } from './math/Mat3'
export { mat3, mat3NormalMatrix } from './math/Mat3'
export type { Aabb } from './math/shadowFit'
export { fitDirectionalOrtho } from './math/shadowFit'
export { clamp, clampAbs, lerp, lerpAngle } from './math/scalar'
export type { Easing } from './math/easings'
/**
 * Easing functions for tweens, e.g. `easings.inOutCubic`. Each is an
 * {@link Easing}.
 *
 * @category Math
 */
export * as easings from './math/easings'

// camera — cameras are scene-tree nodes; `Camera`/`Camera3D` are internal
// view-math helpers the nodes own and are not exported.
export { CameraNode2D } from './camera/CameraNode2D'
export { CameraNode3D } from './camera/CameraNode3D'
export type { CameraView2D, Affine2x3 } from './camera/CameraView2D'
export type { CameraView3D } from './camera/CameraView3D'
export type { ScreenTransform, CameraAnimateOptions } from './camera/Camera'
export type {
  Projectionness,
  ProjectionAnimateOptions,
  ScreenProjection,
} from './camera/Camera3D'

// render internals (mostly for advanced users / tests)
export { Stage } from './render/Stage'
export type {
  StageOptions,
  StageResizeInfo,
  StagePointerEvents,
} from './render/Stage'
export { Renderer } from './render/Renderer'
export type { RendererOptions } from './render/Renderer'
export {
  RenderQuality,
  SHADOW_MAP_SIZES,
  SHADOW_SOFTNESS_TAPS,
} from './render/RenderQuality'
export type { RenderQualityOptions } from './render/RenderQuality'
export { Fog } from './render/Fog'
export type { FogOptions, FogMode } from './render/Fog'
export { PostProcessPipeline } from './render/postfx/PostProcessPipeline'
export type {
  PostEffect,
  PostPass,
  PostPassContext,
} from './render/postfx/PostEffect'
export { ChromaticAberration } from './render/postfx/effects/ChromaticAberration'
export type { ChromaticAberrationOptions } from './render/postfx/effects/ChromaticAberration'
export { Vignette } from './render/postfx/effects/Vignette'
export type { VignetteOptions } from './render/postfx/effects/Vignette'
export { VignetteBlur } from './render/postfx/effects/VignetteBlur'
export type { VignetteBlurOptions } from './render/postfx/effects/VignetteBlur'
export { AmbientOcclusion } from './render/gfx/ao/AmbientOcclusion'
export type { AoPreset } from './render/gfx/ao/AmbientOcclusion'
export type {
  Gfx2D,
  GfxBlend,
  GfxClipShape,
  GfxStrokeStyle,
  GfxTextStyle,
  GfxGradientStop,
} from './render/gfx/Gfx2D'
export { resolveRadii } from './render/gfx/roundRectRadii'
export type { RoundRectRadii, ResolvedRadii } from './render/gfx/roundRectRadii'
export type { GeometryHandle } from './render/gfx/GeometryHandle'
export { parseColor, mixColor, withAlpha } from './render/gfx/parseColor'
export type { RGBA } from './render/gfx/parseColor'

// debug (dev-only surface; production code sees `host.debug === null`)
export { DebugController } from './debug/DebugController'
export type {
  DebugEvents,
  DebugToggleState,
  DebugStatsSnapshot,
  DebugControllerOptions,
  DebugPanelSpec,
  ActivePointerReadout,
  StageChip,
  DebugGpuStatsReadout,
  PhysicsWorldReadout,
} from './debug/DebugController'
export type { PhysicsOverlayFlags } from './debug/DebugPhysicsRenderer'
export type { DebugRenderMode } from './render/gfx/GpuGfx'
export { DebugCamera } from './debug/DebugCamera'
export { FrameStats } from './debug/FrameStats'

// primitives
export { Node2D } from './scene/Node2D'
export { ShapeNode } from './nodes/ShapeNode'
export type { ShapeGeometry, ShapeNodeOptions } from './nodes/ShapeNode'
export { PolylineNode } from './nodes/PolylineNode'
export type {
  PolylineNodeOptions,
  PolylineSmoothing,
} from './nodes/PolylineNode'
export { Path2DNode } from './nodes/Path2DNode'
export type { Path2DNodeOptions, Path2DHitMode } from './nodes/Path2DNode'
export { ParticleEmitterNode } from './nodes/ParticleEmitterNode'
export type { ParticleEmitterNodeOptions } from './nodes/ParticleEmitterNode'
export { VectorParticleNode } from './nodes/VectorParticleNode'
export type {
  VectorParticleNodeOptions,
  VectorParticleSpawnInit,
} from './nodes/VectorParticleNode'
export { TextNode } from './nodes/TextNode'
export type { TextNodeOptions } from './nodes/TextNode'
export { MeshNode, createBoxGeometry } from './nodes/MeshNode'
export type {
  MeshGeometry,
  MeshMaterial,
  MaterialTexture,
  TextureImage,
  TextureSampler,
} from './nodes/MeshNode'
export {
  Light3D,
  DirectionalLight3D,
  PointLight3D,
  SpotLight3D,
} from './nodes/Light3D'
export type { Light3DOptions } from './nodes/Light3D'
export { Viewport2DNode } from './nodes/Viewport2DNode'
export type { Viewport2DOptions } from './nodes/Viewport2DNode'
export { measureText } from './render/gfx/rasterizeLabel'
export type { LabelStyle, LabelMetrics } from './render/gfx/rasterizeLabel'
export {
  ellipsize,
  fitFontSize,
  fitRichTextBlock,
  fitTextBlock,
  textWidth,
  wrapRichText,
  wrapText,
  wrapTextInfo,
} from './render/gfx/textLayout'
export type {
  RichBlock,
  RichLine,
  RichRun,
  TextBlock,
  TextSpan,
} from './render/gfx/textLayout'

// layout (opt-in constraints-based box layout)
export { BoxConstraints, edgeInsets } from './layout/constraints'
export type { Size, EdgeInsets } from './layout/constraints'
export { LayoutNode, isMeasurable } from './layout/LayoutNode'
export type { Measurable, MeasurableNode } from './layout/LayoutNode'
export { LayoutRoot } from './layout/LayoutRoot'
export type { LayoutRootOptions } from './layout/LayoutRoot'
export { Box, SizedBox, Padding, Align, Center } from './layout/nodes/Box'
export type { BoxOptions, AlignOptions, Align1D } from './layout/nodes/Box'
export { alignOffset, alignWithin } from './layout/align'
export {
  Flex,
  Row,
  Column,
  Flexible,
  Expanded,
  Spacer,
} from './layout/nodes/Flex'
export type {
  FlexOptions,
  Axis,
  MainAxisAlign,
  CrossAxisAlign,
} from './layout/nodes/Flex'
export { Stack } from './layout/nodes/Stack'
export type { StackOptions } from './layout/nodes/Stack'
export { Scaffold } from './layout/nodes/Scaffold'
export type { ScaffoldOptions } from './layout/nodes/Scaffold'
export { AspectRatio } from './layout/nodes/AspectRatio'
export type { AspectRatioOptions } from './layout/nodes/AspectRatio'
export { LayoutBuilder } from './layout/nodes/LayoutBuilder'
export type { LayoutBuilderOptions } from './layout/nodes/LayoutBuilder'

// physics
export { PhysicsWorld } from './physics/PhysicsWorld'
export type {
  PhysicsWorldConfig,
  ResolvedPhysicsConfig,
} from './physics/PhysicsWorld'
export { Body, BodyType } from './physics/Body'
export type { BodyDef } from './physics/Body'
export {
  Collider,
  circleShape,
  aabbShape,
  polygonShape,
} from './physics/Collider'
export type {
  ColliderDef,
  Shape,
  CircleShape,
  AABBShape,
  PolygonShape,
} from './physics/Collider'
export { LAYER_DEFAULT, LAYER_ALL, shouldCollide } from './physics/layers'
export { BruteForceBroadPhase } from './physics/BroadPhase'
export type { BroadPhase, PairCallback } from './physics/BroadPhase'
export { SpatialHashBroadPhase } from './physics/SpatialHashBroadPhase'
export { RigidBodyBehavior } from './physics/RigidBodyBehavior'
export type { RigidBodyBehaviorOptions } from './physics/RigidBodyBehavior'
export { PhysicsWorldBehavior } from './physics/PhysicsWorldBehavior'
export type { PhysicsWorldBehaviorOptions } from './physics/PhysicsWorldBehavior'
export type {
  Material,
  Contact,
  Manifold,
  RaycastHit,
  KinematicHit,
  PhysicsEvents,
} from './physics/types'

// particles
export { ParticleEmitter } from './particles/ParticleEmitter'
export type { ParticleEmitterConfig } from './particles/ParticleEmitter'
export { ParticlePool } from './particles/ParticlePool'
export type { ParticleField } from './particles/ParticlePool'
export { getParticleSprite, clearParticleSpriteCache } from './particles/draw'
export type { ParticleSpriteStyle } from './particles/draw'

// assets
export { AssetLoader } from './assets/AssetLoader'
export { parseSvgPaths, computePathBounds } from './assets/SvgPathMap'
export type {
  SvgPathMap,
  SvgPathEntry,
  ParseSvgPathsOptions,
} from './assets/SvgPathMap'
export { buildBitmapMask } from './assets/BitmapMask'
export type { BitmapMask, BitmapMaskOptions } from './assets/BitmapMask'
export { loadGltf, parseGltf } from './assets/gltf'

// input
export { InputSystem } from './input/InputSystem'
export { findHitNode } from './input/hit'
export { bindRegionGesture } from './input/RegionGesture'
export type { RegionGestureOptions } from './input/RegionGesture'
export type {
  PointerEvent2D,
  PointerStateSnapshot,
  PointerPhase,
} from './input/PointerState'

// animation & async lifecycle
export { Animator } from './anim/Animator'
export type { TweenOptions } from './anim/Animator'
export { Timeline } from './anim/Timeline'
export type { TimelineStep } from './anim/Timeline'
// glTF keyframe playback (distinct from the tween Animator above)
export { AnimationPlayer } from './anim/AnimationPlayer'
export type { AnimationPlayerOptions } from './anim/AnimationPlayer'
export type {
  AnimationClip,
  AnimationChannel,
  AnimationSampler,
  Interpolation,
  ChannelPath,
} from './anim/AnimationClip'
export {
  ignoreAbort,
  isAbortError,
  abortError,
  combineAbortSignals,
} from './anim/abortSignal'
export type { CombinedAbort } from './anim/abortSignal'
export { AbortScope } from './anim/AbortScope'

// dom (attach HTML elements to scene nodes)
export { DomTransformSync, projectWorldToCss } from './dom/DomTransformSync'
export type {
  DomAttachment,
  DomAttachOptions,
  Dom3DAttachment,
  Dom3DAttachOptions,
  CssMatrix,
} from './dom/DomTransformSync'

// a11y (optional accessibility layer for canvas scene graphs)
export { AccessibilityTree } from './a11y/AccessibilityTree'
export type {
  Semantics,
  SemanticsHandle,
  A11yRole,
  A11yStates,
  A11yLink,
  A11yRelation,
  Politeness,
} from './a11y/types'

// svelte
export { mountEngine } from './svelte/mountEngine'
export type { MountEngineActionParams } from './svelte/mountEngine'
export { mountStage } from './svelte/mountStage'
export type { MountStageParams } from './svelte/mountStage'
export { domAnchor, domAnchor3d } from './svelte/domAnchor'
export type { DomAnchorParams, DomAnchor3dParams } from './svelte/domAnchor'
export { a11yRoot } from './svelte/a11yRoot'
export type { A11yRootParams } from './svelte/a11yRoot'
export { emitterStore, latestEventStore } from './svelte/emitterStore'
