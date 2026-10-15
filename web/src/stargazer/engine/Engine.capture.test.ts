import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Engine } from './Engine'
import { CAPTURE_IDLE_RELEASE_SEC } from './SceneCapture'
import { MockGfxDevice } from '../render/gfx/webgl2/mockGfxDevice'
import { LayoutRoot } from '../layout/LayoutRoot'
import { TextNode } from '../nodes/TextNode'
import type { Stage } from '../render/Stage'
import { Layer } from '../scene/Layer'
import { ShapeNode } from '../nodes/ShapeNode'
import { postShader } from '../render/postfx/PostEffect'
import type { PostEffect } from '../render/postfx/PostEffect'

const copies = vi.hoisted(() => [] as { width: number; height: number }[])
const rasterFonts = vi.hoisted(() => [] as string[])

// happy-dom has no GPU canvas to read, so the copy returns a stand-in surface.
vi.mock('./captureCopy', () => ({
  copyCanvas: (_canvas: HTMLCanvasElement, width: number, height: number) => {
    copies.push({ width, height })
    return {
      transferToImageBitmap: () => ({ width, height }) as ImageBitmap,
      convertToBlob: async (opts: { type: string }) =>
        new Blob(['image'], { type: opts.type }),
    }
  },
}))

vi.mock('../render/gfx/rasterizeLabel', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../render/gfx/rasterizeLabel')>()
  return {
    ...actual,
    // happy-dom has no 2D rasterizer, so a stand-in raster lets the label
    // cache fill as it would in a browser.
    rasterizeLabel: (...args: Parameters<typeof actual.rasterizeLabel>) => {
      rasterFonts.push(args[1].font)
      return (
        actual.rasterizeLabel(...args) ?? {
          canvas: document.createElement('canvas'),
          texW: 40,
          texH: 12,
          clamped: false,
          localW: 40,
          localH: 12,
          advance: 40,
          ascent: 9,
          descent: 3,
          anchorOffsetX: 0,
          anchorOffsetY: 9,
        }
      )
    },
  }
})

function makeEngine(): Engine {
  return new Engine({
    canvas: document.createElement('canvas'),
    gpuDevice: new MockGfxDevice(),
  })
}

