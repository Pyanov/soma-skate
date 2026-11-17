import { controlsSchema, DATA_FILES, lookSchema, validateGameData, type Controls, type Look } from '../data/schema.ts'
import type { GameData } from '../sim/data.ts'
import { labPark } from '../sim/park/lab.ts'
import { buildPark, type Park } from '../sim/park/park.ts'
import { WORLDS, type Manifest, type ParkSource } from '../sim/park/source.ts'
import { loadCityLook, type CityLook } from './city.ts'
import { binProgress, expectBins } from './fetchbin.ts'
import type { LoadReply, LoadRequest, ParkReply } from './loadworker.ts'
import { loadPaint, loadRealAssets, type Paint, type PaintManifest, type RealAssets } from './real.ts'
import { getJson, loadWorld, type CityRows, type World } from './world.ts'

/** The park's photo paint, re-indexed for a composed world (the park's triangles come first; city triangles carry no paint and are never read). */
function remapPaint(p: Paint, keptTris: Int32Array, _total: number): Paint {
  const n = keptTris.length
  const uv = new Float32Array(n * 6), page = new Uint8Array(n).fill(255), mat = new Uint8Array(n)
  for (let t = 0; t < keptTris.length; t++) {
    const s = keptTris[t]
    uv.set(p.uv.subarray(s * 6, s * 6 + 6), t * 6)
    page[t] = p.page[s]; mat[t] = p.mat[s]
  }
  return { ...p, uv, page, mat }
}

/** The loading screen's status line (main sets it). */
export const loading = { status: (_s: string) => {} }

/** The world on the page: the composed source and the city's parts now; the sim's park when the page takes it (takePark). */
type PageWorld = { src: World['src']; city: World['city']; bvhLoaded: boolean; takePark: () => Promise<Park> }
type WorldLoad = { city: Promise<{ manifest: Manifest; rows: CityRows | null } | null>; world: Promise<PageWorld> }

/**
 * The world (the files, the composed park and city, the sim's park) from the load worker (loadworker.ts):
 * the page never holds the downloaded files, the world arrives moved, not copied, and the sim's park,
 * sent on a port of its own, is unpacked only when the page takes it (after its meshes are built and the
 * world's triangles let go). On the main thread where there are no workers, or if the worker fails
 * before the world is in.
 */
function startWorld(parkName: string, physics: Promise<GameData['physics']>): WorldLoad {
  let cityDone: (c: { manifest: Manifest; rows: CityRows | null } | null) => void = () => {}
  const city = new Promise<{ manifest: Manifest; rows: CityRows | null } | null>((r) => { cityDone = r })
  const here = () => loadWorld(parkName, physics, (manifest, rows) => cityDone({ manifest, rows })).then((w): PageWorld => {
    cityDone(w.city)
    return { src: w.src, city: w.city, bvhLoaded: w.bvhLoaded, takePark: () => Promise.resolve(w.park) }
  })
  if (typeof Worker === 'undefined') return { city, world: here() }
  const world = new Promise<PageWorld>((resolve, reject) => {
    let w: Worker
    try { w = new Worker(new URL('./loadworker.ts', import.meta.url), { type: 'module' }) } catch { here().then(resolve, reject); return }
    let settled = false
    // The park's message, kept unread (its data is unpacked on first read: takePark).
    const { port1, port2 } = new MessageChannel()
    let parkArrived: (e: MessageEvent<ParkReply>) => void = () => {}, parkFail: (e: unknown) => void = () => {}
    const parkEvent = new Promise<MessageEvent<ParkReply>>((res, rej) => { parkArrived = res; parkFail = rej })
    port1.onmessage = (e: MessageEvent<ParkReply>) => { w.terminate(); port1.close(); parkArrived(e) }
    const fallback = (why: unknown) => {
      w.terminate(); binProgress.setRemote(0, 0)
      if (settled) { parkFail(new Error(`load worker failed: ${String(why)}`)); return }
      settled = true
      console.warn('load worker failed, loading here:', why)
      here().then(resolve, reject)
    }
    w.onmessage = (e: MessageEvent<LoadReply>) => {
      const m = e.data
      if (m.t === 'progress') binProgress.setRemote(m.done, m.total)
      else if (m.t === 'city') cityDone(m as { manifest: Manifest; rows: CityRows | null })
      else if (m.t === 'world') {
        settled = true
        const src = m.src as World['src'], c = m.city as World['city']
        cityDone(c)
        resolve({
          src, city: c, bvhLoaded: m.bvhLoaded,
          takePark: async () => {
            const park = (await parkEvent).data.park as Park
            // The lists the park shares with the world came once, with the world.
            park.elements = src.elements; park.lines = src.lines ?? []
            return park
          },
        })
      } else fallback(m.error)
    }
    w.onerror = (e) => fallback(e.message)
    w.postMessage({ t: 'start', parkName, base: document.baseURI, parkPort: port2 } satisfies LoadRequest, [port2])
    physics.then((p) => w.postMessage({ t: 'physics', physics: p } satisfies LoadRequest), () => {})
  })
  return { city, world }
}

