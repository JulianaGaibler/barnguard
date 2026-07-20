/**
 * The built-in drawable `SceneNode`s. {@link ShapeNode} draws a circle/rect,
 * {@link Path2DNode} an arbitrary `Path2D` (SVG artwork), {@link PolylineNode} a
 * point stream (finger-drawn paths), {@link TextNode} a line of text, and
 * {@link ParticleEmitterNode} a particle system. {@link SceneNode} is a
 * transform-only container for grouping children. Subclass `SceneNode` for
 * anything custom.
 *
 * @module nodes
 * @category Nodes
 */
export { SceneNode } from '../scene/SceneNode'
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
export { TextNode } from '../nodes/TextNode'
export type { TextNodeOptions } from '../nodes/TextNode'
