import type { CameraView2D } from '../../camera/CameraView2D'
import type { Node2D } from '../../scene/Node2D'
import { Canvas } from './Canvas'
import { beginPaint, endPaint } from './paintState'
import { Op, Picture } from './Picture'

/** One call a replayed picture made into the renderer. */
export interface PaintCall {
  name: string
  args: unknown[]
}

function viewWith(screenScale: number): CameraView2D {
  return {
    strokeSpaceScale: () => screenScale,
    visibleWorldRect: () => ({ x: 0, y: 0, width: 1000, height: 1000 }),
  } as unknown as CameraView2D
}

const OP_NAMES = Object.fromEntries(
  Object.entries(Op).map(([name, code]) => [code, name]),
)

/**
 * Run a node's `paint` and return the drawing calls it made, in order, with
 * their arguments as the node gave them. For tests of what a node draws,
 * without a renderer.
 *
 * The calls are the node's own statements, the vocabulary of {@link Canvas}, not
 * what the renderer does with them. How a picture is replayed or stored does
 * not change them, so a test written against them holds when the renderer
 * does.
 *
 * `deviceScale` is the number of device pixels per local unit that
 * {@link Canvas.snap} rounds against, and `screenScale` is the world size of a
 * CSS pixel that {@link Canvas.screenScale} returns. Both default to 1.
 *
 * @example
 *   const calls = paintCalls(node, { deviceScale: 2 })
 *   const fills = calls.filter((c) => c.name === 'fillRect')
 */
export function paintCalls(
  node: Node2D,
  opts: { deviceScale?: number; screenScale?: number } = {},
): PaintCall[] {
  const picture = paintPicture(node, opts)
  return picture.ops.map((op, i) => ({
    name: OP_NAMES[op] ?? String(op),
    args: picture.args[i] ?? [],
  }))
}

/**
 * Run a node's `paint` and return the picture it records, for tests of the
 * picture's bounds and dependencies. Takes the same options as
 * {@link paintCalls}.
 */
export function paintPicture(
  node: Node2D,
  opts: { deviceScale?: number; screenScale?: number } = {},
): Picture {
  const picture = new Picture()
  const canvas = new Canvas()
  beginPaint(node)
  canvas.begin(picture, opts.deviceScale ?? 1, viewWith(opts.screenScale ?? 1))
  try {
    node.paint?.(canvas)
  } finally {
    canvas.end()
    endPaint()
  }
  return picture
}
