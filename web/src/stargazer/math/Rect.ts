export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export function rect(x = 0, y = 0, width = 0, height = 0): Rect {
  return { x, y, width, height }
}

export function rectCopy(dst: Rect, src: Readonly<Rect>): Rect {
  dst.x = src.x
  dst.y = src.y
  dst.width = src.width
  dst.height = src.height
  return dst
}

export function rectContains(r: Readonly<Rect>, x: number, y: number): boolean {
  return x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height
}

export function rectIntersects(a: Readonly<Rect>, b: Readonly<Rect>): boolean {
  return !(
    a.x + a.width <= b.x ||
    b.x + b.width <= a.x ||
    a.y + a.height <= b.y ||
    b.y + b.height <= a.y
  )
}

export function rectUnion(
  dst: Rect,
  a: Readonly<Rect>,
  b: Readonly<Rect>,
): Rect {
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  const right = Math.max(a.x + a.width, b.x + b.width)
  const bottom = Math.max(a.y + a.height, b.y + b.height)
  dst.x = x
  dst.y = y
  dst.width = right - x
  dst.height = bottom - y
  return dst
}
