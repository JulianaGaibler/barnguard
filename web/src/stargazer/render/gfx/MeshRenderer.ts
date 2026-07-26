import type {
  GfxDevice,
  Program,
  VBuffer,
  IBuffer,
  Vao,
  Texture,
  IndexType,
  AttribBinding,
} from './GfxDevice'
import type { CameraView3D } from '../../camera/CameraView3D'
import type { Node } from '../../scene/Node'
import type { Node3D } from '../../scene/Node3D'
import {
  MeshNode,
  type MaterialTexture,
  type TextureImage,
  type TextureSampler,
} from '../../nodes/MeshNode'
import { Viewport2DNode } from '../../nodes/Viewport2DNode'
import {
  Light3D,
  DirectionalLight3D,
  PointLight3D,
  SpotLight3D,
} from '../../nodes/Light3D'
import { walkTree } from '../../scene/traverse'
import { mat3, mat3NormalMatrix, type Mat3 } from '../../math/Mat3'
import {
  fitDirectionalOrtho,
  fitSpotPerspective,
  fitPointCubeFace,
  type Aabb,
} from '../../math/shadowFit'
import { vec3, vec3Normalize, type Vec3 } from '../../math/Vec3'
import { mat4TransformPoint, type Mat4 } from '../../math/Mat4'
import { RenderQuality } from '../RenderQuality'
import { Fog } from '../Fog'
import type { ShadowArray, ShadowCube } from './GfxDevice'
import type {
  TextureInspector,
  TextureInspectorSnapshot,
} from './TextureManager'
import meshVertSrc from './webgl2/shaders/mesh.vert.glsl?raw'
import meshFragSrc from './webgl2/shaders/mesh.frag.glsl?raw'
import meshPbrVertSrc from './webgl2/shaders/mesh_pbr.vert.glsl?raw'
import meshPbrFragSrc from './webgl2/shaders/mesh_pbr.frag.glsl?raw'
import shadowDepthVertSrc from './webgl2/shaders/shadow_depth.vert.glsl?raw'
import shadowDepthFragSrc from './webgl2/shaders/shadow_depth.frag.glsl?raw'
import shadowCubeVertSrc from './webgl2/shaders/shadow_cube.vert.glsl?raw'
import shadowCubeFragSrc from './webgl2/shaders/shadow_cube.frag.glsl?raw'

/**
 * The 3D pass's fallback lighting: a single directional light used when the
 * scene has no {@link Light3D} nodes, plus the ambient term applied in every
 * case. Mutate {@link MeshRenderer.light} to retune it.
 */
export interface FallbackLight {
  /**
   * World-space direction the light travels (need not be unit; the shader
   * normalizes).
   */
  direction: [number, number, number]
  /** Light rgb in `0..1`. */
  color: [number, number, number]
  /** Ambient rgb in `0..1`. */
  ambient: [number, number, number]
}

const DEFAULT_LIGHT: FallbackLight = {
  direction: [-0.4, -1, -0.6],
  color: [1, 1, 1],
  ambient: [0.25, 0.25, 0.3],
}

interface GpuMesh {
  posBuf: VBuffer
  normBuf: VBuffer
  uvBuf?: VBuffer
  tangentBuf?: VBuffer
  ibo: IBuffer
  vao: Vao
  indexCount: number
}

/**
 * One material texture tracked for the debug inspector, keyed by image
 * identity.
 */
interface ModelTexEntry {
  /**
   * Material roles this image fills (`baseColor`, `normal`, …); an image may
   * serve more than one.
   */
  roles: Set<string>
  width: number
  height: number
  /**
   * Downscaled preview, decoded lazily from the image's compressed bytes;
   * `null` until decoded.
   */
  preview: HTMLCanvasElement | null
}

/** Longest edge, in pixels, of a model-texture inspector preview. */
const MODEL_PREVIEW_MAX = 128

const LOC_POSITION = 0
const LOC_NORMAL = 1
const LOC_UV = 2
const LOC_TANGENT = 3

/** Fixed size of the PBR shader's light array; excess lights are dropped. */
const MAX_LIGHTS = 8

/** Depth-array layers / `u_shadowMat[]` size (matches the PBR shader). */
const MAX_SHADOW_LAYERS = 4

/** Per-light shadow linkage packed for the shader (see `u_lightShadow`). */
interface ShadowLink {
  /** 1 = depth-array layer, 2 = cube. */
  kind: number
  /** Array layer index (kind 1) or far distance (kind 2). */
  param: number
}

/**
 * Draws the 3D tree through the {@link GfxDevice} seam: a single mesh program,
 * per-mesh GPU buffers uploaded on demand, depth testing, and back-to-front
 * ordering so transparent surfaces blend correctly. {@link MeshNode}s draw their
 * geometry with a lit or unlit material; {@link Viewport2DNode}s draw a shared
 * unit quad textured with their rendered 2D surface.
 *
 * `Stage` owns one instance and calls {@link MeshRenderer.render} once per frame
 * between the framebuffer clear and the 2D layers. GPU resources rebuild on a
 * context-loss/restore. Not part of the public API; use {@link MeshNode},
 * {@link Viewport2DNode}, and {@link World3D}.
 */