export async function loadAll(parkName: string, opts: { previewPaint?: boolean } = {}): Promise<{ data: GameData; controls: Controls; look: Look; src: ParkSource; takePark: () => Promise<Park>; paint: Paint | null; real: RealAssets | null; city: CityLook | null; lights: number[][]; interiors: unknown[] }> {
  performance.mark('load:start')
  // The world starts first, in its worker, alongside the data files (it needs the physics only to build the park).
  let physicsDone: (p: GameData['physics']) => void = () => {}, physicsFail: (e: unknown) => void = () => {}
  const physicsP = new Promise<GameData['physics']>((res, rej) => { physicsDone = res; physicsFail = rej })
  const world = parkName === 'lab' ? null : startWorld(parkName, physicsP)
  // The photo paint needs only the park's manifest (a small JSON; the worker reads its own copy).
  const parkManifestP = parkName === 'lab' ? null : getJson<Manifest & { paint?: PaintManifest }>(`assets/park/${WORLDS[parkName]?.park ?? parkName}.park.json`)
  const files = [...DATA_FILES, 'controls', 'look'] as const
  let raw: Record<string, unknown>
  try { raw = Object.fromEntries(await Promise.all(files.map(async (f) => [f, await getJson(`data/${f}.json`)] as const))) } catch (e) { physicsFail(e); throw e }
  const data = validateGameData(raw as Parameters<typeof validateGameData>[0])
  physicsDone(data.physics)
  const controls = raw.controls
  const look = lookSchema.parse(raw.look)
  performance.mark('load:data')
  if (!world) {
    const src = labPark()
    const park = buildPark(src, data.physics)
    return { data, controls: controlsSchema.parse(controls), look, src, takePark: () => Promise.resolve(park), paint: null, real: null, city: null, lights: [], interiors: [] }
  }
  loading.status('Loading the park')
  const manifest = await parkManifestP!
  performance.mark('load:park')
  // The real look needs the baked photo paint; without it the game draws cute. The photos decode off the
  // main thread: start them now, and the city's look as soon as the worker has the city's manifest.
  void expectBins([`assets/park/${manifest.paint?.binary ?? ''}`, ...(WORLDS[parkName] ? [`assets/park/${WORLDS[parkName].city}.look.bin`] : [])])
  loading.status('Painting the park')
  const paintP = Promise.all([loadPaint('assets/park', manifest, opts.previewPaint), manifest.paint ? loadRealAssets(look.real) : null])
  const cityP = world.city.then(async (c) => {
    if (!c) return null
    performance.mark('load:city-fetched')
    loading.status('Building the city')
    const look = await loadCityLook('assets/park', c.manifest, 0, c.rows)
    performance.mark('load:citylook')
    return { look, lights: c.rows ? c.rows.lights : (c.manifest as unknown as { city?: { lights?: number[][] } }).city?.lights ?? [], interiors: (c.manifest as unknown as { city?: { interiors?: unknown[] } }).city?.interiors ?? [] }
  })
  const w = await world.world
  performance.mark('load:world')
  performance.mark(w.bvhLoaded ? 'load:bvh-file' : 'load:bvh-built')
  const c = await cityP
  loading.status('Pouring the concrete')
  let [paint, real] = await paintP
  performance.mark('load:paint')
  if (paint && w.src.keptTris) paint = remapPaint(paint, w.src.keptTris, w.src.indices.length / 3)
  return { data, controls: controlsSchema.parse(controls), look, src: w.src, takePark: w.takePark, paint, real, city: c?.look ?? null, lights: c?.lights ?? [], interiors: c?.interiors ?? [] }
}
