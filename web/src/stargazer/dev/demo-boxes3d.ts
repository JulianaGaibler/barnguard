import { createEngineHost, type EngineHostOptions } from '../engine/EngineHost'
import { CameraNode3D } from '../camera/CameraNode3D'
import { DirectionalLight3D } from '../nodes/Light3D'
import { MeshNode, createBoxGeometry } from '../nodes/MeshNode'
import { quat, quatFromAxisAngle } from '../math/Quat'
import { WebGPUDevice } from '../render/gfx/webgpu/WebGPUDevice'
import type { DemoFn } from './types'

// Minimal 3D diagnostic scene: solid-colour primitive boxes that each isolate
// one variable, so a WebGPU-vs-WebGL2 difference points at a specific uniform.
//   - red box    flat + lit         wrong brightness → frame light/ambient
//   - green box  flat + UNLIT       shaded or off-colour → per-object flags/color
//   - blue box   PBR                per-object PBR color / path
//   - white box  floating, lit      casts a shadow on the ground (shadow check)
//   - ground     flat + lit, grey   washed toward the clear color → frame "fog"
// No textures at all, so texture-origin / mipmap issues are out of the picture.
// Boxes sit at distinct x positions, so a wrong model matrix shows as a
// mis-placed box. Force the backend with `?gfx=webgpu`. Debug HUD is on.

const runDemo: DemoFn = async ({ canvas, signal, attach }) => {
  const wantsWebGPU =
    new URLSearchParams(window.location.search).get('gfx') === 'webgpu'
  let gpuDevice: EngineHostOptions['gpuDevice']
  if (wantsWebGPU) {
    try {
      gpuDevice = await WebGPUDevice.create(canvas)
    } catch (err) {
      console.warn('[demo-boxes3d] WebGPU unavailable, using WebGL2:', err)
    }
  }

  const host = createEngineHost({
    canvas,
    gpuDevice,
    clearColor: '#101418',
    msaaSamples: 4,
    debug: 'hud',
    fog: { enabled: false },
    quality: { shadowsEnabled: true, shadowMapSize: 2048, shadowSoftness: 9 },
  })
  attach?.(host)

  await host.loadScene((scene) => {
    const root = scene.root

    // PBR so the ground receives shadows (the flat shader samples none).
    const ground = new MeshNode(createBoxGeometry(1), {
      lit: true,
      pbr: true,
      color: [0.5, 0.5, 0.5, 1],
      metallicFactor: 0,
      roughnessFactor: 1,
    })
    ground.transform.setScale(16, 0.2, 16)
    ground.transform.setPosition(0, -0.1, 0)
    root.add(ground)

    const redLit = new MeshNode(createBoxGeometry(1), {
      lit: true,
      color: [0.9, 0.2, 0.2, 1],
    })
    redLit.transform.setPosition(-2.5, 0.5, 0)
    root.add(redLit)

    const greenUnlit = new MeshNode(createBoxGeometry(1), {
      lit: false,
      color: [0.2, 0.8, 0.3, 1],
    })
    greenUnlit.transform.setPosition(0, 0.5, 0)
    root.add(greenUnlit)

    const bluePbr = new MeshNode(createBoxGeometry(1), {
      lit: true,
      pbr: true,
      color: [0.2, 0.4, 0.9, 1],
      metallicFactor: 0,
      roughnessFactor: 0.5,
    })
    bluePbr.transform.setPosition(2.5, 0.5, 0)
    root.add(bluePbr)

    // Floating white box, up off the ground so its shadow reads clearly.
    const floater = new MeshNode(createBoxGeometry(1), {
      lit: true,
      color: [0.95, 0.95, 0.95, 1],
    })
    floater.transform.setPosition(0, 2.5, -1)
    root.add(floater)

    const camera = new CameraNode3D()
    camera.transform.setPosition(0, 3, 8)
    const pitch = quatFromAxisAngle(quat(), 1, 0, 0, -0.28)
    camera.transform.setRotation(pitch.x, pitch.y, pitch.z, pitch.w)
    camera.setAspect(canvas.clientWidth / Math.max(1, canvas.clientHeight))
    root.add(camera)
    camera.makeCurrent()

    const sun = new DirectionalLight3D({
      color: [1, 0.97, 0.92],
      intensity: 2.4,
      shadowEnabled: true,
      shadowNormalBias: 2,
    })
    const sunAim = quatFromAxisAngle(quat(), 1, 0, 0, -1.1)
    sun.transform.setRotation(sunAim.x, sunAim.y, sunAim.z, sunAim.w)
    root.add(sun)

    const fill = new DirectionalLight3D({
      color: [0.45, 0.5, 0.65],
      intensity: 0.4,
    })
    root.add(fill)
  })

  host.start()

  const stop = (): void => host.destroy()
  signal.addEventListener('abort', stop, { once: true })
  return stop
}

export default runDemo
