import { linear, type Easing } from '../math/easings'
import { abortError } from './abortSignal'

export interface TweenOptions {
  /** Total duration in seconds. Zero-duration tweens complete on the next tick. */
  duration: number
  /** Seconds to wait before advancing. */
  delay?: number
  easing?: Easing
  /**
   * Aborting rejects the returned Promise with `DOMException('Aborted',
   * 'AbortError')`. We remove our listener on natural completion, call the
   * pattern in `abortSignal.ts` if you need to combine multiple signals.
   */
  signal?: AbortSignal
  /**
   * Called every tick after the target's properties are updated. Useful for
   * knock-on effects (invalidating a static cache, marking a node dirty).
   */
  onUpdate?: () => void
}

/**
 * Internal per-animation record. One shape covers both `tween` (with onTick
 * doing the interpolation) and `wait` (onTick is undefined).
 */
interface AnimationRecord {
  duration: number
  delay: number
  elapsed: number
  easing: Easing
  onTick?: (eased: number, t: number) => void
  resolve: () => void
  reject: (err: unknown) => void
  removeAbortListener: (() => void) | null
  cancelled: boolean
  completed: boolean
  /**
   * Ownership fingerprint for the dev-time overlap warning. `undefined` when no
   * target (e.g. plain `wait`).
   */
  target?: object
  keys?: readonly string[]
}

const DEV_WARN_OVERLAP = true

/**
 * Owns the engine's active tween/wait set. Ticked once per render frame by
 * `Engine.frame()`. All async animation primitives (`tween`, `wait`, `animate`,
 * `Timeline`) funnel through here so a single `cancelAll()` on engine destroy
 * rejects every outstanding Promise.
 */
export class Animator {
  private readonly active = new Set<AnimationRecord>()
  private disposed = false

  // Persistent scratch buffer for `tick`. Reused across frames, clearing
  // its length at end-of-tick drops references so completed records can be
  // GC'd. Falls back to a fresh allocation on reentrant ticks (an onTick
  // that synchronously triggers another `tick()` on the same animator).
  private readonly _tickScratch: AnimationRecord[] = []
  private _tickDepth = 0
  private _reentrancyWarnings = 0

  /**
   * Tween the numeric properties named in `to` on `target` from their current
   * values to the target values. Non-number properties are ignored at runtime
   * (the caller is expected to constrain via TS).
   */
  tween<T extends object>(
    target: T,
    to: Partial<T>,
    opts: TweenOptions,
  ): Promise<void> {
    const keys = Object.keys(to) as Array<keyof T & string>
    // Snapshot from-values now (before delay) so the tween's starting point
    // isn't affected by other systems mutating the target during the delay.
    const from: Record<string, number> = {}
    for (const key of keys) {
      const v = target[key]
      if (typeof v === 'number') from[key] = v
    }

    return this.schedule(opts, target, keys, (eased) => {
      for (const key of keys) {
        if (!(key in from)) continue
        const toV = to[key]
        if (typeof toV !== 'number') continue
        ;(target as unknown as Record<string, number>)[key] =
          from[key] + (toV - from[key]) * eased
      }
      opts.onUpdate?.()
    })
  }

  /**
   * Resolve after `seconds` of engine time (variable dt, capped by the ticker).
   * Cancellable via `opts.signal`. Zero seconds → resolves on the next tick.
   */
  wait(seconds: number, signal?: AbortSignal): Promise<void> {
    return this.schedule({ duration: Math.max(0, seconds), signal })
  }

