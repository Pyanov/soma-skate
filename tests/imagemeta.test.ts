import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { imageMeta, stripImage } from '../src/harness/imagemeta.ts'
import { rel } from '../src/harness/io.ts'

// Release hygiene (src/harness/imagemeta.ts): metadata goes, the pixels stay byte for byte.

const seg = (marker: number, payload: Buffer) => { const h = Buffer.alloc(4); h[0] = 0xff; h[1] = marker; h.writeUInt16BE(payload.length + 2, 2); return Buffer.concat([h, payload]) }

describe('image metadata', () => {
  it('drops EXIF and comments from a JPEG and keeps JFIF and the scan', () => {
    const jfif = seg(0xe0, Buffer.from('JFIF\0\x01\x01\0\0\x01\0\x01\0\0', 'latin1'))
    const exif = seg(0xe1, Buffer.from('Exif\0\0camera serial 1234', 'latin1'))
    const com = seg(0xfe, Buffer.from('made on some machine', 'latin1'))
    const scan = Buffer.from([0xff, 0xda, 0x00, 0x04, 0x01, 0x02, 0x11, 0x22, 0xff, 0xd9])
    const jpg = Buffer.concat([Buffer.from([0xff, 0xd8]), jfif, exif, com, scan])
    expect(imageMeta(jpg)).toEqual(['APP1:Exif', 'COM'])
    const out = stripImage(jpg)
    expect(out).toEqual(Buffer.concat([Buffer.from([0xff, 0xd8]), jfif, scan]))
    expect(imageMeta(out)).toEqual([])
  })

  it('leaves a clean image unchanged', () => {
    const png = readFileSync(rel('assets/icons/favicon-32.png'))
    expect(stripImage(stripImage(png))).toEqual(stripImage(png))
    expect(imageMeta(stripImage(png))).toEqual([])
  })
})