export class MeshRenderer {
  readonly #device: GfxDevice
  /** Flat program: `{ lit, color }` meshes, the Viewport2D quad, debug views. */
  #program: Program
  /** Metallic-roughness PBR program for `material.pbr` meshes. */
  #pbrProgram: Program
  /** Depth-only program that renders shadow casters from a light's viewpoint. */
  #shadowProgram: Program
  /** Point-light depth program: writes linear distance-to-light per cube face. */
  #cubeProgram: Program
  #cache = new WeakMap<MeshNode, GpuMesh>()
  readonly #uploaded = new Set<MeshNode>()
  #quad: GpuMesh
  #whiteTex: Texture
  readonly #offRestore: () => void
  /** Scratch normal matrix, filled per PBR draw. */
  readonly #normalMat: Mat3 = mat3()
  /**
   * GL textures deduped per {@link TextureImage}, sub-keyed by srgb + sampler
   * (the same image sampled two ways yields two textures). Cleared on context
   * loss; images re-decode lazily from their retained bytes.
   */
  #texCache = new WeakMap<TextureImage, Map<string, Texture>>()
  /** Images with an in-flight async re-decode, so we kick it only once. */
  #decoding = new Set<TextureImage>()
  /**
   * Material textures bound since load, for the debug inspector. Keyed by image
   * identity (matching the GPU dedupe), so an image shared across slots or
   * meshes appears once. Debug-only; grows with the set of images the scene has
   * ever drawn.
   */
  readonly #modelTextures = new Map<TextureImage, ModelTexEntry>()
  /** Images with an in-flight preview decode, so it's kicked only once. */
  readonly #previewDecoding = new Set<TextureImage>()
  /** Every GL texture we uploaded, for teardown. */
  #uploadedTextures = new Set<Texture>()
  /** Bumped on each context restore; stale async decodes drop their result. */
  #epoch = 0
  /** Real depth-array shadow map (directional + spot), allocated on first use. */
  #shadowArray: ShadowArray | null = null
  /** Real depth cubemap for the one point-shadow caster (Phase 3). */
  #shadowCube: ShadowCube | null = null
  /** 1×1 stand-ins bound when no real map exists, so the samplers stay valid. */
  #placeholderArray: ShadowArray | null = null
  #placeholderCube: ShadowCube | null = null
  /** Packed `u_shadowMat[MAX_SHADOW_LAYERS]` (16 floats per layer). */
  readonly #shadowMats = new Float32Array(16 * MAX_SHADOW_LAYERS)
  /** This frame's per-light shadow linkage; empty when nothing casts. */
  #shadowByLight = new Map<Light3D, ShadowLink>()
  /** Live quality settings (shadow resolution, anisotropy, softness, …). */
  readonly #quality: RenderQuality
  /** Live distance-fog settings, uploaded to both programs each frame. */
  readonly #fog: Fog
  /** Edge size the shadow array/cube were allocated at; rebuilt on change. */
  #shadowResolution = 0

  /** Fallback directional + ambient, used when the scene has no light nodes. */
  light: FallbackLight = { ...DEFAULT_LIGHT }
  /**
   * Multiplier on {@link PointLight3D}/{@link SpotLight3D} intensity. glTF
   * punctual intensity is physical (candela) and reads dim without image-based
   * lighting; raise this so imported point/spot lights register. Directional
   * lights are unaffected.
   */
  punctualScale = 1

  /** Last-frame draw counts, read by the debug HUD. Reset each `render`. */
  readonly stats = { draws: 0, visible: 0, vertices: 0, triangles: 0 }

  constructor(
    device: GfxDevice,
    quality: RenderQuality = new RenderQuality(),
    fog: Fog = new Fog(),
  ) {
    this.#device = device
    this.#quality = quality
    this.#fog = fog
    this.#program = this.#createProgram()
    this.#pbrProgram = this.#createPbrProgram()
    this.#shadowProgram = this.#createShadowProgram()
    this.#cubeProgram = this.#createCubeProgram()
    this.#quad = this.#createQuad()
    this.#whiteTex = this.#createWhiteTex()
    this.#offRestore = device.onContextRestored(() => this.#onContextRestored())
  }

