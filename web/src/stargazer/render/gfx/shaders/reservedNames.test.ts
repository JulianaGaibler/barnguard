// WGSL is translated to a platform shading language before it runs: MSL on
// Apple, HLSL on Windows, SPIR-V elsewhere. An identifier that is legal in WGSL
// but reserved in one of those targets produces code that will not compile, and
// only on that platform.
//
// A varying named `half` did exactly that. It is fine in WGSL, but `half` is
// Metal's 16-bit float type, so the generated MSL declared `metal::float2 half`
// and every draw using that pipeline failed on macOS while every other platform
// was unaffected. Translators are supposed to mangle these, and not all of them
// do, so the names are checked here instead of relied upon.

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const DIR = join(import.meta.dirname, '.')

/**
 * Reserved in Metal or HLSL and unsafe as a WGSL struct member or variable.
 * Deliberately narrow: only names that are genuinely reserved, so a failure
 * here always means something.
 */
const RESERVED = new Set([
  // Metal scalar and vector types.
  'half',
  'float',
  'int',
  'uint',
  'short',
  'long',
  'char',
  'bool',
  'void',
  'half2',
  'half3',
  'half4',
  'float2',
  'float3',
  'float4',
  'int2',
  'int3',
  'int4',
  'uint2',
  'uint3',
  'uint4',
  // Metal address spaces and function qualifiers.
  'device',
  'constant',
  'threadgroup',
  'thread',
  'kernel',
  'vertex',
  'fragment',
  'sampler',
  'texture',
  'atomic',
  'access',
  // HLSL types and interpolation modifiers.
  'matrix',
  'vector',
  'sample',
  'linear',
  'centroid',
  'nointerpolation',
  'noperspective',
  'precise',
  'groupshared',
  'inout',
  // C++ carried into MSL.
  'class',
  'struct',
  'template',
  'typename',
  'namespace',
  'operator',
  'public',
  'private',
  'protected',
  'virtual',
  'inline',
  'static',
  'auto',
])

const shaders = readdirSync(DIR).filter((f) => f.endsWith('.wgsl'))

/**
 * Struct member declarations: an optional run of attributes, then `name:`.
 *
 * The attribute run spells out its parentheses rather than allowing spaces in a
 * character class. A looser class lets the regex backtrack into a parse where
 * the attributes swallow the member name and the capture lands somewhere inside
 * the type, which silently matches the wrong identifier.
 */
function memberNames(source: string): { name: string; line: number }[] {
  const out: { name: string; line: number }[] = []
  source.split('\n').forEach((raw, i) => {
    const line = raw.replace(/\/\/.*$/, '')
    const m = /^\s*(?:@[a-zA-Z_]+(?:\([^)]*\))?\s*)*([A-Za-z_]\w*)\s*:/.exec(
      line,
    )
    if (m) out.push({ name: m[1]!, line: i + 1 })
  })
  return out
}

describe('WGSL identifiers are portable', () => {
  it('finds shaders to check', () => {
    expect(shaders.length).toBeGreaterThan(10)
  })

  it.each(shaders)('%s uses no reserved target-language names', (file) => {
    const source = readFileSync(join(DIR, file), 'utf8')
    const offenders = memberNames(source).filter((m) => RESERVED.has(m.name))
    expect(
      offenders.map((o) => `${file}:${o.line} "${o.name}"`),
      'reserved in Metal or HLSL, so the translated shader will not compile',
    ).toEqual([])
  })
})
