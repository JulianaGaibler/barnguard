import type {
  BindGroup,
  BindGroupLayout,
  ComputePipeline,
  GfxDevice,
  Pipeline,
  RenderTarget,
  ShaderModule,
  ShaderReflection,
  Texture,
  UBuffer,
  VBuffer,
} from '../GfxDevice'
import type { CameraView3D } from '../../../camera/CameraView3D'
import type { Node } from '../../../scene/Node'
import type { MeshRenderer } from '../MeshRenderer'
import { POST_PARAMS_UBO_BINDING } from '../batchLayout'
import aoWgsl from '../shaders/ao_gtao.wgsl?raw'
import aoVertSrc from '../shaders/ao_gtao.gen.vert.glsl?raw'
import aoFragSrc from '../shaders/ao_gtao.gen.frag.glsl?raw'
import aoReflect from '../shaders/ao_gtao.reflect.json'
import aoComputeWgsl from '../shaders/ao_gtao.compute.wgsl?raw'
import blurWgsl from '../shaders/ao_blur.wgsl?raw'
import blurVertSrc from '../shaders/ao_blur.gen.vert.glsl?raw'
import blurFragSrc from '../shaders/ao_blur.gen.frag.glsl?raw'
import blurReflect from '../shaders/ao_blur.reflect.json'
import blurComputeWgsl from '../shaders/ao_blur.compute.wgsl?raw'

/** Quality preset: slice/step budget and the occlusion feel. */
export type AoPreset = 'low' | 'medium' | 'high'

interface PresetParams {
  slices: number
  steps: number
  radius: number
  intensity: number
  bias: number
}

const PRESETS: Record<AoPreset, PresetParams> = {
  low: { slices: 2, steps: 3, radius: 0.6, intensity: 2, bias: 0.1 },
  medium: { slices: 3, steps: 4, radius: 0.6, intensity: 2.5, bias: 0.1 },
  high: { slices: 4, steps: 6, radius: 0.6, intensity: 3, bias: 0.1 },
}

/** Fullscreen clip-space triangle (fragment path). */
const FULLSCREEN_TRI = new Float32Array([-1, -1, 3, -1, -1, 3])
/** Bilateral blur edge-stop tightness in window-depth space. */
const BLUR_DEPTH_SIGMA = 0.02

// Bind-group binding numbers (a texture's companion sampler is at binding + 16).
const B_TEX = 0 // generate: G-buffer;  blur: AO input
const B_GBUF = 1 // blur: G-buffer (for depth)
const B_STORAGE = 1 // generate compute output
const B_BLUR_STORAGE = 2 // blur compute output

const GEN_PARAMS_BYTES = 128
const BLUR_PARAMS_BYTES = 32

/**
 * Screen-space ambient occlusion for the 3D pass. A `Stage` owns one lazily and
 * runs it before the main pass when {@link AmbientOcclusion.enabled}: the mesh
 * renderer fills a G-buffer (view normal + packed depth), this estimates
 * occlusion, then a separable depth-aware bilateral blur cleans the noise into
 * {@link AmbientOcclusion.aoTexture}, which the mesh shaders sample to modulate
 * ambient light.
 *
 * Generate + blur run as compute dispatches on WebGPU and fullscreen fragment
 * passes on WebGL2, chosen by `device.supportsCompute`; both share the
 * horizon-scan and blur math. Targets allocate on first enable and resize with
 * the stage.
 *
 * @category Render
 */
export class AmbientOcclusion {
  readonly #device: GfxDevice
  #enabled = false
  #preset: AoPreset = 'medium'
  #intensityOverride: number | null = null
  #radiusOverride: number | null = null
  #directStrength = 0
  #ready = false

  // Targets, (re)allocated on size change.
  #gbuffer: RenderTarget | null = null
  #gbufTex: Texture | null = null
  /**
   * Ping-pong AO buffers: [0] holds the generate + final result, [1] is
   * scratch.
   */
  #aoRt: [RenderTarget, RenderTarget] | null = null // WebGL2 fragment path
  #aoStore: [Texture, Texture] | null = null // WebGPU compute path
  #aoTexView: [Texture, Texture] | null = null // sampleable views of both buffers
  #aoTex: Texture | null = null
  #width = 0
  #height = 0

