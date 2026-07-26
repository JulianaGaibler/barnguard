import type {
  GfxDevice,
  Program,
  VBuffer,
  IBuffer,
  Vao,
  Texture,
  IndexType,
} from './GfxDevice'
import type { Camera3D } from '../../camera/Camera3D'
import type { Node } from '../../scene/Node'
import type { Node3D } from '../../scene/Node3D'
import { MeshNode } from '../../nodes/MeshNode'
import { Viewport2DNode } from '../../nodes/Viewport2DNode'
import { walkTree } from '../../scene/traverse'
import meshVertSrc from './webgl2/shaders/mesh.vert.glsl?raw'
import meshFragSrc from './webgl2/shaders/mesh.frag.glsl?raw'

/** A single directional light plus ambient term for the 3D pass. */
export interface Light3D {
  /** World-space direction the light travels (need not be unit; the shader normalizes). */
  direction: [number, number, number]
  /** Light rgb in `0..1`. */
  color: [number, number, number]
  /** Ambient rgb in `0..1`. */
  ambient: [number, number, number]
}

const DEFAULT_LIGHT: Light3D = {
  direction: [-0.4, -1, -0.6],
  color: [1, 1, 1],
  ambient: [0.25, 0.25, 0.3],
}

interface GpuMesh {
  posBuf: VBuffer
  normBuf: VBuffer
  uvBuf?: VBuffer
  ibo: IBuffer
  vao: Vao
  indexCount: number
}

const LOC_POSITION = 0
const LOC_NORMAL = 1
const LOC_UV = 2

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
  #program: Program
  #cache = new WeakMap<MeshNode, GpuMesh>()
  readonly #uploaded = new Set<MeshNode>()
  #quad: GpuMesh
  #whiteTex: Texture
  readonly #offRestore: () => void

  /** Scene light. Mutate in place or replace to relight the 3D pass. */
  light: Light3D = { ...DEFAULT_LIGHT }

  /** Last-frame draw counts, read by the debug HUD. Reset each `render`. */
  readonly stats = { draws: 0, visible: 0, vertices: 0, triangles: 0 }

  constructor(device: GfxDevice) {
    this.#device = device
    this.#program = this.#createProgram()
    this.#quad = this.#createQuad()
    this.#whiteTex = device.createTexture2D({ width: 1, height: 1 })
    this.#offRestore = device.onContextRestored(() => this.#onContextRestored())
  }

  #createProgram(): Program {
    return this.#device.createProgram({
      vertexSrc: meshVertSrc,
      fragmentSrc: meshFragSrc,
      attribs: { a_position: LOC_POSITION, a_normal: LOC_NORMAL, a_uv: LOC_UV },
    })
  }

  #onContextRestored(): void {
    // GPU handles from the lost context are dead. Recreate shared resources and
    // drop the mesh cache; meshes re-upload lazily from CPU geometry next frame.
    this.#program = this.#createProgram()
    this.#quad = this.#createQuad()
    this.#whiteTex = this.#device.createTexture2D({ width: 1, height: 1 })
    this.#cache = new WeakMap()
    this.#uploaded.clear()
  }

  /**
   * Draw every visible, ready node under `root`, viewed through `camera`. Sets
   * depth test + back-face culling; the caller restores 2D baseline state
   * afterward via {@link GfxDevice.resetToBaseline}.
   */
  render(camera: Camera3D, root: Node, debugMode = 0): void {
    this.stats.draws = 0
    this.stats.visible = 0
    this.stats.vertices = 0
    this.stats.triangles = 0
    const drawables: Node3D[] = []
    walkTree(root, (n) => {
      // Honor visibility up the whole (possibly cross-kind) ancestor chain, so a
      // 3D node nested under a hidden 2D/group node is culled.
      if (n instanceof MeshNode && n.geometry && isEffectivelyVisible(n)) drawables.push(n)
      else if (n instanceof Viewport2DNode && isEffectivelyVisible(n)) drawables.push(n)
    })
    if (drawables.length === 0) return

    const device = this.#device
    const program = this.#program

    // Order back-to-front for correct premultiplied source-over blending.
    const eye = camera.eyePosition()
    const distSq = (m: Node3D): number => {
      const w = m.worldMatrix
      const dx = w[12] - eye.x
      const dy = w[13] - eye.y
      const dz = w[14] - eye.z
      return dx * dx + dy * dy + dz * dz
    }
    drawables.sort((a, b) => distSq(b) - distSq(a))

    device.useProgram(program)
    device.setDepthTest(true)
    device.setDepthWrite(true)
    device.setCullFace('back')

    device.setUniformMat4(program, 'u_viewProj', camera.viewProjection)
    // Debug render view (0 normal, 1 unshaded, 2 normals); one value per frame.
    device.setUniform1f(program, 'u_debugMode', debugMode)
    const l = this.light
    device.setUniform4f(program, 'u_lightDir', l.direction[0], l.direction[1], l.direction[2], 0)
    device.setUniform4f(program, 'u_lightColor', l.color[0], l.color[1], l.color[2], 0)
    device.setUniform4f(program, 'u_ambient', l.ambient[0], l.ambient[1], l.ambient[2], 0)

    for (const node of drawables) {
      if (node instanceof Viewport2DNode) {
        this.#drawViewport(node)
      } else {
        this.#drawMesh(node as MeshNode)
      }
    }
  }

  #drawMesh(mesh: MeshNode): void {
    const gpu = this.#ensureUpload(mesh)
    if (!gpu) return
    const device = this.#device
    const program = this.#program
    device.setUniformMat4(program, 'u_model', mesh.worldMatrix)
    const c = mesh.material.color
    device.setUniform4f(program, 'u_color', c[0], c[1], c[2], c[3] * mesh.transform.alpha)
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

    const indexType: IndexType = geom.indices instanceof Uint32Array ? 'u32' : 'u16'
    const ibo = device.createIndexBuffer(geom.indices.byteLength, indexType)
    device.updateIndexBufferSubData(ibo, 0, geom.indices)

    const vao = device.createVao(
      this.#program,
      [
        this.#attrib(posBuf, LOC_POSITION),
        this.#attrib(normBuf, LOC_NORMAL),
      ],
      ibo,
    )
    const gpu: GpuMesh = { posBuf, normBuf, ibo, vao, indexCount: geom.indices.length }
    this.#cache.set(mesh, gpu)
    this.#uploaded.add(mesh)
    return gpu
  }

  #attrib(buffer: VBuffer, location: number): {
    buffer: VBuffer
    location: number
    size: 3
    type: 'float'
    normalized: false
    offset: number
    stride: number
    divisor: number
  } {
    return {
      buffer,
      location,
      size: 3,
      type: 'float',
      normalized: false,
      offset: 0,
      stride: 12,
      divisor: 0,
    }
  }

  /** Build the shared textured unit quad (1×1 in local xy, facing +z). */
  #createQuad(): GpuMesh {
    const device = this.#device
    const positions = new Float32Array([
      -0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0,
    ])
    const normals = new Float32Array([
      0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1,
    ])
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
        this.#attrib(posBuf, LOC_POSITION),
        this.#attrib(normBuf, LOC_NORMAL),
        {
          buffer: uvBuf,
          location: LOC_UV,
          size: 2,
          type: 'float',
          normalized: false,
          offset: 0,
          stride: 8,
          divisor: 0,
        },
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
    this.#device.deleteTexture(this.#whiteTex)
    this.#device.deleteProgram(this.#program)
  }
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
