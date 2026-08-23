import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * The WebGL2 reflection carries a binding NUMBER but no group: the backend
 * calls `gl.uniformBlockBinding(program, idx, binding)`, so the number is the
 * GL binding point directly. Two blocks in one shader sharing a number bind
 * over each other, and the loser silently reads all zeros. When the loser is
 * `Frame`, every vertex lands at the origin and the shader draws nothing at
 * all, with no error anywhere.
 *
 * Nothing else catches this. It type-checks, it lints, and WebGPU is fine
 * because groups keep the numbers apart there.
 */
const HERE = dirname(fileURLToPath(import.meta.url))

interface Reflection {
  uniformBlocks: { binding: number; glslName: string }[]
  samplers: { binding: number; glslName: string }[]
}

const files = readdirSync(HERE).filter((f) => f.endsWith('.reflect.json'))

describe('shader reflection', () => {
  it('finds reflection sidecars to check', () => {
    expect(files.length).toBeGreaterThan(0)
  })

  it.each(files)('%s gives each uniform block a unique binding', (file) => {
    const r = JSON.parse(readFileSync(join(HERE, file), 'utf8')) as Reflection
    // One block can legitimately appear twice, once per stage (`Frame` is read
    // by both), so collapse by name before looking for collisions.
    const byName = new Map<string, number>()
    for (const b of r.uniformBlocks) byName.set(b.glslName, b.binding)

    const owners = new Map<number, string[]>()
    for (const [name, binding] of byName) {
      // naga emits `<Struct>_block_<n><Stage>`, numbering the block per stage,
      // so one WGSL block read by both stages yields two different GLSL names.
      // Reduce to the struct name to compare blocks rather than emissions.
      const base = name.replace(/_block_\d+(Vertex|Fragment|Compute)?$/, '')
      const list = owners.get(binding) ?? []
      if (!list.includes(base)) list.push(base)
      owners.set(binding, list)
    }
    for (const [binding, names] of owners) {
      expect(names, `binding ${binding} shared in ${file}`).toHaveLength(1)
    }
  })
})
