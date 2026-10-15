import { createEngineHost, type EngineHostOptions } from '../engine/EngineHost'
import { CameraNode2D } from '../camera/CameraNode2D'
import { ShapeNode } from '../nodes/ShapeNode'
import { Layer } from '../scene/Layer'
import { DualKawaseBlur } from '../render/postfx/effects/DualKawaseBlur'
import { FilmGrain } from '../render/postfx/effects/FilmGrain'
import { WebGPUDevice } from '../render/gfx/webgpu/WebGPUDevice'
import type { DemoFn } from './types'

// Post-fx sandbox. The scene is built to make each effect legible on its own:
// a flat mid-gray field (banding, and the energy check that a blurred flat
// field keeps its value), a hard-edged dark square (blur radius), and
// overlapping saturated circles (grain against both flat and busy areas).
//
// Each effect has its own toggle, so they can be judged one at a time, and
// every parameter is a slider rather than an animation. Force the backend
// with `?gfx=webgpu`.
//
// The panel on the right is a `Layer` with a blur of its own, which processes
// that subtree and nothing else, so it blurs while the rest of the scene stays
// crisp. Start with `?stage=off` to turn the stage-wide effects off and see
// the layer on its own, `?cache=on` to start with the layer's result kept and
// `?animate=on` to start with the bar moving. The layer can keep its rendered result (`cache`), and
// the readout shows how many frames it was drawn from that result. Animating
// the bar changes what the layer draws every frame, so it renders again.

/** Deepest chain the sliders can reach. Warmed up front, see `DualKawaseBlur`. */
const MAX_LEVELS = 6

interface ControlPanel {
  el: HTMLElement
  destroy(): void
}

function buildPanel(
  rows: (parent: HTMLElement) => void,
  canvas: HTMLCanvasElement,
): ControlPanel {
  const el = document.createElement('div')
  el.style.cssText = [
    'position:fixed',
    'top:12px',
    'right:12px',
    // Clear of the demo nav's fixed bottom bar, and below it in z so the bar
    // stays clickable. The debug HUD anchors left, so nothing collides.
    'max-height:calc(100% - 76px)',
    'width:230px',
    'overflow-y:auto',
    'padding:10px',
    'background:rgba(10,12,18,0.85)',
    'border:1px solid rgba(255,255,255,0.15)',
    'border-radius:6px',
    'font:11px/1.5 system-ui,sans-serif',
    'color:#fff',
    'z-index:400',
  ].join(';')
  rows(el)
  ;(canvas.parentElement ?? document.body).appendChild(el)
  return {
    el,
    destroy: () => el.remove(),
  }
}

function heading(parent: HTMLElement, text: string): void {
  const h = document.createElement('div')
  h.textContent = text
  h.style.cssText =
    'margin:10px 0 4px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;opacity:.6'
  parent.appendChild(h)
}

function toggle(
  parent: HTMLElement,
  label: string,
  initial: boolean,
  onChange: (v: boolean) => void,
): void {
  const wrap = document.createElement('label')
  wrap.style.cssText = 'display:flex;gap:6px;align-items:center;margin:4px 0'
  const box = document.createElement('input')
  box.type = 'checkbox'
  box.checked = initial
  box.onchange = () => onChange(box.checked)
  wrap.append(box, document.createTextNode(label))
  parent.appendChild(wrap)
}

function slider(
  parent: HTMLElement,
  label: string,
  opts: { min: number; max: number; step: number; value: number },
  onInput: (v: number) => void,
): void {
  const wrap = document.createElement('label')
  wrap.style.cssText = 'display:block;margin:6px 0'
  const head = document.createElement('div')
  head.style.cssText = 'display:flex;justify-content:space-between'
  const name = document.createElement('span')
  name.textContent = label
  name.style.opacity = '.75'
  const read = document.createElement('span')
  read.style.color = '#60a5fa'
  read.textContent = String(opts.value)
  head.append(name, read)
  const input = document.createElement('input')
  input.type = 'range'
  input.min = String(opts.min)
  input.max = String(opts.max)
  input.step = String(opts.step)
  input.value = String(opts.value)
  input.style.cssText = 'width:100%;margin:0'
  input.oninput = () => {
    const v = parseFloat(input.value)
    read.textContent = String(v)
    onInput(v)
  }
  wrap.append(head, input)
  parent.appendChild(wrap)
}

