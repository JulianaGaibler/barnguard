import { createEngineHost, type EngineHostOptions } from '../engine/EngineHost'
import { CameraNode2D } from '../camera/CameraNode2D'
import { CameraNode3D } from '../camera/CameraNode3D'
import { DirectionalLight3D } from '../nodes/Light3D'
import { MeshNode } from '../nodes/MeshNode'
import {
  createDiscGeometry,
  createPrismGeometry,
  createRoundedQuadGeometry,
} from '../nodes/geometry'
import { Node2D } from '../scene/Node2D'
import { Node3D } from '../scene/Node3D'
import type { Gfx2D } from '../render/gfx/Gfx2D'
import { createTexture } from '../assets/createTexture'
import { rasterizeSvg } from '../assets/rasterizeSvg'
import { quat, quatFromAxisAngle } from '../math/Quat'
import { WebGPUDevice } from '../render/gfx/webgpu/WebGPUDevice'
import type { Node } from '../scene/Node'
import type { DemoFn } from './types'

// Exercises the procedural geometry builders and the runtime texture path, in a
// scene that needs no external assets. Force a backend with `?gfx=webgpu`.
//
// What each piece is here to catch:
//   - ground disc      PBR, receives every shadow below it
//   - 48-side prisms   read as cylinders, side normals tilt with the taper
//   - 3/4/5/6 prisms   low side counts, where a winding bug shows as a hole
//   - rounded quad     a rasterised SVG on geometry-rounded corners, lying flat
//   - 2D stroke        translucent and multi-segment, so it takes the stencil
//                      dedup path
//
// Press T to detach and re-attach the 3D content. A target carries depth or
// stencil, never both, so the stroke is the readout for which one the stage
// currently holds: beaded at every joint while the 3D pass owns the depth
// buffer, and one even band once the last 3D node leaves and the stencil comes
// back. A stage outlives the scenes drawn on it, so that hand-back is what
// stops a 3D scene degrading every 2D scene that follows it.

const CARD_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" width="256" height="388" viewBox="0 0 256 388">
  <rect width="256" height="388" fill="#190607"/>
  <circle cx="80" cy="96" r="26" fill="#ffffff"/>
  <circle cx="176" cy="96" r="26" fill="#ffffff"/>
  <circle cx="80" cy="100" r="13" fill="#190607"/>
  <circle cx="176" cy="100" r="13" fill="#190607"/>
  <text x="128" y="290" font-family="sans-serif" font-size="150"
        font-weight="700" fill="#ffffff" text-anchor="middle">7</text>
