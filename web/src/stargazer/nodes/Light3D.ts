import { Node3D } from '../scene/Node3D'

/**
 * Shared options for the punctual light nodes.
 *
 * @category Scene
 */
export interface Light3DOptions {
  /** Linear RGB color in `0..1`. Default white. */
  color?: [number, number, number]
  /** Brightness multiplier applied to `color`. Default `1`. */
  intensity?: number
  /** Cast shadows. Default `false`. */
  shadowEnabled?: boolean
  /**
   * Constant depth offset that pushes the shadow test off the surface. Default
   * `0.0025`.
   */
  shadowBias?: number
  /**
   * Offset (world units, scaled by grazing angle) of the shadow lookup along
   * the surface normal. The main lever against shadow acne. Default `1`
   * (directional lights default `2`).
   */
  shadowNormalBias?: number
  /**
   * Shadow strength `0..1`; `1` is fully dark, lower lifts the shadow. Default
   * `1`.
   */
  shadowOpacity?: number
}

/**
 * Base for the punctual light nodes ({@link DirectionalLight3D},
 * {@link PointLight3D}, {@link SpotLight3D}). A light is transform-driven: the 3D
 * renderer reads its world position and its local −Z axis (in world space) each
 * frame, so a light parented to a moving node tracks it. Add lights to the
 * scene tree like any node; a scene with no light nodes falls back to the
 * renderer's default directional light.
 *
 * @category Scene
 */
export abstract class Light3D extends Node3D {
  /** Linear RGB color in `0..1`. */
  color: [number, number, number]
  /** Brightness multiplier applied to `color`. */
  intensity: number
  /** Cast shadows (a scene supports several shadow-casting lights at once). */
  shadowEnabled: boolean
  /** Constant depth offset against shadow acne, in the shadow map's depth space. */
  shadowBias: number
  /** Normal-offset shadow bias, scaled by grazing angle. */
  shadowNormalBias: number
  /** Shadow strength `0..1`. */
  shadowOpacity: number

  constructor(opts: Light3DOptions = {}, id?: string) {
    super(id)
    this.color = opts.color ? [...opts.color] : [1, 1, 1]
    this.intensity = opts.intensity ?? 1
    this.shadowEnabled = opts.shadowEnabled ?? false
    this.shadowBias = opts.shadowBias ?? 0.0025
    this.shadowNormalBias = opts.shadowNormalBias ?? 1
    this.shadowOpacity = opts.shadowOpacity ?? 1
  }
}

/**
 * A light infinitely far away, casting parallel rays along the node's local −Z
 * axis (in world space). Position is irrelevant; only orientation matters.
 *
 * @category Scene
 * @example
 *   const sun = new DirectionalLight3D({
 *     color: [1, 0.96, 0.9],
 *     intensity: 3,
 *   })
 *   sun.transform.setRotation(quatFromAxisAngle(quat(), 1, 0, 0, -0.6))
 *   engine.tree.add(sun)
 */
export class DirectionalLight3D extends Light3D {
  /**
   * Caps the shadow map's world extent. `0` (default) auto-fits the map to the
   * shadow casters' bounds — tight and sharp for a compact scene, but a large
   * ground plane spreads the map thin. Set a positive value to hold resolution
   * on the near scene and let distant geometry fall outside the shadowed
   * region.
   */
  shadowMaxDistance: number

  constructor(
    opts: Light3DOptions & { shadowMaxDistance?: number } = {},
    id?: string,
  ) {
    // Directional shadows span the scene at a shallow angle, so they need a
    // larger normal bias than local lights to stay acne-free.
    super({ shadowNormalBias: 2, ...opts }, id)
    this.shadowMaxDistance = opts.shadowMaxDistance ?? 0
  }
}

/**
 * A point light radiating from the node's world position with inverse-square
 * falloff. `range` optionally windows the falloff to zero at that distance; `0`
 * (default) leaves it unbounded.
 *
 * @category Scene
 */
export class PointLight3D extends Light3D {
  /**
   * Falloff cutoff distance in world units; `0` = unbounded (inverse-square
   * only).
   */
  range: number

  constructor(opts: Light3DOptions & { range?: number } = {}, id?: string) {
    super(opts, id)
    this.range = opts.range ?? 0
  }
}

/**
 * A spot light at the node's world position, aimed along its local −Z axis,
 * with a cone that is full-bright inside `innerConeAngle` and falls off to dark
 * at `outerConeAngle` (both in radians, half-angles from the axis).
 *
 * @category Scene
 */
export class SpotLight3D extends Light3D {
  /** Falloff cutoff distance in world units; `0` = unbounded. */
  range: number
  /** Inner cone half-angle in radians (full brightness within). */
  innerConeAngle: number
  /** Outer cone half-angle in radians (dark beyond). */
  outerConeAngle: number

  constructor(
    opts: Light3DOptions & {
      range?: number
      innerConeAngle?: number
      outerConeAngle?: number
    } = {},
    id?: string,
  ) {
    super(opts, id)
    this.range = opts.range ?? 0
    this.innerConeAngle = opts.innerConeAngle ?? 0
    this.outerConeAngle = opts.outerConeAngle ?? Math.PI / 4
  }
}