const runDemo: DemoFn = async ({ canvas, signal, attach }) => {
  const params = new URLSearchParams(window.location.search)
  const wantsWebGPU = params.get('gfx') === 'webgpu'
  const stageOff = params.get('stage') === 'off'
  const cacheOn = params.get('cache') === 'on'
  let gpuDevice: EngineHostOptions['gpuDevice']
  if (wantsWebGPU) {
    try {
      gpuDevice = await WebGPUDevice.create(canvas)
    } catch (err) {
      console.warn('[demo-postfx] WebGPU unavailable, using WebGL2:', err)
    }
  }

  const host = createEngineHost({
    canvas,
    gpuDevice,
    clearColor: '#808080',
  })
  attach?.(host)

  // The panel's own blur. Built at the deepest chain and warmed there, like the
  // stage's, so the slider never drops a frame.
  const panelBlur = new DualKawaseBlur({ levels: MAX_LEVELS })
  panelBlur.levels = 3
  const panel = new Layer({
    id: 'frosted-panel',
    effects: [panelBlur],
    padding: 24,
    cache: cacheOn ? 'raster' : 'none',
  })
  let animate = params.get('animate') === 'on'
  let barNode: ShapeNode | null = null

  await host.loadScene((scene) => {
    const root = scene.root

    root.add(
      new ShapeNode({
        geometry: { kind: 'rect', width: 150, height: 150 },
        fill: '#141414',
      }),
    )
    const blobs: { x: number; y: number; r: number; fill: string }[] = [
      { x: -62, y: -22, r: 48, fill: '#ffd34d' },
      { x: 52, y: 12, r: 58, fill: '#fb2872' },
      { x: 8, y: -52, r: 34, fill: '#36ffb9' },
    ]
    for (const b of blobs) {
      const node = new ShapeNode({
        geometry: { kind: 'circle', radius: b.r },
        fill: b.fill,
      })
      node.transform.x = b.x
      node.transform.y = b.y
      root.add(node)
    }

    // The panel's content: a bar with two discs, off to the right.
    const bar = new ShapeNode({
      geometry: { kind: 'rect', width: 56, height: 90, centered: false },
      fill: '#1f2937',
    })
    bar.transform.x = 98
    bar.transform.y = -45
    panel.add(bar)
    barNode = bar
    for (const [y, fill] of [
      [-18, '#fbbf24'],
      [22, '#60a5fa'],
    ] as const) {
      const disc = new ShapeNode({
        geometry: { kind: 'circle', radius: 14 },
        fill,
      })
      disc.transform.x = 126
      disc.transform.y = y
      panel.add(disc)
    }
    root.add(panel)

    const cam = new CameraNode2D()
    cam.setViewport({ x: -160, y: -90, width: 320, height: 180 })
    root.add(cam)
    cam.makeCurrent()
  })

  // Construct at the deepest chain and warm there, so every shallower level
  // the slider reaches is already compiled and switching never drops a frame.
  const blur = new DualKawaseBlur({ levels: MAX_LEVELS })
  const grain = new FilmGrain({ enabled: false })
  blur.enabled = !stageOff
  host.engine.postProcess.add(blur)
  host.engine.postProcess.add(grain)
  host.engine.postProcess.warm()
  panel.warm()
  blur.levels = 3

  const readout = document.createElement('div')
  readout.style.cssText = 'margin-top:6px;color:#60a5fa'
  let frames = 0
  const offFrame = host.engine.ticker.onFrame(() => {
    frames++
    if (animate && barNode)
      barNode.transform.y = -45 + Math.sin(frames / 20) * 20
  })
  const readoutTimer = setInterval(() => {
    const stats = host.engine.primaryStage
      .cacheStats()
      .find((c) => c.name === 'Layer renders')
    readout.textContent = stats
      ? `kept: ${stats.entries}, drawn from it: ${stats.hits}`
      : 'kept: 0'
  }, 200)

  const controls = buildPanel((p) => {
    heading(p, 'Subtree blur (layer effects)')
    toggle(p, 'enabled', panelBlur.enabled, (v) => (panelBlur.enabled = v))
    toggle(p, 'cache', panel.cache === 'raster', (v) => {
      panel.cache = v ? 'raster' : 'none'
    })
    toggle(p, 'animate the bar', animate, (v) => (animate = v))
    p.appendChild(readout)
    slider(p, 'levels', { min: 1, max: MAX_LEVELS, step: 1, value: 3 }, (v) => {
      panelBlur.levels = v
    })

    heading(p, 'Stage blur')
    toggle(p, 'enabled', blur.enabled, (v) => (blur.enabled = v))
    slider(p, 'levels', { min: 1, max: MAX_LEVELS, step: 1, value: 3 }, (v) => {
      blur.levels = v
    })
    slider(
      p,
      'offset',
      { min: 0.5, max: 8, step: 0.1, value: blur.offset },
      (v) => {
        blur.offset = v
      },
    )

    heading(p, 'Film grain')
    toggle(p, 'enabled', grain.enabled, (v) => (grain.enabled = v))
    slider(
      p,
      'cellPx',
      { min: 1, max: 8, step: 0.5, value: grain.cellPx },
      (v) => {
        grain.cellPx = v
      },
    )
    slider(
      p,
      'density',
      { min: 0, max: 1, step: 0.01, value: grain.density },
      (v) => {
        grain.density = v
      },
    )
    slider(
      p,
      'opacity',
      { min: 0, max: 1, step: 0.01, value: grain.opacity },
      (v) => {
        grain.opacity = v
      },
    )
    slider(p, 'hz', { min: 0, max: 60, step: 1, value: grain.hz }, (v) => {
      grain.hz = v
    })
  }, canvas)

  host.start()

  const stop = (): void => {
    clearInterval(readoutTimer)
    offFrame()
    controls.destroy()
    host.destroy()
  }
  signal.addEventListener('abort', stop, { once: true })
  return stop
}

export default runDemo