</svg>`

/** A translucent multi-segment stroke, drawn over the 3D pass. */
class StrokeOverlayNode extends Node2D {
  readonly #pts = new Float32Array(14)

  constructor() {
    super('stencil-probe')
    this.renderLayer = 'dynamic'
    for (let i = 0; i < 7; i++) {
      this.#pts[i * 2] = 60 + i * 90
      this.#pts[i * 2 + 1] = i % 2 === 0 ? 70 : 130
    }
  }

  override draw(gfx: Gfx2D): void {
    gfx.strokePolyline(this.#pts, 7, {
      color: 'rgba(255,255,255,0.45)',
      width: 26,
      cap: 'round',
      join: 'round',
    })
  }
}

const runDemo: DemoFn = async ({ canvas, signal, attach }) => {
  const wantsWebGPU =
    new URLSearchParams(window.location.search).get('gfx') === 'webgpu'
  let gpuDevice: EngineHostOptions['gpuDevice']
  if (wantsWebGPU) {
    try {
      gpuDevice = await WebGPUDevice.create(canvas)
    } catch (err) {
      console.warn('[demo-shapes3d] WebGPU unavailable, using WebGL2:', err)
    }
  }

  const host = createEngineHost({
    canvas,
    gpuDevice,
    clearColor: '#141018',
    msaaSamples: 4,
    debug: 'hud',
    quality: { shadowsEnabled: true, shadowMapSize: 2048, shadowSoftness: 1 },
  })
  attach?.(host)

  const cardTex = await createTexture(
    await rasterizeSvg(CARD_SVG, { scale: 2 }),
  )

  let table: Node3D | null = null
  let sceneRoot: Node | null = null
  let camera3d: CameraNode3D | null = null

  await host.loadScene((scene) => {
    const root = scene.root
    const group = new Node3D('table')
    root.add(group)
    table = group
    sceneRoot = root

    const ground = new MeshNode(createDiscGeometry({ radius: 6 }), {
      lit: true,
      pbr: true,
      color: [0.86, 0.82, 0.7, 1],
      metallicFactor: 0,
      roughnessFactor: 1,
    })
    group.add(ground)

    // Two buttons, tapered so the side band is not a flat-lit ring.
    for (const x of [-1.6, 1.6]) {
      const button = new MeshNode(
        createPrismGeometry({
          sides: 48,
          radius: 0.9,
          topRadius: 0.78,
          height: 0.34,
        }),
        {
          lit: true,
          pbr: true,
          color: [0.95, 0.95, 0.95, 1],
          metallicFactor: 0,
          roughnessFactor: 0.6,
        },
      )
      button.transform.setPosition(x, 0, 1.6)
      group.add(button)
    }

    // Seat markers, one per low side count.
    const markerColors: Array<[number, number, number, number]> = [
      [0.99, 0.25, 0.25, 1],
      [0.35, 0.78, 0.72, 1],
      [0.82, 0.3, 0.72, 1],
      [0.97, 0.53, 0.09, 1],
    ]
    ;[3, 4, 5, 6].forEach((sides, i) => {
      const marker = new MeshNode(
        createPrismGeometry({ sides, radius: 0.3, height: 0.42 }),
        {
          lit: true,
          pbr: true,
          color: markerColors[i]!,
          metallicFactor: 0,
          roughnessFactor: 0.8,
        },
      )
      marker.transform.setPosition(-2.7 + i * 1.8, 0, -2.4)
      group.add(marker)
    })

    // A card lying flat, face up, rounded by geometry rather than alpha.
    const card = new MeshNode(
      createRoundedQuadGeometry({
        width: 1.28,
        height: 1.94,
        radius: 0.12,
        cornerSegments: 6,
      }),
      {
        lit: true,
        pbr: true,
        color: [1, 1, 1, 1],
        baseColorTex: cardTex,
        metallicFactor: 0,
        roughnessFactor: 1,
      },
    )
    const layFlat = quatFromAxisAngle(quat(), 1, 0, 0, -Math.PI / 2)
    card.transform.setRotation(layFlat.x, layFlat.y, layFlat.z, layFlat.w)
    card.transform.setPosition(0, 0.004, -0.4)
    group.add(card)

    const camera = new CameraNode3D()
    camera.projectionness = 0
    camera.focalDistance = 5
    camera.transform.setPosition(0, 3.2, 6)
    const pitch = quatFromAxisAngle(quat(), 1, 0, 0, -0.49)
    camera.transform.setRotation(pitch.x, pitch.y, pitch.z, pitch.w)
    camera.setAspect(canvas.clientWidth / Math.max(1, canvas.clientHeight))
    group.add(camera)
    camera.makeCurrent()
    camera3d = camera

    const sun = new DirectionalLight3D({
      color: [1, 0.97, 0.92],
      intensity: 2.4,
      shadowEnabled: true,
      shadowOpacity: 0.3,
      shadowNormalBias: 2,
    })
    const sunAim = quatFromAxisAngle(quat(), 1, 0, 0, -1.05)
    sun.transform.setRotation(sunAim.x, sunAim.y, sunAim.z, sunAim.w)
    group.add(sun)

    const fill = new DirectionalLight3D({
      color: [0.5, 0.55, 0.7],
      intensity: 0.6,
    })
    group.add(fill)

    // The 2D layers only draw when a 2D camera is current, and a stage starts
    // with no camera at all. The 2D and 3D cameras are independent, so both are
    // current at once.
    const camera2d = new CameraNode2D()
    camera2d.setViewport({ x: 0, y: 0, width: 1000, height: 560 })
    root.add(camera2d)
    camera2d.makeCurrent()

    root.add(new StrokeOverlayNode())
  })

  host.engine.ambientOcclusion.enabled = true
  host.start()

  // Detaching rather than destroying keeps the meshes and their uploads alive,
  // so the toggle measures the depth/stencil swap and nothing else.
  let attached = true
  const onKey = (e: KeyboardEvent): void => {
    if (e.key !== 't' && e.key !== 'T') return
    if (!table || !sceneRoot) return
    attached = !attached
    if (attached) {
      sceneRoot.add(table)
      camera3d?.makeCurrent()
    } else {
      sceneRoot.remove(table)
    }
    console.info(
      `[demo-shapes3d] 3D content ${attached ? 'attached' : 'detached'}`,
    )
  }
  window.addEventListener('keydown', onKey)

  const stop = (): void => {
    window.removeEventListener('keydown', onKey)
    host.destroy()
  }
  signal.addEventListener('abort', stop, { once: true })
  return stop
}

export default runDemo
