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
export { Scene } from './scene/Scene'
export type { RenderLayer, NodeEvents } from './scene/SceneNode'
export { Behavior } from './scene/Behavior'
export type { BehaviorCtor } from './scene/Behavior'
export { walkTree } from './scene/traverse'
export { hitTestCircle } from './scene/hitTest'

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
export { clamp, clampAbs, lerp, lerpAngle } from './math/scalar'
export type { Easing } from './math/easings'
/**
 * Easing functions for tweens, e.g. `easings.inOutCubic`. Each is an
 * {@link Easing}.
 *
 * @category Math
 */
export * as easings from './math/easings'

// camera
export { Camera } from './camera/Camera'
export type { ScreenTransform, CameraAnimateOptions } from './camera/Camera'

// render internals (mostly for advanced users / tests)
export { Layers } from './render/Layers'
export { Stage } from './render/Stage'
export type {
  StageOptions,
  StageResizeInfo,
  StagePointerEvents,
  RendererMode,
} from './render/Stage'
export { Renderer } from './render/Renderer'
export type { RendererOptions } from './render/Renderer'
export type { DynamicResolutionOptions } from './render/DynamicResolution'
export type {
  Gfx2D,
  GfxBlend,
  GfxStrokeStyle,
  GfxTextStyle,
  GfxGradientStop,
} from './render/gfx/Gfx2D'
export type { GeometryHandle } from './render/gfx/GeometryHandle'
export { Canvas2DGfx } from './render/gfx/Canvas2DGfx'
export type { Canvas2DGfxOptions } from './render/gfx/Canvas2DGfx'
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
export type { DebugRenderMode } from './render/gfx/gpu/GpuGfx'
export { DebugCamera } from './debug/DebugCamera'
export { FrameStats } from './debug/FrameStats'

// primitives
export { SceneNode } from './scene/SceneNode'
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
export { TextNode } from './nodes/TextNode'
export type { TextNodeOptions } from './nodes/TextNode'

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

// input
export { InputSystem } from './input/InputSystem'
export { findHitNode } from './input/hit'
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
export {
  ignoreAbort,
  isAbortError,
  abortError,
  combineAbortSignals,
} from './anim/abortSignal'
export type { CombinedAbort } from './anim/abortSignal'

// dom (attach HTML elements to scene nodes)
export { DomTransformSync, projectWorldToCss } from './dom/DomTransformSync'
export type {
  DomAttachment,
  DomAttachOptions,
  CssMatrix,
} from './dom/DomTransformSync'

// svelte
export { mountEngine } from './svelte/mountEngine'
export type { MountEngineActionParams } from './svelte/mountEngine'
export { mountStage } from './svelte/mountStage'
export type { MountStageParams } from './svelte/mountStage'
export { domAnchor } from './svelte/domAnchor'
export type { DomAnchorParams } from './svelte/domAnchor'
export { emitterStore, latestEventStore } from './svelte/emitterStore'
