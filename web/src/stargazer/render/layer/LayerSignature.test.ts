import { describe, expect, it } from 'vitest'
import { Node2D } from '../../scene/Node2D'
import {
  LayerSignature,
  copySignature,
  hashString,
  nodeKey,
  signaturesEqual,
} from './LayerSignature'

describe('LayerSignature', () => {
  it('collects values in order and restarts', () => {
    const s = new LayerSignature()
    s.push(1)
    s.push(2)
    expect(Array.from(s.words.subarray(0, s.length))).toEqual([1, 2])
    s.begin()
    s.push(9)
    expect(s.length).toBe(1)
    expect(s.words[0]).toBe(9)
  })

  it('grows past its first allocation without losing values', () => {
    const s = new LayerSignature()
    for (let i = 0; i < 1000; i++) s.push(i)
    expect(s.length).toBe(1000)
    expect(s.words[0]).toBe(0)
    expect(s.words[999]).toBe(999)
  })

  it('appends the six values of an affine', () => {
    const s = new LayerSignature()
    s.pushAffine({ a: 1, b: 2, c: 3, d: 4, e: 5, f: 6 })
    expect(Array.from(s.words.subarray(0, 6))).toEqual([1, 2, 3, 4, 5, 6])
  })
})

describe('signaturesEqual', () => {
  const words = (...v: number[]): Float64Array => Float64Array.from(v)

  it('compares only the used length', () => {
    expect(signaturesEqual(words(1, 2, 3), 2, words(1, 2, 9), 2)).toBe(true)
  })

  it('tells different values and different lengths apart', () => {
    expect(signaturesEqual(words(1, 2), 2, words(1, 3), 2)).toBe(false)
    expect(signaturesEqual(words(1, 2), 2, words(1, 2), 1)).toBe(false)
  })
})

describe('copySignature', () => {
  it('reuses a target that is big enough', () => {
    const into = new Float64Array(8)
    const out = copySignature(Float64Array.from([4, 5, 6]), 3, into)
    expect(out).toBe(into)
    expect(Array.from(out.subarray(0, 3))).toEqual([4, 5, 6])
  })

  it('replaces a target that is too small', () => {
    const into = new Float64Array(1)
    const out = copySignature(Float64Array.from([4, 5, 6]), 3, into)
    expect(out).not.toBe(into)
    expect(Array.from(out)).toEqual([4, 5, 6])
  })
})

describe('hashString', () => {
  it('is stable and tells strings apart', () => {
    expect(hashString('#112233')).toBe(hashString('#112233'))
    expect(hashString('#112233')).not.toBe(hashString('#112234'))
    expect(hashString('')).toBe(hashString(''))
  })
})

describe('nodeKey', () => {
  it('is stable for a node and different between nodes', () => {
    const a = new Node2D()
    const b = new Node2D()
    expect(nodeKey(a)).toBe(nodeKey(a))
    expect(nodeKey(a)).not.toBe(nodeKey(b))
  })
})
