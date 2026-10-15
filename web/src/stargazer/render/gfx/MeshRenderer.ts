import { RenderFailures } from './RenderFailures'
import type {
  BindGroup,
  BindGroupEntry,
  BindGroupLayout,
  TargetFormat,
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
  type MeshGeometry,
  type TextureImage,
  type TextureSampler,
} from '../../nodes/MeshNode'
import {
  Light3D,
  DirectionalLight3D,
  PointLight3D,
  SpotLight3D,
} from '../../nodes/Light3D'
import { isEffectivelyVisible, walkTree } from '../../scene/traverse'
import { mat3, mat3NormalMatrix, type Mat3 } from '../../math/Mat3'
import {
  fitDirectionalOrtho,
  fitSpotPerspective,
  fitPointCubeFace,
  type Aabb,
} from '../../math/shadowFit'
import { vec3, vec3Normalize, type Vec3 } from '../../math/Vec3'
import { mat4TransformPoint, type Mat4 } from '../../math/Mat4'
import {
  boxOutsideFrustum,
  createFrustum,
  frustumFromMatrix,
  type FrustumPlanes,
} from '../../math/frustum'
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
  /** The vertex buffer bindings of each program, built once per upload. */
  flatBuffers: VertexBinding[]
  pbrBuffers: VertexBinding[]
  shadowBuffers: VertexBinding[]
  gbufferBuffers: VertexBinding[]
  /** Whether the geometry actually had tangents (drives the PBR tangent path). */
  hasTangent: boolean
  /**
   * The geometry these buffers hold, so a node that swaps its geometry gets a
   * re-upload instead of the previous shape. Absent on the shared quad, which
   * has no node and never changes.
   */
  geometry?: MeshGeometry
  /** Drops the node's destroy subscription. Absent on the shared quad. */
  offDestroy?: () => void
}

type VertexBinding = { buffer: VBuffer; offset: number }

/**
 * One mesh's draw in the main pass. Every mesh is recorded and has its uniforms
 * staged before the first draw is issued, so each ring uploads once.
 */
interface DrawRec {
  mesh: MeshNode
  gpu: GpuMesh
  pbr: boolean
  blended: boolean
  /** Index into the pipeline arrays, see {@link variantOf}. */
  variant: number
  /** Byte offset of the mesh's slice in its object ring. */
  offset: number
  /** Squared distance to the eye, for ordering. */
  dist: number
  /** Bound textures, one for the flat program and six for PBR. */
  tex: Texture[]
}

/** The object bind group a mesh last drew with, and what it was built from. */
interface ObjectGroup {
  pbr: boolean
  generation: number
  tex: Texture[]
  group: BindGroup
}

/** Pipeline array index from cull and depth write. */
function variantOf(doubleSided: boolean, write: boolean): number {
  return (doubleSided ? 2 : 0) + (write ? 1 : 0)
}

/**
 * Opaque meshes first, grouped by program and state and nearest first, so the
 * depth test rejects what hides behind them. Transparent meshes after, back to
 * front.
 */
function drawOrder(a: DrawRec, b: DrawRec): number {
  if (a.blended !== b.blended) return a.blended ? 1 : -1
  if (a.blended) return b.dist - a.dist
  if (a.pbr !== b.pbr) return a.pbr ? 1 : -1
  if (a.variant !== b.variant) return a.variant - b.variant
  return a.dist - b.dist
}

/** A bind group over a ring's buffer, rebuilt when the ring replaces it. */
class RingBinding {
  readonly #ring: UboRing
  readonly #layout: BindGroupLayout
  readonly #binding: number
  readonly #size: number
  #group: BindGroup | null = null
  #generation = -1

  constructor(
    ring: UboRing,
    layout: BindGroupLayout,
    binding: number,
    size: number,
  ) {
    this.#ring = ring
    this.#layout = layout
    this.#binding = binding
    this.#size = size
  }

  group(device: GfxDevice): BindGroup {
    if (!this.#group || this.#generation !== this.#ring.generation) {
      this.#generation = this.#ring.generation
      this.#group = device.createBindGroup(this.#layout, [
        {
          binding: this.#binding,
          resource: { uniformBuffer: this.#ring.buffer, size: this.#size },
        },
      ])
    }
    return this.#group
  }
}

const LOC_POSITION = 0
const LOC_NORMAL = 1
const LOC_UV = 2
const LOC_TANGENT = 3

/** Fixed size of the PBR shader's light array. Excess lights are dropped. */
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
// near/far (vec4), object = model (one mat4). The view matrix + near/far turn
// window depth into the linear view depth the prepass writes.
const GBUFFER_FRAME_BYTES = 144
const GBUFFER_OBJECT_BYTES = 64

// Texture units (globally unique with the UBO bindings, the WebGL2 backend
// flattens bind groups to these numbers). Flat `u_texture` shares unit 0 with
// the PBR material base slot but they never coexist in one draw.
const U_TEX = 0
const U_AO = 2 // screen-space AO texture in the frame group (sampler at +16 = 18)
const U_SHADOW_ARRAY = 8
const U_SHADOW_CUBE = 9
const U_PBR_TEX_BASE = 10 // baseColor..diffuseTransmission -> 10..15

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
 * depth-only pre-pass. Pipelines pre-warm asynchronously. `Stage` gates the 3D
 * pass on {@link MeshRenderer.ready}.
 */
