import { createEngineHost, type EngineHostOptions } from '../engine/EngineHost'
import { loadGltf } from '../assets/gltf'
import { CameraNode3D } from '../camera/CameraNode3D'
import { DirectionalLight3D, PointLight3D } from '../nodes/Light3D'
import { MeshNode, createBoxGeometry } from '../nodes/MeshNode'
import { quat, quatFromAxisAngle } from '../math/Quat'
import { WebGPUDevice } from '../render/gfx/webgpu/WebGPUDevice'
import type { DemoFn } from './types'

// 3D backend test: two glTF models (a diffuse-transmission plant and a
// metallic-roughness refrigerator) on a shadow-catching ground plane, lit by a
// shadow-casting sun plus a warm point light and a cool fill. It exercises mesh
// rendering, PBR, punctual lights, and the shadow pre-pass so the WebGPU
// backend's 3D coordinate handling (clip-Z, front-face winding, shadows) can be
// compared against WebGL2. Force the backend with `?gfx=webgpu`. The debug HUD
// is on so the free-fly camera can inspect from any angle.
//
// The models load from `/debug/*.glb` (a gitignored public/ drop, dev-only).

const runDemo: DemoFn = async ({ canvas, signal, attach }) => {
  const wantsWebGPU =
    new URLSearchParams(window.location.search).get('gfx') === 'webgpu'
  let gpuDevice: EngineHostOptions['gpuDevice']
  if (wantsWebGPU) {
    try {
      gpuDevice = await WebGPUDevice.create(canvas)
    } catch (err) {
      console.warn('[demo-scene3d] WebGPU unavailable, using WebGL2:', err)
    }
  }

  const host = createEngineHost({
    canvas,
    gpuDevice,
    clearColor: '#20242c',
    msaaSamples: 4,
    debug: 'hud',
    quality: { shadowsEnabled: true, shadowMapSize: 2048, shadowSoftness: 9 },
  })
  attach?.(host)

  // loadGltf is async, so resolve the models before building the scene.
  const [plant, fridge] = await Promise.all([
    loadGltf('/debug/DiffuseTransmissionPlant.glb'),
    loadGltf('/debug/CommercialRefrigerator.glb'),
  ])

  await host.loadScene((scene) => {
    const root = scene.root

    // Wide, thin slab at y=0 to catch shadows. PBR so it receives them (the
    // flat shader samples no shadow map).
    const ground = new MeshNode(createBoxGeometry(1), {
      lit: true,
      pbr: true,
      color: [0.55, 0.57, 0.6, 1],
      metallicFactor: 0,
      roughnessFactor: 1,
    })
    ground.transform.setScale(24, 0.2, 24)
    ground.transform.setPosition(0, -0.1, 0)
    root.add(ground)

    fridge.transform.setPosition(1.4, 0, 0)
    root.add(fridge)
    plant.transform.setPosition(-1.2, 0, 0)
    root.add(plant)

    // Camera raised and pitched down toward the models (forward is local -Z).
    const camera = new CameraNode3D()
    camera.transform.setPosition(0, 2.2, 6)
    const pitch = quatFromAxisAngle(quat(), 1, 0, 0, -0.18)
    camera.transform.setRotation(pitch.x, pitch.y, pitch.z, pitch.w)
    camera.setAspect(canvas.clientWidth / Math.max(1, canvas.clientHeight))
    root.add(camera)
    camera.makeCurrent()

    // Key sun (casts shadows), aimed down and forward via its local -Z.
    const sun = new DirectionalLight3D({
      color: [1, 0.96, 0.9],
      intensity: 2.6,
      shadowEnabled: true,
      shadowNormalBias: 2,
    })
    const sunAim = quatFromAxisAngle(quat(), 1, 0, 0, -1.0)
    sun.transform.setRotation(sunAim.x, sunAim.y, sunAim.z, sunAim.w)
    root.add(sun)

    // Cool horizontal fill so shadowed faces aren't black.
    const fill = new DirectionalLight3D({
      color: [0.5, 0.55, 0.7],
      intensity: 0.5,
    })
    root.add(fill)

    // Warm point light off to the left to read specular highlights.
    const point = new PointLight3D({
      color: [1, 0.7, 0.3],
      intensity: 6,
      range: 14,
    })
    point.transform.setPosition(-2.5, 3, 3)
    root.add(point)
  })

  host.start()

  const stop = (): void => host.destroy()
  signal.addEventListener('abort', stop, { once: true })
  return stop
}

export default runDemo
