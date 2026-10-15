// A small zip reader for `.lottie` files. It reads the central directory and
// extracts stored (method 0) and deflated (method 8) entries. ZIP64 and
// encrypted archives are rejected.

/** One file inside an archive. */
export interface ZipEntry {
  /** Path inside the archive. */
  readonly name: string
  /** Compression method, 0 stored or 8 deflate. */
  readonly method: number
  /** Compressed size in bytes. */
  readonly compressedSize: number
  /** Uncompressed size in bytes. */
  readonly size: number
  /** Offset of the entry's local header. */
  readonly offset: number
}

const EOCD_SIGNATURE = 0x06054b50
const CENTRAL_SIGNATURE = 0x02014b50
const LOCAL_SIGNATURE = 0x04034b50

/** Cap on what one entry may expand to, a guard against decompression bombs. */
const MAX_ENTRY_BYTES = 256 * 1024 * 1024

/**
 * List the entries of a zip archive.
 *
 * @example
 *   const entries = readZip(bytes)
 *   const manifest = await extractZipEntry(
 *     bytes,
 *     entries.get('manifest.json')!,
 *   )
 */
export function readZip(bytes: Uint8Array): Map<string, ZipEntry> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  // The end-of-central-directory record sits at the very end, behind an
  // optional comment of up to 64 KiB.
  let eocd = -1
  const min = Math.max(0, bytes.length - 22 - 0xffff)
  for (let i = bytes.length - 22; i >= min; i--) {
    if (view.getUint32(i, true) === EOCD_SIGNATURE) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('readZip: not a zip archive')
  const count = view.getUint16(eocd + 10, true)
  const dirSize = view.getUint32(eocd + 12, true)
  const dirOffset = view.getUint32(eocd + 16, true)
  if (count === 0xffff || dirSize === 0xffffffff || dirOffset === 0xffffffff) {
    throw new Error('readZip: ZIP64 archives are not supported')
  }
  const decoder = new TextDecoder()
  const entries = new Map<string, ZipEntry>()
  let p = dirOffset
  for (let i = 0; i < count; i++) {
    if (
      p + 46 > bytes.length ||
      view.getUint32(p, true) !== CENTRAL_SIGNATURE
    ) {
      throw new Error('readZip: corrupt central directory')
    }
    const flags = view.getUint16(p + 8, true)
    if (flags & 1)
      throw new Error('readZip: encrypted entries are not supported')
    const method = view.getUint16(p + 10, true)
    const compressedSize = view.getUint32(p + 20, true)
    const size = view.getUint32(p + 24, true)
    const nameLen = view.getUint16(p + 28, true)
    const extraLen = view.getUint16(p + 30, true)
    const commentLen = view.getUint16(p + 32, true)
    const offset = view.getUint32(p + 42, true)
    const name = decoder.decode(bytes.subarray(p + 46, p + 46 + nameLen))
    if (!name.endsWith('/')) {
      entries.set(name, { name, method, compressedSize, size, offset })
    }
    p += 46 + nameLen + extraLen + commentLen
  }
  return entries
}

/** Extract one entry's bytes. */
export async function extractZipEntry(
  bytes: Uint8Array,
  entry: ZipEntry,
): Promise<Uint8Array> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const o = entry.offset
  if (o + 30 > bytes.length || view.getUint32(o, true) !== LOCAL_SIGNATURE) {
    throw new Error(`readZip: corrupt local header for '${entry.name}'`)
  }
  const nameLen = view.getUint16(o + 26, true)
  const extraLen = view.getUint16(o + 28, true)
  const start = o + 30 + nameLen + extraLen
  const data = bytes.subarray(start, start + entry.compressedSize)
  if (entry.size > MAX_ENTRY_BYTES) {
    throw new Error(`readZip: '${entry.name}' is too large`)
  }
  if (entry.method === 0) return data.slice()
  if (entry.method !== 8) {
    throw new Error(`readZip: unsupported compression method ${entry.method}`)
  }
  if (typeof DecompressionStream === 'undefined') {
    throw new Error(
      'readZip: this browser has no DecompressionStream for deflate-raw',
    )
  }
  const stream = new Blob([data as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream('deflate-raw'))
  const out = new Uint8Array(await new Response(stream).arrayBuffer())
  if (out.length > MAX_ENTRY_BYTES) {
    throw new Error(`readZip: '${entry.name}' is too large`)
  }
  return out
}