export class MeshRenderer {
  readonly #device: GfxDevice
  readonly #targetColor: TargetFormat

  #flatShader!: ShaderModule
  #pbrShader!: ShaderModule
  #shadowShader!: ShaderModule
  #cubeShader!: ShaderModule
  #gbufferShader!: ShaderModule
  /** Flat / PBR pipelines, indexed by {@link variantOf}. */
  #flatPipelines: Pipeline[] = []
  #pbrPipelines: Pipeline[] = []
  #shadowPipeline!: Pipeline
  #cubePipeline!: Pipeline
  #gbufferPipeline!: Pipeline
  #ready = false
  readonly #failures: RenderFailures
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
  #shadowCamBinding!: RingBinding
  #cubeCamRing!: UboRing
  #cubeCamBinding!: RingBinding

  // Per-object dynamic-offset rings. All are staged: a pass writes every slice
  // into CPU memory and uploads once, so no draw is dropped and a frame costs
  // one buffer write per ring.
  #flatObjectRing!: UboRing
  #pbrObjectRing!: UboRing
  #shadowObjectRing!: UboRing
  #shadowObjectBinding!: RingBinding
  // AO G-buffer prepass: a per-frame UBO + a per-object ring.
  #gbufferFrameUbo!: UBuffer
  #gbufferFrameBindGroup!: BindGroup
  #gbufferObjectRing!: UboRing
  #gbufferObjectBinding!: RingBinding

