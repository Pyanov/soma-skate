import type { CarDims, GameData } from '../data.ts'
import { madd, v3, type Vec3 } from '../math.ts'
import { makeLine, type GrindLine } from '../park/grindlines.ts'
import type { Thing } from '../thing.ts'
import { dimsOf } from '../skater/cars.ts'
import { carFrame } from './traffic.ts'

// Grindable edges on the sim's cars (docs/mechanics/traffic.md): moving grind lines. A car's edges
// are fixed in its own frame (x forward, y left, z up from the road under its middle, the sizes of
// its collision boxes); a grind on one is placed in the world each tick from the car's pose.

export type CarEdge = { name: string; a: Vec3; b: Vec3 }

/**
 * The roof's four edges, the hood's and trunk's side edges, and the bumpers (the body's top edge at
 * each end), named car roof and so on (a streetcar's: streetcar roof, from traffic.tram name).
 */
export function carEdges(D: CarDims & { name?: string }): CarEdge[] {
  const bx = D.body.length / 2, by = D.body.width / 2, bz = D.body.top
  const cx0 = D.cabin.offset - D.cabin.length / 2, cx1 = D.cabin.offset + D.cabin.length / 2, cy = D.cabin.width / 2, cz = D.cabin.top
  const k = D.name ?? 'car'
  return [
    { name: `${k} roof`, a: v3(cx0, cy, cz), b: v3(cx1, cy, cz) },
    { name: `${k} roof`, a: v3(cx0, -cy, cz), b: v3(cx1, -cy, cz) },
    { name: `${k} roof`, a: v3(cx1, -cy, cz), b: v3(cx1, cy, cz) },
    { name: `${k} roof`, a: v3(cx0, -cy, cz), b: v3(cx0, cy, cz) },
    { name: `${k} hood`, a: v3(cx1, by, bz), b: v3(bx, by, bz) },
    { name: `${k} hood`, a: v3(cx1, -by, bz), b: v3(bx, -by, bz) },
    { name: `${k} bumper`, a: v3(bx, -by, bz), b: v3(bx, by, bz) },
    { name: `${k} trunk`, a: v3(-bx, by, bz), b: v3(cx0, by, bz) },
    { name: `${k} trunk`, a: v3(-bx, -by, bz), b: v3(cx0, -by, bz) },
    { name: `${k} bumper`, a: v3(-bx, -by, bz), b: v3(-bx, by, bz) },
  ]
}

/** Edge j of car c where it is this tick, as a grind line (id -1: not one of the park's lines). */
export function carLine(c: Thing, data: Pick<GameData, 'traffic' | 'vehicles'>, j: number): GrindLine {
  const e = carEdges(dimsOf(data, c))[j], { f, l, u } = carFrame(c)
  const w = (p: Vec3) => madd(madd(madd(c.pos, f, p.x), l, p.y), u, p.z)
  return makeLine(-1, e.name, 'ledge', [w(e.a), w(e.b)])
}
