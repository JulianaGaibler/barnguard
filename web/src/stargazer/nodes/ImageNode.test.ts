import { describe, expect, it } from 'vitest'
import { ImageNode, naturalSize } from './ImageNode'

function canvasOf(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

describe('ImageNode', () => {
  const image = canvasOf(200, 100)

  it('draws at the natural size by default', () => {
    expect(new ImageNode({ image }).drawnSize).toEqual({
      width: 200,
      height: 100,
    })
  })

  it('keeps the aspect ratio when only the height is given', () => {
    expect(new ImageNode({ image, height: 40 }).drawnSize).toEqual({
      width: 80,
      height: 40,
    })
  })

  it('keeps the aspect ratio when only the width is given', () => {
    expect(new ImageNode({ image, width: 50 }).drawnSize).toEqual({
      width: 50,
      height: 25,
    })
  })

  it('stretches to both sizes when both are given', () => {
    expect(new ImageNode({ image, width: 10, height: 10 }).drawnSize).toEqual({
      width: 10,
      height: 10,
    })
  })

  it('follows a new image', () => {
    const node = new ImageNode({ image })
    node.image = canvasOf(30, 60)
    expect(node.drawnSize).toEqual({ width: 30, height: 60 })
  })
})

describe('naturalSize', () => {
  it('reads an image element before it loads as zero', () => {
    expect(naturalSize(new Image())).toEqual({ width: 0, height: 0 })
  })

  it('reads a canvas by its pixel size', () => {
    expect(naturalSize(canvasOf(7, 9))).toEqual({ width: 7, height: 9 })
  })
})
