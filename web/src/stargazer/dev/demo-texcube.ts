import { createEngineHost, type EngineHostOptions } from '../engine/EngineHost'
import { CameraNode3D } from '../camera/CameraNode3D'
import { DirectionalLight3D } from '../nodes/Light3D'
import { loadGltf } from '../assets/gltf'
import { quat, quatFromAxisAngle } from '../math/Quat'
import { WebGPUDevice } from '../render/gfx/webgpu/WebGPUDevice'
import type { DemoFn } from './types'

// Texture-orientation diagnostic: a single UV test cube (each face carries a
// distinct, oriented marking) framed head-on, so any mis-sampling on WebGPU
// vs WebGL2 is unambiguous (upside-down = V-flip, mirrored = U-flip, turned =
// rotation/axis-swap). Bright fill lighting so the albedo texture reads
// clearly. Force the backend with `?gfx=webgpu`. Debug HUD on for the fly cam.

const runDemo: DemoFn = async ({ canvas, signal, attach }) => {
  const wantsWebGPU =
    new URLSearchParams(window.location.search).get('gfx') === 'webgpu'
  let gpuDevice: EngineHostOptions['gpuDevice']
  if (wantsWebGPU) {
    try {
      gpuDevice = await WebGPUDevice.create(canvas)
    } catch (err) {
      console.warn('[demo-texcube] WebGPU unavailable, using WebGL2:', err)
    }
  }

  const host = createEngineHost({
    canvas,
    gpuDevice,
    clearColor: '#101418',
    msaaSamples: 4,
    debug: 'hud',
    fog: { enabled: false },
    quality: { shadowsEnabled: false },
  })
  attach?.(host)

  const cube = await loadGltf('/debug/test_cube_cross.glb')

  await host.loadScene((scene) => {
    const root = scene.root
    root.add(cube)

    const camera = new CameraNode3D()
    camera.transform.setPosition(0, 0, 3.2)
    root.add(camera)
    camera.makeCurrent()

    // Even, near-white lighting from the camera side so the albedo dominates
    // and shading doesn't obscure the texture orientation.
    const key = new DirectionalLight3D({ color: [1, 1, 1], intensity: 1.6 })
    root.add(key)
    const fill = new DirectionalLight3D({
      color: [0.7, 0.7, 0.8],
      intensity: 0.8,
    })
    const fillAim = quatFromAxisAngle(quat(), 0, 1, 0, Math.PI)
    fill.transform.setRotation(fillAim.x, fillAim.y, fillAim.z, fillAim.w)
    root.add(fill)
  })

  host.start()

  const stop = (): void => host.destroy()
  signal.addEventListener('abort', stop, { once: true })
  return stop
}

export default runDemo