  // The frame's meshes and lights, gathered by `collect`.
  readonly #meshes: MeshNode[] = []
  readonly #lights: Light3D[] = []
  /** Opaque meshes, the set the AO G-buffer draws. */
  readonly #opaque: MeshNode[] = []
  /** Opaque meshes that cast shadows. */
  readonly #casters: MeshNode[] = []
  readonly #shadowLights: Light3D[] = []
  #collected = false
  // What the shadow maps were last rendered from. They are reused while the
  // casters, the lights and the map size stay the same.
  #shadowsValid = false
  #sig = new Float32Array(0)
  #sigPrev = new Float32Array(0)
  #refs: unknown[] = []
  #refsPrev: unknown[] = []
  readonly #visit = (n: Node): void => {
    if (n instanceof MeshNode) {
      if (n.geometry && isEffectivelyVisible(n)) this.#meshes.push(n)
    } else if (n instanceof Light3D && isEffectivelyVisible(n)) {
      this.#lights.push(n)
    }
  }
  // Records of the main pass and the object bind groups meshes drew with.
  readonly #recs: DrawRec[] = []
  readonly #drawList: DrawRec[] = []
  #objectGroups = new WeakMap<MeshNode, ObjectGroup>()
  // Shadow pass: each caster's upload and ring slice, and the camera slices.
  readonly #casterGpu: GpuMesh[] = []
  readonly #casterOff: number[] = []
  readonly #layerCamOff: number[] = [0, 0, 0, 0]
  readonly #faceCamOff: number[] = [0, 0, 0, 0, 0, 0]
  /** The camera's frustum, and each shadow layer's and cube face's. */
  readonly #frustum = createFrustum()
  readonly #layerFrusta: FrustumPlanes[] = Array.from(
    { length: MAX_SHADOW_LAYERS },
    createFrustum,
  )
  readonly #faceFrusta: FrustumPlanes[] = Array.from(
    { length: 6 },
    createFrustum,
  )
  /** The world box of each staged caster, six numbers each. */
  #casterBox = new Float64Array(0)
  readonly #box = new Float64Array(6)
  readonly #gbufferGpu: GpuMesh[] = []
  readonly #gbufferOff: number[] = []

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
  #whiteTex!: Texture
  readonly #offRestore: () => void
  readonly #normalMat: Mat3 = mat3()
  #texCache = new WeakMap<TextureImage, Map<number, Texture>>()
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
  readonly stats = {
    draws: 0,
    visible: 0,
    /** Meshes outside the camera's view, not drawn in the main pass. */
    culled: 0,
    vertices: 0,
    triangles: 0,
    /** Shadow depth passes rendered this frame, none when the maps are reused. */
    shadowPasses: 0,
  }

  constructor(
    device: GfxDevice,
    targetColor: TargetFormat,
    quality: RenderQuality = new RenderQuality(),
    fog: Fog = new Fog(),
    failures: RenderFailures = new RenderFailures(),
  ) {
    this.#failures = failures
    this.#device = device
    // Own a private copy: `retarget` mutates this, and the caller may share the
    // object it passed.
    this.#targetColor = { ...targetColor }
    this.#quality = quality
    this.#fog = fog
    this.#createResources()
    this.#offRestore = device.onContextRestored(() => this.#onContextRestored())
  }

  /** Whether the pipelines are warm. `Stage` skips the 3D pass until then. */
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
  retarget(targetColor: TargetFormat): void {
    if (
      this.#targetColor.format === targetColor.format &&
      this.#targetColor.samples === targetColor.samples &&
      this.#targetColor.depthStencil === targetColor.depthStencil
    )
      return
    this.#targetColor.format = targetColor.format
    this.#targetColor.samples = targetColor.samples
    this.#targetColor.depthStencil = targetColor.depthStencil
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
    this.#shadowCamRing = new UboRing(
      device,
      SHADOW_CAM_BYTES,
      8,
      'shadowCam',
      true,
      true,
    )
    this.#shadowCamBinding = new RingBinding(
      this.#shadowCamRing,
      this.#shadowCamLayout,
      CAMERA3D_UBO_BINDING,
      SHADOW_CAM_BYTES,
    )
    this.#cubeCamRing = new UboRing(
      device,
      CUBE_CAM_BYTES,
      8,
      'cubeCam',
      true,
      true,
    )
    this.#cubeCamBinding = new RingBinding(
      this.#cubeCamRing,
      this.#cubeCamLayout,
      CAMERA3D_UBO_BINDING,
      CUBE_CAM_BYTES,
    )

    // Per-object rings.
    this.#flatObjectRing = new UboRing(
      device,
      FLAT_OBJECT_BYTES,
      256,
      'flatObj',
      true,
      true,
    )
    this.#pbrObjectRing = new UboRing(
      device,
      PBR_OBJECT_BYTES,
      256,
      'pbrObj',
      true,
      true,
    )
    this.#shadowObjectRing = new UboRing(
      device,
      SHADOW_OBJECT_BYTES,
      256,
      'shadowObj',
      true,
      true,
    )
    this.#shadowObjectBinding = new RingBinding(
      this.#shadowObjectRing,
      this.#shadowObjectLayout,
      MESH_OBJECT_UBO_BINDING,
      SHADOW_OBJECT_BYTES,
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
      256,
      'gbufObj',
      true,
      true,
    )
    this.#gbufferObjectBinding = new RingBinding(
      this.#gbufferObjectRing,
      this.#gbufferObjectLayout,
      MESH_OBJECT_UBO_BINDING,
      GBUFFER_OBJECT_BYTES,
    )

    this.#whiteTex = this.#device.createTexture2D({ width: 1, height: 1 })
    void this.#warmup()
  }

  async #warmup(): Promise<void> {
    try {
      await this.#buildPipelines()
    } catch (err) {
      // 3D stays off. The 2D passes are unaffected.
      this.#failures.report('3D renderer', err)
    }
  }

  async #buildPipelines(): Promise<void> {
    this.#ready = false
    const seq = ++this.#warmupSeq
    const device = this.#device
    const format = this.#targetColor.format
    const samples = this.#targetColor.samples
    // The shared screen target may carry stencil for the 2D path alongside the
    // depth this pass needs. The shadow, cube and G-buffer pipelines below
    // render into their own depth-only targets and keep the derived default.
    const depthStencil = this.#targetColor.depthStencil
    const flatLayout = [this.#flatFrameLayout, this.#flatObjectLayout]
    const pbrLayout = [this.#pbrFrameLayout, this.#pbrObjectLayout]
    for (const cull of ['back', 'none'] as const) {
      for (const write of [true, false]) {
        const depth: DepthState = { test: true, write }
        const key = `${cull}|${write}`
        const variant = variantOf(cull === 'none', write)
        this.#flatPipelines[variant] = await device.createPipeline({
          shader: this.#flatShader,
          vertexLayout: this.#flatVertexLayout(),
          bindGroupLayouts: flatLayout,
          color: { format, blend: 'source-over' },
          depth,
          depthStencil,
          cull,
          frontFace: device.ndc.frontFace,
          primitive: 'triangle-list',
          samples,
          label: `mesh-flat-${key}`,
        })
        if (seq !== this.#warmupSeq) return
        this.#pbrPipelines[variant] = await device.createPipeline({
          shader: this.#pbrShader,
          vertexLayout: this.#pbrVertexLayout(),
          bindGroupLayouts: pbrLayout,
          color: { format, blend: 'source-over' },
          depth,
          depthStencil,
          cull,
          frontFace: device.ndc.frontFace,
          primitive: 'triangle-list',
          samples,
          label: `mesh-pbr-${key}`,
        })
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
    // linear depth (BA). No blend, it overwrites every covered pixel.
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
    this.#dropShadows()
    this.#flatPipelines = []
    this.#pbrPipelines = []
    this.#objectGroups = new WeakMap()
    this.#createResources()
  }

  /**
   * Draw every visible, ready node under `root`, viewed through `camera`. Runs
   * inside the stage's main render pass. Each pipeline bakes its own depth/cull
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

  /**
   * Gather the frame's meshes and lights in one walk. `Stage` calls this once
   * before the shadow pass, and the shadow, G-buffer and main passes read the
   * result. A pass called without it gathers for itself.
   */
  collect(root: Node): void {
    this.#meshes.length = 0
    this.#lights.length = 0
    this.#opaque.length = 0
    this.#casters.length = 0
    walkTree(root, this.#visit)
    for (const mesh of this.#meshes) {
      if (isBlended(mesh)) continue
      this.#opaque.push(mesh)
      if (mesh.material.castShadow !== false) this.#casters.push(mesh)
    }
    this.#collected = true
  }

  #ensureCollected(root: Node): void {
    if (this.#collected) return
    this.collect(root)
    this.#collected = false
  }

  render(camera: CameraView3D, root: Node, debugMode = 0): void {
    // The uploaded view-projection must land depth in the backend's clip range
    // (WebGPU keeps [0,1], WebGL [-1,1]). The camera rebuilds only on a change.
    const device = this.#device
    camera.setClipDepth(device.ndc.clipDepth)
    this.stats.draws = 0
    this.stats.visible = 0
    this.stats.culled = 0
    this.stats.vertices = 0
    this.stats.triangles = 0
    this.#flatObjectRing.reset(device)
    this.#pbrObjectRing.reset(device)
    this.#ensureCollected(root)
    // The main pass is the last reader of the frame's lists.
    this.#collected = false
    const meshes = this.#meshes
    if (meshes.length === 0) return

    const eye = camera.eyePosition()
    const frustum = frustumFromMatrix(
      this.#frustum,
      camera.viewProjection,
      device.ndc.clipDepth,
    )
    // Record each mesh and stage its uniforms, then upload each ring once and
    // draw.
    const list = this.#drawList
    list.length = 0
    let anyFlat = false
    let anyPbr = false
    for (const mesh of meshes) {
      if (this.#outside(mesh, frustum)) {
        this.stats.culled++
        continue
      }
      const gpu = this.#ensureUpload(mesh)
      if (!gpu) continue
      const rec = this.#record(list.length)
      rec.mesh = mesh
      rec.gpu = gpu
      rec.blended = isBlended(mesh)
      rec.pbr = !!mesh.material.pbr
      // Transparent meshes still depth-test against the opaque ones but stop
      // writing it.
      rec.variant = variantOf(mesh.material.doubleSided === true, !rec.blended)
      const w = mesh.worldMatrix
      const dx = w[12] - eye.x
      const dy = w[13] - eye.y
      const dz = w[14] - eye.z
      rec.dist = dx * dx + dy * dy + dz * dz
      if (rec.pbr) {
        this.#stagePbr(rec)
        anyPbr = true
      } else {
        this.#stageFlat(rec)
        anyFlat = true
      }
      list.push(rec)
    }
    if (list.length === 0) return
    list.sort(drawOrder)
    if (anyFlat) this.#beginFlat(camera, eye, debugMode)
    if (anyPbr) this.#beginPbr(camera, eye, debugMode, this.#lights)
    this.#flatObjectRing.flush(device)
    this.#pbrObjectRing.flush(device)
    for (const rec of list) this.#drawRec(rec)
  }

  /** The `i`th pooled draw record. */
  #record(i: number): DrawRec {
    let rec = this.#recs[i]
    if (!rec) {
      rec = {
        mesh: null as unknown as MeshNode,
        gpu: null as unknown as GpuMesh,
        pbr: false,
        blended: false,
        variant: 0,
        offset: 0,
        dist: 0,
        tex: [],
      }
      this.#recs[i] = rec
    }
    return rec
  }

  /**
   * Render the shadow-caster depth maps for this frame as depth-only render
   * passes, before the stage's main pass. Stores per-light shadow state that
   * the following {@link MeshRenderer.render} feeds to the PBR program.
   */
  renderShadows(root: Node): void {
    this.stats.shadowPasses = 0
    if (!this.#ready || !this.#quality.meshShadowsEnabled) {
      this.#dropShadows()
      return
    }
    const size = this.#quality.shadowMapSize
    if (size !== this.#shadowResolution) {
      if (this.#shadowArray) this.#device.deleteShadowArray(this.#shadowArray)
      if (this.#shadowCube) this.#device.deleteShadowCube(this.#shadowCube)
      this.#shadowArray = null
      this.#shadowCube = null
      this.#shadowResolution = size
      this.#shadowsValid = false
    }
    this.#ensureCollected(root)
    const casters = this.#casters
    const shadowLights = this.#shadowLights
    shadowLights.length = 0
    for (const light of this.#lights) {
      if (light.shadowEnabled) shadowLights.push(light)
    }
    if (shadowLights.length === 0 || casters.length === 0) {
      this.#dropShadows()
      return
    }
    // The maps and the per-light links from the last render still hold when
    // nothing they were made from has changed.
    const unchanged = this.#shadowInputsUnchanged(casters, shadowLights)
    if (this.#shadowsValid && unchanged) return
    const aabb = this.#castersAABB(casters)
    if (!aabb) {
      this.#dropShadows()
      return
    }
    this.#shadowByLight.clear()
    this.#shadowsValid = true
    const device = this.#device
    this.#shadowObjectRing.reset(device)
    this.#shadowCamRing.reset(device)
    this.#cubeCamRing.reset(device)

    // Every layer and face draws the same casters, so each caster's model matrix
    // is written once and its slice shared by all of them.
    const gpus = this.#casterGpu
    const offsets = this.#casterOff
    gpus.length = 0
    offsets.length = 0
    const s = this.#objStaging
    if (this.#casterBox.length < casters.length * 6) {
      this.#casterBox = new Float64Array(casters.length * 6)
    }
    const boxes = this.#casterBox
    for (const caster of casters) {
      const gpu = this.#ensureUpload(caster)
      if (!gpu) continue
      s.set(caster.worldMatrix, 0)
      const o = gpus.length * 6
      if (this.#worldBox(caster, this.#box)) boxes.set(this.#box, o)
      else boxes.fill(NaN, o, o + 6)
      gpus.push(gpu)
      offsets.push(this.#shadowObjectRing.push(device, s))
    }

    let layer = 0
    for (const light of shadowLights) {
      if (layer >= MAX_SHADOW_LAYERS) break
      const vp = this.#shadowMatrixFor(light, aabb)
      if (!vp) continue
      this.#layerCamOff[layer] = this.#shadowCamRing.push(
        device,
        vp as unknown as Float32Array,
      )
      this.#shadowMats.set(vp, layer * 16)
      frustumFromMatrix(this.#layerFrusta[layer], vp, device.ndc.clipDepth)
      this.#shadowByLight.set(light, { kind: 1, param: layer })
      layer++
    }
    const point = shadowLights.find(
      (l): l is PointLight3D => l instanceof PointLight3D,
    )
    const pointFar = point ? this.#stagePointFaces(point, aabb) : 0
    this.#shadowObjectRing.flush(device)
    this.#shadowCamRing.flush(device)
    this.#cubeCamRing.flush(device)

    this.stats.shadowPasses = layer + (point ? 6 : 0)
    for (let l = 0; l < layer; l++) {
      device.beginRenderPass({
        depth: {
          target: { shadowArray: this.#ensureShadowArray(), layer: l },
          loadOp: 'clear',
        },
      })
      this.#drawShadowCasters(false, this.#layerCamOff[l], this.#layerFrusta[l])
      device.endRenderPass()
    }
    if (point) {
      const cube = this.#ensurePointCube()
      for (let face = 0; face < 6; face++) {
        device.beginRenderPass({
          depth: { target: { shadowCube: cube, face }, loadOp: 'clear' },
        })
        this.#drawShadowCasters(
          true,
          this.#faceCamOff[face],
          this.#faceFrusta[face],
        )
        device.endRenderPass()
      }
      this.#shadowByLight.set(point, { kind: 2, param: pointFar })
    }
  }

  /** Forget the shadow links, so the frame draws unshadowed. */
  #dropShadows(): void {
    this.#shadowByLight.clear()
    this.#shadowsValid = false
  }

  /**
   * Whether everything the shadow maps depend on matches the last render, and
   * if not, record it for the next comparison. That is each caster and its
   * geometry, each shadowing light's placement and reach, and the map size.
   */
  #shadowInputsUnchanged(
    casters: readonly MeshNode[],
    lights: readonly Light3D[],
  ): boolean {
    const need = casters.length * 16 + lights.length * 20 + 1
    if (this.#sig.length !== need) this.#sig = new Float32Array(need)
    const sig = this.#sig
    const refs = this.#refs
    refs.length = 0
    let o = 0
    for (const caster of casters) {
      sig.set(caster.worldMatrix, o)
      o += 16
      refs.push(caster, caster.geometry)
    }
    for (const light of lights) {
      sig.set(light.worldMatrix, o)
      o += 16
      sig[o++] =
        light instanceof DirectionalLight3D ? light.shadowMaxDistance : 0
      sig[o++] = light instanceof SpotLight3D ? light.outerConeAngle : 0
      sig[o++] =
        light instanceof PointLight3D || light instanceof SpotLight3D
          ? light.range
          : 0
      sig[o++] = 0
      refs.push(light)
    }
    sig[o] = this.#shadowResolution
    let same = this.#sigPrev.length === sig.length
    for (let i = 0; same && i < sig.length; i++) {
      if (sig[i] !== this.#sigPrev[i]) same = false
    }
    for (let i = 0; same && i < refs.length; i++) {
      if (refs[i] !== this.#refsPrev[i]) same = false
    }
    same = same && refs.length === this.#refsPrev.length
    if (!same) {
      ;[this.#sig, this.#sigPrev] = [this.#sigPrev, this.#sig]
      ;[this.#refs, this.#refsPrev] = [this.#refsPrev, this.#refs]
    }
    return same
  }

  /**
   * Stage the camera slices of the six faces of a point light's depth cubemap
   * and return the light's far distance.
   */
  #stagePointFaces(light: PointLight3D, aabb: Aabb): number {
    const device = this.#device
    const w = light.worldMatrix
    const px = w[12]
    const py = w[13]
    const pz = w[14]
    const far =
      light.range > 0 ? light.range : this.#castersFar(aabb, px, py, pz)
    const near = Math.max(0.05, far * 0.005)
    const pos = vec3(px, py, pz)
    for (let face = 0; face < 6; face++) {
      // Pad the projection far so geometry at `dist ≈ far` isn't clipped.
      const vp = fitPointCubeFace(
        pos,
        face,
        near,
        far * 1.01,
        device.ndc.clipDepth,
      )
      frustumFromMatrix(this.#faceFrusta[face], vp, device.ndc.clipDepth)
      const s = this.#camStaging
      s.set(vp, 0)
      s[16] = px
      s[17] = py
      s[18] = pz
      s[20] = far
      this.#faceCamOff[face] = this.#cubeCamRing.push(device, s)
    }
    return far
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

  /**
   * Draw the staged casters into the open shadow pass. `camOff` is the pass's
   * slice of the camera ring (group 0), and each caster has its own slice of
   * the object ring (group 1).
   */
  #drawShadowCasters(
    cube: boolean,
    camOff: number,
    frustum: FrustumPlanes,
  ): void {
    const device = this.#device
    const pipeline = cube ? this.#cubePipeline : this.#shadowPipeline
    const camGroup = (
      cube ? this.#cubeCamBinding : this.#shadowCamBinding
    ).group(device)
    const objGroup = this.#shadowObjectBinding.group(device)
    const gpus = this.#casterGpu
    const offsets = this.#casterOff
    const boxes = this.#casterBox
    for (let i = 0; i < gpus.length; i++) {
      // A caster outside this map's sides or past its far plane cannot reach
      // it. One nearer than the near plane still can, so that plane is kept out.
      const o = i * 6
      if (
        boxes[o] === boxes[o] &&
        (boxOutsideFrustum(
          frustum,
          boxes[o],
          boxes[o + 1],
          boxes[o + 2],
          boxes[o + 3],
          boxes[o + 4],
          boxes[o + 5],
          0,
          4,
        ) ||
          boxOutsideFrustum(
            frustum,
            boxes[o],
            boxes[o + 1],
            boxes[o + 2],
            boxes[o + 3],
            boxes[o + 4],
            boxes[o + 5],
            5,
            6,
          ))
      ) {
        continue
      }
      const gpu = gpus[i]
      device.draw({
        pipeline,
        vertexBuffers: gpu.shadowBuffers,
        indexBuffer: gpu.ibo,
        bindGroups: [
          { group: 0, bindGroup: camGroup, dynamicOffsets: [camOff] },
          { group: 1, bindGroup: objGroup, dynamicOffsets: [offsets[i]] },
        ],
        indexCount: gpu.indexCount,
      })
    }
  }

  /**
   * Ambient-occlusion G-buffer prepass: draw opaque, AO-receiving geometry into
   * `target`, writing the view-space normal (octahedral in RG) to the color
   * attachment, and depth to the sampleable depth attachment. Runs
   * single-sample before the main pass. The AO pass reads both to estimate
   * occlusion. Transparent meshes are skipped (they write no depth), matching
   * the shadow-caster set. No-op until pipelines warm.
   */
  renderGBuffer(camera: CameraView3D, root: Node, target: RenderTarget): void {
    if (!this.#ready) return
    const device = this.#device
    camera.setClipDepth(device.ndc.clipDepth)
    this.#ensureCollected(root)
    // Frame block: view-projection + view + near/far, so the prepass can write
    // linear view depth.
    const f = this.#gbufFrameStaging
    f.set(camera.viewProjection as unknown as Float32Array, 0)
    f.set(camera.view as unknown as Float32Array, 16)
    f[32] = camera.near
    f[33] = camera.far
    device.updateUniformBuffer(this.#gbufferFrameUbo, f)
    this.#gbufferObjectRing.reset(device)
    const gpus = this.#gbufferGpu
    const offsets = this.#gbufferOff
    gpus.length = 0
    offsets.length = 0
    const s = this.#gbufObjStaging
    const frustum = frustumFromMatrix(
      this.#frustum,
      camera.viewProjection,
      device.ndc.clipDepth,
    )
    for (const mesh of this.#opaque) {
      if (this.#outside(mesh, frustum)) continue
      const gpu = this.#ensureUpload(mesh)
      if (!gpu) continue
      s.set(mesh.worldMatrix as unknown as Float32Array, 0)
      gpus.push(gpu)
      offsets.push(this.#gbufferObjectRing.push(device, s))
    }
    this.#gbufferObjectRing.flush(device)
    device.beginRenderPass({
      color: {
        target,
        loadOp: 'clear',
        // (0.5, 0.5) octahedral-decodes to +Z. The cleared background normal is
        // arbitrary, since the AO pass ignores far-depth texels.
        clearColor: [0.5, 0.5, 0, 1],
      },
      depth: {
        target: { renderTarget: target },
        loadOp: 'clear',
        clearValue: 1,
      },
    })
    const objGroup = this.#gbufferObjectBinding.group(device)
    for (let i = 0; i < gpus.length; i++) {
      const gpu = gpus[i]
      device.draw({
        pipeline: this.#gbufferPipeline,
        vertexBuffers: gpu.gbufferBuffers,
        indexBuffer: gpu.ibo,
        bindGroups: [
          { group: 0, bindGroup: this.#gbufferFrameBindGroup },
          { group: 1, bindGroup: objGroup, dynamicOffsets: [offsets[i]] },
        ],
        indexCount: gpu.indexCount,
      })
    }
    device.endRenderPass()
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

  /**
   * Write the mesh's world-space box into `out` as min x, y, z then max x, y,
   * z. False when the mesh has no bounds.
   */
  #worldBox(mesh: MeshNode, out: Float64Array): boolean {
    const b = mesh.localBounds()
    if (!b) return false
    const m = mesh.worldMatrix
    // The centre moves by the matrix, and each half extent spreads over the
    // absolute values of its column.
    const cx = (b.min.x + b.max.x) / 2
    const cy = (b.min.y + b.max.y) / 2
    const cz = (b.min.z + b.max.z) / 2
    const ex = (b.max.x - b.min.x) / 2
    const ey = (b.max.y - b.min.y) / 2
    const ez = (b.max.z - b.min.z) / 2
    for (let r = 0; r < 3; r++) {
      const c = m[r] * cx + m[4 + r] * cy + m[8 + r] * cz + m[12 + r]
      const e =
        Math.abs(m[r]) * ex + Math.abs(m[4 + r]) * ey + Math.abs(m[8 + r]) * ez
      out[r] = c - e
      out[3 + r] = c + e
    }
    return true
  }

  /**
   * Whether the mesh lies wholly outside `frustum`. A mesh without bounds never
   * does.
   */
  #outside(mesh: MeshNode, frustum: FrustumPlanes): boolean {
    const box = this.#box
    if (!this.#worldBox(mesh, box)) return false
    return boxOutsideFrustum(
      frustum,
      box[0],
      box[1],
      box[2],
      box[3],
      box[4],
      box[5],
    )
  }

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
    // u_shadowMeta.z is 1 when the light projection keeps depth in [0,1].
    // u_shadowMeta.w is 1 when the shadow map is stored top-down (both true on
    // WebGPU).
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
    // Layout (words): count @0 (ivec4), color[] @4, pos[] @36, dir[] @68,
    // cone[] @100, shadow[] @132 (each array is 8 × 4 words = 32 words).
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

  /** Write a flat mesh's object block into its ring and note its texture. */
  #stageFlat(rec: DrawRec): void {
    const mesh = rec.mesh
    const s = this.#flatObjStaging
    s.set(mesh.worldMatrix, 0) // u_model @0..15
    const c = mesh.material.color
    s[16] = c[0]
    s[17] = c[1]
    s[18] = c[2]
    s[19] = c[3] * mesh.transform.alpha // u_color @16
    const m = mesh.material
    // An unlit mesh can still carry artwork. The flat program takes it straight
    // and upright.
    const base = m.baseColorTex
      ? this.#resolveMap(m.baseColorTex, 'u_texture')
      : null
    s[20] = m.lit ? 1 : 0 // u_flags.x = lit
    s[21] = 0 // u_flags.y, unused
    s[22] = base ? 1 : 0 // u_flags.z = material texture
    s[23] = m.alphaMode === 'MASK' ? (m.alphaCutoff ?? 0.5) : 0 // u_flags.w
    rec.tex[0] = base ?? this.#whiteTex
    rec.offset = this.#flatObjectRing.push(this.#device, s)
  }

  /** Write a PBR mesh's object block into its ring and note its textures. */
  #stagePbr(rec: DrawRec): void {
    const mesh = rec.mesh
    const gpu = rec.gpu
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
    s[54] = m.toonSteps ?? 0 // u_hasTex1.z: diffuse banding, off below 2
    const white = this.#whiteTex
    const tex = rec.tex
    tex[0] = t0 ?? white
    tex[1] = t1 ?? white
    tex[2] = t2 ?? white
    tex[3] = t3 ?? white
    tex[4] = t4 ?? white
    tex[5] = t5 ?? white
    rec.offset = this.#pbrObjectRing.push(this.#device, s)
  }

  /**
   * The object bind group for a record: its ring slice and its textures. A mesh
   * keeps the one it built until its textures change or its ring grows.
   */
  #objectGroup(rec: DrawRec): BindGroup {
    const ring = rec.pbr ? this.#pbrObjectRing : this.#flatObjectRing
    const count = rec.pbr ? 6 : 1
    const held = this.#objectGroups.get(rec.mesh)
    if (
      held &&
      held.pbr === rec.pbr &&
      held.generation === ring.generation &&
      sameTextures(held.tex, rec.tex, count)
    ) {
      return held.group
    }
    const entries: BindGroupEntry[] = [
      {
        binding: MESH_OBJECT_UBO_BINDING,
        resource: {
          uniformBuffer: ring.buffer,
          size: rec.pbr ? PBR_OBJECT_BYTES : FLAT_OBJECT_BYTES,
        },
      },
    ]
    if (rec.pbr) {
      for (let i = 0; i < count; i++) {
        entries.push({
          binding: U_PBR_TEX_BASE + i,
          resource: { texture: rec.tex[i] },
        })
      }
    } else {
      entries.push({ binding: U_TEX, resource: { texture: rec.tex[0] } })
    }
    const group = this.#device.createBindGroup(
      rec.pbr ? this.#pbrObjectLayout : this.#flatObjectLayout,
      entries,
    )
    this.#objectGroups.set(rec.mesh, {
      pbr: rec.pbr,
      generation: ring.generation,
      tex: rec.tex.slice(0, count),
      group,
    })
    return group
  }

  #drawRec(rec: DrawRec): void {
    const gpu = rec.gpu
    const objGroup = this.#objectGroup(rec)
    this.#device.draw({
      pipeline: rec.pbr
        ? this.#pbrPipelines[rec.variant]
        : this.#flatPipelines[rec.variant],
      vertexBuffers: rec.pbr ? gpu.pbrBuffers : gpu.flatBuffers,
      indexBuffer: gpu.ibo,
      bindGroups: [
        // Set by `#beginFlat` / `#beginPbr`, which run before any draw.
        {
          group: 0,
          bindGroup: rec.pbr
            ? this.#pbrFrameBindGroup!
            : this.#flatFrameBindGroup!,
        },
        { group: 1, bindGroup: objGroup, dynamicOffsets: [rec.offset] },
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
    const key =
      (srgb ? 1 : 0) +
      (sampler.wrap === 'repeat' ? 2 : 0) +
      (sampler.mipmap ? 4 : 0)
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
    // Keyed by node, so a node handed different geometry has to re-upload
    // rather than keep drawing the shape it was built with.
    if (existing) {
      if (existing.geometry === geom) return existing
      this.release(mesh)
    }

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
    // layout serves every mesh. The shader gates their use by flags.
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
      flatBuffers: [
        { buffer: posBuf, offset: 0 },
        { buffer: normBuf, offset: 0 },
        { buffer: uvBuf, offset: 0 },
      ],
      pbrBuffers: [
        { buffer: posBuf, offset: 0 },
        { buffer: normBuf, offset: 0 },
        { buffer: uvBuf, offset: 0 },
        { buffer: tangentBuf, offset: 0 },
      ],
      shadowBuffers: [{ buffer: posBuf, offset: 0 }],
      gbufferBuffers: [
        { buffer: posBuf, offset: 0 },
        { buffer: normBuf, offset: 0 },
      ],
      hasTangent: !!geom.tangents,
      geometry: geom,
      // `#uploaded` holds meshes strongly so `destroy` can free them all, which
      // means a destroyed node would otherwise keep its buffers for the life of
      // the renderer. `destroy` fires once per node.
      offDestroy: mesh.events.on('destroy', () => this.release(mesh)),
    }
    this.#cache.set(mesh, gpu)
    this.#uploaded.add(mesh)
    return gpu
  }

  release(mesh: MeshNode): void {
    const gpu = this.#cache.get(mesh)
    if (!gpu) return
    gpu.offDestroy?.()
    this.#device.deleteBuffer(gpu.posBuf)
    this.#device.deleteBuffer(gpu.normBuf)
    this.#device.deleteBuffer(gpu.uvBuf)
    this.#device.deleteBuffer(gpu.tangentBuf)
    this.#device.deleteIndexBuffer(gpu.ibo)
    this.#cache.delete(mesh)
    this.#uploaded.delete(mesh)
    this.#objectGroups.delete(mesh)
  }

  destroy(): void {
    this.#offRestore()
    for (const mesh of this.#uploaded) this.release(mesh)
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
    for (const ring of [
      this.#shadowCamRing,
      this.#cubeCamRing,
      this.#flatObjectRing,
      this.#pbrObjectRing,
      this.#shadowObjectRing,
      this.#gbufferObjectRing,
    ]) {
      ring.dispose(this.#device)
    }
    if (this.#shadowArray) this.#device.deleteShadowArray(this.#shadowArray)
    if (this.#placeholderArray)
      this.#device.deleteShadowArray(this.#placeholderArray)
    if (this.#shadowCube) this.#device.deleteShadowCube(this.#shadowCube)
    if (this.#placeholderCube)
      this.#device.deleteShadowCube(this.#placeholderCube)
    this.#modelInspector.clear()
  }
}

function sameTextures(held: Texture[], now: Texture[], count: number): boolean {
  for (let i = 0; i < count; i++) if (held[i] !== now[i]) return false
  return true
}

/**
 * True for meshes drawn in the transparent bucket, those with a `BLEND`
 * material. Opaque and alpha-`MASK` meshes stay in the depth-writing opaque
 * bucket.
 */
function isBlended(node: Node3D): boolean {
  return node instanceof MeshNode && node.material.alphaMode === 'BLEND'
}

/** True when the node and every ancestor is visible (any kind). */
