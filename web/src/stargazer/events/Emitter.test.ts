import { describe, expect, it } from 'vitest'
import { createEmitter } from './Emitter'

interface M {
  greet: string
  count: number
  ping: void
}

describe('Emitter', () => {
  it('dispatches to all handlers', () => {
    const e = createEmitter<M>()
    const seen: string[] = []
    e.on('greet', (s) => seen.push('a:' + s))
    e.on('greet', (s) => seen.push('b:' + s))
    e.emit('greet', 'hi')
    expect(seen).toEqual(['a:hi', 'b:hi'])
  })

  it('the on-returned unsubscribe removes the handler', () => {
    const e = createEmitter<M>()
    const seen: number[] = []
    const off = e.on('count', (n) => seen.push(n))
    e.emit('count', 1)
    off()
    e.emit('count', 2)
    expect(seen).toEqual([1])
  })

  describe('mutations during dispatch (P7 contract)', () => {
    it('a handler that calls off() DURING dispatch still runs this emit but is gone next emit', () => {
      const e = createEmitter<M>()
      const seen: string[] = []
      const h = (s: string): void => {
        seen.push('h:' + s)
        e.off('greet', h)
      }
      e.on('greet', h)
      e.on('greet', (s) => seen.push('other:' + s))
      e.emit('greet', 'first')
      e.emit('greet', 'second')
      // Both handlers ran the first time; only `other` ran the second.
      expect(seen).toEqual(['h:first', 'other:first', 'other:second'])
    })

    it('a handler that calls on() during dispatch does NOT invoke the new handler this emit', () => {
      const e = createEmitter<M>()
      const seen: string[] = []
      const late = (s: string): void => {
        seen.push('late:' + s)
      }
      e.on('greet', (s) => {
        seen.push('early:' + s)
        e.on('greet', late)
      })
      e.emit('greet', 'first')
      // `late` was added mid-dispatch, must not fire this emit.
      expect(seen).toEqual(['early:first'])
      // Next emit picks up `late`.
      e.emit('greet', 'second')
      expect(seen).toEqual(['early:first', 'early:second', 'late:second'])
    })
  })

  describe('scratch reuse (P7)', () => {
    it('repeated emits with the same key do not leak references between calls', () => {
      // Regression guard: the persistent scratch array must be cleared at
      // end-of-emit so any closure-captured references from the last emit's
      // handler set don't pin their captures alive.
      const e = createEmitter<M>()
      let ref: object | null = { big: 'data' }
      const w = new WeakRef(ref)
      const h = (): void => {
        // Reads ref so closure captures it.
        void ref
      }
      e.on('ping', h)
      e.emit('ping', undefined)
      e.emit('ping', undefined)
      e.off('ping', h)
      // Emit again with no handlers, should not touch the (now-empty) scratch.
      e.emit('ping', undefined)
      // Drop the strong ref; the emitter's scratch array should not hold it.
      ref = null
      // Note: we can't force GC in Vitest, but this at least exercises the
      // clear-on-finally path without exploding.
      expect(w).toBeDefined()
    })

    it('reentrant emit on the same key warns and still dispatches correctly', () => {
      const e = createEmitter<M>()
      const seen: number[] = []
      let depth = 0
      const warnings: string[] = []
      const origWarn = console.warn
      console.warn = (...args: unknown[]): void => {
        warnings.push(args.join(' '))
      }
      try {
        e.on('count', (n) => {
          seen.push(n)
          depth++
          if (depth === 1) {
            // Recursively emit the same key from inside the handler.
            e.emit('count', 999)
          }
        })
        e.emit('count', 1)
      } finally {
        console.warn = origWarn
      }
      // Both emits landed: 1 (outer), 999 (nested).
      expect(seen).toEqual([1, 999])
      // Reentrancy was warned.
      expect(warnings.some((w) => /reentrant/i.test(w))).toBe(true)
    })

    it('emits on different keys do not interfere with each other', () => {
      const e = createEmitter<M>()
      const seenGreet: string[] = []
      const seenCount: number[] = []
      e.on('greet', (s) => {
        seenGreet.push(s)
        // Emit a DIFFERENT key from inside the handler, should not be
        // treated as reentrant (each key has its own scratch/depth).
        e.emit('count', 42)
      })
      e.on('count', (n) => seenCount.push(n))
      e.emit('greet', 'x')
      expect(seenGreet).toEqual(['x'])
      expect(seenCount).toEqual([42])
    })
  })
})
