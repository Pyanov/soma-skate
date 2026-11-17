// The big binaries (the park, its paint, the city and its look and data), fetched with progress for
// the loading screen. In the built site (./skate build) they ship gzipped as name.bin.gz, which any
// static host serves as it is; they are inflated here (a host that adds Content-Encoding itself hands
// over the bytes already inflated: the gzip header says which). build.json lists the files and sizes.

/** A built file: its size as shipped, its revision, and for a .gz file the inflated size. */
type BuildFile = { url: string; bytes: number; rev: string; raw?: number }
export type BuildManifest = { version: string; files: BuildFile[] }

/**
 * Bytes of the big binaries: expected (the build's sizes, or each response's length on the dev server) and
 * read so far, here and in the load worker (which reports its own: setRemote).
 */
export const binProgress = {
  total: 0, done: 0, remoteDone: 0, remoteTotal: 0,
  onChange: (_done: number, _total: number) => {},
  report() { this.onChange(this.done + this.remoteDone, this.total + this.remoteTotal) },
  setRemote(done: number, total: number) { this.remoteDone = done; this.remoteTotal = total; this.report() },
}

/** What relative file names resolve against: the page (a worker's own location is its script's, so the page tells it: setBinBase). */
let base = typeof document !== 'undefined' ? document.baseURI : typeof location !== 'undefined' ? location.href : 'http://localhost/'
export const setBinBase = (url: string) => { base = url }
export const resolveUrl = (url: string) => new URL(url, base).href

let manifest: Promise<BuildManifest | null> | null = null
/** The built site's file list (null on the dev server). */
export function buildManifest(): Promise<BuildManifest | null> {
  manifest ??= import.meta.env.PROD ? fetch(resolveUrl('build.json'), { cache: 'no-store' }).then((r) => (r.ok ? r.json() as Promise<BuildManifest> : null)).catch(() => null) : Promise.resolve(null)
  return manifest
}

const counted = new Set<string>()
/** Count a file in the expected total once (the loader can announce them before it fetches). */
export async function expectBins(urls: string[]) {
  const m = await buildManifest()
  for (const u of urls) {
    if (counted.has(u)) continue
    const f = m?.files.find((x) => x.url === u || x.url === `${u}.gz`)
    if (!f) continue
    counted.add(u); binProgress.total += f.bytes
  }
  binProgress.report()
}

export async function fetchBin(url: string): Promise<ArrayBuffer> {
  const m = await buildManifest()
  const gzFile = m?.files.find((f) => f.url === `${url}.gz`)
  const r = await fetch(resolveUrl(gzFile ? `${url}.gz` : url), { cache: 'no-store' })
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`)
  if (!counted.has(url)) {
    counted.add(url)
    const len = gzFile?.bytes || Number(r.headers.get('content-length') ?? 0) || (m?.files.find((f) => f.url === url)?.bytes ?? 0)
    binProgress.total += len
  }
  // A host that marks the .gz Content-Encoding hands over the inflated bytes: count them at the shipped scale.
  const scale = gzFile?.raw && r.headers.get('content-encoding') ? gzFile.bytes / gzFile.raw : 1
  // Read it in chunks for the progress bar.
  const chunks: Uint8Array[] = []
  let n = 0
  if (r.body) {
    const reader = r.body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value); n += value.length
      binProgress.done += value.length * scale; binProgress.report()
    }
  } else { const b = new Uint8Array(await r.arrayBuffer()); chunks.push(b); n = b.length; binProgress.done += n * scale; binProgress.report() }
  const bytes = new Uint8Array(n)
  let at = 0
  for (const c of chunks) { bytes.set(c, at); at += c.length }
  chunks.length = 0
  // A first visit: the service worker is not in charge yet, so keep what came down in its cache now
  // (the same key it uses), and its 'warm' pass will not fetch it again.
  if (m && typeof caches !== 'undefined') {
    const key = new URL(resolveUrl(gzFile ? `${url}.gz` : url))
    void caches.open(`soma-skate-${m.version}`).then((c) => c.match(key.origin + key.pathname).then((hit) => hit ? undefined : c.put(key.origin + key.pathname, new Response(bytes, { headers: { 'content-type': 'application/octet-stream' } })))).catch(() => {})
  }
  return gunzipIfNeeded(bytes)
}

/** Inflate gzip bytes (the 1f 8b header); anything else is returned as it is. */
export async function gunzipIfNeeded(bytes: Uint8Array): Promise<ArrayBuffer> {
  if (bytes.length < 2 || bytes[0] !== 0x1f || bytes[1] !== 0x8b) return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  const stream = new Blob([bytes as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream("gzip"))
  return new Response(stream).arrayBuffer()
}
