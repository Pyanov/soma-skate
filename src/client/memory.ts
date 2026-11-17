import * as THREE from 'three'

// Phones run out of memory before they run out of frames. Once three.js has copied a static geometry
// or texture to the GPU, the CPU-side copy is dead weight: these drop it after the upload. Only in the
// built site: the dev server keeps everything for its tools (picking a park comment raycasts the park's
// own triangles). Nothing here touches the sim's data (collision triangles, the BVH): only what the
// renderer drew from. A lost WebGL context could not re-upload what was dropped (the page reloads).

const on = import.meta.env?.PROD ?? false   // (plain Node, for probes, has no env)

type Buf = ArrayBuffer & { transfer?: (n: number) => ArrayBuffer; detached?: boolean }

/**
 * Let a typed array's memory go now. An array that is the whole of its buffer hands the buffer back
 * (ArrayBuffer.transfer(0) frees it at once): a dropped array would wait for a garbage collection, which
 * comes when it comes, and the peak while loading is the moment that matters on a phone. Only for
 * arrays nothing else views. Returns an empty array of the same kind (code that reads .length or .count
 * keeps working).
 */
export function release<T extends ArrayLike<number>>(a: T): T {
  const v = a as unknown as ArrayBufferView, buf = v.buffer as Buf
  if (ArrayBuffer.isView(v) && buf instanceof ArrayBuffer && v.byteOffset === 0 && v.byteLength === buf.byteLength && typeof buf.transfer === 'function' && !buf.detached) buf.transfer(0)
  return new (a.constructor as new (n: number) => T)(0)
}

/** Textures waiting for their first upload (uploadPending sends them all at once). */
const pending = new Set<THREE.Texture>()

/**
 * A static geometry: its attributes (but those in keep, which the client still reads or rewrites) and
 * its index let their arrays go after the first upload. Bounding volumes are computed first (culling).
 */
export function freeGeometryAfterUpload(geo: THREE.BufferGeometry, keep: string[] = []) {
  if (!on) return
  if (!geo.boundingSphere) geo.computeBoundingSphere()
  if (!geo.boundingBox) geo.computeBoundingBox()
  const drop = function (this: THREE.BufferAttribute) { (this as unknown as { array: ArrayLike<number> }).array = release(this.array) }
  for (const [name, a] of Object.entries(geo.attributes)) if (!keep.includes(name) && (a as THREE.BufferAttribute).isBufferAttribute) (a as THREE.BufferAttribute).onUpload(drop)
  if (geo.index) geo.index.onUpload(drop)
}

/** A texture that is never re-uploaded: its pixels (a data array, or an ImageBitmap closed) go after the first upload. */
export function freeTextureAfterUpload(tex: THREE.Texture) {
  if (!on) return
  pending.add(tex)
  tex.addEventListener('dispose', () => pending.delete(tex))
  const before = tex.onUpdate
  tex.onUpdate = (t: THREE.Texture) => {
    before?.call(t, t)
    pending.delete(t)
    const img = t.image as { data?: ArrayLike<number> | null; width: number; height: number; close?: () => void } | null
    if (!img) return
    if (img.data) img.data = release(img.data)
    else if (typeof img.close === 'function') img.close()
    t.onUpdate = before ?? null
  }
}

/** Upload every texture registered above that has not been drawn yet (and so let its pixels go). */
export function uploadPending(renderer: THREE.WebGLRenderer) {
  for (const t of [...pending]) if (t.image && t.version > 0) renderer.initTexture(t)
}
