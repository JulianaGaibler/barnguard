// The stencil bit layout and the state of every stencil operation the 2D
// renderer performs. Every user of the stencil buffer (nonzero and even-odd
// fills, clip paths, translucent-stroke de-duplication) draws from this one
// table, so their bits never collide.
//
// Bit layout of the 8-bit stencil value:
//
//   bits 7..5  clip depth D (0..7). A pixel is inside the current clip when its
//              depth bits equal the current depth.
//   bit  4     flag, used by the stroke de-duplication mark.
//   bits 3..0  winding count, modulo 16. Non-zero only between a fan and its
//              cover.
//
// WebGPU bakes a stencil state's compare, ops and masks into the pipeline and
// only the reference is dynamic. Each row below is therefore its own pipeline
// variant, and the per-draw reference comes from `stencilReferenceFor`. The
// comparison direction is the same on both backends: `less` passes when
// `(reference & readMask) < (stencil & readMask)`.

import type { StencilState } from './GfxDevice'

/** Bit position of the clip depth within the stencil value. */
export const CLIP_DEPTH_SHIFT = 5
/** Mask of the clip depth bits. */
export const CLIP_DEPTH_MASK = 0xe0
/** The deepest clip nesting the stencil can hold. */
export const MAX_CLIP_DEPTH = 7
/** Mask of the winding count bits. */
export const WINDING_MASK = 0x0f
/** The stroke de-duplication flag bit. */
export const FLAG_BIT = 0x10

/** How a path's winding count decides coverage. */
export type FillRule = 'nonzero' | 'evenodd'

/** One entry of the recipe table. */
export type StencilRow =
  | 'clipTest'
  | 'fanNonzero'
  | 'fanEvenOdd'
  | 'coverNonzero'
  | 'coverEvenOdd'
  | 'clipApplyNonzero'
  | 'clipApplyEvenOdd'
  | 'clipPop'
  | 'strokeMark'
  | 'strokeReset'

/** A row's pipeline state, and whether its draws write color. */
export interface StencilRowState {
  state: StencilState
  colorWrite: boolean
}

/**
 * The pipeline state of each row. `clipTest` is the state of an ordinary draw
 * inside a clip: it passes where the depth bits equal `D` and writes nothing.
 * Draws at depth 0 use no stencil state at all.
 */
export const STENCIL_ROWS: Readonly<Record<StencilRow, StencilRowState>> = {
  clipTest: {
    state: {
      front: { compare: 'equal' },
      readMask: CLIP_DEPTH_MASK,
      writeMask: 0,
    },
    colorWrite: true,
  },
  // Counts winding into bits 3..0 where the depth bits equal D. The write mask
  // keeps carries and borrows out of the flag and depth bits.
  fanNonzero: {
    state: {
      front: { compare: 'equal', passOp: 'increment-wrap' },
      back: { compare: 'equal', passOp: 'decrement-wrap' },
      readMask: CLIP_DEPTH_MASK,
      writeMask: WINDING_MASK,
    },
    colorWrite: false,
  },
  fanEvenOdd: {
    state: {
      front: { compare: 'equal', passOp: 'invert' },
      readMask: CLIP_DEPTH_MASK,
      writeMask: 0x01,
    },
    colorWrite: false,
  },
  // Paints where the winding count is non-zero and clears it as it goes, so the
  // bits are zero again once the cover is done.
  coverNonzero: {
    state: {
      front: { compare: 'not-equal', failOp: 'zero', passOp: 'zero' },
      readMask: WINDING_MASK,
      writeMask: WINDING_MASK,
    },
    colorWrite: true,
  },
  coverEvenOdd: {
    state: {
      front: { compare: 'not-equal', failOp: 'zero', passOp: 'zero' },
      readMask: 0x01,
      writeMask: WINDING_MASK,
    },
    colorWrite: true,
  },
  // Writes the new depth where the winding count is set. Replace with a
  // reference of `(D + 1) << 5` clears the winding bits at the same time.
  clipApplyNonzero: {
    state: {
      front: { compare: 'not-equal', passOp: 'replace' },
      readMask: WINDING_MASK,
      writeMask: 0xff,
    },
    colorWrite: false,
  },
  clipApplyEvenOdd: {
    state: {
      front: { compare: 'not-equal', passOp: 'replace' },
      readMask: 0x01,
      writeMask: 0xff,
    },
    colorWrite: false,
  },
  // Lowers pixels deeper than D - 1 back to D - 1. The reference carries the
  // lower depth in its top bits and ones below them, so `less` selects every
  // pixel whose depth bits exceed it.
  clipPop: {
    state: {
      front: { compare: 'less', passOp: 'replace' },
      readMask: 0xff,
      writeMask: CLIP_DEPTH_MASK,
    },
    colorWrite: false,
  },
  // Paints a pixel once: the first fragment sees the flag clear and sets it.
  strokeMark: {
    state: {
      front: { compare: 'equal', passOp: 'invert' },
      readMask: CLIP_DEPTH_MASK | FLAG_BIT,
      writeMask: FLAG_BIT,
    },
    colorWrite: true,
  },
  // Clears the flag over the same geometry, with color writes off.
  strokeReset: {
    state: {
      front: { compare: 'equal', passOp: 'invert' },
      readMask: CLIP_DEPTH_MASK | FLAG_BIT,
      writeMask: FLAG_BIT,
    },
    colorWrite: false,
  },
}

/** The stencil reference a draw of `row` at clip depth `depth` uses. */
export function stencilReferenceFor(row: StencilRow, depth: number): number {
  switch (row) {
    case 'clipTest':
    case 'fanNonzero':
    case 'fanEvenOdd':
    case 'strokeMark':
      return depth << CLIP_DEPTH_SHIFT
    case 'strokeReset':
      return (depth << CLIP_DEPTH_SHIFT) | FLAG_BIT
    case 'coverNonzero':
    case 'coverEvenOdd':
      return 0
    case 'clipApplyNonzero':
    case 'clipApplyEvenOdd':
      return (depth + 1) << CLIP_DEPTH_SHIFT
    case 'clipPop':
      return ((depth - 1) << CLIP_DEPTH_SHIFT) | 0x1f
  }
}

/** The fan row for a fill rule. */
export function fanRow(rule: FillRule): StencilRow {
  return rule === 'nonzero' ? 'fanNonzero' : 'fanEvenOdd'
}

/** The cover row for a fill rule. */
export function coverRow(rule: FillRule): StencilRow {
  return rule === 'nonzero' ? 'coverNonzero' : 'coverEvenOdd'
}
