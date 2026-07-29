import type {
  BindGroup,
  BindGroupLayout,
  ColorFormat,
  DepthState,
  GfxDevice,
  IBuffer,
  IndexType,
  Pipeline,
  RenderTarget,
  ShaderModule,
  ShadowArray,
  ShadowCube,
  Texture,
  UBuffer,
  VBuffer,
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
import {
  CAMERA3D_UBO_BINDING,
  MESH_LIGHTS_UBO_BINDING,
  MESH_OBJECT_UBO_BINDING,
  MESH_SHADOW_UBO_BINDING,
} from './batchLayout'
import { UboRing } from './programs/programCommon'
import type { TextureInspector } from './TextureManager'
import { ModelTextureInspector } from './ModelTextureInspector'
import type { ShaderReflection } from './GfxDevice'
import meshWgsl from './shaders/mesh.wgsl?raw'
import meshVertSrc from './shaders/mesh.gen.vert.glsl?raw'
import meshFragSrc from './shaders/mesh.gen.frag.glsl?raw'
import meshReflect from './shaders/mesh.reflect.json'
import meshPbrWgsl from './shaders/mesh_pbr.wgsl?raw'
import meshPbrVertSrc from './shaders/mesh_pbr.gen.vert.glsl?raw'
import meshPbrFragSrc from './shaders/mesh_pbr.gen.frag.glsl?raw'
import meshPbrReflect from './shaders/mesh_pbr.reflect.json'
import shadowDepthWgsl from './shaders/shadow_depth.wgsl?raw'
import shadowDepthVertSrc from './shaders/shadow_depth.gen.vert.glsl?raw'
import shadowDepthFragSrc from './shaders/shadow_depth.gen.frag.glsl?raw'
import shadowDepthReflect from './shaders/shadow_depth.reflect.json'
import shadowCubeWgsl from './shaders/shadow_cube.wgsl?raw'
import shadowCubeVertSrc from './shaders/shadow_cube.gen.vert.glsl?raw'
import shadowCubeFragSrc from './shaders/shadow_cube.gen.frag.glsl?raw'
import shadowCubeReflect from './shaders/shadow_cube.reflect.json'
import gbufferWgsl from './shaders/gbuffer.wgsl?raw'
import gbufferVertSrc from './shaders/gbuffer.gen.vert.glsl?raw'
import gbufferFragSrc from './shaders/gbuffer.gen.frag.glsl?raw'
import gbufferReflect from './shaders/gbuffer.reflect.json'

/**
 * The 3D pass's fallback lighting: a single directional light used when the
 * scene has no {@link Light3D} nodes, plus the ambient term applied in every
 * case. Mutate {@link MeshRenderer.light} to retune it.
 */
export interface FallbackLight {
  direction: [number, number, number]
  color: [number, number, number]
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
  /** Always present (zero-filled when the geometry has no UVs). */
  uvBuf: VBuffer
  /** Always present (zero-filled when the geometry has no tangents). */
  tangentBuf: VBuffer
  ibo: IBuffer
  indexCount: number
  /** Whether the geometry actually had tangents (drives the PBR tangent path). */
  hasTangent: boolean
}

const LOC_POSITION = 0
const LOC_NORMAL = 1
const LOC_UV = 2
const LOC_TANGENT = 3

/** Fixed size of the PBR shader's light array; excess lights are dropped. */
const MAX_LIGHTS = 8
/** Depth-array layers / `u_shadowMat[]` size (matches the PBR shader). */
const MAX_SHADOW_LAYERS = 4

// --- std140 block byte sizes (must match the mesh shaders' UBO blocks) ------
const FLAT_FRAME_BYTES = 208
const FLAT_OBJECT_BYTES = 96
const PBR_FRAME_BYTES = 176
const LIGHTS_BYTES = 656
const SHADOW_FRAME_BYTES = 272
const PBR_OBJECT_BYTES = 224
const SHADOW_CAM_BYTES = 64
const CUBE_CAM_BYTES = 96
const SHADOW_OBJECT_BYTES = 64
// AO G-buffer prepass blocks: frame = view-projection + view (two mat4) +
// near/far (vec4); object = model (one mat4). The view matrix + near/far turn
// window depth into the linear view depth the prepass writes.
const GBUFFER_FRAME_BYTES = 144
const GBUFFER_OBJECT_BYTES = 64

// Texture units (globally unique with the UBO bindings; the WebGL2 backend
// flattens bind groups to these numbers). Flat `u_texture` shares unit 0 with
// the PBR material base slot but they never coexist in one draw.
const U_TEX = 0
const U_AO = 2 // screen-space AO texture in the frame group (sampler at +16 = 18)
const U_SHADOW_ARRAY = 8
const U_SHADOW_CUBE = 9
const U_PBR_TEX_BASE = 10 // baseColor..diffuseTransmission → 10..15

/** Per-light shadow linkage packed for the shader (see `u_lightShadow`). */
interface ShadowLink {
  kind: number
  param: number
}

/**
 * Draws the 3D tree through the {@link GfxDevice} seam: a flat + a PBR pipeline,
 * per-mesh GPU buffers uploaded on demand, per-frame + per-object uniform
 * blocks, and back-to-front ordering so transparent surfaces blend correctly.
 *
 * `Stage` owns one instance and calls {@link MeshRenderer.render} once per frame
 * inside the main render pass, and {@link MeshRenderer.renderShadows} as a
 * depth-only pre-pass. Pipelines pre-warm asynchronously; `Stage` gates the 3D
 * pass on {@link MeshRenderer.ready}.
 */
export class MeshRenderer {
  readonly #device: GfxDevice
  readonly #targetColor: { format: ColorFormat; samples: number }

  #flatShader!: ShaderModule
  #pbrShader!: ShaderModule
  #shadowShader!: ShaderModule
  #cubeShader!: ShaderModule
  #gbufferShader!: ShaderModule
  /** Flat / PBR pipelines keyed by `${cull}|${depthWrite}`. */
  #flatPipelines = new Map<string, Pipeline>()
  #pbrPipelines = new Map<string, Pipeline>()
  #shadowPipeline!: Pipeline
  #cubePipeline!: Pipeline
  #gbufferPipeline!: Pipeline
  #ready = false
  #warmupSeq = 0

  // Bind-group layouts.
  #flatFrameLayout!: BindGroupLayout
  #flatObjectLayout!: BindGroupLayout
  #pbrFrameLayout!: BindGroupLayout
  #pbrObjectLayout!: BindGroupLayout
  #shadowCamLayout!: BindGroupLayout
  #shadowObjectLayout!: BindGroupLayout
  #cubeCamLayout!: BindGroupLayout
  #gbufferFrameLayout!: BindGroupLayout
  #gbufferObjectLayout!: BindGroupLayout

  // Per-frame UBOs + bind groups.
  #flatFrameUbo!: UBuffer
  #flatFrameBindGroup: BindGroup | null = null
  #flatFrameBoundAo: Texture | null = null
  #pbrFrameUbo!: UBuffer
  #lightsUbo!: UBuffer
  #shadowFrameUbo!: UBuffer
  #pbrFrameBindGroup: BindGroup | null = null
  #pbrFrameBoundArray: ShadowArray | null = null
  #pbrFrameBoundCube: ShadowCube | null = null
  #pbrFrameBoundAo: Texture | null = null

  // Screen-space AO state, pushed each frame by the stage before `render`.
  #aoTex: Texture | null = null
  #aoEnabled = false
  #aoPixelW = 0
  #aoPixelH = 0
  #aoDirectStrength = 0
  // Shadow-pass camera UBOs, one slice per layer/face via a dynamic-offset ring.
  // A shared buffer would clobber under WebGPU's deferred submission (every pass
  // would read the last-written matrix). The ring gives each pass its own slice.
  #shadowCamRing!: UboRing
  #shadowCamBindGroup!: BindGroup
  #cubeCamRing!: UboRing
  #cubeCamBindGroup!: BindGroup

  // Per-object dynamic-offset rings.
  #flatObjectRing!: UboRing
  #pbrObjectRing!: UboRing
  #shadowObjectRing!: UboRing
  #shadowObjectBindGroup!: BindGroup
  // AO G-buffer prepass: a per-frame UBO + a per-object ring.
  #gbufferFrameUbo!: UBuffer
  #gbufferFrameBindGroup!: BindGroup
  #gbufferObjectRing!: UboRing
  #gbufferObjectBindGroup!: BindGroup

  // Staging buffers for the UBO writes.
  readonly #flatFrameStaging = new Float32Array(FLAT_FRAME_BYTES / 4)
  readonly #flatObjStaging = new Float32Array(FLAT_OBJECT_BYTES / 4)
  readonly #pbrFrameStaging = new Float32Array(PBR_FRAME_BYTES / 4)
  readonly #lightsBuf = new ArrayBuffer(LIGHTS_BYTES)
  readonly #lightsF = new Float32Array(this.#lightsBuf)
  readonly #lightsI = new Int32Array(this.#lightsBuf)
  readonly #shadowFrameStaging = new Float32Array(SHADOW_FRAME_BYTES / 4)
  readonly #pbrObjStaging = new Float32Array(PBR_OBJECT_BYTES / 4)
  readonly #camStaging = new Float32Array(CUBE_CAM_BYTES / 4)
  readonly #objStaging = new Float32Array(SHADOW_OBJECT_BYTES / 4)
  readonly #gbufFrameStaging = new Float32Array(GBUFFER_FRAME_BYTES / 4)
  readonly #gbufObjStaging = new Float32Array(GBUFFER_OBJECT_BYTES / 4)

  #cache = new WeakMap<MeshNode, GpuMesh>()
  readonly #uploaded = new Set<MeshNode>()
  #quad!: GpuMesh
  #whiteTex!: Texture
  readonly #offRestore: () => void
  readonly #normalMat: Mat3 = mat3()
  #texCache = new WeakMap<TextureImage, Map<string, Texture>>()
  #decoding = new Set<TextureImage>()
  readonly #modelInspector = new ModelTextureInspector()
  #uploadedTextures = new Set<Texture>()
  #epoch = 0
  #shadowArray: ShadowArray | null = null
  #shadowCube: ShadowCube | null = null
  #placeholderArray: ShadowArray | null = null
  #placeholderCube: ShadowCube | null = null
  readonly #shadowMats = new Float32Array(16 * MAX_SHADOW_LAYERS)
  #shadowByLight = new Map<Light3D, ShadowLink>()
  readonly #quality: RenderQuality
  readonly #fog: Fog
  #shadowResolution = 0

  light: FallbackLight = { ...DEFAULT_LIGHT }
  punctualScale = 1
  readonly stats = { draws: 0, visible: 0, vertices: 0, triangles: 0 }

  constructor(
    device: GfxDevice,
    targetColor: { format: ColorFormat; samples: number },
    quality: RenderQuality = new RenderQuality(),
    fog: Fog = new Fog(),
  ) {
    this.#device = device
    // Own a private copy: `retarget` mutates this, and the caller may share the
    // object it passed.
    this.#targetColor = { ...targetColor }
    this.#quality = quality
    this.#fog = fog
    this.#createResources()
    this.#offRestore = device.onContextRestored(() => this.#onContextRestored())
  }

  /** Whether the pipelines are warm; `Stage` skips the 3D pass until then. */
  get ready(): boolean {
    return this.#ready
  }

  /**
   * Re-point the color pipelines at a new target color format / sample count
   * and re-warm them. `Stage` calls this after a live MSAA swap so the baked
   * pipeline sample count matches the resized render target. No-op when
   * unchanged. `ready` drops until the async re-warm completes, so `Stage`
   * skips the 3D pass in the meantime. The depth-only shadow pipelines are
   * single-sample and unaffected, but the shared re-warm rebuilds them too.
   */
  retarget(targetColor: { format: ColorFormat; samples: number }): void {
    if (
      this.#targetColor.format === targetColor.format &&
      this.#targetColor.samples === targetColor.samples
    )
      return
    this.#targetColor.format = targetColor.format
    this.#targetColor.samples = targetColor.samples
    void this.#warmup()
  }

  #createResources(): void {
    const device = this.#device
    this.#flatShader = device.createShaderModule({
      glsl: { vertex: meshVertSrc, fragment: meshFragSrc },
      wgsl: {
        code: meshWgsl,
        vertexEntry: 'vs_main',
        fragmentEntry: 'fs_main',
      },
      reflection: meshReflect as ShaderReflection,
      label: 'mesh-flat',
    })
    this.#pbrShader = device.createShaderModule({
      glsl: { vertex: meshPbrVertSrc, fragment: meshPbrFragSrc },
      wgsl: {
        code: meshPbrWgsl,
        vertexEntry: 'vs_main',
        fragmentEntry: 'fs_main',
      },
      reflection: meshPbrReflect as ShaderReflection,
      label: 'mesh-pbr',
    })
    this.#shadowShader = device.createShaderModule({
      glsl: { vertex: shadowDepthVertSrc, fragment: shadowDepthFragSrc },
      wgsl: {
        code: shadowDepthWgsl,
        vertexEntry: 'vs_main',
        fragmentEntry: 'fs_main',
      },
      reflection: shadowDepthReflect as ShaderReflection,
      label: 'shadow-depth',
    })
    this.#cubeShader = device.createShaderModule({
      glsl: { vertex: shadowCubeVertSrc, fragment: shadowCubeFragSrc },
      wgsl: {
        code: shadowCubeWgsl,
        vertexEntry: 'vs_main',
        fragmentEntry: 'fs_main',
      },
      reflection: shadowCubeReflect as ShaderReflection,
      label: 'shadow-cube',
    })
    this.#gbufferShader = device.createShaderModule({
      glsl: { vertex: gbufferVertSrc, fragment: gbufferFragSrc },
      wgsl: {
        code: gbufferWgsl,
        vertexEntry: 'vs_main',
        fragmentEntry: 'fs_main',
      },
      reflection: gbufferReflect as ShaderReflection,
      label: 'ao-gbuffer',
    })

    // Bind-group layouts.
    this.#flatFrameLayout = device.createBindGroupLayout([
      { binding: CAMERA3D_UBO_BINDING, type: 'uniform-buffer' },
      { binding: U_AO, type: 'texture-2d' },
    ])
    this.#flatObjectLayout = device.createBindGroupLayout([
      {
        binding: MESH_OBJECT_UBO_BINDING,
        type: 'uniform-buffer',
        dynamicOffset: true,
      },
      { binding: U_TEX, type: 'texture-2d' },
    ])
    this.#pbrFrameLayout = device.createBindGroupLayout([
      { binding: CAMERA3D_UBO_BINDING, type: 'uniform-buffer' },
      { binding: MESH_LIGHTS_UBO_BINDING, type: 'uniform-buffer' },
      { binding: MESH_SHADOW_UBO_BINDING, type: 'uniform-buffer' },
      { binding: U_AO, type: 'texture-2d' },
      { binding: U_SHADOW_ARRAY, type: 'texture-2d-array-shadow' },
      { binding: U_SHADOW_CUBE, type: 'texture-cube-shadow' },
    ])
    this.#pbrObjectLayout = device.createBindGroupLayout([
      {
        binding: MESH_OBJECT_UBO_BINDING,
        type: 'uniform-buffer',
        dynamicOffset: true,
      },
      ...[0, 1, 2, 3, 4, 5].map((i) => ({
        binding: U_PBR_TEX_BASE + i,
        type: 'texture-2d' as const,
      })),
    ])
    this.#shadowCamLayout = device.createBindGroupLayout([
      {
        binding: CAMERA3D_UBO_BINDING,
        type: 'uniform-buffer',
        dynamicOffset: true,
      },
    ])
    this.#cubeCamLayout = device.createBindGroupLayout([
      {
        binding: CAMERA3D_UBO_BINDING,
        type: 'uniform-buffer',
        dynamicOffset: true,
      },
    ])
    this.#shadowObjectLayout = device.createBindGroupLayout([
      {
        binding: MESH_OBJECT_UBO_BINDING,
        type: 'uniform-buffer',
        dynamicOffset: true,
      },
    ])
    this.#gbufferFrameLayout = device.createBindGroupLayout([
      { binding: CAMERA3D_UBO_BINDING, type: 'uniform-buffer' },
    ])
    this.#gbufferObjectLayout = device.createBindGroupLayout([
      {
        binding: MESH_OBJECT_UBO_BINDING,
        type: 'uniform-buffer',
        dynamicOffset: true,
      },
    ])

    // Per-frame UBOs + stable bind groups.
    this.#flatFrameUbo = device.createUniformBuffer(FLAT_FRAME_BYTES)
    // The flat frame bind group is built lazily in `#beginFlat` so it can bind
    // the current AO texture (or the white fallback) and rebuild when it changes.
    this.#flatFrameBindGroup = null
    this.#flatFrameBoundAo = null
    this.#pbrFrameUbo = device.createUniformBuffer(PBR_FRAME_BYTES)
    this.#lightsUbo = device.createUniformBuffer(LIGHTS_BYTES)
    this.#shadowFrameUbo = device.createUniformBuffer(SHADOW_FRAME_BYTES)
    this.#pbrFrameBindGroup = null
    this.#pbrFrameBoundArray = null
    this.#pbrFrameBoundCube = null
    // One slice per shadow layer / cube face. Slot counts are sized past the
    // real maxima (4 array layers, 6 cube faces) so the ring never overflows.
    this.#shadowCamRing = new UboRing(device, SHADOW_CAM_BYTES, 8, 'shadowCam')
    this.#shadowCamBindGroup = device.createBindGroup(this.#shadowCamLayout, [
      {
        binding: CAMERA3D_UBO_BINDING,
        resource: {
          uniformBuffer: this.#shadowCamRing.buffer,
          size: SHADOW_CAM_BYTES,
        },
      },
    ])
    this.#cubeCamRing = new UboRing(device, CUBE_CAM_BYTES, 8, 'cubeCam')
    this.#cubeCamBindGroup = device.createBindGroup(this.#cubeCamLayout, [
      {
        binding: CAMERA3D_UBO_BINDING,
        resource: {
          uniformBuffer: this.#cubeCamRing.buffer,
          size: CUBE_CAM_BYTES,
        },
      },
    ])

    // Per-object rings.
    this.#flatObjectRing = new UboRing(
      device,
      FLAT_OBJECT_BYTES,
      1024,
      'flatObj',
    )
    this.#pbrObjectRing = new UboRing(device, PBR_OBJECT_BYTES, 1024, 'pbrObj')
    this.#shadowObjectRing = new UboRing(
      device,
      SHADOW_OBJECT_BYTES,
      4096,
      'shadowObj',
    )
    this.#shadowObjectBindGroup = device.createBindGroup(
      this.#shadowObjectLayout,
      [
        {
          binding: MESH_OBJECT_UBO_BINDING,
          resource: {
            uniformBuffer: this.#shadowObjectRing.buffer,
            size: SHADOW_OBJECT_BYTES,
          },
        },
      ],
    )

    // AO G-buffer prepass: one per-frame block, one per-object ring.
    this.#gbufferFrameUbo = device.createUniformBuffer(GBUFFER_FRAME_BYTES)
    this.#gbufferFrameBindGroup = device.createBindGroup(
      this.#gbufferFrameLayout,
      [
        {
          binding: CAMERA3D_UBO_BINDING,
          resource: { uniformBuffer: this.#gbufferFrameUbo },
        },
      ],
    )
    this.#gbufferObjectRing = new UboRing(
      device,
      GBUFFER_OBJECT_BYTES,
      1024,
      'gbufObj',
    )
    this.#gbufferObjectBindGroup = device.createBindGroup(
      this.#gbufferObjectLayout,
      [
        {
          binding: MESH_OBJECT_UBO_BINDING,
          resource: {
            uniformBuffer: this.#gbufferObjectRing.buffer,
            size: GBUFFER_OBJECT_BYTES,
          },
        },
      ],
    )

    this.#quad = this.#createQuad()
    this.#whiteTex = this.#device.createTexture2D({ width: 1, height: 1 })
    void this.#warmup()
  }

  async #warmup(): Promise<void> {
    this.#ready = false
    const seq = ++this.#warmupSeq
    const device = this.#device
    const format = this.#targetColor.format
    const samples = this.#targetColor.samples
    const flatLayout = [this.#flatFrameLayout, this.#flatObjectLayout]
    const pbrLayout = [this.#pbrFrameLayout, this.#pbrObjectLayout]
    for (const cull of ['back', 'none'] as const) {
      for (const write of [true, false]) {
        const depth: DepthState = { test: true, write }
        const key = `${cull}|${write}`
        this.#flatPipelines.set(
          key,
          await device.createPipeline({
            shader: this.#flatShader,
            vertexLayout: this.#flatVertexLayout(),
            bindGroupLayouts: flatLayout,
            color: { format, blend: 'source-over' },
            depth,
            cull,
            frontFace: device.ndc.frontFace,
            primitive: 'triangle-list',
            samples,
            label: `mesh-flat-${key}`,
          }),
        )
        if (seq !== this.#warmupSeq) return
        this.#pbrPipelines.set(
          key,
          await device.createPipeline({
            shader: this.#pbrShader,
            vertexLayout: this.#pbrVertexLayout(),
            bindGroupLayouts: pbrLayout,
            color: { format, blend: 'source-over' },
            depth,
            cull,
            frontFace: device.ndc.frontFace,
            primitive: 'triangle-list',
            samples,
            label: `mesh-pbr-${key}`,
          }),
        )
        if (seq !== this.#warmupSeq) return
      }
    }
    // Depth-only shadow pipelines (no color target).
    this.#shadowPipeline = await device.createPipeline({
      shader: this.#shadowShader,
      vertexLayout: [this.#posLayout()],
      bindGroupLayouts: [this.#shadowCamLayout, this.#shadowObjectLayout],
      color: null,
      depth: { test: true, write: true },
      cull: 'none',
      frontFace: device.ndc.frontFace,
      primitive: 'triangle-list',
      samples: 1,
      label: 'shadow-depth',
    })
    if (seq !== this.#warmupSeq) return
    this.#cubePipeline = await device.createPipeline({
      shader: this.#cubeShader,
      vertexLayout: [this.#posLayout()],
      bindGroupLayouts: [this.#cubeCamLayout, this.#shadowObjectLayout],
      color: null,
      depth: { test: true, write: true },
      cull: 'none',
      frontFace: device.ndc.frontFace,
      primitive: 'triangle-list',
      samples: 1,
      label: 'shadow-cube',
    })
    if (seq !== this.#warmupSeq) return
    // AO G-buffer prepass: single-sample RGBA8 packing view normal (RG) + 16-bit
    // linear depth (BA). No blend; it overwrites every covered pixel.
    this.#gbufferPipeline = await device.createPipeline({
      shader: this.#gbufferShader,
      vertexLayout: [this.#posLayout(), this.#normalLayout()],
      bindGroupLayouts: [this.#gbufferFrameLayout, this.#gbufferObjectLayout],
      color: { format: 'linear', blend: 'none' },
      depth: { test: true, write: true },
      cull: 'back',
      frontFace: device.ndc.frontFace,
      primitive: 'triangle-list',
      samples: 1,
      label: 'ao-gbuffer',
    })
    if (seq === this.#warmupSeq) this.#ready = true
  }

  #posLayout(): import('./GfxDevice').VertexBufferLayout {
    return {
      arrayStride: 12,
      stepMode: 'vertex',
      attributes: [{ location: LOC_POSITION, format: 'float32x3', offset: 0 }],
    }
  }
  #normalLayout(): import('./GfxDevice').VertexBufferLayout {
    return {
      arrayStride: 12,
      stepMode: 'vertex',
      attributes: [{ location: LOC_NORMAL, format: 'float32x3', offset: 0 }],
    }
  }
  #flatVertexLayout(): import('./GfxDevice').VertexBufferLayout[] {
    return [
      this.#posLayout(),
      {
        arrayStride: 12,
        stepMode: 'vertex',
        attributes: [{ location: LOC_NORMAL, format: 'float32x3', offset: 0 }],
      },
      {
        arrayStride: 8,
        stepMode: 'vertex',
        attributes: [{ location: LOC_UV, format: 'float32x2', offset: 0 }],
      },
    ]
  }
  #pbrVertexLayout(): import('./GfxDevice').VertexBufferLayout[] {
    return [
      ...this.#flatVertexLayout(),
      {
        arrayStride: 16,
        stepMode: 'vertex',
        attributes: [{ location: LOC_TANGENT, format: 'float32x4', offset: 0 }],
      },
    ]
  }

  #onContextRestored(): void {
    this.#cache = new WeakMap()
    this.#uploaded.clear()
    this.#texCache = new WeakMap()
    this.#decoding.clear()
    this.#uploadedTextures.clear()
    this.#epoch++
    this.#shadowArray = null
    this.#shadowCube = null
    this.#placeholderArray = null
    this.#placeholderCube = null
    this.#shadowResolution = 0
    this.#shadowByLight.clear()
    this.#flatPipelines.clear()
    this.#pbrPipelines.clear()
    this.#createResources()
  }

  /**
   * Draw every visible, ready node under `root`, viewed through `camera`. Runs
   * inside the stage's main render pass; each pipeline bakes its own depth/cull
   * state, so no device state is set imperatively.
   */
  /**
   * Push this frame's screen-space AO for the mesh shaders to sample. `tex` is
   * the blurred AO texture (null when AO is off), `enabled` gates the ambient
   * modulation, and `pixelW`/`pixelH` size the screen-space lookup. Call before
   * {@link MeshRenderer.render}.
   */
  setAmbientOcclusion(
    tex: Texture | null,
    enabled: boolean,
    pixelW: number,
    pixelH: number,
    directStrength: number,
  ): void {
    this.#aoTex = tex
    this.#aoEnabled = enabled && tex !== null
    this.#aoPixelW = pixelW
    this.#aoPixelH = pixelH
    this.#aoDirectStrength = directStrength
  }

  /** The AO texture to bind, or the 1×1 white fallback when AO is off. */
  #aoResolved(): Texture {
    return this.#aoTex ?? this.#whiteTex
  }

  /**
   * Write `aoParams` (@word `o`): enabled, flip-uv.y, resW, resH, then
   * `aoParams2` (@word `o+4`): direct-light AO strength.
   */
  #writeAoParams(s: Float32Array, o: number): void {
    s[o] = this.#aoEnabled ? 1 : 0
    // The fragment position and the AO render target share an FBO origin per
    // backend, so no V-flip is needed. Kept as a param for tuning.
    s[o + 1] = 0
    s[o + 2] = this.#aoPixelW
    s[o + 3] = this.#aoPixelH
    s[o + 4] = this.#aoEnabled ? this.#aoDirectStrength : 0
    s[o + 5] = 0
    s[o + 6] = 0
    s[o + 7] = 0
  }

  render(camera: CameraView3D, root: Node, debugMode = 0): void {
    // The uploaded view-projection must land depth in the backend's clip range
    // (WebGPU keeps [0,1], WebGL [-1,1]). The camera rebuilds only on a change.
    camera.setClipDepth(this.#device.ndc.clipDepth)
    this.stats.draws = 0
    this.stats.visible = 0
    this.stats.vertices = 0
    this.stats.triangles = 0
    this.#flatObjectRing.reset()
    this.#pbrObjectRing.reset()
    const drawables: Node3D[] = []
    const lights: Light3D[] = []
    walkTree(root, (n) => {
      if (n instanceof MeshNode && n.geometry && isEffectivelyVisible(n))
        drawables.push(n)
      else if (n instanceof Viewport2DNode && isEffectivelyVisible(n))
        drawables.push(n)
      else if (n instanceof Light3D && isEffectivelyVisible(n)) lights.push(n)
    })
    if (drawables.length === 0) return

    const eye = camera.eyePosition()
    const distSq = (m: Node3D): number => {
      const w = m.worldMatrix
      const dx = w[12] - eye.x
      const dy = w[13] - eye.y
      const dz = w[14] - eye.z
      return dx * dx + dy * dy + dz * dz
    }
    const opaque: Node3D[] = []
    const blend: Node3D[] = []
    for (const node of drawables) (isBlended(node) ? blend : opaque).push(node)
    blend.sort((a, b) => distSq(b) - distSq(a))
    const ordered = opaque.concat(blend)
    const blendStart = opaque.length

    let flatReady = false
    let pbrReady = false
    for (let i = 0; i < ordered.length; i++) {
      // Transparent bucket: keep depth-testing against opaque depth but stop
      // writing (pipeline variant with write:false).
      const write = !(i >= blendStart && blend.length > 0)
      const node = ordered[i]
      const cull =
        node instanceof MeshNode && node.material.doubleSided ? 'none' : 'back'
      if (node instanceof MeshNode && node.material.pbr) {
        if (!pbrReady) {
          this.#beginPbr(camera, eye, debugMode, lights)
          pbrReady = true
        }
        this.#drawMeshPbr(node, cull, write)
      } else {
        if (!flatReady) {
          this.#beginFlat(camera, eye, debugMode)
          flatReady = true
        }
        if (node instanceof Viewport2DNode)
          this.#drawViewport(node, cull, write)
        else this.#drawMesh(node as MeshNode, cull, write)
      }
    }
  }

  /**
   * Render the shadow-caster depth maps for this frame as depth-only render
   * passes, before the stage's main pass. Stores per-light shadow state that
   * the following {@link MeshRenderer.render} feeds to the PBR program.
   */
  renderShadows(root: Node): void {
    this.#shadowByLight.clear()
    if (!this.#ready || !this.#quality.shadowsEnabled) return
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
    this.#shadowObjectRing.reset()
    this.#shadowCamRing.reset()
    this.#cubeCamRing.reset()

    let layer = 0
    for (const light of lights) {
      if (layer >= MAX_SHADOW_LAYERS) break
      const vp = this.#shadowMatrixFor(light, aabb)
      if (!vp) continue
      this.#drawShadowLayer(vp, casters, layer)
      this.#shadowMats.set(vp, layer * 16)
      this.#shadowByLight.set(light, { kind: 1, param: layer })
      layer++
    }
    const point = lights.find(
      (l): l is PointLight3D => l instanceof PointLight3D,
    )
    if (point) this.#renderPointShadow(point, casters, aabb)
  }

  /** Render all casters into the six faces of the point light's depth cubemap. */
  #renderPointShadow(
    light: PointLight3D,
    casters: MeshNode[],
    aabb: Aabb,
  ): void {
    const device = this.#device
    const w = light.worldMatrix
    const px = w[12]
    const py = w[13]
    const pz = w[14]
    const far =
      light.range > 0 ? light.range : this.#castersFar(aabb, px, py, pz)
    const near = Math.max(0.05, far * 0.005)
    const pos = vec3(px, py, pz)
    const cube = this.#ensurePointCube()
    for (let face = 0; face < 6; face++) {
      // Pad the projection far so geometry at `dist ≈ far` isn't clipped.
      const vp = fitPointCubeFace(
        pos,
        face,
        near,
        far * 1.01,
        device.ndc.clipDepth,
      )
      const s = this.#camStaging
      s.set(vp, 0)
      s[16] = px
      s[17] = py
      s[18] = pz
      s[20] = far
      const camOff = this.#cubeCamRing.push(device, s)
      if (camOff < 0) continue
      device.beginRenderPass({
        depth: { target: { shadowCube: cube, face }, loadOp: 'clear' },
      })
      for (const caster of casters) this.#drawShadowCaster(caster, true, camOff)
      device.endRenderPass()
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
        this.#device.ndc.clipDepth,
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
        this.#device.ndc.clipDepth,
      )
    }
    return null
  }

  /** Render every caster's depth into one depth-array `layer` from `vp`. */
  #drawShadowLayer(vp: Mat4, casters: MeshNode[], layer: number): void {
    const device = this.#device
    const camOff = this.#shadowCamRing.push(
      device,
      vp as unknown as Float32Array,
    )
    if (camOff < 0) return
    device.beginRenderPass({
      depth: {
        target: { shadowArray: this.#ensureShadowArray(), layer },
        loadOp: 'clear',
      },
    })
    for (const caster of casters) this.#drawShadowCaster(caster, false, camOff)
    device.endRenderPass()
  }

  /**
   * Draw one caster into the current shadow pass. `camOff` is the caller's
   * per-pass slice offset into the shadow-camera ring (group 0); the caster's
   * model matrix takes its own slice in the object ring (group 1).
   */
  #drawShadowCaster(caster: MeshNode, cube: boolean, camOff: number): void {
    const gpu = this.#ensureUpload(caster)
    if (!gpu) return
    const device = this.#device
    const s = this.#objStaging
    s.set(caster.worldMatrix, 0)
    const off = this.#shadowObjectRing.push(device, s)
    if (off < 0) return
    device.draw({
      pipeline: cube ? this.#cubePipeline : this.#shadowPipeline,
      vertexBuffers: [{ buffer: gpu.posBuf, offset: 0 }],
      indexBuffer: gpu.ibo,
      bindGroups: [
        {
          group: 0,
          bindGroup: cube ? this.#cubeCamBindGroup : this.#shadowCamBindGroup,
          dynamicOffsets: [camOff],
        },
        {
          group: 1,
          bindGroup: this.#shadowObjectBindGroup,
          dynamicOffsets: [off],
        },
      ],
      indexCount: gpu.indexCount,
    })
  }

  /**
   * Ambient-occlusion G-buffer prepass: draw opaque, AO-receiving geometry into
   * `target` — the view-space normal (octahedral in RG) to the color
   * attachment, depth to the sampleable depth attachment. Runs single-sample
   * before the main pass; the AO pass reads both to estimate occlusion.
   * Transparent meshes are skipped (they write no depth), matching the
   * shadow-caster set. No-op until pipelines warm.
   */
  renderGBuffer(camera: CameraView3D, root: Node, target: RenderTarget): void {
    if (!this.#ready) return
    const device = this.#device
    camera.setClipDepth(device.ndc.clipDepth)
    const casters: MeshNode[] = []
    walkTree(root, (n) => {
      if (
        n instanceof MeshNode &&
        n.geometry &&
        !isBlended(n) &&
        isEffectivelyVisible(n)
      ) {
        casters.push(n)
      }
    })
    // Frame block: view-projection + view + near/far, so the prepass can write
    // linear view depth.
    const f = this.#gbufFrameStaging
    f.set(camera.viewProjection as unknown as Float32Array, 0)
    f.set(camera.view as unknown as Float32Array, 16)
    f[32] = camera.near
    f[33] = camera.far
    device.updateUniformBuffer(this.#gbufferFrameUbo, f)
    this.#gbufferObjectRing.reset()
    device.beginRenderPass({
      color: {
        target,
        loadOp: 'clear',
        // (0.5, 0.5) octahedral-decodes to +Z. The cleared background normal is
        // arbitrary — the AO pass ignores far-depth texels.
        clearColor: [0.5, 0.5, 0, 1],
      },
      depth: {
        target: { renderTarget: target },
        loadOp: 'clear',
        clearValue: 1,
      },
    })
    for (const caster of casters) this.#drawGBufferCaster(caster)
    device.endRenderPass()
  }

  /** Draw one caster into the current G-buffer pass (position + normal). */
  #drawGBufferCaster(caster: MeshNode): void {
    const gpu = this.#ensureUpload(caster)
    if (!gpu) return
    const device = this.#device
    const s = this.#gbufObjStaging
    s.set(caster.worldMatrix as unknown as Float32Array, 0)
    const off = this.#gbufferObjectRing.push(device, s)
    if (off < 0) return
    device.draw({
      pipeline: this.#gbufferPipeline,
      vertexBuffers: [
        { buffer: gpu.posBuf, offset: 0 },
        { buffer: gpu.normBuf, offset: 0 },
      ],
      indexBuffer: gpu.ibo,
      bindGroups: [
        { group: 0, bindGroup: this.#gbufferFrameBindGroup },
        {
          group: 1,
          bindGroup: this.#gbufferObjectBindGroup,
          dynamicOffsets: [off],
        },
      ],
      indexCount: gpu.indexCount,
    })
  }

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

  #lightForward(light: Light3D): Vec3 {
    const w = light.worldMatrix
    return vec3Normalize(this.#scratchDir, vec3(-w[8], -w[9], -w[10]))
  }
  readonly #scratchDir: Vec3 = vec3()
  readonly #scratchPt: Vec3 = vec3()

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

  /** Write the flat program's per-frame block (once per frame). */
  #beginFlat(
    camera: CameraView3D,
    eye: { x: number; y: number; z: number },
    debugMode: number,
  ): void {
    const s = this.#flatFrameStaging
    s.set(camera.viewProjection, 0) // u_viewProj @0..15
    s[16] = eye.x
    s[17] = eye.y
    s[18] = eye.z // u_eyePos @16
    const l = this.light
    s[20] = l.ambient[0]
    s[21] = l.ambient[1]
    s[22] = l.ambient[2] // u_ambient @20
    this.#writeFog(s, 24) // u_fogColor @24, u_fogParams @28
    s[32] = l.direction[0]
    s[33] = l.direction[1]
    s[34] = l.direction[2] // u_lightDir @32
    s[36] = l.color[0]
    s[37] = l.color[1]
    s[38] = l.color[2] // u_lightColor @36
    s[40] = debugMode // u_debug @40
    this.#writeAoParams(s, 44) // u_aoParams @44
    const device = this.#device
    device.updateUniformBuffer(this.#flatFrameUbo, s)
    // Rebuild the frame bind group when the bound AO texture changes.
    const ao = this.#aoResolved()
    if (!this.#flatFrameBindGroup || this.#flatFrameBoundAo !== ao) {
      this.#flatFrameBindGroup = device.createBindGroup(this.#flatFrameLayout, [
        {
          binding: CAMERA3D_UBO_BINDING,
          resource: { uniformBuffer: this.#flatFrameUbo },
        },
        { binding: U_AO, resource: { texture: ao } },
      ])
      this.#flatFrameBoundAo = ao
    }
  }

  /**
   * Write the PBR program's per-frame + lights + shadow blocks (once per
   * frame).
   */
  #beginPbr(
    camera: CameraView3D,
    eye: { x: number; y: number; z: number },
    debugMode: number,
    lights: Light3D[],
  ): void {
    const device = this.#device
    const f = this.#pbrFrameStaging
    f.set(camera.viewProjection, 0)
    f[16] = eye.x
    f[17] = eye.y
    f[18] = eye.z
    const amb = this.light.ambient
    f[20] = amb[0]
    f[21] = amb[1]
    f[22] = amb[2]
    this.#writeFog(f, 24)
    f[32] = debugMode
    this.#writeAoParams(f, 36) // u_aoParams @36
    device.updateUniformBuffer(this.#pbrFrameUbo, f)

    this.#writeLights(lights)
    device.updateUniformBuffer(this.#lightsUbo, this.#lightsF)

    // Shadow frame: matrices + (texel, samples, backend conventions). The
    // convention flags let the shadow sample reconcile the light-space depth
    // and the shadow-map row order per backend (see mesh_pbr.wgsl).
    const sf = this.#shadowFrameStaging
    sf.set(this.#shadowMats, 0) // u_shadowMat[4] @0..63
    sf[64] = 1 / this.#quality.shadowMapSize // u_shadowMeta.x
    sf[65] = this.#quality.shadowSoftness // u_shadowMeta.y
    // u_shadowMeta.z = 1 when the light projection keeps depth in [0,1]; .w = 1
    // when the shadow map is stored top-down (both true on WebGPU).
    sf[66] = device.ndc.clipDepth === 'zero-to-one' ? 1 : 0
    sf[67] = device.ndc.textureTopDown ? 1 : 0
    device.updateUniformBuffer(this.#shadowFrameUbo, sf)

    // Rebuild the frame bind group when the bound shadow maps or AO texture change.
    const arr = this.#arrayForBind()
    const cube = this.#cubeForBind()
    const ao = this.#aoResolved()
    if (
      !this.#pbrFrameBindGroup ||
      this.#pbrFrameBoundArray !== arr ||
      this.#pbrFrameBoundCube !== cube ||
      this.#pbrFrameBoundAo !== ao
    ) {
      this.#pbrFrameBindGroup = device.createBindGroup(this.#pbrFrameLayout, [
        {
          binding: CAMERA3D_UBO_BINDING,
          resource: { uniformBuffer: this.#pbrFrameUbo },
        },
        {
          binding: MESH_LIGHTS_UBO_BINDING,
          resource: { uniformBuffer: this.#lightsUbo },
        },
        {
          binding: MESH_SHADOW_UBO_BINDING,
          resource: { uniformBuffer: this.#shadowFrameUbo },
        },
        { binding: U_AO, resource: { texture: ao } },
        { binding: U_SHADOW_ARRAY, resource: { shadowArray: arr } },
        { binding: U_SHADOW_CUBE, resource: { shadowCube: cube } },
      ])
      this.#pbrFrameBoundArray = arr
      this.#pbrFrameBoundCube = cube
      this.#pbrFrameBoundAo = ao
    }
  }

  /** Write `u_fogColor` (@word `o`) + `u_fogParams` (@word `o+4`). */
  #writeFog(s: Float32Array, o: number): void {
    const f = this.#fog
    const c = f.color
    s[o] = c[0]
    s[o + 1] = c[1]
    s[o + 2] = c[2]
    s[o + 3] = f.enabled ? 1 : 0
    s[o + 4] = f.mode === 'linear' ? 1 : 0
    s[o + 5] = f.density
    s[o + 6] = f.start
    s[o + 7] = f.end
  }

  /** Pack the `Lights` block from the scene's light nodes. */
  #writeLights(lights: Light3D[]): void {
    const F = this.#lightsF
    const I = this.#lightsI
    // Layout (words): count @0 (ivec4); color[] @4; pos[] @36; dir[] @68;
    // cone[] @100; shadow[] @132 (each array is 8 × 4 words = 32 words).
    const COLOR = 4
    const POS = COLOR + MAX_LIGHTS * 4
    const DIR = POS + MAX_LIGHTS * 4
    const CONE = DIR + MAX_LIGHTS * 4
    const SHADOW = CONE + MAX_LIGHTS * 4
    F.fill(0)
    if (lights.length === 0) {
      const l = this.light
      I[0] = 1
      // pos[0] = (0,0,0, type 0), dir[0] = direction, color[0] = color.
      F[DIR + 0] = l.direction[0]
      F[DIR + 1] = l.direction[1]
      F[DIR + 2] = l.direction[2]
      F[COLOR + 0] = l.color[0]
      F[COLOR + 1] = l.color[1]
      F[COLOR + 2] = l.color[2]
      return
    }
    const n = Math.min(lights.length, MAX_LIGHTS)
    I[0] = n
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
      let dx = -w[8]
      let dy = -w[9]
      let dz = -w[10]
      const len = Math.hypot(dx, dy, dz) || 1
      dx /= len
      dy /= len
      dz /= len
      const c = light.color
      const s = light.intensity * gain
      const sh = this.#shadowByLight.get(light)
      const opacity = sh ? light.shadowOpacity : 0
      const p = i * 4
      F[POS + p] = w[12]
      F[POS + p + 1] = w[13]
      F[POS + p + 2] = w[14]
      F[POS + p + 3] = type
      F[DIR + p] = dx
      F[DIR + p + 1] = dy
      F[DIR + p + 2] = dz
      F[DIR + p + 3] = range
      F[COLOR + p] = c[0] * s
      F[COLOR + p + 1] = c[1] * s
      F[COLOR + p + 2] = c[2] * s
      F[COLOR + p + 3] = opacity
      F[CONE + p] = cosInner
      F[CONE + p + 1] = cosOuter
      F[SHADOW + p] = sh ? sh.kind : 0
      F[SHADOW + p + 1] = sh ? sh.param : 0
      F[SHADOW + p + 2] = light.shadowBias
      F[SHADOW + p + 3] = light.shadowNormalBias
    }
  }

  #drawMesh(mesh: MeshNode, cull: 'back' | 'none', write: boolean): void {
    const gpu = this.#ensureUpload(mesh)
    if (!gpu) return
    const s = this.#flatObjStaging
    s.set(mesh.worldMatrix, 0) // u_model @0..15
    const c = mesh.material.color
    s[16] = c[0]
    s[17] = c[1]
    s[18] = c[2]
    s[19] = c[3] * mesh.transform.alpha // u_color @16
    s[20] = mesh.material.lit ? 1 : 0 // u_flags.x = lit
    s[21] = 0 // u_flags.y = useTexture
    const off = this.#flatObjectRing.push(this.#device, s)
    if (off < 0) return
    this.#drawFlat(gpu, this.#whiteTex, off, cull, write)
    this.#countDraw(gpu)
  }

  #drawViewport(
    node: Viewport2DNode,
    cull: 'back' | 'none',
    write: boolean,
  ): void {
    const tex = node.colorTexture ?? this.#whiteTex
    const s = this.#flatObjStaging
    s.set(node.worldMatrix, 0)
    s[16] = 1
    s[17] = 1
    s[18] = 1
    s[19] = node.transform.alpha
    s[20] = 0 // lit
    s[21] = 1 // useTexture
    const off = this.#flatObjectRing.push(this.#device, s)
    if (off < 0) return
    this.#drawFlat(this.#quad, tex, off, cull, write)
    this.#countDraw(this.#quad)
  }

  #drawFlat(
    gpu: GpuMesh,
    tex: Texture,
    dynOffset: number,
    cull: 'back' | 'none',
    write: boolean,
  ): void {
    const device = this.#device
    const objBg = device.createBindGroup(this.#flatObjectLayout, [
      {
        binding: MESH_OBJECT_UBO_BINDING,
        resource: {
          uniformBuffer: this.#flatObjectRing.buffer,
          size: FLAT_OBJECT_BYTES,
        },
      },
      { binding: U_TEX, resource: { texture: tex } },
    ])
    device.draw({
      pipeline: this.#flatPipelines.get(`${cull}|${write}`)!,
      vertexBuffers: [
        { buffer: gpu.posBuf, offset: 0 },
        { buffer: gpu.normBuf, offset: 0 },
        { buffer: gpu.uvBuf, offset: 0 },
      ],
      indexBuffer: gpu.ibo,
      bindGroups: [
        // Set by `#beginFlat`, which runs before any flat draw.
        { group: 0, bindGroup: this.#flatFrameBindGroup! },
        { group: 1, bindGroup: objBg, dynamicOffsets: [dynOffset] },
      ],
      indexCount: gpu.indexCount,
    })
  }

  #drawMeshPbr(mesh: MeshNode, cull: 'back' | 'none', write: boolean): void {
    const gpu = this.#ensureUpload(mesh)
    if (!gpu) return
    const device = this.#device
    const m = mesh.material
    const s = this.#pbrObjStaging
    s.fill(0)
    s.set(mesh.worldMatrix, 0) // u_model @0..15
    mat3NormalMatrix(this.#normalMat, mesh.worldMatrix)
    // u_normalMatrix (mat4 @16): write the mat3 into the upper 3 columns.
    const nm = this.#normalMat
    s[16] = nm[0]
    s[17] = nm[1]
    s[18] = nm[2]
    s[20] = nm[3]
    s[21] = nm[4]
    s[22] = nm[5]
    s[24] = nm[6]
    s[25] = nm[7]
    s[26] = nm[8]
    const c = m.color
    s[32] = c[0]
    s[33] = c[1]
    s[34] = c[2]
    s[35] = c[3] * mesh.transform.alpha // u_baseColorFactor @32
    const e = m.emissiveFactor
    s[36] = e?.[0] ?? 0
    s[37] = e?.[1] ?? 0
    s[38] = e?.[2] ?? 0 // u_emissiveFactor @36
    s[40] = m.metallicFactor ?? 1
    s[41] = m.roughnessFactor ?? 1
    s[42] = m.occlusionStrength ?? 1
    s[43] = m.normalScale ?? 1 // u_matParams0 @40
    s[44] = m.alphaCutoff ?? 0.5
    s[45] = m.diffuseTransmission ?? 0
    s[46] = gpu.hasTangent ? 1 : 0
    s[47] = m.alphaMode === 'MASK' ? 1 : m.alphaMode === 'BLEND' ? 2 : 0 // u_matParams1 @44
    // has-flags + textures @48 (u_hasTex0), @52 (u_hasTex1).
    const t0 = this.#resolveMap(m.baseColorTex, 'u_baseColorTex')
    const t1 = this.#resolveMap(m.metalRoughTex, 'u_metalRoughTex')
    const t2 = this.#resolveMap(m.normalTex, 'u_normalTex')
    const t3 = this.#resolveMap(m.occlusionTex, 'u_occlusionTex')
    const t4 = this.#resolveMap(m.emissiveTex, 'u_emissiveTex')
    const t5 = this.#resolveMap(
      m.diffuseTransmissionTex,
      'u_diffuseTransmissionTex',
    )
    s[48] = t0 ? 1 : 0
    s[49] = t1 ? 1 : 0
    s[50] = t2 ? 1 : 0
    s[51] = t3 ? 1 : 0
    s[52] = t4 ? 1 : 0
    s[53] = t5 ? 1 : 0
    const off = this.#pbrObjectRing.push(device, s)
    if (off < 0) return
    const objBg = device.createBindGroup(this.#pbrObjectLayout, [
      {
        binding: MESH_OBJECT_UBO_BINDING,
        resource: {
          uniformBuffer: this.#pbrObjectRing.buffer,
          size: PBR_OBJECT_BYTES,
        },
      },
      { binding: U_PBR_TEX_BASE, resource: { texture: t0 ?? this.#whiteTex } },
      {
        binding: U_PBR_TEX_BASE + 1,
        resource: { texture: t1 ?? this.#whiteTex },
      },
      {
        binding: U_PBR_TEX_BASE + 2,
        resource: { texture: t2 ?? this.#whiteTex },
      },
      {
        binding: U_PBR_TEX_BASE + 3,
        resource: { texture: t3 ?? this.#whiteTex },
      },
      {
        binding: U_PBR_TEX_BASE + 4,
        resource: { texture: t4 ?? this.#whiteTex },
      },
      {
        binding: U_PBR_TEX_BASE + 5,
        resource: { texture: t5 ?? this.#whiteTex },
      },
    ])
    device.draw({
      pipeline: this.#pbrPipelines.get(`${cull}|${write}`)!,
      vertexBuffers: [
        { buffer: gpu.posBuf, offset: 0 },
        { buffer: gpu.normBuf, offset: 0 },
        { buffer: gpu.uvBuf, offset: 0 },
        { buffer: gpu.tangentBuf, offset: 0 },
      ],
      indexBuffer: gpu.ibo,
      bindGroups: [
        { group: 0, bindGroup: this.#pbrFrameBindGroup! },
        { group: 1, bindGroup: objBg, dynamicOffsets: [off] },
      ],
      indexCount: gpu.indexCount,
    })
    this.#countDraw(gpu)
  }

  #countDraw(gpu: GpuMesh): void {
    this.stats.draws++
    this.stats.visible++
    this.stats.vertices += gpu.indexCount
    this.stats.triangles += gpu.indexCount / 3
  }

  /** Resolve a material texture slot to a GPU texture (tracking + async decode). */
  #resolveMap(
    slot: MaterialTexture | null | undefined,
    samplerName: string,
  ): Texture | null {
    if (!slot) return null
    this.#modelInspector.track(slot.image, samplerName)
    return this.#ensureTexture(slot.image, slot.srgb, slot.sampler)
  }

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
    // Object-space (mesh) UVs: the WebGPU backend must not apply its 2D
    // render-origin V-flip, or the texture samples upside-down.
    device.updateTexture2D(tex, bmp, {
      flipY: false,
      premultiply: false,
      objectSpaceUV: true,
    })
    this.#modelInspector.setUploadedSize(image, bmp.width, bmp.height)
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
        if (epoch !== this.#epoch) bmp.close()
        else image.bitmap = bmp
      },
      () => {
        this.#decoding.delete(image)
      },
    )
  }

  get textureInspector(): TextureInspector | null {
    return this.#modelInspector.hasEntries ? this.#modelInspector : null
  }

  #ensureUpload(mesh: MeshNode): GpuMesh | null {
    const geom = mesh.geometry
    if (!geom) return null
    const existing = this.#cache.get(mesh)
    if (existing) return existing

    const device = this.#device
    const vertCount = geom.positions.length / 3
    const posBuf = device.createVertexBuffer(geom.positions.byteLength)
    device.updateBufferSubData(posBuf, 0, geom.positions)
    const normBuf = device.createVertexBuffer(geom.normals.byteLength)
    device.updateBufferSubData(normBuf, 0, geom.normals)

    const indexType: IndexType =
      geom.indices instanceof Uint32Array ? 'u32' : 'u16'
    const ibo = device.createIndexBuffer(geom.indices.byteLength, indexType)
    device.updateIndexBufferSubData(ibo, 0, geom.indices)

    // UV + tangent are always allocated (zero-filled when absent) so one vertex
    // layout serves every mesh; the shader gates their use by flags.
    const uvSrc = geom.uvs ?? new Float32Array(vertCount * 2)
    const uvBuf = device.createVertexBuffer(uvSrc.byteLength)
    device.updateBufferSubData(uvBuf, 0, uvSrc)
    const tanSrc = geom.tangents ?? new Float32Array(vertCount * 4)
    const tangentBuf = device.createVertexBuffer(tanSrc.byteLength)
    device.updateBufferSubData(tangentBuf, 0, tanSrc)

    const gpu: GpuMesh = {
      posBuf,
      normBuf,
      uvBuf,
      tangentBuf,
      ibo,
      indexCount: geom.indices.length,
      hasTangent: !!geom.tangents,
    }
    this.#cache.set(mesh, gpu)
    this.#uploaded.add(mesh)
    return gpu
  }

  /** Build the shared textured unit quad (1×1 in local xy, facing +z). */
  #createQuad(): GpuMesh {
    const device = this.#device
    const positions = new Float32Array([
      -0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0,
    ])
    const normals = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1])
    const uvs = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1])
    const tangents = new Float32Array(4 * 4)
    const indices = new Uint16Array([0, 1, 2, 0, 2, 3])

    const posBuf = device.createVertexBuffer(positions.byteLength)
    device.updateBufferSubData(posBuf, 0, positions)
    const normBuf = device.createVertexBuffer(normals.byteLength)
    device.updateBufferSubData(normBuf, 0, normals)
    const uvBuf = device.createVertexBuffer(uvs.byteLength)
    device.updateBufferSubData(uvBuf, 0, uvs)
    const tangentBuf = device.createVertexBuffer(tangents.byteLength)
    device.updateBufferSubData(tangentBuf, 0, tangents)
    const ibo = device.createIndexBuffer(indices.byteLength, 'u16')
    device.updateIndexBufferSubData(ibo, 0, indices)

    return {
      posBuf,
      normBuf,
      uvBuf,
      tangentBuf,
      ibo,
      indexCount: indices.length,
      hasTangent: false,
    }
  }

  release(mesh: MeshNode): void {
    const gpu = this.#cache.get(mesh)
    if (!gpu) return
    this.#device.deleteBuffer(gpu.posBuf)
    this.#device.deleteBuffer(gpu.normBuf)
    this.#device.deleteBuffer(gpu.uvBuf)
    this.#device.deleteBuffer(gpu.tangentBuf)
    this.#device.deleteIndexBuffer(gpu.ibo)
    this.#cache.delete(mesh)
    this.#uploaded.delete(mesh)
  }

  destroy(): void {
    this.#offRestore()
    for (const mesh of this.#uploaded) this.release(mesh)
    this.#device.deleteBuffer(this.#quad.posBuf)
    this.#device.deleteBuffer(this.#quad.normBuf)
    this.#device.deleteBuffer(this.#quad.uvBuf)
    this.#device.deleteBuffer(this.#quad.tangentBuf)
    this.#device.deleteIndexBuffer(this.#quad.ibo)
    for (const tex of this.#uploadedTextures) this.#device.deleteTexture(tex)
    this.#uploadedTextures.clear()
    this.#device.deleteTexture(this.#whiteTex)
    this.#device.deleteShaderModule(this.#flatShader)
    this.#device.deleteShaderModule(this.#pbrShader)
    this.#device.deleteShaderModule(this.#shadowShader)
    this.#device.deleteShaderModule(this.#cubeShader)
    this.#device.deleteUniformBuffer(this.#flatFrameUbo)
    this.#device.deleteUniformBuffer(this.#pbrFrameUbo)
    this.#device.deleteUniformBuffer(this.#lightsUbo)
    this.#device.deleteUniformBuffer(this.#shadowFrameUbo)
    this.#device.deleteUniformBuffer(this.#shadowCamRing.buffer)
    this.#device.deleteUniformBuffer(this.#cubeCamRing.buffer)
    if (this.#shadowArray) this.#device.deleteShadowArray(this.#shadowArray)
    if (this.#placeholderArray)
      this.#device.deleteShadowArray(this.#placeholderArray)
    if (this.#shadowCube) this.#device.deleteShadowCube(this.#shadowCube)
    if (this.#placeholderCube)
      this.#device.deleteShadowCube(this.#placeholderCube)
    this.#modelInspector.clear()
  }
}

/**
 * True for surfaces drawn in the transparent bucket: a `BLEND` mesh or a
 * `Viewport2DNode` quad. Opaque and alpha-`MASK` meshes stay in the
 * depth-writing opaque bucket.
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
