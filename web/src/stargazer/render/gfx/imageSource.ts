// Dimension probes for a `TexImageSource` upload, shared by both backends.
// Every concrete source (ImageBitmap, HTMLCanvasElement, VideoFrame, …) carries
// numeric `width`/`height`, but the union type does not, so read them defensively.

export function getSourceWidth(source: TexImageSource): number {
  if ('width' in source && typeof source.width === 'number') return source.width
  return 0
}

export function getSourceHeight(source: TexImageSource): number {
  if ('height' in source && typeof source.height === 'number') {
    return source.height
  }
  return 0
}
