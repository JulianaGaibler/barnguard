import { describe, expect, it } from 'vitest'

const shaders = import.meta.glob('/src/**/*.gen.{vert,frag}.glsl', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

// Pixel and cell math goes wrong at the right and bottom edge of a large
// canvas below full float precision, so every generated shader declares it.
describe('generated GLSL', () => {
  it('declares high precision floats and ints', () => {
    const names = Object.keys(shaders)
    expect(names.length).toBeGreaterThan(10)
    for (const name of names) {
      expect(shaders[name], name).toContain('precision highp float;')
      expect(shaders[name], name).toContain('precision highp int;')
      expect(shaders[name], name).not.toMatch(/\b(mediump|lowp)\b/)
    }
  })
})
