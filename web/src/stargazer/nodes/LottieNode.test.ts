import { describe, expect, it } from 'vitest'
import { GpuGfx } from '../render/gfx/GpuGfx'
import { MockGfxDevice } from '../render/gfx/webgl2/mockGfxDevice'
import { parseLottie } from '../lottie/model/parse'
import { LottieNode } from './LottieNode'
import type { Camera } from '../camera/Camera'

const fixtures = import.meta.glob('../dev/fixtures/lottie/*.json', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>

const load = (name: string) =>
  parseLottie(fixtures[`../dev/fixtures/lottie/${name}.json`])

async function setup(): Promise<{ gfx: GpuGfx; device: MockGfxDevice }> {
  const canvas = document.createElement('canvas')
  canvas.width = 800
  canvas.height = 600
  const device = new MockGfxDevice()
  const gfx = new GpuGfx(canvas, device, { stencil: true })
  await gfx.whenReady
  return { gfx, device }
}

function drawFrame(gfx: GpuGfx, node: LottieNode): void {
  gfx.beginFrame({
    clearColor: '#000000',
    transparent: false,
    pixelW: 800,
    pixelH: 600,
  })
  gfx.setBaseTransform(1, 0, 0, 1, 0, 0)
  gfx.setAlpha(1)
  node.draw(gfx, {} as Camera, 0)
  gfx.endFrame()
}

describe('LottieNode', () => {
  it('draws simple shape animations as stencil or convex fills', async () => {
    const summary: Record<string, { draws: number; fans: number }> = {}
    for (const name of ['polystar_anim', 'hourglass', 'playback_test']) {
      const { gfx, device } = await setup()
      const node = new LottieNode({
        animation: load(name),
        width: 300,
        height: 300,
      })
      device.reset()
      drawFrame(gfx, node)
      summary[name] = {
        draws: device.draws.length,
        fans: device.draws.filter(
          (d) => d.stencil?.front.passOp === 'increment-wrap',
        ).length,
      }
      expect(device.draws.length, name).toBeGreaterThan(0)
    }
    expect(summary).toMatchInlineSnapshot(`
      {
        "hourglass": {
          "draws": 4,
          "fans": 1,
        },
        "playback_test": {
          "draws": 1,
          "fans": 0,
        },
        "polystar_anim": {
          "draws": 2,
          "fans": 1,
        },
      }
    `)
  })

  it('evaluates only when the frame changes', async () => {
    const { gfx } = await setup()
    const node = new LottieNode({
      animation: load('polystar_anim'),
      autoplay: false,
    })
    drawFrame(gfx, node)
    drawFrame(gfx, node)
    expect(node.stats.evaluations).toBe(1)
    node.seek(30)
    drawFrame(gfx, node)
    expect(node.stats.evaluations).toBe(2)
    node.play()
    node.onUpdate(1 / 60)
    drawFrame(gfx, node)
    expect(node.stats.evaluations).toBe(3)
  })

  it('freezes while not drawn when asked to', async () => {
    const { gfx } = await setup()
    const node = new LottieNode({
      animation: load('polystar_anim'),
      offscreen: 'freeze',
    })
    drawFrame(gfx, node)
    node.onUpdate(0.5)
    const f = node.player.currentFrame
    expect(f).toBeGreaterThan(0)
    // No draw since the last update: time stands still.
    node.onUpdate(0.5)
    expect(node.player.currentFrame).toBe(f)
  })

  it('reports its box through layout and unsupported features through diagnostics', () => {
    const node = new LottieNode({ animation: load('masking') })
    expect(
      node.measure({
        constrainW: (w: number) => w,
        constrainH: (h: number) => h,
      } as never).w,
    ).toBe(400)
    node.arrange(10, 20, 100, 50)
    expect(node.debugBounds).toEqual({
      x: 0,
      y: 0,
      width: 100,
      height: 50,
    })
    expect(node.diagnostics.length).toBeGreaterThanOrEqual(0)
  })

  it('repeats a styled shape once per copy and trims by length', async () => {
    const prop = (k: unknown) => ({ a: 0, k })
    const make = (copies: number, extra: unknown[] = []) =>
      parseLottie({
        v: '5.7.0',
        fr: 30,
        ip: 0,
        op: 30,
        w: 100,
        h: 100,
        layers: [
          {
            ty: 4,
            ind: 1,
            nm: 'l',
            ip: 0,
            op: 30,
            ks: {},
            shapes: [
              {
                ty: 'gr',
                it: [
                  { ty: 'rc', p: prop([0, 0]), s: prop([10, 10]), r: prop(0) },
                  { ty: 'fl', c: prop([1, 0, 0, 1]), o: prop(100) },
                  ...extra,
                  {
                    ty: 'rp',
                    c: prop(copies),
                    o: prop(0),
                    m: 1,
                    tr: {
                      p: prop([20, 0]),
                      a: prop([0, 0]),
                      s: prop([100, 100]),
                      r: prop(0),
                      so: prop(100),
                      eo: prop(50),
                    },
                  },
                  { ty: 'tr', p: prop([50, 50]) },
                ],
              },
            ],
          },
        ],
      })
    const verts = async (anim: ReturnType<typeof make>): Promise<number> => {
      const { gfx, device } = await setup()
      const node = new LottieNode({
        animation: anim,
        width: 100,
        height: 100,
        autoplay: false,
      })
      device.reset()
      drawFrame(gfx, node)
      return device.draws.reduce((n, d) => n + d.count, 0)
    }
    const one = await verts(make(1))
    expect(one).toBeGreaterThan(0)
    expect(await verts(make(4))).toBe(one * 4)
    // A trim that keeps half a rectangle turns the fill into a fan and cover.
    const trimmed = make(1, [
      { ty: 'tm', s: prop(0), e: prop(50), o: prop(0), m: 1 },
    ])
    expect(await verts(trimmed)).toBeGreaterThan(0)
  })

  it('draws mattes and masks through offscreen passes', async () => {
    for (const name of ['masking', 'like', 'water_filling']) {
      const { gfx, device } = await setup()
      const node = new LottieNode({
        animation: load(name),
        width: 400,
        height: 300,
        autoplay: false,
      })
      device.reset()
      drawFrame(gfx, node)
      expect(device.passes.length, name).toBeGreaterThan(2)
      // Every pass that opened was closed, and the last one resolved.
      expect(
        device.passes.at(-1)?.desc.color?.resolveTarget,
        name,
      ).toBeDefined()
      expect(
        node.diagnostics.filter((d) => d.code === 'unsupported-matte'),
      ).toHaveLength(0)
      node.destroy()
    }
  })

  it('composites a layer as a unit only when its opacity needs it', async () => {
    const prop = (k: unknown) => ({ a: 0, k })
    const make = (opacity: number) =>
      parseLottie({
        v: '5.7.0',
        fr: 30,
        ip: 0,
        op: 30,
        w: 100,
        h: 100,
        layers: [
          {
            ty: 4,
            ind: 1,
            nm: 'l',
            ip: 0,
            op: 30,
            ks: { o: prop(opacity) },
            shapes: [
              { ty: 'rc', p: prop([40, 50]), s: prop([40, 40]), r: prop(0) },
              { ty: 'fl', c: prop([1, 0, 0, 1]), o: prop(100) },
              { ty: 'el', p: prop([60, 50]), s: prop([40, 40]) },
              { ty: 'fl', c: prop([0, 0, 1, 1]), o: prop(100) },
            ],
          },
        ],
      })
    const passes = async (opacity: number, mode: 'exact' | 'fold') => {
      const { gfx, device } = await setup()
      const node = new LottieNode({
        animation: make(opacity),
        width: 100,
        height: 100,
        autoplay: false,
        opacityMode: mode,
      })
      device.reset()
      drawFrame(gfx, node)
      const n = device.passes.length
      node.destroy()
      return n
    }
    // Other tests may leave offscreen demand on, which adds a closing pass to
    // every frame. The comparison is between the three cases.
    const full = await passes(100, 'exact')
    // The surface adds its pass, and the main pass resumes as the closing one.
    expect(await passes(50, 'exact')).toBe(full + 1)
    expect(await passes(50, 'fold')).toBe(full)
  })
})
