// Debug-inspector view over a 3D model's material textures. `MeshRenderer`
// tracks each glTF image it uploads here (by role) and reports uploaded sizes.
// The HUD's texture inspector reads `snapshot()`, which lazily decodes a
// downscaled preview per source. Kept apart from the renderer because it only
// touches image bytes and produces canvases, no render state.

import type { TextureImage } from '../../nodes/MeshNode'
import type {
  TextureInspector,
  TextureInspectorSnapshot,
} from './TextureManager'

interface ModelTexEntry {
  roles: Set<string>
  width: number
  height: number
  preview: HTMLCanvasElement | null
}

const MODEL_PREVIEW_MAX = 128

/**
 * Collects the model's material textures for the debug HUD. Implements the
 * shared {@link TextureInspector} surface (the label-preview half is a no-op,
 * meshes have no label atlas).
 */
export class ModelTextureInspector implements TextureInspector {
  readonly #entries = new Map<TextureImage, ModelTexEntry>()
  readonly #previewDecoding = new Set<TextureImage>()

  /** Whether any texture has been tracked (the getter gate in `MeshRenderer`). */
  get hasEntries(): boolean {
    return this.#entries.size > 0
  }

  /**
   * Record that `image` is used in the `samplerName` role (e.g.
   * `u_baseColorTex`).
   */
  track(image: TextureImage, samplerName: string): void {
    const role = samplerName.replace(/^u_/, '').replace(/Tex$/, '')
    let entry = this.#entries.get(image)
    if (!entry) {
      entry = { roles: new Set(), width: 0, height: 0, preview: null }
      this.#entries.set(image, entry)
    }
    entry.roles.add(role)
  }

  /** Record the uploaded pixel size of a tracked image. */
  setUploadedSize(image: TextureImage, width: number, height: number): void {
    const entry = this.#entries.get(image)
    if (entry) {
      entry.width = width
      entry.height = height
    }
  }

  clear(): void {
    this.#entries.clear()
    this.#previewDecoding.clear()
  }

  snapshot(): TextureInspectorSnapshot {
    const perSource: TextureInspectorSnapshot['perSource'] = []
    for (const [image, entry] of this.#entries) {
      // List every tracked texture with its role + uploaded size. The preview
      // thumbnail decodes lazily off `image.bytes`, so a texture shows up (with
      // a blank thumb) even before it decodes or if it never does.
      if (!entry.preview) this.#decodePreview(image)
      perSource.push({
        width: entry.width,
        height: entry.height,
        source: entry.preview,
        label: [...entry.roles].join(' + '),
      })
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

  renderLabelPreview(): null {
    return null
  }

  #decodePreview(image: TextureImage): void {
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
        const entry = this.#entries.get(image)
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
}

/** Draw `bmp` into a canvas fitted within `max`×`max`, preserving aspect. */
function downscaleToCanvas(bmp: ImageBitmap, max: number): HTMLCanvasElement {
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height))
  const w = Math.max(1, Math.round(bmp.width * scale))
  const h = Math.max(1, Math.round(bmp.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (ctx) ctx.drawImage(bmp, 0, 0, w, h)
  return canvas
}
