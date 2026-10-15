import { createEngineHost } from '../engine/EngineHost'
import { addDemoCamera } from './demoCamera'
import { ShapeNode } from '../nodes/ShapeNode'
import { IOS_CORNER_SMOOTHING } from '../render/gfx/squircle'
import { Path2DNode } from '../nodes/Path2DNode'
import type { GfxShadowStyle } from '../render/gfx/Gfx2D'
import { SHADOW_SIGMA_BUDGETS } from '../render/VectorQuality'
import { flattenSvgPath, tessellateContours } from '../assets/SvgPathContours'
import { registerPathTessellation } from '../render/gfx/PathTessellationRegistry'
import type { DemoFn } from './types'

// Vector sandbox: gradients, border alignment/joins, smooth corners, ellipses,
// and drop shadows (the analytic kind on ShapeNode next to the cached-mask
// kind on Path2DNode, so the two read the same under the same style). `?gfx=webgpu` forces the
// other backend; the HUD's "Path shadows" section is the way to watch the
// mask cache and bake budget respond to the sliders below.

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
    'max-height:calc(100% - 76px)',
    'width:250px',
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
  return { el, destroy: () => el.remove() }
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

function select<T extends string>(
  parent: HTMLElement,
  label: string,
  options: readonly T[],
  initial: T,
  onChange: (v: T) => void,
): void {
  const wrap = document.createElement('label')
  wrap.style.cssText = 'display:block;margin:6px 0'
  const name = document.createElement('div')
  name.textContent = label
  name.style.opacity = '.75'
  const sel = document.createElement('select')
  sel.style.cssText = 'width:100%;margin-top:2px'
  for (const opt of options) {
    const o = document.createElement('option')
    o.value = opt
    o.textContent = opt
    if (opt === initial) o.selected = true
    sel.appendChild(o)
  }
  sel.onchange = () => onChange(sel.value as T)
  wrap.append(name, sel)
  parent.appendChild(wrap)
}

/**
 * A five-point star Path2D, registered for
 * fillPath2D/strokePath2D/shadowPath2D.
 */
function buildStarPath(outerR: number, innerR: number): Path2D {
  const points: string[] = []
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outerR : innerR
    const angle = (Math.PI / 5) * i - Math.PI / 2
    const x = Math.cos(angle) * r
    const y = Math.sin(angle) * r
    points.push(`${i === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`)
  }
  const d = `${points.join(' ')} Z`
  const contours = flattenSvgPath(d, 0.5)
  const path = new Path2D(d)
  registerPathTessellation(path, tessellateContours(contours), contours)
  return path
}

const BORDER_ALIGNS = ['center', 'inside', 'outside'] as const
const BORDER_JOINS: readonly CanvasLineJoin[] = ['miter', 'round', 'bevel']
const BORDER_CAPS: readonly CanvasLineCap[] = ['butt', 'round', 'square']

