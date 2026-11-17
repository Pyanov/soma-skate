import type { TrafficPath } from './source.ts'

// The street network the sim's cars drive (docs/mechanics/traffic.md): each path with its
// cumulative length, and for each end the streets that meet it there. Built once with the park.

export type TrafficRoute = TrafficPath & { cum: number[]; length: number; box: [number, number, number, number] }   // box: x0, y0, x1, y1
/** Where a car can go on from a path's end: another path, entered at its start or its end. */
export type TrafficExit = { path: number; atStart: boolean }
export type TrafficNet = { paths: TrafficRoute[]; exits: { start: TrafficExit[]; end: TrafficExit[] }[] }

/** Ends closer than this are one junction. */
const JUNCTION = 6

export function buildTraffic(paths: TrafficPath[]): TrafficNet {
  const routes: TrafficRoute[] = paths.filter((p) => p.points.length >= 2).map((p) => {
    const cum = [0]
    for (let i = 1; i < p.points.length; i++) cum.push(cum[i - 1] + Math.hypot(p.points[i][0] - p.points[i - 1][0], p.points[i][1] - p.points[i - 1][1]))
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    for (const q of p.points) { x0 = Math.min(x0, q[0]); y0 = Math.min(y0, q[1]); x1 = Math.max(x1, q[0]); y1 = Math.max(y1, q[1]) }
    return { ...p, cum, length: cum[cum.length - 1], box: [x0, y0, x1, y1] as [number, number, number, number] }
  })
  const ends = routes.flatMap((p, i) => {
    const a = p.points[0], b = p.points[p.points.length - 1]
    return [{ path: i, atStart: true, x: a[0], y: a[1] }, { path: i, atStart: false, x: b[0], y: b[1] }]
  })
  const exitsAt = (path: number, x: number, y: number): TrafficExit[] =>
    ends.filter((e) => e.path !== path && Math.hypot(e.x - x, e.y - y) < JUNCTION && (e.atStart || !routes[e.path].oneway)).map((e) => ({ path: e.path, atStart: e.atStart }))
  const exits = routes.map((p, i) => {
    const a = p.points[0], b = p.points[p.points.length - 1]
    return { start: exitsAt(i, a[0], a[1]), end: exitsAt(i, b[0], b[1]) }
  })
  return { paths: routes, exits }
}
