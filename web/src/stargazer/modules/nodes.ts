/**
 * The built-in drawable `Node2D`s. {@link ShapeNode} draws a circle/rect,
 * {@link Path2DNode} an arbitrary `Path2D` (SVG artwork), {@link PolylineNode} a
 * point stream (finger-drawn paths), {@link TextNode} a line of text,
 * {@link ParticleEmitterNode} a baked, sprite-based particle system, and
 * {@link VectorParticleNode} an open base class for particles that need
 * per-piece vector geometry. {@link Node2D} is a transform-only container for
 * grouping children. Subclass `Node2D` for anything custom.
 *
 * @module nodes
 * @category Nodes
 */
export { Node2D } from '../scene/Node2D'
export { ShapeNode } from '../nodes/ShapeNode'
export type { ShapeGeometry, ShapeNodeOptions } from '../nodes/ShapeNode'
export { PolylineNode } from '../nodes/PolylineNode'
export type {
  PolylineNodeOptions,
  PolylineSmoothing,
} from '../nodes/PolylineNode'
export { Path2DNode } from '../nodes/Path2DNode'
export type { Path2DNodeOptions, Path2DHitMode } from '../nodes/Path2DNode'
export { ParticleEmitterNode } from '../nodes/ParticleEmitterNode'
export type { ParticleEmitterNodeOptions } from '../nodes/ParticleEmitterNode'
export { VectorParticleNode } from '../nodes/VectorParticleNode'
export type {
  VectorParticleNodeOptions,
  VectorParticleSpawnInit,
} from '../nodes/VectorParticleNode'
export { TextNode } from '../nodes/TextNode'
export type { TextNodeOptions } from '../nodes/TextNode'
export { MeshNode, createBoxGeometry } from '../nodes/MeshNode'
export type {
  MeshGeometry,
  MeshMaterial,
  MaterialTexture,
  TextureImage,
  TextureSampler,
} from '../nodes/MeshNode'
export {
  Light3D,
  DirectionalLight3D,
  PointLight3D,
  SpotLight3D,
} from '../nodes/Light3D'
export type { Light3DOptions } from '../nodes/Light3D'
export { Viewport2DNode } from '../nodes/Viewport2DNode'
export type { Viewport2DOptions } from '../nodes/Viewport2DNode'
