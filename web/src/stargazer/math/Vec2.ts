export interface Vec2 {
  x: number
  y: number
}

export function vec2(x = 0, y = 0): Vec2 {
  return { x, y }
}

export function vec2Set(v: Vec2, x: number, y: number): Vec2 {
  v.x = x
  v.y = y
  return v
}

export function vec2Copy(dst: Vec2, src: Readonly<Vec2>): Vec2 {
  dst.x = src.x
  dst.y = src.y
  return dst
}

export function vec2Add(dst: Vec2, a: Readonly<Vec2>, b: Readonly<Vec2>): Vec2 {
  dst.x = a.x + b.x
  dst.y = a.y + b.y
  return dst
}

export function vec2Sub(dst: Vec2, a: Readonly<Vec2>, b: Readonly<Vec2>): Vec2 {
  dst.x = a.x - b.x
  dst.y = a.y - b.y
  return dst
}

export function vec2Scale(dst: Vec2, a: Readonly<Vec2>, s: number): Vec2 {
  dst.x = a.x * s
  dst.y = a.y * s
  return dst
}

export function vec2Length(a: Readonly<Vec2>): number {
  return Math.hypot(a.x, a.y)
}

export function vec2DistanceSq(a: Readonly<Vec2>, b: Readonly<Vec2>): number {
  const dx = a.x - b.x
  const dy = a.y - b.y
  return dx * dx + dy * dy
}

export function vec2Distance(a: Readonly<Vec2>, b: Readonly<Vec2>): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

export function vec2Lerp(
  dst: Vec2,
  a: Readonly<Vec2>,
  b: Readonly<Vec2>,
  t: number,
): Vec2 {
  dst.x = a.x + (b.x - a.x) * t
  dst.y = a.y + (b.y - a.y) * t
  return dst
}
