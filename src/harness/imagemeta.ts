// Lossless image metadata stripping for release files: the pixels stay byte for byte, only the
// metadata goes. JPEG: APP1..APP15 segments (EXIF, XMP, IPTC, camera maker notes) and comments are
// dropped; APP0 (JFIF), APP2 ICC profiles and APP14 (Adobe, which sets the colour transform) stay.
// PNG: text, time and EXIF chunks are dropped.

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const PNG_DROP = new Set(['tEXt', 'iTXt', 'zTXt', 'tIME', 'eXIf'])

function stripJpeg(b: Buffer): Buffer {
  const out: Buffer[] = [b.subarray(0, 2)]
  let i = 2
  while (i + 4 <= b.length && b[i] === 0xff) {
    const m = b[i + 1]
    if (m === 0xd8 || (m >= 0xd0 && m <= 0xd7) || m === 0x01) { out.push(b.subarray(i, i + 2)); i += 2; continue }
    if (m === 0xda) break   // start of scan: the rest is image data
    const len = b.readUInt16BE(i + 2)
    const seg = b.subarray(i, i + 2 + len)
    const app = m >= 0xe0 && m <= 0xef
    const keep = !app && m !== 0xfe ? true
      : m === 0xe0 ? true
      : m === 0xe2 ? seg.subarray(4, 16).toString('latin1') === 'ICC_PROFILE\0'
      : m === 0xee ? seg.subarray(4, 9).toString('latin1') === 'Adobe'
      : false
    if (keep) out.push(seg)
    i += 2 + len
  }
  out.push(b.subarray(i))
  return Buffer.concat(out)
}

function stripPng(b: Buffer): Buffer {
  const out: Buffer[] = [b.subarray(0, 8)]
  let i = 8
  while (i + 12 <= b.length) {
    const len = b.readUInt32BE(i), type = b.subarray(i + 4, i + 8).toString('latin1')
    const end = i + 12 + len
    if (!PNG_DROP.has(type)) out.push(b.subarray(i, end))
    i = end
    if (type === 'IEND') break
  }
  return Buffer.concat(out)
}

/** The same image without its metadata (unchanged if it has none or is not a JPEG or PNG). */
export function stripImage(b: Buffer): Buffer {
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) return stripJpeg(b)
  if (b.length > 8 && b.subarray(0, 8).equals(PNG_SIG)) return stripPng(b)
  return b
}

/** What metadata an image carries (for the release audit): segment or chunk names. */
export function imageMeta(b: Buffer): string[] {
  const found: string[] = []
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2
    while (i + 4 <= b.length && b[i] === 0xff) {
      const m = b[i + 1]
      if (m === 0xda) break
      if ((m >= 0xd0 && m <= 0xd8) || m === 0x01) { i += 2; continue }
      const len = b.readUInt16BE(i + 2)
      if ((m >= 0xe1 && m <= 0xef && m !== 0xe2 && m !== 0xee) || m === 0xfe) found.push(m === 0xfe ? 'COM' : `APP${m - 0xe0}:${b.subarray(i + 4, i + 10).toString('latin1').replace(/[^ -~]/g, '')}`)
      i += 2 + len
    }
  } else if (b.subarray(0, 8).equals(PNG_SIG)) {
    let i = 8
    while (i + 12 <= b.length) {
      const len = b.readUInt32BE(i), type = b.subarray(i + 4, i + 8).toString('latin1')
      if (PNG_DROP.has(type)) found.push(type)
      i += 12 + len
      if (type === 'IEND') break
    }
  }
  return found
}
