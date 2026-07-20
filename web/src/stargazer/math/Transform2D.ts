/**
 * A `SceneNode`'s local transform: position, per-axis scale, rotation, a pivot
 * origin, and alpha. Set the fields directly (`node.transform.x = 100`); each
 * setter marks the node dirty so the scene walk rebuilds the matrices and
 * propagates to descendants.
 *
 * `local` is the composed matrix rebuilt lazily from the fields; `world` is
 * `local` pre-multiplied by the parent chain, filled in by the scene walk each
 * frame. Read them for hit-testing or custom draw math, but treat them as
 * read-only.
 *
 * Composition order (applied right-to-left to a point): translate origin →
 * scale → rotate → translate to `(x, y)`. Matches Godot / Unity 2D.
 *
 * @category Math
 */
export class Transform2D {
  /** Composed local matrix, rebuilt lazily from the fields. Treat as read-only. */
  readonly local: DOMMatrix = new DOMMatrix()
  /** World matrix (`local` × parent chain), filled by the scene walk. Read-only. */
  readonly world: DOMMatrix = new DOMMatrix()

  /** Internal, the owning `SceneNode` hooks this to mark itself dirty. */
  onDirty: (() => void) | null = null

  #_x = 0
  #_y = 0
  #_scaleX = 1
  #_scaleY = 1
  #_rotation = 0
  #_originX = 0
  #_originY = 0
  #_dirty = true

  /** Opacity in `[0, 1]`. Multiplied down into descendants by the render walk. */
  alpha = 1

  /** X position in the parent's local space. */
  get x(): number {
    return this.#_x
  }
  set x(v: number) {
    if (this.#_x !== v) {
      this.#_x = v
      this.#_dirty = true
      this.onDirty?.()
    }
  }

  /** Y position in the parent's local space. */
  get y(): number {
    return this.#_y
  }
  set y(v: number) {
    if (this.#_y !== v) {
      this.#_y = v
      this.#_dirty = true
      this.onDirty?.()
    }
  }

  /** Horizontal scale factor (1 = unscaled). */
  get scaleX(): number {
    return this.#_scaleX
  }
  set scaleX(v: number) {
    if (this.#_scaleX !== v) {
      this.#_scaleX = v
      this.#_dirty = true
      this.onDirty?.()
    }
  }

  /** Vertical scale factor (1 = unscaled). */
  get scaleY(): number {
    return this.#_scaleY
  }
  set scaleY(v: number) {
    if (this.#_scaleY !== v) {
      this.#_scaleY = v
      this.#_dirty = true
      this.onDirty?.()
    }
  }

  /** Rotation in radians, clockwise in the y-down coordinate space. */
  get rotation(): number {
    return this.#_rotation
  }
  set rotation(v: number) {
    if (this.#_rotation !== v) {
      this.#_rotation = v
      this.#_dirty = true
      this.onDirty?.()
    }
  }

  /** Pivot X (local units) that scale and rotation turn around. Default 0. */
  get originX(): number {
    return this.#_originX
  }
  set originX(v: number) {
    if (this.#_originX !== v) {
      this.#_originX = v
      this.#_dirty = true
      this.onDirty?.()
    }
  }

  /** Pivot Y (local units) that scale and rotation turn around. Default 0. */
  get originY(): number {
    return this.#_originY
  }
  set originY(v: number) {
    if (this.#_originY !== v) {
      this.#_originY = v
      this.#_dirty = true
      this.onDirty?.()
    }
  }

  get dirty(): boolean {
    return this.#_dirty
  }

  markDirty(): void {
    this.#_dirty = true
  }

  /**
   * Rebuild `local` from decomposed fields. Cheap no-op when clean.
   *
   * Composition order (right-to-left applied to a point): translate origin →
   * scale → rotate → translate to (x, y). Matches Godot/Unity 2D behavior.
   */
  updateLocal(): void {
    if (!this.#_dirty) return
    const l = this.local
    l.a = 1
    l.b = 0
    l.c = 0
    l.d = 1
    l.e = 0
    l.f = 0
    if (this.#_x !== 0 || this.#_y !== 0) l.translateSelf(this.#_x, this.#_y)
    if (this.#_rotation !== 0) {
      // DOMMatrix.rotateSelf takes degrees around Z when passed one argument;
      // pass single-arg form for 2D.
      l.rotateSelf((this.#_rotation * 180) / Math.PI)
    }
    if (this.#_scaleX !== 1 || this.#_scaleY !== 1) {
      l.scaleSelf(this.#_scaleX, this.#_scaleY)
    }
    if (this.#_originX !== 0 || this.#_originY !== 0) {
      l.translateSelf(-this.#_originX, -this.#_originY)
    }
    this.#_dirty = false
  }
}
