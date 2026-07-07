import { describe, expect, it } from 'vitest'
import { Animator } from './Animator'
import { linear, outCubic } from '../math/easings'

describe('Animator', () => {
  describe('tween', () => {
    it('lands exactly on the target after full duration', async () => {
      const a = new Animator()
      const target = { x: 0, y: 10 }
      const p = a.tween(
        target,
        { x: 100, y: 20 },
        { duration: 1, easing: linear },
      )
      a.tick(0.5)
      expect(target.x).toBeCloseTo(50, 5)
      expect(target.y).toBeCloseTo(15, 5)
      a.tick(0.5)
      await p
      expect(target.x).toBe(100)
      expect(target.y).toBe(20)
    })

    it('respects `delay` before starting to advance', async () => {
      const a = new Animator()
      const target = { x: 0 }
      const p = a.tween(
        target,
        { x: 100 },
        { duration: 1, delay: 0.5, easing: linear },
      )
      a.tick(0.4) // still in delay
      expect(target.x).toBe(0)
      a.tick(0.6) // consumed 0.5 delay + 0.5 of tween
      expect(target.x).toBeCloseTo(50, 5)
      a.tick(0.5)
      await p
      expect(target.x).toBe(100)
    })

    it('applies easing (values differ from linear at the midpoint)', () => {
      const a = new Animator()
      const linearT = { x: 0 }
      const easedT = { x: 0 }
      a.tween(linearT, { x: 100 }, { duration: 1, easing: linear })
      a.tween(easedT, { x: 100 }, { duration: 1, easing: outCubic })
      a.tick(0.5)
      expect(linearT.x).toBeCloseTo(50, 3)
      expect(easedT.x).toBeCloseTo(outCubic(0.5) * 100, 3)
      expect(linearT.x).not.toBeCloseTo(easedT.x, 3)
    })

    it('rejects synchronously when signal is already aborted', async () => {
      const a = new Animator()
      const ctrl = new AbortController()
      ctrl.abort()
      await expect(
        a.tween({ x: 0 }, { x: 1 }, { duration: 1, signal: ctrl.signal }),
      ).rejects.toThrow(/Aborted/)
    })

    it('rejects with AbortError when signal fires mid-tween', async () => {
      const a = new Animator()
      const ctrl = new AbortController()
      const p = a.tween(
        { x: 0 },
        { x: 1 },
        { duration: 1, signal: ctrl.signal },
      )
      a.tick(0.3)
      ctrl.abort()
      await expect(p).rejects.toMatchObject({ name: 'AbortError' })
    })

    it('warns on overlapping tweens on the same target key', () => {
      const a = new Animator()
      const target = { x: 0 }
      const warnings: string[] = []
      const origWarn = console.warn
      console.warn = (...args: unknown[]): void => {
        warnings.push(args.join(' '))
      }
      try {
        void a.tween(target, { x: 100 }, { duration: 1 })
        void a.tween(target, { x: 200 }, { duration: 1 })
      } finally {
        console.warn = origWarn
      }
      expect(warnings.some((w) => /overlapping tween/i.test(w))).toBe(true)
    })
  })

  describe('listener lifetime (no leaks on natural completion)', () => {
    it('removes its abort listener when the tween completes normally', async () => {
      const a = new Animator()
      const ctrl = new AbortController()
      const signal = ctrl.signal
      let added = 0
      let removed = 0
      const origAdd = signal.addEventListener.bind(signal)
      const origRemove = signal.removeEventListener.bind(signal)
      signal.addEventListener = ((type: string, ...args: unknown[]): void => {
        if (type === 'abort') added++
        return (origAdd as unknown as (...args: unknown[]) => void)(
          type,
          ...args,
        )
      }) as typeof signal.addEventListener
      signal.removeEventListener = ((
        type: string,
        ...args: unknown[]
      ): void => {
        if (type === 'abort') removed++
        return (origRemove as unknown as (...args: unknown[]) => void)(
          type,
          ...args,
        )
      }) as typeof signal.removeEventListener

      const N = 200
      const promises: Promise<void>[] = []
      const target = { x: 0 }
      for (let i = 0; i < N; i++) {
        promises.push(a.tween(target, { x: 1 }, { duration: 0, signal }))
      }
      // duration=0: first tick completes them all.
      a.tick(1)
      await Promise.all(promises)
      expect(added).toBe(N)
      expect(removed).toBe(N)
    })
  })

  describe('wait', () => {
    it('resolves after `duration` of ticked time', async () => {
      const a = new Animator()
      const p = a.wait(0.3)
      a.tick(0.15)
      let settled = false
      p.then(() => (settled = true))
      await Promise.resolve()
      expect(settled).toBe(false)
      a.tick(0.15)
      await p
      expect(true).toBe(true) // resolved
    })

    it('rejects immediately when the signal is already aborted', async () => {
      const a = new Animator()
      const ctrl = new AbortController()
      ctrl.abort()
      await expect(a.wait(1, ctrl.signal)).rejects.toMatchObject({
        name: 'AbortError',
      })
    })
  })

  describe('cancelAll', () => {
    it('rejects every outstanding animation with AbortError', async () => {
      const a = new Animator()
      const p1 = a.wait(1)
      const p2 = a.tween({ x: 0 }, { x: 1 }, { duration: 1 })
      a.cancelAll()
      await expect(p1).rejects.toMatchObject({ name: 'AbortError' })
      await expect(p2).rejects.toMatchObject({ name: 'AbortError' })
    })
  })

  describe('in-place tick scratch (P6)', () => {
    it('a tween spawned during an onTick fires on the NEXT tick, not this one', () => {
      // Documented contract: records added during their own tick's onTick
      // are picked up on the following tick, not the current one. In-place
      // scratch must preserve this.
      const a = new Animator()
      const outer = { x: 0 }
      const inner = { y: 0 }
      let innerStarted = false
      a.tween(
        outer,
        { x: 100 },
        {
          duration: 1,
          easing: linear,
          onUpdate: () => {
            // Spawn a second tween from inside the first's onUpdate, only
            // once, at the first tick where x has moved.
            if (!innerStarted && outer.x > 0) {
              innerStarted = true
              void a.tween(inner, { y: 50 }, { duration: 1, easing: linear })
            }
          },
        },
      )
      a.tick(0.5) // outer.x becomes 50; inner tween is added but should NOT tick this frame
      expect(outer.x).toBeCloseTo(50, 5)
      expect(inner.y).toBe(0) // added mid-tick, waits for next tick
      a.tick(0.5) // inner tween now runs its first tick with dt=0.5
      expect(inner.y).toBeCloseTo(25, 5)
    })

    it('warns on reentrant tick (an onTick that recurses back into tick)', () => {
      const a = new Animator()
      const warnings: string[] = []
      const origWarn = console.warn
      console.warn = (...args: unknown[]): void => {
        warnings.push(args.join(' '))
      }
      let didRecurse = false
      try {
        void a.tween(
          { x: 0 },
          { x: 1 },
          {
            duration: 1,
            easing: linear,
            onUpdate: () => {
              // Recursively tick ONCE from inside an onUpdate, pathological,
              // and the reentrant tick would infinitely retrigger this same
              // handler without the guard.
              if (!didRecurse) {
                didRecurse = true
                a.tick(0)
              }
            },
          },
        )
        a.tick(0.5)
      } finally {
        console.warn = origWarn
      }
      expect(warnings.some((w) => /reentrant/i.test(w))).toBe(true)
    })

    it('cancelAll during tick rejects records that had not yet ticked', async () => {
      // Regression guard: while iterating the snapshot, if cancelAll() runs,
      // the remaining snapshot records must still reject cleanly and not
      // double-resolve.
      const a = new Animator()
      let firstTicked = false
      const p1 = a.tween(
        { x: 0 },
        { x: 1 },
        {
          duration: 1,
          easing: linear,
          onUpdate: () => {
            if (!firstTicked) {
              firstTicked = true
              a.cancelAll()
            }
          },
        },
      )
      const p2 = a.tween({ y: 0 }, { y: 1 }, { duration: 1, easing: linear })
      a.tick(0.5)
      await expect(p1).rejects.toMatchObject({ name: 'AbortError' })
      await expect(p2).rejects.toMatchObject({ name: 'AbortError' })
    })
  })
})