  /** Advance every active animation by `dt` seconds. Called by Engine.frame(). */
  tick(dt: number): void {
    if (this.disposed || this.active.size === 0) return

    // Reentrant path: an outer `tick`'s onTick/resolve triggered another
    // tick on the same animator. Fall back to a fresh allocation so the
    // outer tick's scratch stays intact until it returns. Reentrancy is
    // legal but almost always signals a design bug (recursive game logic
    // that will eventually stack-overflow), so warn, throttled to avoid
    // log spam.
    if (this._tickDepth > 0) {
      if (this._reentrancyWarnings < 3) {
        this._reentrancyWarnings++
        console.warn(
          `[stargazer] Animator.tick reentrant, an onTick or promise ` +
            `resolution triggered another tick. depth=${this._tickDepth + 1}. ` +
            `Usually a bug (recursive game logic that will eventually stack-overflow).`,
        )
      }
      const nested: AnimationRecord[] = []
      for (const r of this.active) nested.push(r)
      this._runTick(dt, nested)
      return
    }

    // Fill the persistent scratch. Snapshotting isolates the loop from
    // records that add themselves during onTick, those hit `this.active`
    // but not `scratch`, so they fire next tick (the documented contract).
    const scratch = this._tickScratch
    scratch.length = 0
    for (const r of this.active) scratch.push(r)
    this._tickDepth++
    try {
      this._runTick(dt, scratch)
    } finally {
      this._tickDepth--
      // Drop references so completed records can be GC'd between ticks.
      scratch.length = 0
    }
  }

  private _runTick(dt: number, snapshot: AnimationRecord[]): void {
    for (let i = 0; i < snapshot.length; i++) {
      const record = snapshot[i]
      if (record.cancelled || record.completed) continue
      record.elapsed += dt
      if (record.elapsed < record.delay) continue
      const progress =
        record.duration <= 0
          ? 1
          : Math.min(1, (record.elapsed - record.delay) / record.duration)
      const eased = record.easing(progress)
      record.onTick?.(eased, progress)
      if (progress >= 1) {
        record.completed = true
        this.finalize(record)
        record.resolve()
      }
    }
  }

  /** Reject every active animation with AbortError. Called on engine destroy. */
  cancelAll(): void {
    if (this.disposed) return
    this.disposed = true
    const snapshot: AnimationRecord[] = []
    for (const r of this.active) snapshot.push(r)
    for (const record of snapshot) {
      if (record.cancelled || record.completed) continue
      record.cancelled = true
      this.finalize(record)
      record.reject(abortError())
    }
    this.active.clear()
  }

  private schedule(
    opts: TweenOptions,
    target?: object,
    keys?: readonly string[],
    onTick?: (eased: number, t: number) => void,
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (this.disposed) {
        reject(abortError())
        return
      }
      if (opts.signal?.aborted) {
        reject(abortError())
        return
      }

      const record: AnimationRecord = {
        duration: opts.duration,
        delay: Math.max(0, opts.delay ?? 0),
        elapsed: 0,
        easing: opts.easing ?? linear,
        onTick,
        resolve,
        reject,
        removeAbortListener: null,
        cancelled: false,
        completed: false,
        target,
        keys,
      }

      // Attach abort listener. MUST remove on natural completion (see plan
      // §"Abort listener lifetime, implementation contract").
      const signal = opts.signal
      if (signal) {
        const onAbort = (): void => {
          if (record.completed || record.cancelled) return
          record.cancelled = true
          this.finalize(record)
          this.active.delete(record)
          reject(abortError())
        }
        signal.addEventListener('abort', onAbort, { once: true })
        record.removeAbortListener = () => {
          signal.removeEventListener('abort', onAbort)
        }
      }

      // Dev-mode overlap warning: any prior active tween on the same target
      // touching any of these keys will be over-written by us starting now.
      if (DEV_WARN_OVERLAP && target && keys && keys.length > 0) {
        outer: for (const other of this.active) {
          if (other.target !== target || !other.keys) continue
          for (const k of other.keys) {
            if (keys.includes(k)) {
              console.warn(
                `[stargazer] overlapping tween on the same target key '${k}'. ` +
                  `Last-writer wins per tick; cancel the earlier tween to avoid drift.`,
              )
              break outer
            }
          }
        }
      }

      this.active.add(record)
    })
  }

  /** Remove the abort listener (if any) and drop the record from `active`. */
  private finalize(record: AnimationRecord): void {
    if (record.removeAbortListener) {
      record.removeAbortListener()
      record.removeAbortListener = null
    }
    this.active.delete(record)
  }
}