describe('Engine.capture', () => {
  let engine: Engine
  const originalDpr = window.devicePixelRatio

  beforeEach(() => {
    copies.length = 0
    rasterFonts.length = 0
    Object.defineProperty(window, 'devicePixelRatio', {
      value: 2,
      configurable: true,
    })
    engine = makeEngine()
  })

  afterEach(() => {
    engine.destroy()
    vi.useRealTimers()
    Object.defineProperty(window, 'devicePixelRatio', {
      value: originalDpr,
      configurable: true,
    })
  })

  it('renders at the exact pixel size whatever the pixel ratio', async () => {
    let size: { w: number; h: number } | null = null
    await engine.capture({
      width: 300,
      height: 120,
      gpuDevice: new MockGfxDevice(),
      build: () => {
        size = { ...engine.captureStage!.renderer.pixelSize }
      },
    })
    expect(size).toEqual({ w: 300, h: 120 })
    expect(copies).toEqual([{ width: 300, height: 120 }])
  })

  it('builds the scene before rendering it the settle frames', async () => {
    const events: string[] = []
    await engine.capture({
      width: 10,
      height: 10,
      settleFrames: 3,
      gpuDevice: new MockGfxDevice(),
      build: () => {
        events.push('build')
        const stage = engine.captureStage!
        const render = stage.render.bind(stage)
        vi.spyOn(stage, 'render').mockImplementation((dt) => {
          events.push('render')
          render(dt)
        })
      },
    })
    expect(events).toEqual(['build', 'render', 'render', 'render'])
  })

  it('renders two settle frames by default', async () => {
    let renders = 0
    await engine.capture({
      width: 10,
      height: 10,
      gpuDevice: new MockGfxDevice(),
      build: () => {
        const stage = engine.captureStage!
        const render = stage.render.bind(stage)
        vi.spyOn(stage, 'render').mockImplementation((dt) => {
          renders++
          render(dt)
        })
      },
    })
    expect(renders).toBe(2)
  })

  it('waits for layer effects to compile before taking the image', async () => {
    const effect: PostEffect = {
      enabled: true,
      passes: [
        {
          shader: postShader('', '', '', {
            attributes: [],
            uniformBlocks: [],
            samplers: [],
          }),
          paramsBytes: 0,
          writeParams: () => undefined,
        },
      ],
    }
    const layer = new Layer({
      region: { x: 0, y: 0, width: 10, height: 10 },
      effects: [effect],
    })
    let renders = 0
    await engine.capture({
      width: 10,
      height: 10,
      gpuDevice: new MockGfxDevice(),
      build: (root) => {
        layer.add(
          new ShapeNode({
            geometry: { kind: 'rect', width: 10, height: 10, centered: false },
            fill: '#ff0000',
          }),
        )
        root.add(layer)
        const stage = engine.captureStage!
        const render = stage.render.bind(stage)
        vi.spyOn(stage, 'render').mockImplementation((dt) => {
          renders++
          render(dt)
        })
      },
    })
    // The first frames start the compile and draw the layer without it.
    expect(renders).toBe(4)
    expect(layer.effectsApplied).toBe(true)
  })

  it('encodes a blob of the requested type', async () => {
    const blob = await engine.captureBlob({
      width: 10,
      height: 10,
      type: 'image/jpeg',
      gpuDevice: new MockGfxDevice(),
      build: () => {},
    })
    expect(blob.type).toBe('image/jpeg')
  })

  it('works on an engine whose loop never started', async () => {
    const bitmap = await engine.capture({
      width: 64,
      height: 32,
      gpuDevice: new MockGfxDevice(),
      build: () => {},
    })
    expect(bitmap.width).toBe(64)
  })

  it('keeps the capture stage out of the frame loop', async () => {
    await engine.capture({
      width: 10,
      height: 10,
      gpuDevice: new MockGfxDevice(),
      build: () => {},
    })
    expect(engine.captureStage!.active).toBe(false)
  })

  it('runs layout for the capture scene only', async () => {
    const primaryRoot = new LayoutRoot()
    engine.tree.root.add(primaryRoot)
    const primaryRun = vi.spyOn(primaryRoot, '_runIfDirty')
    let captureRun: ReturnType<typeof vi.spyOn> | null = null
    await engine.capture({
      width: 10,
      height: 10,
      gpuDevice: new MockGfxDevice(),
      build: (root) => {
        const layout = new LayoutRoot()
        root.add(layout)
        captureRun = vi.spyOn(layout, '_runIfDirty')
      },
    })
    expect(captureRun).toHaveBeenCalled()
    expect(primaryRun).not.toHaveBeenCalled()
  })

  it('rasterizes text at its exact size when the size changes between captures', async () => {
    // One frame per capture puts the second capture's first frame right after
    // the first capture's raster, where a label still settling would borrow it.
    const captureText = (fontSize: number) =>
      engine.capture({
        width: 200,
        height: 100,
        settleFrames: 1,
        gpuDevice: new MockGfxDevice(),
        build: (root) => {
          root.add(
            new TextNode({ text: 'points', y: 50, fontSize, fontWeight: 700 }),
          )
        },
      })
    await captureText(20)
    await captureText(26)
    expect(rasterFonts.some((font) => font.includes(' 20px'))).toBe(true)
    expect(rasterFonts.some((font) => font.includes(' 26px'))).toBe(true)
  })

  describe('resources', () => {
    function plainCapture(build: () => void | Promise<void> = () => {}) {
      return engine.capture({
        width: 10,
        height: 10,
        gpuDevice: new MockGfxDevice(),
        build,
      })
    }

    it('reuses one stage for consecutive captures', async () => {
      let first: Stage | null = null
      let second: Stage | null = null
      await plainCapture(() => {
        first = engine.captureStage
      })
      await plainCapture(() => {
        second = engine.captureStage
      })
      expect(second).toBe(first)
    })

    it('destroys the previous scene before the next one', async () => {
      let previous: TextNode | null = null
      await engine.capture({
        width: 10,
        height: 10,
        gpuDevice: new MockGfxDevice(),
        build: (root) => {
          previous = new TextNode({ text: 'a' })
          root.add(previous)
        },
      })
      expect(previous!.isDestroyed).toBe(true)
    })

    it('runs captures one at a time in call order', async () => {
      const events: string[] = []
      let finishFirst!: () => void
      const firstBuild = new Promise<void>((resolve) => {
        finishFirst = resolve
      })
      const first = plainCapture(async () => {
        events.push('first build')
        await firstBuild
        events.push('first built')
      })
      const second = plainCapture(() => {
        events.push('second build')
      })
      await Promise.resolve()
      await Promise.resolve()
      expect(events).toEqual(['first build'])
      finishFirst()
      await Promise.all([first, second])
      expect(events).toEqual(['first build', 'first built', 'second build'])
    })

    it('releases the stage and its device after the idle period', async () => {
      vi.useFakeTimers()
      const device = new MockGfxDevice()
      const destroy = vi.spyOn(device, 'destroy')
      await engine.capture({
        width: 10,
        height: 10,
        gpuDevice: device,
        build: () => {},
      })
      vi.advanceTimersByTime(CAPTURE_IDLE_RELEASE_SEC * 1000 - 1)
      expect(engine.captureStage).not.toBeNull()
      vi.advanceTimersByTime(1)
      expect(engine.captureStage).toBeNull()
      expect(destroy).toHaveBeenCalled()
    })

    it('releases the stage and its device when the engine is destroyed', async () => {
      const device = new MockGfxDevice()
      const destroy = vi.spyOn(device, 'destroy')
      await engine.capture({
        width: 10,
        height: 10,
        gpuDevice: device,
        build: () => {},
      })
      engine.destroy()
      expect(engine.captureStage).toBeNull()
      expect(destroy).toHaveBeenCalled()
      await expect(plainCapture()).rejects.toThrow('engine.destroy()')
    })

    it('releases the stage when the build throws', async () => {
      await expect(
        plainCapture(() => {
          throw new Error('bad scene')
        }),
      ).rejects.toThrow('bad scene')
      expect(engine.captureStage).toBeNull()
    })

    it('releases the stage when a render faults', async () => {
      await expect(
        plainCapture(() => {
          vi.spyOn(engine.captureStage!, 'faulted', 'get').mockReturnValue(true)
        }),
      ).rejects.toThrow('faulted')
      expect(engine.captureStage).toBeNull()
    })
  })
})
