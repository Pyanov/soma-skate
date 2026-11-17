// The load worker: fetches the world's files, composes the park and the city and builds the sim's park
// (world.ts: the same code the page runs where there are no workers, and the same buildPark as the Node
// harness, with the same BVH file, so the result is the same to the bit). It sends the page the city's
// manifest and rows early ('city'), the loading bar's bytes ('progress'), the composed world ('world'),
// and the sim's park on a port of its own, which the page reads only once its meshes are built and the
// world's triangles let go, so the two never sit in its memory together (a message is unpacked when it
// is read). Every typed array is transferred, not copied: one copy of each, and it ends up the page's.
import type { Physics } from '../sim/data.ts'
import type { Park } from '../sim/park/park.ts'
import { binProgress, setBinBase } from './fetchbin.ts'
import { loadWorld } from './world.ts'

/** Every ArrayBuffer under a value, once (the transfer list). */
function buffers(o: unknown, out = new Set<ArrayBuffer>(), seen = new WeakSet<object>()): Set<ArrayBuffer> {
  if (!o || typeof o !== 'object') return out
  if (ArrayBuffer.isView(o)) { if (o.buffer instanceof ArrayBuffer) out.add(o.buffer); return out }
  if (seen.has(o)) return out
  seen.add(o)
  for (const v of Array.isArray(o) ? o : o instanceof Map ? [...o.values()] : Object.values(o)) buffers(v, out, seen)
  return out
}

export type LoadRequest = { t: 'start'; parkName: string; base: string; parkPort: MessagePort } | { t: 'physics'; physics: Physics }
export type LoadReply =
  | { t: 'progress'; done: number; total: number }
  | { t: 'city'; manifest: unknown; rows: unknown }
  | { t: 'world'; src: unknown; city: unknown; bvhLoaded: boolean }
  | { t: 'error'; error: string }
/** On the park port: the sim's park, without the lists it shares with the world (the page puts them back). */
export type ParkReply = { park: unknown }

const post = (m: LoadReply, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(m, transfer)
let physicsReady: (p: Physics) => void = () => {}
const physics = new Promise<Physics>((r) => { physicsReady = r })

self.onmessage = (e: MessageEvent<LoadRequest>) => {
  const m = e.data
  if (m.t === 'physics') { physicsReady(m.physics); return }
  setBinBase(m.base)
  let last = 0
  binProgress.onChange = (done, total) => {
    const now = performance.now()
    if (now - last < 80 && done < total) return
    last = now
    post({ t: 'progress', done, total })
  }
  // The page builds the city's look from the city's manifest (its element list comes with the world, composed) and rows.
  loadWorld(m.parkName, physics, (manifest, rows) => post({ t: 'city', manifest: { ...manifest, elements: [], rails: [], spots: [], lines: [] }, rows }))
    .then(({ src, park, bvhLoaded }) => {
      binProgress.onChange(binProgress.done, binProgress.total)
      // The page draws from the world; the rails and the traffic are the sim's (they come with the park). The
      // city's parts went over already ('city').
      const page = { ...src, rails: [], traffic: [] }
      post({ t: 'world', src: page, city: null, bvhLoaded }, [...buffers(page)])
      const p: Partial<Park> = { ...park }
      delete p.elements; delete p.lines
      m.parkPort.postMessage({ park: p } satisfies ParkReply, [...buffers(p)])
    })
    .catch((err) => post({ t: 'error', error: String((err as Error)?.stack ?? err) }))
}
