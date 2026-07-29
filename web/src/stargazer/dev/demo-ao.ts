import { createEngineHost, type EngineHostOptions } from '../engine/EngineHost'
import { CameraNode3D } from '../camera/CameraNode3D'
import { DirectionalLight3D } from '../nodes/Light3D'
import { MeshNode, createBoxGeometry } from '../nodes/MeshNode'
import { quat, quatFromAxisAngle } from '../math/Quat'
import { WebGPUDevice } from '../render/gfx/webgpu/WebGPUDevice'
import type { DemoFn } from './types'

// Ambient-occlusion torture scene: geometry arranged so AO is obvious when it
// works and its absence is obvious when it doesn't. Everything is the same matte
// off-white so shading reads as pure occlusion, lit by one soft overhead sun so
// concave areas are ambient-dominated (where AO lives).
//   - a room corner (floor + two walls) — the inside seams should darken
//   - a big block wedged into the corner — deep contact darkening on every seam
//   - a stack of two boxes — a dark band where they meet
//   - boxes with shrinking gaps — AO deepens as the gap closes
//   - a lone box on open floor — a soft contact shadow at its base only
//   - a box floating above open floor — a soft AO disc on the floor DIRECTLY
//     BELOW it. This is the Y-flip check: run `?gfx=webgpu` and confirm the disc
//     sits under the box (not offset above/to the side). A mirrored AO buffer on
//     one backend puts it on the wrong side — invert the generate-flip if so.
// Toggle AO in the debug HUD (Rendering → 3D → Ambient occlusion) to A/B it, and
// crank intensity/radius there. Force the backend with `?gfx=webgpu`.

const WHITE: [number, number, number, number] = [0.82, 0.82, 0.8, 1]

const runDemo: DemoFn = async ({ canvas, signal, attach }) => {
  const wantsWebGPU =
    new URLSearchParams(window.location.search).get('gfx') === 'webgpu'
  let gpuDevice: EngineHostOptions['gpuDevice']
  if (wantsWebGPU) {
    try {
      gpuDevice = await WebGPUDevice.create(canvas)
    } catch (err) {
      console.warn('[demo-ao] WebGPU unavailable, using WebGL2:', err)
    }
  }

  const host = createEngineHost({
    canvas,
    gpuDevice,
    clearColor: '#2a2e36',
    msaaSamples: 4,
    debug: 'hud',
    fog: { enabled: false },
    quality: { shadowsEnabled: true, shadowMapSize: 2048, shadowSoftness: 9 },
  })
  attach?.(host)

  await host.loadScene((scene) => {
    const root = scene.root

    const box = (
      sx: number,
      sy: number,
      sz: number,
      x: number,
      y: number,
      z: number,
    ): void => {
      // PBR (matte white) so the directional light below actually drives it —
      // flat meshes ignore scene lights and use a fixed full-strength fallback,
      // which would wash out the ambient term AO modulates.
      const n = new MeshNode(createBoxGeometry(1), {
        lit: true,
        pbr: true,
        color: WHITE,
        metallicFactor: 0,
        roughnessFactor: 1,
      })
      n.transform.setScale(sx, sy, sz)
      n.transform.setPosition(x, y, z)
      root.add(n)
    }

    // Room: floor + back wall + right wall meeting in a corner at (+7, 0, -7),
    // kept on the right so the top-left debug HUD never covers the showcase.
    box(14, 0.4, 14, 0, -0.2, 0) // floor, top at y = 0
    box(14, 7, 0.4, 0, 3.5, -7) // back wall
    box(0.4, 7, 14, 7, 3.5, 0) // right wall

    // Big block wedged into the corner: seams with floor + both walls.
    box(3, 3, 3, 5.3, 1.5, -5.3)

    // Stack of two unit boxes — a dark contact band where they meet.
    box(1, 1, 1, 2, 0.5, -5)
    box(1, 1, 1, 2, 1.5, -5)

    // Boxes with shrinking gaps: 0.4 → 0.2 → 0.05. AO deepens as they close.
    box(1, 1, 1, -1, 0.5, -5)
    box(1, 1, 1, -2.4, 0.5, -5) // gap 0.4
    box(1, 1, 1, -3.6, 0.5, -5) // gap 0.2
    box(1, 1, 1, -4.65, 0.5, -5) // gap 0.05

    // Lone box on open floor: only a soft base contact shadow.
    box(1.2, 1.2, 1.2, -3, 0.6, 1)

    // Floating box (0.3-unit gap to the floor, within the AO radius): the Y-flip
    // check. Correct AO draws a soft disc on the floor directly beneath it; a
    // mirrored buffer offsets it. On open floor so nothing else darkens the patch.
    box(1.2, 1.2, 1.2, 1, 0.9, 1)

    // Camera up high on the open side, looking down -Z into the corner so every
    // seam and gap is in frame.
    const camera = new CameraNode3D()
    camera.transform.setPosition(1, 6, 10)
    const pitch = quatFromAxisAngle(quat(), 1, 0, 0, -0.5)
    camera.transform.setRotation(pitch.x, pitch.y, pitch.z, pitch.w)
    camera.setAspect(canvas.clientWidth / Math.max(1, canvas.clientHeight))
    root.add(camera)
    camera.makeCurrent()

    // A steep key light: tops catch it, but the vertical faces, contacts, and
    // the corner interior are lit almost entirely by ambient — which AO
    // modulates — so the darkening reads strongly against the lit tops.
    const sun = new DirectionalLight3D({
      color: [1, 0.98, 0.95],
      intensity: 2.4,
      shadowEnabled: true,
      shadowNormalBias: 2,
    })
    const sunAim = quatFromAxisAngle(quat(), 1, 0, 0, -1.35)
    sun.transform.setRotation(sunAim.x, sunAim.y, sunAim.z, sunAim.w)
    root.add(sun)
  })

  // Strong AO by default so the effect is unmistakable; tune it live in the HUD.
  const ao = host.engine.ambientOcclusion
  ao.enabled = true
  ao.preset = 'high'
  ao.intensity = 4
  ao.radius = 0.6
  ao.directStrength = 0.6

  host.start()

  const stop = (): void => host.destroy()
  signal.addEventListener('abort', stop, { once: true })
  return stop
}

export default runDemo