const runDemo: DemoFn = async ({ canvas, signal, attach }) => {
  const host = createEngineHost({
    canvas,
    clearColor: '#11131a',
  })
  attach?.(host)

  let gradientBox: ShapeNode
  let borderBox: ShapeNode
  let shadowCircle: ShapeNode
  let shadowStar: Path2DNode
  let smoothBox: ShapeNode
  let ellipse: ShapeNode
  let cam: ReturnType<typeof addDemoCamera>
  const smooth = { radius: 24, smoothing: IOS_CORNER_SMOOTHING }
  const ellipseRadii = { x: 60, y: 30 }

  await host.loadScene((scene) => {
    cam = addDemoCamera(scene, { x: -240, y: -150, width: 480, height: 300 })

    gradientBox = new ShapeNode({
      geometry: { kind: 'rect', width: 120, height: 80, radii: 12 },
      fill: {
        kind: 'linear',
        x0: 0,
        y0: -40,
        x1: 0,
        y1: 40,
        stops: [
          { offset: 0, color: '#8f74e7' },
          { offset: 1, color: '#2d2452' },
        ],
      },
    })
    gradientBox.transform.x = -160
    gradientBox.transform.y = -60
    scene.root.add(gradientBox)

    borderBox = new ShapeNode({
      geometry: { kind: 'rect', width: 100, height: 100 },
      fill: '#1c1c22',
      stroke: '#fdf6e3',
      lineWidth: 10,
      lineAlign: 'center',
      lineJoin: 'miter',
      lineCap: 'butt',
    })
    borderBox.transform.x = 0
    borderBox.transform.y = -60
    scene.root.add(borderBox)

    shadowCircle = new ShapeNode({
      geometry: { kind: 'circle', radius: 50 },
      fill: '#36ffb9',
      shadow: { color: 'rgba(0,0,0,0.5)', offsetX: 0, offsetY: 10, blur: 20 },
    })
    shadowCircle.transform.x = 160
    shadowCircle.transform.y = -60
    scene.root.add(shadowCircle)

    const starPath = buildStarPath(50, 22)
    shadowStar = new Path2DNode({
      path: starPath,
      fill: '#ffd34d',
      shadow: { color: 'rgba(0,0,0,0.5)', offsetX: 0, offsetY: 10, blur: 20 },
    })
    shadowStar.transform.x = 160
    shadowStar.transform.y = 110
    scene.root.add(shadowStar)

    smoothBox = new ShapeNode({
      geometry: {
        kind: 'rect',
        width: 110,
        height: 110,
        radii: smooth.radius,
        smoothing: smooth.smoothing,
      },
      fill: '#4a90d9',
      stroke: '#fdf6e3',
      lineWidth: 2,
      shadow: { color: 'rgba(0,0,0,0.5)', offsetY: 8, blur: 24 },
    })
    smoothBox.transform.x = -160
    smoothBox.transform.y = 90
    scene.root.add(smoothBox)

    ellipse = new ShapeNode({
      geometry: {
        kind: 'ellipse',
        radiusX: ellipseRadii.x,
        radiusY: ellipseRadii.y,
      },
      fill: '#d94a8c',
      stroke: '#fdf6e3',
      lineWidth: 3,
    })
    ellipse.transform.y = 90
    scene.root.add(ellipse)
  })

  host.start()

  const quality = host.engine.quality.vector

  const panel = buildPanel((p) => {
    heading(p, 'Gradient')
    slider(p, 'angle (deg)', { min: 0, max: 360, step: 5, value: 90 }, (v) => {
      const rad = (v * Math.PI) / 180
      const dx = Math.cos(rad) * 40
      const dy = Math.sin(rad) * 40
      gradientBox.fill = {
        kind: 'linear',
        x0: -dx,
        y0: -dy,
        x1: dx,
        y1: dy,
        stops: [
          { offset: 0, color: '#8f74e7' },
          { offset: 1, color: '#2d2452' },
        ],
      }
    })

    heading(p, 'Border')
    select(p, 'align', BORDER_ALIGNS, 'center', (v) => {
      borderBox.lineAlign = v
    })
    select(p, 'join', BORDER_JOINS, 'miter', (v) => {
      borderBox.lineJoin = v
    })
    select(p, 'cap', BORDER_CAPS, 'butt', (v) => {
      borderBox.lineCap = v
    })
    toggle(p, 'exactJoins', false, (v) => {
      borderBox.exactJoins = v
    })
    slider(p, 'width', { min: 1, max: 30, step: 1, value: 10 }, (v) => {
      borderBox.lineWidth = v
    })
    slider(p, 'miterLimit', { min: 1, max: 10, step: 0.5, value: 4 }, (v) => {
      borderBox.miterLimit = v
    })

    heading(p, 'Smooth corners')
    const applySmooth = (): void => {
      smoothBox.geometry = {
        kind: 'rect',
        width: 110,
        height: 110,
        radii: smooth.radius,
        smoothing: smooth.smoothing,
      }
    }
    slider(
      p,
      'smoothing (%)',
      { min: 0, max: 100, step: 1, value: 60 },
      (v) => {
        smooth.smoothing = v / 100
        applySmooth()
      },
    )
    slider(
      p,
      'radius',
      { min: 0, max: 55, step: 1, value: smooth.radius },
      (v) => {
        smooth.radius = v
        applySmooth()
      },
    )

    heading(p, 'Ellipse')
    const applyEllipse = (): void => {
      ellipse.geometry = {
        kind: 'ellipse',
        radiusX: ellipseRadii.x,
        radiusY: ellipseRadii.y,
      }
    }
    slider(
      p,
      'radiusX',
      { min: 2, max: 90, step: 1, value: ellipseRadii.x },
      (v) => {
        ellipseRadii.x = v
        applyEllipse()
      },
    )
    slider(
      p,
      'radiusY',
      { min: 2, max: 90, step: 1, value: ellipseRadii.y },
      (v) => {
        ellipseRadii.y = v
        applyEllipse()
      },
    )
    select(p, 'stroke align', BORDER_ALIGNS, 'center', (v) => {
      ellipse.lineAlign = v
    })

    heading(p, 'Shadow (circle = analytic, star = cached mask)')
    const shadow: GfxShadowStyle = {
      color: 'rgba(0,0,0,0.5)',
      offsetX: 0,
      offsetY: 10,
      blur: 20,
      spread: 0,
      inset: false,
    }
    const applyShadow = (): void => {
      const style = { ...shadow }
      shadowCircle.shadow = style
      shadowStar.shadow = style
    }
    slider(p, 'offsetX', { min: -40, max: 40, step: 1, value: 0 }, (v) => {
      shadow.offsetX = v
      applyShadow()
    })
    slider(p, 'offsetY', { min: -40, max: 40, step: 1, value: 10 }, (v) => {
      shadow.offsetY = v
      applyShadow()
    })
    slider(p, 'blur', { min: 0, max: 60, step: 1, value: 20 }, (v) => {
      shadow.blur = v
      applyShadow()
    })
    slider(p, 'spread', { min: -20, max: 20, step: 1, value: 0 }, (v) => {
      shadow.spread = v
      applyShadow()
    })
    toggle(p, 'inset', false, (v) => {
      shadow.inset = v
      applyShadow()
    })

    heading(p, 'quality.vector')
    toggle(p, 'pathShadowsEnabled', quality.pathShadowsEnabled, (v) => {
      quality.pathShadowsEnabled = v
    })
    select(
      p,
      'shadowSigmaBudget',
      SHADOW_SIGMA_BUDGETS.map(String),
      String(quality.shadowSigmaBudget),
      (v) => {
        quality.shadowSigmaBudget = Number(v)
      },
    )
    toggle(p, 'analyticShadowFrame', quality.analyticShadowFrame, (v) => {
      quality.analyticShadowFrame = v
    })
    toggle(p, 'dither', quality.dither, (v) => {
      quality.dither = v
    })

    heading(p, 'Camera')
    slider(p, 'zoom', { min: 0.5, max: 3, step: 0.1, value: 1 }, (v) => {
      const w = 480 / v
      const h = 300 / v
      cam.setViewport({ x: -w / 2, y: -h / 2, width: w, height: h })
    })
  }, canvas)

  const stop = (): void => {
    panel.destroy()
    host.destroy()
  }
  signal.addEventListener('abort', stop, { once: true })
  return stop
}

export default runDemo
