/**
 * Label stub. The arcade doesn't print or persist high scores, but the
 * `DisplayManifest` still requires label-render callbacks. The only one an
 * attendant can trigger is `renderPreviewLabel`, so these return a small valid
 * blank blob and never throw.
 */
export async function blankLabelBlob(size = 64): Promise<Blob> {
  if (typeof OffscreenCanvas === 'undefined') {
    return new Blob([], { type: 'image/jpeg' })
  }
  const canvas = new OffscreenCanvas(size, size)
  const ctx = canvas.getContext('2d')
  if (ctx) {
    ctx.fillStyle = '#0d1016'
    ctx.fillRect(0, 0, size, size)
  }
  return canvas.convertToBlob({ type: 'image/jpeg', quality: 0.8 })
}