  #createShadowProgram(): Program {
    return this.#device.createProgram({
      vertexSrc: shadowDepthVertSrc,
      fragmentSrc: shadowDepthFragSrc,
      attribs: { a_position: LOC_POSITION },
    })
  }

  #createCubeProgram(): Program {
    return this.#device.createProgram({
      vertexSrc: shadowCubeVertSrc,
      fragmentSrc: shadowCubeFragSrc,
      attribs: { a_position: LOC_POSITION },
    })
  }

  #createProgram(): Program {
    return this.#device.createProgram({
      vertexSrc: meshVertSrc,
      fragmentSrc: meshFragSrc,
      attribs: { a_position: LOC_POSITION, a_normal: LOC_NORMAL, a_uv: LOC_UV },
    })
  }

  #createPbrProgram(): Program {
    return this.#device.createProgram({
      vertexSrc: meshPbrVertSrc,
      fragmentSrc: meshPbrFragSrc,
      attribs: {
        a_position: LOC_POSITION,
        a_normal: LOC_NORMAL,
        a_uv: LOC_UV,
        a_tangent: LOC_TANGENT,
      },
    })
  }

  /**
   * A 1×1 fallback texture bound to unused PBR map slots and to the flat
   * program's `u_texture`. Its contents are never sampled — the `u_has*` flags
   * (PBR) and `u_useTexture` (flat) gate every read — so it stays
   * uninitialized.
   */
  #createWhiteTex(): Texture {
    return this.#device.createTexture2D({ width: 1, height: 1 })
  }

  #onContextRestored(): void {
    // GPU handles from the lost context are dead. Recreate shared resources and
    // drop the mesh cache; meshes re-upload lazily from CPU geometry next frame.
    this.#program = this.#createProgram()
    this.#pbrProgram = this.#createPbrProgram()
    this.#shadowProgram = this.#createShadowProgram()
    this.#cubeProgram = this.#createCubeProgram()
    this.#quad = this.#createQuad()
    this.#whiteTex = this.#createWhiteTex()
    this.#cache = new WeakMap()
    this.#uploaded.clear()
    // Texture caches share the mesh cache's lifecycle: dropping them re-uploads
    // images lazily, and the epoch bump makes an in-flight decode discard a
    // bitmap destined for the previous context.
    this.#texCache = new WeakMap()
    this.#decoding.clear()
    this.#uploadedTextures.clear()
    this.#epoch++
    // Shadow maps + FBO died with the context; drop the handles and rebuild lazily.
    this.#shadowArray = null
    this.#shadowCube = null
    this.#placeholderArray = null
    this.#placeholderCube = null
    this.#shadowResolution = 0
    this.#shadowByLight.clear()
  }

  /**
   * Draw every visible, ready node under `root`, viewed through `camera`. Sets
   * depth test + back-face culling; the caller restores 2D baseline state
   * afterward via {@link GfxDevice.resetToBaseline}.
   */
  render(camera: CameraView3D, root: Node, debugMode = 0): void {
    this.stats.draws = 0
    this.stats.visible = 0
    this.stats.vertices = 0
    this.stats.triangles = 0
    const drawables: Node3D[] = []
    const lights: Light3D[] = []
    walkTree(root, (n) => {
      // Honor visibility up the whole (possibly cross-kind) ancestor chain, so a
      // 3D node nested under a hidden 2D/group node is culled.
      if (n instanceof MeshNode && n.geometry && isEffectivelyVisible(n))
        drawables.push(n)
      else if (n instanceof Viewport2DNode && isEffectivelyVisible(n))
        drawables.push(n)
      else if (n instanceof Light3D && isEffectivelyVisible(n)) lights.push(n)
    })
    if (drawables.length === 0) return

    const device = this.#device

    // Order back-to-front for correct premultiplied source-over blending.
    const eye = camera.eyePosition()
    const distSq = (m: Node3D): number => {
      const w = m.worldMatrix
      const dx = w[12] - eye.x
      const dy = w[13] - eye.y
      const dz = w[14] - eye.z
      return dx * dx + dy * dy + dz * dz
    }
    // Two buckets: opaque + alpha-MASK first (MASK discards, so it's opaque for
    // depth), then transparent back-to-front. Opaque ordering is irrelevant with
    // depth test on; the blend pass must be sorted for correct compositing.
    const opaque: Node3D[] = []
    const blend: Node3D[] = []
    for (const node of drawables) (isBlended(node) ? blend : opaque).push(node)
    blend.sort((a, b) => distSq(b) - distSq(a))
    const ordered = opaque.concat(blend)
    const blendStart = opaque.length

    device.setDepthTest(true)
    device.setDepthWrite(true)
    device.setCullFace('back')

    // Per-program frame uniforms are set the first time each program is used
    // this frame; they persist on the program across intervening switches.
    let flatReady = false
    let pbrReady = false
    for (let i = 0; i < ordered.length; i++) {
      // Entering the transparent bucket: keep depth-testing against the opaque
      // depth but stop writing, and blend premultiplied source-over.
      if (i === blendStart && blend.length > 0) {
        device.setDepthWrite(false)
        device.setBlend('source-over')
      }
      const node = ordered[i]
      // Double-sided materials draw both faces; everything else back-face culls.
      device.setCullFace(
        node instanceof MeshNode && node.material.doubleSided ? 'none' : 'back',
      )
      if (node instanceof MeshNode && node.material.pbr) {
        if (!pbrReady) {
          this.#beginPbr(camera, eye, debugMode, lights)
          pbrReady = true
        } else {
          device.useProgram(this.#pbrProgram)
        }
        this.#drawMeshPbr(node)
      } else {
        if (!flatReady) {
          this.#beginFlat(camera, eye, debugMode)
          flatReady = true
        } else {
          device.useProgram(this.#program)
        }
        if (node instanceof Viewport2DNode) this.#drawViewport(node)
        else this.#drawMesh(node as MeshNode)
      }
    }

    // Leave depth-write on so the debug-line pass and the 2D baseline don't
    // inherit the transparent bucket's disabled state.
    device.setDepthWrite(true)
  }

  /**
   * Render the shadow-caster depth maps for this frame. The stage calls this as
   * a pre-pass, before its `beginFrame`, so the shadow FBO switch is undone
   * when `beginFrame` rebinds the screen target. It stores per-light shadow
   * state that the following {@link MeshRenderer.render} feeds to the PBR
   * program.
   */
  renderShadows(root: Node): void {
    this.#shadowByLight.clear()
    if (!this.#quality.shadowsEnabled) return
    // Rebuild the maps when the resolution setting changed (recreated lazily at
    // the new size by the ensure helpers below).
    const size = this.#quality.shadowMapSize
    if (size !== this.#shadowResolution) {
      if (this.#shadowArray) this.#device.deleteShadowArray(this.#shadowArray)
      if (this.#shadowCube) this.#device.deleteShadowCube(this.#shadowCube)
      this.#shadowArray = null
      this.#shadowCube = null
      this.#shadowResolution = size
    }
    const casters: MeshNode[] = []
    const lights: Light3D[] = []
    walkTree(root, (n) => {
      if (
        n instanceof MeshNode &&
        n.geometry &&
        !isBlended(n) &&
        isEffectivelyVisible(n)
      ) {
        casters.push(n)
      } else if (
        n instanceof Light3D &&
        n.shadowEnabled &&
        isEffectivelyVisible(n)
      ) {
        lights.push(n)
      }
    })
    if (lights.length === 0 || casters.length === 0) return
    const aabb = this.#castersAABB(casters)
    if (!aabb) return

    let layer = 0
    let rendered = false
    for (const light of lights) {
      if (layer >= MAX_SHADOW_LAYERS) break
      // Directional and spot lights each take one depth-array layer.
      const vp = this.#shadowMatrixFor(light, aabb)
      if (!vp) continue // point lights use the cube (below); others unsupported
      this.#drawShadowLayer(vp, casters, layer)
      this.#shadowMats.set(vp, layer * 16)
      this.#shadowByLight.set(light, { kind: 1, param: layer })
      layer++
      rendered = true
    }
    // One point light casts via a depth cubemap (core WebGL2 has no cube arrays,
    // so only the first shadow-casting point light gets a map).
    const point = lights.find(
      (l): l is PointLight3D => l instanceof PointLight3D,
    )
    if (point) {
      this.#renderPointShadow(point, casters, aabb)
      rendered = true
    }
    if (rendered) this.#device.endShadowPass()
  }

  /** Render all casters into the six faces of the point light's depth cubemap. */
  #renderPointShadow(
    light: PointLight3D,
    casters: MeshNode[],
    aabb: Aabb,
  ): void {
    const device = this.#device
    const cp = this.#cubeProgram
    const w = light.worldMatrix
    const px = w[12]
    const py = w[13]
    const pz = w[14]
    const far =
      light.range > 0 ? light.range : this.#castersFar(aabb, px, py, pz)
    const near = Math.max(0.05, far * 0.005)
    const pos = vec3(px, py, pz)
    const cube = this.#ensurePointCube()
    device.useProgram(cp)
    device.setCullFace('none')
    device.setUniform4f(cp, 'u_lightPos', px, py, pz, 0)
    device.setUniform1f(cp, 'u_far', far)
    for (let face = 0; face < 6; face++) {
      device.beginShadowCubeFace(cube, face)
      // Pad the projection far so geometry at `dist ≈ far` isn't clipped before
      // the fragment shader writes its linear depth.
      device.setUniformMat4(
        cp,
        'u_shadowViewProj',
        fitPointCubeFace(pos, face, near, far * 1.01),
      )
      for (const caster of casters) {
        const gpu = this.#ensureUpload(caster)
        if (!gpu) continue
        device.setUniformMat4(cp, 'u_model', caster.worldMatrix)
        device.bindVao(gpu.vao)
        device.drawElements(gpu.indexCount, 0)
      }
    }
    this.#shadowByLight.set(light, { kind: 2, param: far })
  }

  #ensurePointCube(): ShadowCube {
    if (!this.#shadowCube)
      this.#shadowCube = this.#device.createShadowCube(
        this.#quality.shadowMapSize,
      )
    return this.#shadowCube
  }

  /** Light-space view-projection for a directional/spot caster, or null. */
  #shadowMatrixFor(light: Light3D, aabb: Aabb): Mat4 | null {
    if (light instanceof DirectionalLight3D) {
      return fitDirectionalOrtho(
        aabb,
        this.#lightForward(light),
        this.#quality.shadowMapSize,
        light.shadowMaxDistance,
      )
    }
    if (light instanceof SpotLight3D) {
      const w = light.worldMatrix
      const far =
        light.range > 0
          ? light.range
          : this.#castersFar(aabb, w[12], w[13], w[14])
      return fitSpotPerspective(
        vec3(w[12], w[13], w[14]),
        this.#lightForward(light),
        light.outerConeAngle,
        Math.max(0.05, far * 0.01),
        far,
      )
    }
    return null
  }

  /** Render every caster's depth into one depth-array `layer` from `vp`. */
  #drawShadowLayer(vp: Mat4, casters: MeshNode[], layer: number): void {
    const device = this.#device
    const p = this.#shadowProgram
    device.beginShadowLayer(this.#ensureShadowArray(), layer)
    device.useProgram(p)
    device.setCullFace('none') // bias, not culling, controls acne
    device.setUniformMat4(p, 'u_shadowViewProj', vp)
    for (const caster of casters) {
      const gpu = this.#ensureUpload(caster)
      if (!gpu) continue
      device.setUniformMat4(p, 'u_model', caster.worldMatrix)
      device.bindVao(gpu.vao)
      device.drawElements(gpu.indexCount, 0)
    }
  }

  /**
   * Distance from a point to the farthest corner of `aabb`, for a light's far
   * plane.
   */
  #castersFar(aabb: Aabb, px: number, py: number, pz: number): number {
    let far = 0.1
    for (let i = 0; i < 8; i++) {
      const dx = (i & 1 ? aabb.max.x : aabb.min.x) - px
      const dy = (i & 2 ? aabb.max.y : aabb.min.y) - py
      const dz = (i & 4 ? aabb.max.z : aabb.min.z) - pz
      far = Math.max(far, Math.hypot(dx, dy, dz))
    }
    return far
  }

  /** A light's world-space travel direction (its local −Z axis, normalized). */
  #lightForward(light: Light3D): Vec3 {
    const w = light.worldMatrix
    return vec3Normalize(this.#scratchDir, vec3(-w[8], -w[9], -w[10]))
  }
  readonly #scratchDir: Vec3 = vec3()
  readonly #scratchPt: Vec3 = vec3()

  /** Combined world AABB of the shadow casters, or null if none have bounds. */
  #castersAABB(casters: MeshNode[]): Aabb | null {
    let minX = Infinity,
      minY = Infinity,
      minZ = Infinity
    let maxX = -Infinity,
      maxY = -Infinity,
      maxZ = -Infinity
    let any = false
    for (const c of casters) {
      const b = c.localBounds()
      if (!b) continue
      const w = c.worldMatrix
      for (let i = 0; i < 8; i++) {
        const p = mat4TransformPoint(
          this.#scratchPt,
          w,
          i & 1 ? b.max.x : b.min.x,
          i & 2 ? b.max.y : b.min.y,
          i & 4 ? b.max.z : b.min.z,
        )
        if (p.x < minX) minX = p.x
        if (p.y < minY) minY = p.y
        if (p.z < minZ) minZ = p.z
        if (p.x > maxX) maxX = p.x
        if (p.y > maxY) maxY = p.y
        if (p.z > maxZ) maxZ = p.z
      }
      any = true
    }
    if (!any) return null
    return { min: vec3(minX, minY, minZ), max: vec3(maxX, maxY, maxZ) }
  }

  #ensureShadowArray(): ShadowArray {
    if (!this.#shadowArray) {
      this.#shadowArray = this.#device.createShadowArray(
        this.#quality.shadowMapSize,
        MAX_SHADOW_LAYERS,
      )
    }
    return this.#shadowArray
  }

  /** The array/cube to bind for sampling: the real map, or a 1×1 stand-in. */
  #arrayForBind(): ShadowArray {
    if (this.#shadowArray) return this.#shadowArray
    if (!this.#placeholderArray)
      this.#placeholderArray = this.#device.createShadowArray(1, 1)
    return this.#placeholderArray
  }
  #cubeForBind(): ShadowCube {
    if (this.#shadowCube) return this.#shadowCube
    if (!this.#placeholderCube)
      this.#placeholderCube = this.#device.createShadowCube(1)
    return this.#placeholderCube
  }

  /** Activate the flat program and set its per-frame uniforms (once per frame). */
  #beginFlat(
    camera: CameraView3D,
    eye: { x: number; y: number; z: number },
    debugMode: number,
  ): void {
    const device = this.#device
    const program = this.#program
    device.useProgram(program)
    device.setUniformMat4(program, 'u_viewProj', camera.viewProjection)
    device.setUniform4f(program, 'u_eyePos', eye.x, eye.y, eye.z, 0)
    this.#setFog(program)
    // Debug render view (0 normal, 1 unshaded, 2 normals); one value per frame.
    device.setUniform1f(program, 'u_debugMode', debugMode)
    const l = this.light
    device.setUniform4f(
      program,
      'u_lightDir',
      l.direction[0],
      l.direction[1],
      l.direction[2],
      0,
    )
    device.setUniform4f(
      program,
      'u_lightColor',
      l.color[0],
      l.color[1],
      l.color[2],
      0,
    )
    device.setUniform4f(
      program,
      'u_ambient',
      l.ambient[0],
      l.ambient[1],
      l.ambient[2],
      0,
    )
  }

  /** Activate the PBR program and set its per-frame uniforms (once per frame). */
  #beginPbr(
    camera: CameraView3D,
    eye: { x: number; y: number; z: number },
    debugMode: number,
    lights: Light3D[],
  ): void {
    const device = this.#device
    const p = this.#pbrProgram
    device.useProgram(p)
    device.setUniformMat4(p, 'u_viewProj', camera.viewProjection)
    device.setUniform4f(p, 'u_eyePos', eye.x, eye.y, eye.z, 0)
    device.setUniform1f(p, 'u_debugMode', debugMode)
    this.#setFog(p)
    this.#setLights(p, lights)
    // Shadow maps (real or 1×1 stand-ins) + the packed light-space matrices.
    device.setUniformShadowArray(p, 'u_shadowArray', this.#arrayForBind(), 6)
    device.setUniformShadowCube(p, 'u_shadowCube', this.#cubeForBind(), 7)
    device.setUniform1f(p, 'u_shadowTexel', 1 / this.#quality.shadowMapSize)
    device.setUniform1i(p, 'u_shadowSamples', this.#quality.shadowSoftness)
    device.setUniformMat4Array(p, 'u_shadowMat', this.#shadowMats)
  }

  /**
   * Upload the scene's distance-fog uniforms, shared by both 3D programs.
   * `u_fogColor.w` carries the enable flag (the shader early-outs on 0), and
   * `u_fogParams` packs mode / density / start / end.
   */
  #setFog(p: Program): void {
    const device = this.#device
    const f = this.#fog
    const c = f.color
    device.setUniform4f(p, 'u_fogColor', c[0], c[1], c[2], f.enabled ? 1 : 0)
    device.setUniform4f(
      p,
      'u_fogParams',
      f.mode === 'linear' ? 1 : 0,
      f.density,
      f.start,
      f.end,
    )
  }

  /**
   * Pack the punctual-light uniform array from the scene's {@link Light3D}
   * nodes, reading each node's world matrix (translation → position, −Z column
   * → direction) so lights track animated parents. Ambient always comes from
   * {@link MeshRenderer.light}; with no light nodes, so does a single fallback
   * directional. Lights past {@link MAX_LIGHTS} are dropped.
   */
  #setLights(p: Program, lights: Light3D[]): void {
    const device = this.#device
    const amb = this.light.ambient
    device.setUniform4f(p, 'u_ambient', amb[0], amb[1], amb[2], 0)

    if (lights.length === 0) {
      const l = this.light
      device.setUniform1i(p, 'u_lightCount', 1)
      device.setUniform4f(p, 'u_lightPos[0]', 0, 0, 0, 0) // w = type 0 (directional)
      device.setUniform4f(
        p,
        'u_lightDir[0]',
        l.direction[0],
        l.direction[1],
        l.direction[2],
        0,
      )
      device.setUniform4f(
        p,
        'u_lightColor[0]',
        l.color[0],
        l.color[1],
        l.color[2],
        0,
      )
      device.setUniform4f(p, 'u_lightCone[0]', 0, 0, 0, 0)
      device.setUniform4f(p, 'u_lightShadow[0]', 0, 0, 0, 0) // the fallback casts none
      return
    }

    const n = Math.min(lights.length, MAX_LIGHTS)
    device.setUniform1i(p, 'u_lightCount', n)
    for (let i = 0; i < n; i++) {
      const light = lights[i]
      const w = light.worldMatrix
      let type = 0
      let range = 0
      let gain = 1
      let cosInner = 0
      let cosOuter = 0
      if (light instanceof PointLight3D) {
        type = 1
        range = light.range
        gain = this.punctualScale
      } else if (light instanceof SpotLight3D) {
        type = 2
        range = light.range
        gain = this.punctualScale
        cosInner = Math.cos(light.innerConeAngle)
        cosOuter = Math.cos(light.outerConeAngle)
      }
      // Direction of travel = the node's local −Z axis in world space.
      let dx = -w[8]
      let dy = -w[9]
      let dz = -w[10]
      const len = Math.hypot(dx, dy, dz) || 1
      dx /= len
      dy /= len
      dz /= len
      const c = light.color
      const s = light.intensity * gain
      // A shadow-casting light links to its map here; `u_lightColor.w` carries
      // the shadow opacity (0 = no shadow, so the shader's shadow term is 1).
      const sh = this.#shadowByLight.get(light)
      const opacity = sh ? light.shadowOpacity : 0
      device.setUniform4f(p, `u_lightPos[${i}]`, w[12], w[13], w[14], type)
      device.setUniform4f(p, `u_lightDir[${i}]`, dx, dy, dz, range)
      device.setUniform4f(
        p,
        `u_lightColor[${i}]`,
        c[0] * s,
        c[1] * s,
        c[2] * s,
        opacity,
      )
      device.setUniform4f(p, `u_lightCone[${i}]`, cosInner, cosOuter, 0, 0)
      device.setUniform4f(
        p,
        `u_lightShadow[${i}]`,
        sh ? sh.kind : 0,
        sh ? sh.param : 0,
        light.shadowBias,
        light.shadowNormalBias,
      )
    }
  }

  #drawMesh(mesh: MeshNode): void {
    const gpu = this.#ensureUpload(mesh)
    if (!gpu) return
    const device = this.#device
    const program = this.#program
    device.setUniformMat4(program, 'u_model', mesh.worldMatrix)
    const c = mesh.material.color
    device.setUniform4f(
      program,
      'u_color',
      c[0],
      c[1],
      c[2],
      c[3] * mesh.transform.alpha,
    )
    device.setUniform1f(program, 'u_lit', mesh.material.lit ? 1 : 0)
    device.setUniform1f(program, 'u_useTexture', 0)
    device.setUniformTexture(program, 'u_texture', this.#whiteTex, 0)
    device.bindVao(gpu.vao)
    device.drawElements(gpu.indexCount, 0)
    this.stats.draws++
    this.stats.visible++
    this.stats.vertices += gpu.indexCount
    this.stats.triangles += gpu.indexCount / 3
  }

  #drawMeshPbr(mesh: MeshNode): void {
    const gpu = this.#ensureUpload(mesh)
    if (!gpu) return
    const device = this.#device
    const p = this.#pbrProgram
    const m = mesh.material
    device.setUniformMat4(p, 'u_model', mesh.worldMatrix)
    mat3NormalMatrix(this.#normalMat, mesh.worldMatrix)
    device.setUniformMat3(p, 'u_normalMatrix', this.#normalMat)
    const c = m.color
    device.setUniform4f(
      p,
      'u_baseColorFactor',
      c[0],
      c[1],
      c[2],
      c[3] * mesh.transform.alpha,
    )
    device.setUniform1f(p, 'u_metallicFactor', m.metallicFactor ?? 1)
    device.setUniform1f(p, 'u_roughnessFactor', m.roughnessFactor ?? 1)
    const e = m.emissiveFactor
    device.setUniform4f(
      p,
      'u_emissiveFactor',
      e?.[0] ?? 0,
      e?.[1] ?? 0,
      e?.[2] ?? 0,
      0,
    )
    device.setUniform1f(p, 'u_occlusionStrength', m.occlusionStrength ?? 1)
    device.setUniform1f(p, 'u_normalScale', m.normalScale ?? 1)
    device.setUniform1i(
      p,
      'u_alphaMode',
      m.alphaMode === 'MASK' ? 1 : m.alphaMode === 'BLEND' ? 2 : 0,
    )
    device.setUniform1f(p, 'u_alphaCutoff', m.alphaCutoff ?? 0.5)
    device.setUniform1f(p, 'u_diffuseTransmission', m.diffuseTransmission ?? 0)
    device.setUniform1f(p, 'u_hasTangent', gpu.tangentBuf ? 1 : 0)
    this.#bindMap(p, 'u_baseColorTex', 0, 'u_hasBaseColorTex', m.baseColorTex)
    this.#bindMap(
      p,
      'u_metalRoughTex',
      1,
      'u_hasMetalRoughTex',
      m.metalRoughTex,
    )
    this.#bindMap(p, 'u_normalTex', 2, 'u_hasNormalTex', m.normalTex)
    this.#bindMap(p, 'u_occlusionTex', 3, 'u_hasOcclusionTex', m.occlusionTex)
    this.#bindMap(p, 'u_emissiveTex', 4, 'u_hasEmissiveTex', m.emissiveTex)
    this.#bindMap(
      p,
      'u_diffuseTransmissionTex',
      5,
      'u_hasDiffTransTex',
      m.diffuseTransmissionTex,
    )
    device.bindVao(gpu.vao)
    device.drawElements(gpu.indexCount, 0)
    this.stats.draws++
    this.stats.visible++
    this.stats.vertices += gpu.indexCount
    this.stats.triangles += gpu.indexCount / 3
  }

  /**
   * Bind a material texture slot to `unit` and set its `u_has*` flag. Falls
   * back to the 1×1 texture (flag 0) when the slot is empty or its image hasn't
   * decoded yet (a re-decode is kicked; the map appears within a frame or
   * two).
   */
  #bindMap(
    p: Program,
    samplerName: string,
    unit: number,
    hasName: string,
    slot: MaterialTexture | null | undefined,
  ): void {
    const device = this.#device
    if (slot) this.#trackModelTexture(slot.image, samplerName)
    const tex = slot
      ? this.#ensureTexture(slot.image, slot.srgb, slot.sampler)
      : null
    if (tex) {
      device.setUniformTexture(p, samplerName, tex, unit)
      device.setUniform1f(p, hasName, 1)
    } else {
      device.setUniformTexture(p, samplerName, this.#whiteTex, unit)
      device.setUniform1f(p, hasName, 0)
    }
  }

  /**
   * The GL texture for `image` under a given srgb + sampler, uploading it from
   * the image's decoded bitmap on first use (then closing the bitmap to free
   * the uncompressed pixels — the compressed bytes are kept for re-decode).
   * Returns `null` when the bitmap isn't ready, kicking an async decode.
   */
  #ensureTexture(
    image: TextureImage,
    srgb: boolean,
    sampler: TextureSampler,
  ): Texture | null {
    const key = `${srgb ? 's' : 'l'}|${sampler.wrap}|${sampler.mipmap ? 'm' : 'n'}`
    let variants = this.#texCache.get(image)
    const cached = variants?.get(key)
    if (cached) return cached
    const bmp = image.bitmap
    if (!bmp) {
      this.#decodeImageAsync(image)
      return null
    }
    const device = this.#device
    const tex = device.createTexture2D({
      width: bmp.width,
      height: bmp.height,
      filter: 'linear',
      wrap: sampler.wrap,
      srgb,
      mipmap: sampler.mipmap,
      anisotropy: sampler.mipmap ? this.#quality.anisotropy : 1,
    })
    device.updateTexture2D(tex, bmp, { flipY: false, premultiply: false })
    const tracked = this.#modelTextures.get(image)
    if (tracked) {
      tracked.width = bmp.width
      tracked.height = bmp.height
    }
    // Free the uncompressed bitmap; a second srgb/sampler variant (rare) or a
    // context restore re-decodes from `image.bytes`.
    bmp.close()
    image.bitmap = null
    if (!variants) {
      variants = new Map()
      this.#texCache.set(image, variants)
    }
    variants.set(key, tex)
    this.#uploadedTextures.add(tex)
    return tex
  }

  /**
   * Re-decode an image's compressed bytes to a bitmap for the next frame's
   * upload.
   */
  #decodeImageAsync(image: TextureImage): void {
    if (this.#decoding.has(image) || image.bitmap || !image.bytes) return
    this.#decoding.add(image)
    const epoch = this.#epoch
    const blob = new Blob([image.bytes as BlobPart], { type: image.mimeType })
    void createImageBitmap(blob, {
      premultiplyAlpha: 'none',
      imageOrientation: 'none',
      colorSpaceConversion: 'none',
    }).then(
      (bmp) => {
        this.#decoding.delete(image)
        // Stale when the context was restored mid-decode (epoch moved on).
        if (epoch !== this.#epoch) bmp.close()
        else image.bitmap = bmp
      },
      () => {
        this.#decoding.delete(image)
      },
    )
  }

  /**
   * Read-only view of the model's material textures for the debug inspector, or
   * `null` when none have been bound. These textures live only on the GPU (the
   * uncompressed pixels are freed after upload), so previews decode lazily from
   * each image's retained compressed bytes.
   */
  get textureInspector(): TextureInspector | null {
    return this.#modelTextures.size > 0 ? this.#modelInspector : null
  }

  readonly #modelInspector: TextureInspector = {
    snapshot: () => this.#modelSnapshot(),
    renderLabelPreview: () => null,
  }

  /** Note a material texture (and the role it fills) for the inspector. */
  #trackModelTexture(image: TextureImage, samplerName: string): void {
    const role = samplerName.replace(/^u_/, '').replace(/Tex$/, '')
    let entry = this.#modelTextures.get(image)
    if (!entry) {
      entry = { roles: new Set(), width: 0, height: 0, preview: null }
      this.#modelTextures.set(image, entry)
    }
    entry.roles.add(role)
  }

  /**
   * Build the inspector snapshot: model textures as `perSource`, no atlas or
   * labels.
   */
  #modelSnapshot(): TextureInspectorSnapshot {
    const perSource: TextureInspectorSnapshot['perSource'] = []
    for (const [image, entry] of this.#modelTextures) {
      if (entry.preview) {
        perSource.push({
          width: entry.width,
          height: entry.height,
          source: entry.preview,
          label: [...entry.roles].join(' + '),
        })
      } else {
        this.#decodeModelPreview(image)
      }
    }
    return {
      atlas: {
        width: 0,
        height: 0,
        tileSize: 0,
        capacity: 0,
        used: 0,
        full: false,
        canvas: null,
        bindings: [],
      },
      perSource,
      labels: [],
      labelCount: 0,
      labelCap: 0,
      labelRegensThisFrame: 0,
      labelMaxRegensPerFrame: 0,
    }
  }

  /**
   * Decode an image's compressed bytes to a downscaled preview canvas for the
   * inspector, closing the full-resolution bitmap once copied so only the small
   * canvas stays resident.
   */
  #decodeModelPreview(image: TextureImage): void {
    if (
      this.#previewDecoding.has(image) ||
      !image.bytes ||
      typeof createImageBitmap === 'undefined'
    )
      return
    this.#previewDecoding.add(image)
    const blob = new Blob([image.bytes as BlobPart], { type: image.mimeType })
    void createImageBitmap(blob, {
      imageOrientation: 'none',
      colorSpaceConversion: 'none',
    }).then(
      (bmp) => {
        this.#previewDecoding.delete(image)
        const entry = this.#modelTextures.get(image)
        if (entry) {
          entry.width = bmp.width
          entry.height = bmp.height
          entry.preview = downscaleToCanvas(bmp, MODEL_PREVIEW_MAX)
        }
        bmp.close()
      },
      () => {
        this.#previewDecoding.delete(image)
      },
    )
  }

  #drawViewport(node: Viewport2DNode): void {
    const device = this.#device
    const program = this.#program
    const tex = node.colorTexture ?? this.#whiteTex
    device.setUniformMat4(program, 'u_model', node.worldMatrix)
    // Alpha only; the texture carries the color. `u_useTexture` samples it.
    device.setUniform4f(program, 'u_color', 1, 1, 1, node.transform.alpha)
    device.setUniform1f(program, 'u_lit', 0)
    device.setUniform1f(program, 'u_useTexture', 1)
    device.setUniformTexture(program, 'u_texture', tex, 0)
    device.bindVao(this.#quad.vao)
    device.drawElements(this.#quad.indexCount, 0)
    this.stats.draws++
    this.stats.visible++
    this.stats.vertices += this.#quad.indexCount
    this.stats.triangles += this.#quad.indexCount / 3
  }

  #ensureUpload(mesh: MeshNode): GpuMesh | null {
    const geom = mesh.geometry
    if (!geom) return null
    const existing = this.#cache.get(mesh)
    if (existing) return existing

    const device = this.#device
    const posBuf = device.createVertexBuffer(geom.positions.byteLength)
    device.updateBufferSubData(posBuf, 0, geom.positions)
    const normBuf = device.createVertexBuffer(geom.normals.byteLength)
    device.updateBufferSubData(normBuf, 0, geom.normals)

    const indexType: IndexType =
      geom.indices instanceof Uint32Array ? 'u32' : 'u16'
    const ibo = device.createIndexBuffer(geom.indices.byteLength, indexType)
    device.updateIndexBufferSubData(ibo, 0, geom.indices)

    const attribs: AttribBinding[] = [
      this.#attribN(posBuf, LOC_POSITION, 3),
      this.#attribN(normBuf, LOC_NORMAL, 3),
    ]
    // TEXCOORD_0 and TANGENT feed the PBR program; the flat program ignores the
    // extra attribute locations, so one VAO serves both.
    let uvBuf: VBuffer | undefined
    let tangentBuf: VBuffer | undefined
    if (geom.uvs) {
      uvBuf = device.createVertexBuffer(geom.uvs.byteLength)
      device.updateBufferSubData(uvBuf, 0, geom.uvs)
      attribs.push(this.#attribN(uvBuf, LOC_UV, 2))
    }
    if (geom.tangents) {
      tangentBuf = device.createVertexBuffer(geom.tangents.byteLength)
      device.updateBufferSubData(tangentBuf, 0, geom.tangents)
      attribs.push(this.#attribN(tangentBuf, LOC_TANGENT, 4))
    }

    const vao = device.createVao(this.#pbrProgram, attribs, ibo)
    const gpu: GpuMesh = {
      posBuf,
      normBuf,
      uvBuf,
      tangentBuf,
      ibo,
      vao,
      indexCount: geom.indices.length,
    }
    this.#cache.set(mesh, gpu)
    this.#uploaded.add(mesh)
    return gpu
  }

  /** A tightly-packed, per-vertex float attribute binding at `location`. */
  #attribN(buffer: VBuffer, location: number, size: 2 | 3 | 4): AttribBinding {
    return {
      buffer,
      location,
      size,
      type: 'float',
      normalized: false,
      offset: 0,
      stride: size * 4,
      divisor: 0,
    }
  }

  /** Build the shared textured unit quad (1×1 in local xy, facing +z). */
  #createQuad(): GpuMesh {
    const device = this.#device
    const positions = new Float32Array([
      -0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0,
    ])
    const normals = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1])
    const uvs = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1])
    const indices = new Uint16Array([0, 1, 2, 0, 2, 3])

    const posBuf = device.createVertexBuffer(positions.byteLength)
    device.updateBufferSubData(posBuf, 0, positions)
    const normBuf = device.createVertexBuffer(normals.byteLength)
    device.updateBufferSubData(normBuf, 0, normals)
    const uvBuf = device.createVertexBuffer(uvs.byteLength)
    device.updateBufferSubData(uvBuf, 0, uvs)
    const ibo = device.createIndexBuffer(indices.byteLength, 'u16')
    device.updateIndexBufferSubData(ibo, 0, indices)

    const vao = device.createVao(
      this.#program,
      [
        this.#attribN(posBuf, LOC_POSITION, 3),
        this.#attribN(normBuf, LOC_NORMAL, 3),
        this.#attribN(uvBuf, LOC_UV, 2),
      ],
      ibo,
    )
    return { posBuf, normBuf, uvBuf, ibo, vao, indexCount: indices.length }
  }

  /**
   * Drop a mesh's GPU buffers (e.g. when its node is destroyed or its geometry
   * is replaced). Safe to call for an un-uploaded mesh.
   */
  release(mesh: MeshNode): void {
    const gpu = this.#cache.get(mesh)
    if (!gpu) return
    this.#device.deleteVao(gpu.vao)
    this.#device.deleteBuffer(gpu.posBuf)
    this.#device.deleteBuffer(gpu.normBuf)
    if (gpu.uvBuf) this.#device.deleteBuffer(gpu.uvBuf)
    if (gpu.tangentBuf) this.#device.deleteBuffer(gpu.tangentBuf)
    this.#device.deleteIndexBuffer(gpu.ibo)
    this.#cache.delete(mesh)
    this.#uploaded.delete(mesh)
  }

  /** Release every uploaded mesh, the shared quad, and the program. */
  destroy(): void {
    this.#offRestore()
    for (const mesh of this.#uploaded) this.release(mesh)
    this.#device.deleteVao(this.#quad.vao)
    this.#device.deleteBuffer(this.#quad.posBuf)
    this.#device.deleteBuffer(this.#quad.normBuf)
    if (this.#quad.uvBuf) this.#device.deleteBuffer(this.#quad.uvBuf)
    this.#device.deleteIndexBuffer(this.#quad.ibo)
    for (const tex of this.#uploadedTextures) this.#device.deleteTexture(tex)
    this.#uploadedTextures.clear()
    this.#device.deleteTexture(this.#whiteTex)
    this.#device.deleteProgram(this.#program)
    this.#device.deleteProgram(this.#pbrProgram)
    this.#device.deleteProgram(this.#shadowProgram)
    this.#device.deleteProgram(this.#cubeProgram)
    if (this.#shadowArray) this.#device.deleteShadowArray(this.#shadowArray)
    if (this.#placeholderArray)
      this.#device.deleteShadowArray(this.#placeholderArray)
    if (this.#shadowCube) this.#device.deleteShadowCube(this.#shadowCube)
    if (this.#placeholderCube)
      this.#device.deleteShadowCube(this.#placeholderCube)
    this.#modelTextures.clear()
    this.#previewDecoding.clear()
  }
}

/** Draw a bitmap into a fresh canvas contained within a `max`-px box. */
function downscaleToCanvas(bmp: ImageBitmap, max: number): HTMLCanvasElement {
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bmp.width * scale))
  canvas.height = Math.max(1, Math.round(bmp.height * scale))
  const ctx = canvas.getContext('2d')
  if (ctx) ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height)
  return canvas
}

/**
 * True for surfaces drawn in the transparent bucket: a `BLEND` mesh (its glass
 * fallback included) or a `Viewport2DNode` quad, which composites over the 3D
 * pass. Opaque and alpha-`MASK` meshes stay in the depth-writing opaque
 * bucket.
 */
function isBlended(node: Node3D): boolean {
  if (node instanceof Viewport2DNode) return true
  return node instanceof MeshNode && node.material.alphaMode === 'BLEND'
}

/** True when the node and every ancestor is visible (any kind). */
function isEffectivelyVisible(node: Node): boolean {
  let n: Node | null = node
  while (n) {
    if (!n.visible) return false
    n = n.parent
  }
  return true
}
