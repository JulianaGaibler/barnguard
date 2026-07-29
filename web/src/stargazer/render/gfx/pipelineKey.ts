// Stable string key for pipeline memoization, shared by both backends so an
// identical `PipelineDesc` reuses one pipeline. Handle identity for
// shader/bind-group layouts (via lazily-assigned ids), structural for the
// scalar fields.

import type { PipelineDesc } from './GfxDevice'

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
  const color = desc.color ? `${desc.color.format}/${desc.color.blend}` : 'none'
  const depth = desc.depth
    ? `${desc.depth.test ? 1 : 0}${desc.depth.write ? 1 : 0}/${desc.depth.compare ?? 'le'}/${desc.depth.biasSlopeScale ?? 0}/${desc.depth.biasConstant ?? 0}`
    : 'none'
  return `s${shaderId}|bgl${layoutIds}|v${vtx}|c${color}|d${depth}|${desc.cull}|${desc.frontFace}|${desc.primitive}|x${desc.samples}`
}
