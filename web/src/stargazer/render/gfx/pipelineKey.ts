// Stable string key for pipeline memoization, shared by both backends so an
// identical `PipelineDesc` reuses one pipeline. Handle identity for
// shader/bind-group layouts (via lazily-assigned ids), structural for the
// scalar fields.

import type { PipelineDesc, StencilFaceState } from './GfxDevice'
import { resolveDepthStencil } from './depthStencil'

const pipelineIdTag = Symbol('gfxPipelineId')
let nextPipelineTagId = 1

/** Lazily assign a stable numeric id to a handle object, for keying by identity. */
function tagId(o: object): number {
  const rec = o as unknown as Record<symbol, number>
  if (!rec[pipelineIdTag]) rec[pipelineIdTag] = nextPipelineTagId++
  return rec[pipelineIdTag]
}

export function pipelineKey(desc: PipelineDesc): string {
  const shaderId = tagId(desc.shader)
  const layoutIds = desc.bindGroupLayouts.map(tagId).join('.')
  const vtx = desc.vertexLayout
    .map(
      (l) =>
        `${l.arrayStride}:${l.stepMode[0]}:` +
        l.attributes
          .map((a) => `${a.location}/${a.format}/${a.offset}`)
          .join('-'),
    )
    .join(';')
  const color = desc.color
    ? `${desc.color.format}/${desc.color.blend}/${desc.color.write === false ? 0 : 1}`
    : 'none'
  const depth = desc.depth
    ? `${desc.depth.test ? 1 : 0}${desc.depth.write ? 1 : 0}/${desc.depth.compare ?? 'le'}/${desc.depth.biasSlopeScale ?? 0}/${desc.depth.biasConstant ?? 0}`
    : 'none'
  const st = desc.stencil
  const stencil = st
    ? `${face(st.front)}~${face(st.back ?? st.front)}/${st.readMask ?? 0xff}/${st.writeMask ?? 0xff}/${st.reference ?? 0}`
    : 'none'
  // The attachment format is part of the pipeline, and two descs with
  // identical state can target different attachments (a 2D pipeline that tests
  // nothing looks the same on a stencil-only target as on a combined one), so
  // it has to key them apart.
  const ds = resolveDepthStencil(desc)
  return `s${shaderId}|bgl${layoutIds}|v${vtx}|c${color}|d${depth}|t${stencil}|f${ds}|${desc.cull}|${desc.frontFace}|${desc.primitive}|x${desc.samples}`
}

function face(f: StencilFaceState): string {
  return `${f.compare ?? 'always'},${f.failOp ?? 'keep'},${f.depthFailOp ?? 'keep'},${f.passOp ?? 'keep'}`
}