  // Generate.
  #genFragShader!: ShaderModule
  #genFragLayout!: BindGroupLayout
  #genFragPipeline: Pipeline | null = null
  #genComputeShader!: ShaderModule
  #genComputeLayout!: BindGroupLayout
  #genComputePipeline: ComputePipeline | null = null
  #genParamsUbo!: UBuffer
  readonly #genStaging = new Float32Array(GEN_PARAMS_BYTES / 4)
  #genBind: BindGroup | null = null

  // Blur (separable H then V).
  #blurFragShader!: ShaderModule
  #blurFragLayout!: BindGroupLayout
  #blurFragPipeline: Pipeline | null = null
  #blurComputeShader!: ShaderModule
  #blurComputeLayout!: BindGroupLayout
  #blurComputePipeline: ComputePipeline | null = null
  #blurHUbo!: UBuffer
  #blurVUbo!: UBuffer
  readonly #blurStaging = new Float32Array(BLUR_PARAMS_BYTES / 4)
  #blurHBind: BindGroup | null = null
  #blurVBind: BindGroup | null = null

  #vbo: VBuffer | null = null

  constructor(device: GfxDevice) {
    this.#device = device
    this.#createResources()
  }

  get enabled(): boolean {
    return this.#enabled
  }
  set enabled(v: boolean) {
    if (this.#enabled === v) return
    this.#enabled = v
    if (!v) this.#freeTargets()
  }

  get preset(): AoPreset {
    return this.#preset
  }
  set preset(p: AoPreset) {
    this.#preset = p
  }

  /**
   * Occlusion strength. Reads the preset's value unless overridden; the debug
   * HUD sets it to tune live. Setting resets to the preset when passed the
   * preset's own value is not required — any number sticks until changed.
   */
  get intensity(): number {
    return this.#intensityOverride ?? PRESETS[this.#preset].intensity
  }
  set intensity(v: number) {
    this.#intensityOverride = v
  }

  /** Sampling radius in view-space units. Preset value unless overridden. */
  get radius(): number {
    return this.#radiusOverride ?? PRESETS[this.#preset].radius
  }
  set radius(v: number) {
    this.#radiusOverride = v
  }

  /**
   * How much AO also darkens the DIFFUSE direct light, in `[0,1]`. `0` is
   * physically correct (AO only touches the flat ambient term); higher values
   * are a stylized/baked-AO look that makes contact darkening read on directly
   * lit surfaces too. Never affects specular. The mesh shaders read it.
   */
  get directStrength(): number {
    return this.#directStrength
  }
  set directStrength(v: number) {
    this.#directStrength = Math.max(0, Math.min(1, v))
  }

  /** Whether pipelines are warm. `run` is a no-op until then. */
  get ready(): boolean {
    return this.#ready
  }

  /**
   * The blurred AO texture the mesh pass samples (greyscale, 1 = unoccluded).
   * Null until the first {@link AmbientOcclusion.run}. Single-sample.
   */
  get aoTexture(): Texture | null {
    return this.#aoTex
  }

  #createResources(): void {
    const device = this.#device
    this.#genParamsUbo = device.createUniformBuffer(GEN_PARAMS_BYTES)
    this.#blurHUbo = device.createUniformBuffer(BLUR_PARAMS_BYTES)
    this.#blurVUbo = device.createUniformBuffer(BLUR_PARAMS_BYTES)

    this.#genFragShader = device.createShaderModule({
      glsl: { vertex: aoVertSrc, fragment: aoFragSrc },
      wgsl: { code: aoWgsl, vertexEntry: 'vs_main', fragmentEntry: 'fs_main' },
      reflection: aoReflect as ShaderReflection,
      label: 'ao-gtao',
    })
    this.#genFragLayout = device.createBindGroupLayout([
      { binding: B_TEX, type: 'texture-2d' },
      { binding: POST_PARAMS_UBO_BINDING, type: 'uniform-buffer' },
    ])
    this.#blurFragShader = device.createShaderModule({
      glsl: { vertex: blurVertSrc, fragment: blurFragSrc },
      wgsl: {
        code: blurWgsl,
        vertexEntry: 'vs_main',
        fragmentEntry: 'fs_main',
      },
      reflection: blurReflect as ShaderReflection,
      label: 'ao-blur',
    })
    this.#blurFragLayout = device.createBindGroupLayout([
      { binding: B_TEX, type: 'texture-2d' },
      { binding: B_GBUF, type: 'texture-2d' },
      { binding: POST_PARAMS_UBO_BINDING, type: 'uniform-buffer' },
    ])

    if (device.supportsCompute) {
      this.#genComputeShader = device.createShaderModule({
        wgsl: { code: aoComputeWgsl, computeEntry: 'cs_main' },
        reflection: { attributes: [], uniformBlocks: [], samplers: [] },
        label: 'ao-gtao-compute',
      })
      this.#genComputeLayout = device.createBindGroupLayout([
        { binding: B_TEX, type: 'texture-2d' },
        { binding: B_STORAGE, type: 'storage-texture-2d' },
        { binding: POST_PARAMS_UBO_BINDING, type: 'uniform-buffer' },
      ])
      this.#blurComputeShader = device.createShaderModule({
        wgsl: { code: blurComputeWgsl, computeEntry: 'cs_main' },
        reflection: { attributes: [], uniformBlocks: [], samplers: [] },
        label: 'ao-blur-compute',
      })
      this.#blurComputeLayout = device.createBindGroupLayout([
        { binding: B_TEX, type: 'texture-2d' },
        { binding: B_GBUF, type: 'texture-2d' },
        { binding: B_BLUR_STORAGE, type: 'storage-texture-2d' },
        { binding: POST_PARAMS_UBO_BINDING, type: 'uniform-buffer' },
      ])
    }
    void this.#warmup()
  }

  async #warmup(): Promise<void> {
    const device = this.#device
    if (device.supportsCompute) {
      this.#genComputePipeline = await device.createComputePipeline({
        shader: this.#genComputeShader,
        bindGroupLayouts: [this.#genComputeLayout],
        label: 'ao-gtao-compute',
      })
      this.#blurComputePipeline = await device.createComputePipeline({
        shader: this.#blurComputeShader,
        bindGroupLayouts: [this.#blurComputeLayout],
        label: 'ao-blur-compute',
      })
    } else {
      const vertexLayout = [
        {
          arrayStride: 8,
          stepMode: 'vertex' as const,
          attributes: [
            { location: 0, format: 'float32x2' as const, offset: 0 },
          ],
        },
      ]
      this.#genFragPipeline = await device.createPipeline({
        shader: this.#genFragShader,
        vertexLayout,
        bindGroupLayouts: [this.#genFragLayout],
        color: { format: 'linear', blend: 'none' },
        depth: null,
        cull: 'none',
        frontFace: device.ndc.frontFace,
        primitive: 'triangle-list',
        samples: 1,
        label: 'ao-gtao',
      })
      this.#blurFragPipeline = await device.createPipeline({
        shader: this.#blurFragShader,
        vertexLayout,
        bindGroupLayouts: [this.#blurFragLayout],
        color: { format: 'linear', blend: 'none' },
        depth: null,
        cull: 'none',
        frontFace: device.ndc.frontFace,
        primitive: 'triangle-list',
        samples: 1,
        label: 'ao-blur',
      })
      this.#vbo = device.createVertexBuffer(FULLSCREEN_TRI.byteLength)
      device.updateBufferSubData(this.#vbo, 0, FULLSCREEN_TRI)
    }
    this.#ready = true
  }

  /**
   * Fill the G-buffer, estimate occlusion, and blur it for this frame. Call
   * before the stage's `beginFrame`, in the same pre-frame window as the shadow
   * prepass. No-op until pipelines warm.
   */
  run(
    camera: CameraView3D,
    root: Node,
    meshRenderer: MeshRenderer,
    pixelW: number,
    pixelH: number,
  ): void {
    if (!this.#enabled || !this.#ready) return
    this.#ensureTargets(pixelW, pixelH)
    meshRenderer.renderGBuffer(camera, root, this.#gbuffer!)
    this.#writeGenParams(camera, pixelW, pixelH)
    if (this.#device.supportsCompute) this.#runCompute(pixelW, pixelH)
    else this.#runFragment()
  }

  #runCompute(w: number, h: number): void {
    const device = this.#device
    const gx = Math.ceil(w / 8)
    const gy = Math.ceil(h / 8)
    device.beginComputePass()
    // generate → buffer 0
    device.dispatchCompute({
      pipeline: this.#genComputePipeline!,
      bindGroups: [{ group: 0, bindGroup: this.#genBind! }],
      x: gx,
      y: gy,
    })
    // blur H: 0 → 1, blur V: 1 → 0
    device.dispatchCompute({
      pipeline: this.#blurComputePipeline!,
      bindGroups: [{ group: 0, bindGroup: this.#blurHBind! }],
      x: gx,
      y: gy,
    })
    device.dispatchCompute({
      pipeline: this.#blurComputePipeline!,
      bindGroups: [{ group: 0, bindGroup: this.#blurVBind! }],
      x: gx,
      y: gy,
    })
    device.endComputePass()
  }

  #runFragment(): void {
    const [rt0, rt1] = this.#aoRt!
    // generate → rt0
    this.#fragPass(this.#genFragPipeline!, this.#genBind!, rt0)
    // blur H: rt0 → rt1
    this.#fragPass(this.#blurFragPipeline!, this.#blurHBind!, rt1)
    // blur V: rt1 → rt0 (final)
    this.#fragPass(this.#blurFragPipeline!, this.#blurVBind!, rt0)
  }

  #fragPass(
    pipeline: Pipeline,
    bindGroup: BindGroup,
    target: RenderTarget,
  ): void {
    const device = this.#device
    device.beginRenderPass({
      color: { target, loadOp: 'clear', clearColor: [1, 1, 1, 1] },
    })
    device.draw({
      pipeline,
      vertexBuffers: [{ buffer: this.#vbo!, offset: 0 }],
      bindGroups: [{ group: 0, bindGroup }],
      vertexCount: 3,
    })
    device.endRenderPass()
  }

  #ensureTargets(w: number, h: number): void {
    if (this.#gbuffer && this.#width === w && this.#height === h) return
    this.#freeTargets()
    const device = this.#device
    this.#width = w
    this.#height = h
    this.#gbuffer = device.createRenderTarget({
      width: w,
      height: h,
      depth: true,
      colorSpace: 'linear',
    })
    this.#gbufTex = device.colorTexture(this.#gbuffer)

    if (device.supportsCompute) {
      const mk = (): Texture =>
        device.createTexture2D({
          width: w,
          height: h,
          filter: 'linear',
          storage: true,
        })
      this.#aoStore = [mk(), mk()]
      this.#aoTexView = this.#aoStore
    } else {
      const mk = (): RenderTarget =>
        device.createRenderTarget({ width: w, height: h, colorSpace: 'linear' })
      this.#aoRt = [mk(), mk()]
      this.#aoTexView = [
        device.colorTexture(this.#aoRt[0]),
        device.colorTexture(this.#aoRt[1]),
      ]
    }
    this.#aoTex = this.#aoTexView[0]
    this.#buildBindGroups()
    this.#writeBlurParams(w, h)
  }

  #buildBindGroups(): void {
    const device = this.#device
    const gbuf = this.#gbufTex!
    const [buf0, buf1] = this.#aoTexView!
    const params = { uniformBuffer: this.#genParamsUbo }
    if (device.supportsCompute) {
      const store = this.#aoStore!
      this.#genBind = device.createBindGroup(this.#genComputeLayout, [
        { binding: B_TEX, resource: { texture: gbuf } },
        { binding: B_STORAGE, resource: { texture: store[0] } },
        { binding: POST_PARAMS_UBO_BINDING, resource: params },
      ])
      this.#blurHBind = device.createBindGroup(this.#blurComputeLayout, [
        { binding: B_TEX, resource: { texture: buf0 } },
        { binding: B_GBUF, resource: { texture: gbuf } },
        { binding: B_BLUR_STORAGE, resource: { texture: store[1] } },
        {
          binding: POST_PARAMS_UBO_BINDING,
          resource: { uniformBuffer: this.#blurHUbo },
        },
      ])
      this.#blurVBind = device.createBindGroup(this.#blurComputeLayout, [
        { binding: B_TEX, resource: { texture: buf1 } },
        { binding: B_GBUF, resource: { texture: gbuf } },
        { binding: B_BLUR_STORAGE, resource: { texture: store[0] } },
        {
          binding: POST_PARAMS_UBO_BINDING,
          resource: { uniformBuffer: this.#blurVUbo },
        },
      ])
    } else {
      this.#genBind = device.createBindGroup(this.#genFragLayout, [
        { binding: B_TEX, resource: { texture: gbuf } },
        { binding: POST_PARAMS_UBO_BINDING, resource: params },
      ])
      this.#blurHBind = device.createBindGroup(this.#blurFragLayout, [
        { binding: B_TEX, resource: { texture: buf0 } },
        { binding: B_GBUF, resource: { texture: gbuf } },
        {
          binding: POST_PARAMS_UBO_BINDING,
          resource: { uniformBuffer: this.#blurHUbo },
        },
      ])
      this.#blurVBind = device.createBindGroup(this.#blurFragLayout, [
        { binding: B_TEX, resource: { texture: buf1 } },
        { binding: B_GBUF, resource: { texture: gbuf } },
        {
          binding: POST_PARAMS_UBO_BINDING,
          resource: { uniformBuffer: this.#blurVUbo },
        },
      ])
    }
  }

  #writeGenParams(camera: CameraView3D, w: number, h: number): void {
    const s = this.#genStaging
    s.set(camera.invProjection as unknown as Float32Array, 0)
    // resTexel
    s[16] = w
    s[17] = h
    s[18] = w > 0 ? 1 / w : 0
    s[19] = h > 0 ? 1 / h : 0
    // radiusIntBias: radius, intensity, angle bias, slices
    const p = PRESETS[this.#preset]
    s[20] = this.radius
    s[21] = this.intensity
    s[22] = p.bias
    s[23] = p.slices
    // stepsNearFar: steps, near, far, ndc-z of near plane (WebGPU 0, WebGL -1)
    const zeroToOne = this.#device.ndc.clipDepth === 'zero-to-one'
    s[24] = p.steps
    s[25] = camera.near
    s[26] = camera.far
    s[27] = zeroToOne ? 0 : -1
    // proj: ndc-z of far plane (1), projection[0][0], projection[1][1], flipY.
    // proj[0][0]/[1][1] give the screen radius per axis (FOV + aspect); flipY is
    // set for top-down textures so the reconstructed NDC y matches the sample.
    const proj = camera.projection as unknown as Float32Array
    s[28] = 1
    s[29] = proj[0]
    s[30] = proj[5]
    s[31] = this.#device.ndc.textureTopDown ? 1 : 0
    this.#device.updateUniformBuffer(this.#genParamsUbo, s)
  }

  #writeBlurParams(w: number, h: number): void {
    const s = this.#blurStaging
    // Horizontal.
    s[0] = 1
    s[1] = 0
    s[2] = w
    s[3] = h
    s[4] = BLUR_DEPTH_SIGMA
    this.#device.updateUniformBuffer(this.#blurHUbo, s)
    // Vertical.
    s[0] = 0
    s[1] = 1
    this.#device.updateUniformBuffer(this.#blurVUbo, s)
  }

  #freeTargets(): void {
    const device = this.#device
    if (this.#gbuffer) device.deleteRenderTarget(this.#gbuffer)
    if (this.#aoRt) for (const rt of this.#aoRt) device.deleteRenderTarget(rt)
    if (this.#aoStore) for (const t of this.#aoStore) device.deleteTexture(t)
    for (const bg of [this.#genBind, this.#blurHBind, this.#blurVBind])
      if (bg) device.deleteBindGroup(bg)
    this.#gbuffer = null
    this.#gbufTex = null
    this.#aoRt = null
    this.#aoStore = null
    this.#aoTexView = null
    this.#aoTex = null
    this.#genBind = null
    this.#blurHBind = null
    this.#blurVBind = null
    this.#width = 0
    this.#height = 0
  }

  /** Release every GPU resource. */
  dispose(): void {
    this.#freeTargets()
    if (this.#vbo) this.#device.deleteBuffer(this.#vbo)
    this.#device.deleteUniformBuffer(this.#genParamsUbo)
    this.#device.deleteUniformBuffer(this.#blurHUbo)
    this.#device.deleteUniformBuffer(this.#blurVUbo)
    this.#vbo = null
  }
}
