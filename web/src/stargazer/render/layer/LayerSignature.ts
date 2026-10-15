/**
 * A list of numbers that describes what a layer would draw this frame, built by
 * pushing one value at a time. Two frames with the same signature draw the same
 * pixels, so a layer that kept its last render can use it again.
 *
 * @remarks
 *   Engine developers: the compose walk fills one per cached layer, in tree
 *   order, with everything the subtree's output depends on. It is a flat
 *   `Float64Array` that grows by doubling and is reused every frame, so
 *   building one allocates nothing at rest.
 */
export class LayerSignature {
  /** The pushed values, valid up to `length`. */
  words = new Float64Array(256)
  length = 0

  /** Start a new signature, dropping the values of the last one. */
  begin(): void {
    this.length = 0
  }

  /** Append one value. */
  push(value: number): void {
    if (this.length === this.words.length) {
      const grown = new Float64Array(this.words.length * 2)
      grown.set(this.words)
      this.words = grown
    }
    this.words[this.length++] = value
  }

  /** Append the six values of an affine matrix. */
  pushAffine(m: {
    a: number
    b: number
    c: number
    d: number
    e: number
    f: number
  }): void {
    this.push(m.a)
    this.push(m.b)
    this.push(m.c)
    this.push(m.d)
    this.push(m.e)
    this.push(m.f)
  }
}

/** Whether the first `lengthA` values of `a` equal the first `lengthB` of `b`. */
export function signaturesEqual(
  a: Float64Array,
  lengthA: number,
  b: Float64Array,
  lengthB: number,
): boolean {
  if (lengthA !== lengthB) return false
  for (let i = 0; i < lengthA; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

/**
 * Copy the first `length` values of `from` into `into`, growing `into` when it
 * is too small, and return the array to keep (`into` or its replacement).
 */
export function copySignature(
  from: Float64Array,
  length: number,
  into: Float64Array,
): Float64Array {
  const target = into.length >= length ? into : new Float64Array(length)
  target.set(from.subarray(0, length))
  return target
}

/** A number that stands for `text`, so a signature can hold a string as a value. */
export function hashString(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

const KEYS = new WeakMap<object, number>()
let nextKey = 1

/**
 * A number that names an object for as long as it lives, so a signature can
 * record which nodes a layer holds, and in what order, as plain values.
 */
export function nodeKey(node: object): number {
  let key = KEYS.get(node)
  if (key === undefined) {
    key = nextKey++
    KEYS.set(node, key)
  }
  return key
}
