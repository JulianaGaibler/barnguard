/**
 * Decomposed 2D transform with a lazily-rebuilt `local` DOMMatrix and a `world`
 * DOMMatrix populated by the scene walker. Setters mark dirty and fire
 * `onDirty`, the owning `SceneNode` hooks this to propagate to descendants.
 */
export class Transform2D {
  readonly local: DOMMatrix = new DOMMatrix()
  readonly world: DOMMatrix = new DOMMatrix()

  onDirty: (() => void) | null = null

  private _x = 0
  private _y = 0
  private _scaleX = 1
  private _scaleY = 1
  private _rotation = 0
  private _originX = 0
  private _originY = 0
  private _dirty = true

  alpha = 1

  get x(): number {
    return this._x
  }
  set x(v: number) {
    if (this._x !== v) {
      this._x = v
      this._dirty = true
      this.onDirty?.()
    }
  }

  get y(): number {
    return this._y
  }
  set y(v: number) {
    if (this._y !== v) {
      this._y = v
      this._dirty = true
      this.onDirty?.()
    }
  }

  get scaleX(): number {
    return this._scaleX
  }
  set scaleX(v: number) {
    if (this._scaleX !== v) {
      this._scaleX = v
      this._dirty = true
      this.onDirty?.()
    }
  }

  get scaleY(): number {
    return this._scaleY
  }
  set scaleY(v: number) {
    if (this._scaleY !== v) {
      this._scaleY = v
      this._dirty = true
      this.onDirty?.()
    }
  }

  get rotation(): number {
    return this._rotation
  }
  set rotation(v: number) {
    if (this._rotation !== v) {
      this._rotation = v
      this._dirty = true
      this.onDirty?.()
    }
  }

  get originX(): number {
    return this._originX
  }
  set originX(v: number) {
    if (this._originX !== v) {
      this._originX = v
      this._dirty = true
      this.onDirty?.()
    }
  }

  get originY(): number {
    return this._originY
  }
  set originY(v: number) {
    if (this._originY !== v) {
      this._originY = v
      this._dirty = true
      this.onDirty?.()
    }
  }

  get dirty(): boolean {
    return this._dirty
  }

  markDirty(): void {
    this._dirty = true
  }

  /**
   * Rebuild `local` from decomposed fields. Cheap no-op when clean.
   *
   * Composition order (right-to-left applied to a point): translate origin →
   * scale → rotate → translate to (x, y). Matches Godot/Unity 2D behaviour.
   */
  updateLocal(): void {
    if (!this._dirty) return
    const l = this.local
    l.a = 1
    l.b = 0
    l.c = 0
    l.d = 1
    l.e = 0
    l.f = 0
    if (this._x !== 0 || this._y !== 0) l.translateSelf(this._x, this._y)
    if (this._rotation !== 0) {
      // DOMMatrix.rotateSelf takes degrees around Z when passed one argument;
      // pass single-arg form for 2D.
      l.rotateSelf((this._rotation * 180) / Math.PI)
    }
    if (this._scaleX !== 1 || this._scaleY !== 1) {
      l.scaleSelf(this._scaleX, this._scaleY)
    }
    if (this._originX !== 0 || this._originY !== 0) {
      l.translateSelf(-this._originX, -this._originY)
    }
    this._dirty = false
  }
}
