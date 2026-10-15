import type { Node2D } from '../../scene/Node2D'

/** The values of a node's paint properties, per instance. */
const values = new WeakMap<object, Record<string, unknown>>()
/** Prototypes that already have an accessor for a name. */
const installed = new WeakMap<object, Set<string>>()

/**
 * Declare the properties a node's `paint` draws from, and give them their first
 * values. Writing one marks the node for repaint when the value changed (by
 * `Object.is`), including a write by a tween.
 *
 * Call it in the constructor, with the fields declared `declare` and no
 * initializer. A class field with an initializer (`openAmount = 1`) defines an
 * own property on the instance, which hides the accessor, so the write never
 * reaches it and the node never repaints. In development it throws when the
 * instance already has an own property of one of these names.
 *
 * Hold primitives, or objects that are replaced rather than changed in place.
 * Changing an object in place keeps its identity, so it is not seen as a
 * change.
 *
 * @example
 *   class EyeNode extends Node2D {
 *     declare openAmount: number
 *     declare lookAtX: number
 *     constructor() {
 *       super()
 *       definePaintProps(this, { openAmount: 1, lookAtX: 0 })
 *     }
 *   }
 *   engine.tween(eye, { openAmount: 0 }, { duration: 0.2 })
 */
export function definePaintProps<
  N extends Node2D,
  P extends Record<string, unknown>,
>(node: N, initial: P): void {
  const proto = Object.getPrototypeOf(node) as object
  let names = installed.get(proto)
  if (!names) {
    names = new Set()
    installed.set(proto, names)
  }
  const store = values.get(node) ?? {}
  values.set(node, store)
  for (const name of Object.keys(initial)) {
    if (Object.prototype.hasOwnProperty.call(node, name)) {
      if (import.meta.env.DEV) {
        throw new Error(
          `definePaintProps: '${name}' is already an own property of ${node.constructor.name}. Declare it with 'declare ${name}: ...' and no initializer.`,
        )
      }
      delete (node as unknown as Record<string, unknown>)[name]
    }
    if (!names.has(name)) {
      names.add(name)
      Object.defineProperty(proto, name, {
        configurable: true,
        enumerable: true,
        get(this: object) {
          return values.get(this)![name]
        },
        set(this: Node2D, value: unknown) {
          const own = values.get(this)!
          if (Object.is(own[name], value)) return
          own[name] = value
          this.markNeedsPaint()
        },
      })
    }
    store[name] = initial[name]
  }
}
