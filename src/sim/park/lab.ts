import { hashBytes } from '../hash.ts'
import { cos, sin, tan } from '../math.ts'
import type { ElementInfo, LineInfo, ParkSource, RailInfo, SpotInfo } from './source.ts'

// The lab: a small park generated in code, one of each obstacle type. It never
// changes, so mechanic tests on it stay stable while the SoMa model evolves.

type P3 = [number, number, number]

class Builder {
  positions: number[] = []
  indices: number[] = []
  elements: ElementInfo[] = []
  rails: RailInfo[] = []
  private start = 0

  begin() { this.start = this.indices.length / 3 }
  end(id: string, collection: string, type: string, name: string) {
    const count = this.indices.length / 3 - this.start
    this.elements.push({ id, element: id, collection, feature: id, name, type, role: 'body', tris: [this.start, count] })
  }
  tri(a: P3, b: P3, c: P3) {
    const base = this.positions.length / 3
    this.positions.push(...a, ...b, ...c)
    this.indices.push(base, base + 1, base + 2)
  }
  quad(a: P3, b: P3, c: P3, d: P3) { this.tri(a, b, c); this.tri(a, c, d) }

  /** Axis-aligned box without its bottom face. */
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) {
    const p = (x: number, y: number, z: number): P3 => [x, y, z]
    this.quad(p(x0, y0, z1), p(x1, y0, z1), p(x1, y1, z1), p(x0, y1, z1))
    this.quad(p(x0, y0, z0), p(x1, y0, z0), p(x1, y0, z1), p(x0, y0, z1))
    this.quad(p(x1, y1, z0), p(x0, y1, z0), p(x0, y1, z1), p(x1, y1, z1))
    this.quad(p(x0, y1, z0), p(x0, y0, z0), p(x0, y0, z1), p(x0, y1, z1))
    this.quad(p(x1, y0, z0), p(x1, y1, z0), p(x1, y1, z1), p(x1, y0, z1))
  }

  /**
   * Extrude a profile (u along `dir`, z up) across a width. The profile runs from
   * the toe over the top to the back-bottom corner; side caps fan from that corner.
   */
  extrude(origin: [number, number], dir: [number, number], width: number, profile: [number, number][], closed = false) {
    const [ox, oy] = origin, [dx, dy] = dir
    const wx = -dy, wy = dx
    const at = (u: number, z: number, w: number): P3 => [ox + dx * u + wx * w, oy + dy * u + wy * w, z]
    const segs = closed ? profile.length : profile.length - 1
    for (let i = 0; i < segs; i++) {
      const [u0, z0] = profile[i], [u1, z1] = profile[(i + 1) % profile.length]
      this.quad(at(u0, z0, 0), at(u1, z1, 0), at(u1, z1, width), at(u0, z0, width))
    }
    const [bu, bz] = profile[profile.length - 1]
    for (let i = 0; i < profile.length - 2; i++) {
      const [u0, z0] = profile[i], [u1, z1] = profile[i + 1]
      this.tri(at(bu, bz, 0), at(u1, z1, 0), at(u0, z0, 0))
      this.tri(at(bu, bz, width), at(u0, z0, width), at(u1, z1, width))
    }
  }

  rail(id: string, kind: string, points: P3[]) {
    this.rails.push({ id, feature: id, kind, spec: '', points })
  }
}

/** Quarterpipe profile: circular transition of radius r up to height h, optional vertical extension, deck. */
function quarterProfile(r: number, h: number, vert: number, deck: number, segments = 16): [number, number][] {
  const arcTop = Math.min(h, r)
  const uTop = Math.sqrt(r * r - (r - arcTop) * (r - arcTop))
  const pts: [number, number][] = []
  for (let i = 0; i <= segments; i++) {
    const u = (uTop * i) / segments
    pts.push([u, r - Math.sqrt(Math.max(0, r * r - u * u))])
  }
  const top = arcTop + vert
  if (vert > 0) pts.push([uTop, top])
  pts.push([uTop + deck, top], [uTop + deck, 0])
  return pts
}

/**
 * The test hill: a San Francisco street east of the lab for bombing (docs/mechanics/hill.md).
 * Arc length s runs downhill from the top. Grade = rise per metre (negative downhill), linear
 * between the key points, so each change of grade is a rounded vertical curve.
 */
export const HILL = {
  start: [70, 140] as [number, number],   // top of the centreline, site metres
  grade: [
    [0, 0], [12, 0], [15, -0.10],          // start flat, crest into 10% (radius 30 m)
    [125, -0.10], [127, -0.02],            // sag into the crosswalk flat (radius 25 m)
    [139, -0.02], [142, -0.12],            // crest out of it (radius 30 m): airborne above about 17 m/s
    [200, -0.12], [201.5, -0.08],          // sag into 8%
    [230, -0.08], [232, 0],                // sag into the runout
    [244, 0], [246, 0.06], [256, 0.06],    // the runout tips up into the end wall
  ] as [number, number][],
  turn: { from: 152, to: 188, deg: -35 },  // the street bends left (heading 180 -> 145, radius 59 m)
  halfWidth: 6, crown: 0.015, curb: 0.17, curbTop: 0.2, sidewalk: 2.8, wall: 4, step: 0.5,
}

/** Heading (deg, clockwise from north), centreline xy and grade at arc length s. */
function hillFrame(s: number) {
  const { from, to, deg } = HILL.turn
  const headingAt = (q: number) => 180 + deg * Math.min(1, Math.max(0, (q - from) / (to - from)))
  let x = HILL.start[0], y = HILL.start[1]
  // Integrate the plan position in 0.25 m steps (exact enough, and deterministic).
  for (let q = 0; q < s - 1e-9; q += 0.25) {
    const d = Math.min(0.25, s - q), h = (headingAt(q + d / 2) * Math.PI) / 180
    x += sin(h) * d; y += cos(h) * d
  }
  return { x, y, heading: headingAt(s) }
}

function hillGrade(s: number) {
  const g = HILL.grade
  for (let i = 1; i < g.length; i++) if (s <= g[i][0]) return g[i - 1][1] + ((g[i][1] - g[i - 1][1]) * (s - g[i - 1][0])) / (g[i][0] - g[i - 1][0])
  return g[g.length - 1][1]
}

function streetHill(b: Builder, spots: SpotInfo[], lines: LineInfo[]) {
  const H = HILL
  const end = H.grade[H.grade.length - 1][0]
  // Elevation of the centreline (crown) along s; the runout (s 232..244) sits at z = 0.
  const zAt: number[] = []
  let z = 0
  const n = Math.round(end / H.step)
  for (let i = 0; i <= n; i++) {
    if (i > 0) { const s0 = (i - 1) * H.step; for (let k = 0; k < 10; k++) z += hillGrade(s0 + (k + 0.5) * H.step / 10) * H.step / 10 }
    zAt.push(z)
  }
  const zRun = zAt[Math.round(238 / H.step)]
  const frames = zAt.map((zz, i) => ({ ...hillFrame(i * H.step), z: zz - zRun }))
  // A cross-section point: w across (+ = left of downhill), dz above the crown.
  const at = (i: number, w: number, dz: number): P3 => {
    const f = frames[i], h = (f.heading * Math.PI) / 180
    return [f.x - cos(h) * w, f.y + sin(h) * w, f.z + dz]
  }
  const gutter = -H.crown * H.halfWidth
  const curbZ = gutter + H.curb
  const outer = H.halfWidth + H.curbTop + H.sidewalk
  const walkZ = (w: number) => curbZ + 0.02 * (Math.abs(w) - H.halfWidth - H.curbTop)
  const strip = (id: string, collection: string, type: string, name: string, cross: [number, number][]) => {
    b.begin()
    for (let i = 0; i < n; i++) for (let k = 0; k < cross.length - 1; k++) {
      const [w0, z0] = cross[k], [w1, z1] = cross[k + 1]
      b.quad(at(i, w0, z0), at(i + 1, w0, z0), at(i + 1, w1, z1), at(i, w1, z1))
    }
    b.end(id, collection, type, name)
  }
  const crown: [number, number][] = [-6, -4, -2, 0, 2, 4, 6].map((w) => [w * H.halfWidth / 6, -H.crown * Math.abs(w * H.halfWidth / 6)])
  strip('hill_street', 'ground', 'road', 'Hill street', crown)
  for (const side of [1, -1]) {
    const tag = side > 0 ? 'east' : 'west'
    const w0 = side * H.halfWidth, w1 = side * (H.halfWidth + H.curbTop)
    strip(`hill_curb_${tag}`, 'obstacles', 'curb', `Hill curb (${tag})`, [[w0, gutter], [w0, curbZ], [w1, curbZ]])
    strip(`hill_sidewalk_${tag}`, 'ground', 'sidewalk', `Hill sidewalk (${tag})`, [[w1, curbZ], [side * outer, walkZ(outer)]])
    strip(`hill_wall_${tag}`, 'walls', '', `Hill buildings (${tag})`, [[side * outer, walkZ(outer)], [side * outer, walkZ(outer) + H.wall]])
  }
  // End walls across the street, top and bottom.
  for (const [i, id] of [[0, 'hill_end_top'], [n, 'hill_end_bottom']] as const) {
    b.begin()
    b.quad(at(i, -outer, gutter - 0.5), at(i, outer, gutter - 0.5), at(i, outer, H.wall + 0.5), at(i, -outer, H.wall + 0.5))
    b.end(id, 'walls', '', 'Hill end wall')
  }
  // Catch floor under the whole hill (keeps the curb grind lines, which need ground below, and
  // anything that ever falls through).
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, zLow = Infinity
  for (let i = 0; i <= n; i++) for (const w of [-outer, outer]) {
    const [x, y, zz] = at(i, w, 0)
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); zLow = Math.min(zLow, zz)
  }
  b.begin(); b.quad([x0 - 2, y0 - 2, zLow - 1.5], [x1 + 2, y0 - 2, zLow - 1.5], [x1 + 2, y1 + 2, zLow - 1.5], [x0 - 2, y1 + 2, zLow - 1.5]); b.end('hill_catch', 'ground', '', 'Hill catch floor')

  const spot = (id: string, label: string, s: number, back = false) => {
    const f = frames[Math.round(s / H.step)]
    spots.push({ id, label, xy: [Math.round(f.x * 1000) / 1000, Math.round(f.y * 1000) / 1000], heading: back ? f.heading - 180 : f.heading })
  }
  spot('lab_hill_top', 'hill top', 5)
  spot('lab_hill_ten', 'hill 10% section', 40)
  spot('lab_hill_crosswalk', 'hill crosswalk', 131)
  spot('lab_hill_twelve', 'hill 12% section', 146)
  spot('lab_hill_bottom', 'hill bottom (facing up)', 238, true)
  // The bomb line for the rider-line autopilot (skate lines --park lab): down the middle, round the bend.
  const pts: [number, number][] = []
  for (let s = 5; s <= 236; s += 4) { const f = frames[Math.round(s / H.step)]; pts.push([Math.round(f.x * 1000) / 1000, Math.round(f.y * 1000) / 1000]) }
  lines.push({ id: 'lab_hill_bomb', points: pts, maxSlopeDeg: 6.8 })
}

/**
 * A spine for spine transfers (docs/mechanics/air-tricks.md): two 1.7 m quarterpipes (r 2.0, 1.5 m
 * of transition and 0.2 m of vert) back to back across x 14..26, the ridge at y = -10. Added after
 * the hill, so everything before keeps its triangle order.
 */
function labSpine(b: Builder, spots: SpotInfo[]) {
  const R = -10, prof = quarterProfile(2.0, 1.5, 0.2, 0.02), uTop = Math.sqrt(4 - 0.5 * 0.5), top = 1.7
  b.begin(); b.extrude([26, R - uTop - 0.02], [0, 1], 12, prof); b.end('L11', 'obstacles', 'quarterpipe', 'Spine, south face')
  b.begin(); b.extrude([14, R + uTop + 0.02], [0, -1], 12, prof); b.end('L12', 'obstacles', 'quarterpipe', 'Spine, north face')
  b.rail('L11_coping', 'coping', [[26, R - 0.02, top], [14, R - 0.02, top]])
  b.rail('L12_coping', 'coping', [[14, R + 0.02, top], [26, R + 0.02, top]])
  spots.push({ id: 'lab_spine_south', label: 'spine (from the south)', xy: [20, R - 8], heading: 0 })
  spots.push({ id: 'lab_spine_north', label: 'spine (from the north)', xy: [20, R + 8], heading: 180 })
}

export function labPark(): ParkSource {
  const b = new Builder()

  b.begin(); b.quad([-30, -20, 0], [30, -20, 0], [30, 30, 0], [-30, 30, 0]); b.end('ground', 'ground', '', 'Lab floor')

  // Small quarterpipe (1.2 m, r 2.0) and vert ramp (3.4 m, r 3.0) face south across y = 20.
  b.begin(); b.extrude([-6, 20], [0, 1], 8, quarterProfile(2.0, 1.2, 0, 1.5)); b.end('L01', 'obstacles', 'quarterpipe', 'Small quarterpipe')
  const smallTop = Math.sqrt(4 - 0.8 * 0.8)
  b.rail('L01_coping', 'coping', [[-6, 20 + smallTop, 1.2], [-14, 20 + smallTop, 1.2]])
  b.begin(); b.extrude([6, 20], [0, 1], 10, quarterProfile(3.0, 3.0, 0.4, 1.5)); b.end('L02', 'obstacles', 'quarterpipe', 'Vert ramp')
  b.rail('L02_coping', 'coping', [[6, 23, 3.4], [-4, 23, 3.4]])

  // 25 degree bank, 1 m high, with a flat top.
  const run = 1 / tan((25 * Math.PI) / 180)
  b.begin(); b.extrude([16, 20], [0, 1], 8, [[0, 0], [run, 1], [run + 2, 1], [run + 2, 0]]); b.end('L03', 'obstacles', 'bank', 'Bank')

  // Ledge (0.45 m) with angle-iron edges, flat rail (0.35 m), manual pad (0.15 m).
  b.begin(); b.box(4, 0, 0, 10, 0.5, 0.45); b.end('L04', 'obstacles', 'ledge', 'Ledge')
  b.rail('L04_edge_s', 'angle', [[4, 0, 0.45], [10, 0, 0.45]])
  b.rail('L04_edge_n', 'angle', [[4, 0.5, 0.45], [10, 0.5, 0.45]])
  b.begin(); b.box(-10, 3.975, 0.3, -4, 4.025, 0.35); b.box(-9.8, 3.975, 0, -9.75, 4.025, 0.3); b.box(-4.25, 3.975, 0, -4.2, 4.025, 0.3); b.end('L05', 'obstacles', 'flat_rail', 'Flat rail')
  b.rail('L05_rail', 'rail', [[-10, 4, 0.35], [-4, 4, 0.35]])
  b.begin(); b.box(-20, 0, 0, -16, 2, 0.15); b.end('L06', 'obstacles', 'manual_pad', 'Manual pad')

  // Platform with a 3-stair down to the south and a bank up the back; down rail beside the stairs.
  b.begin()
  b.box(14, 8, 0, 18, 12, 0.51)
  b.box(14, 7.65, 0, 18, 8, 0.34)
  b.box(14, 7.3, 0, 18, 7.65, 0.17)
  b.end('L07', 'obstacles', 'stairs', '3-stair platform')
  b.begin(); b.extrude([14, 14], [0, -1], 4, [[0, 0], [2, 0.51], [2, 0]]); b.end('L08', 'obstacles', 'bank', 'Platform back bank')
  b.begin(); b.extrude([13.6, 8.6], [0, -1], 0.05, [[0, 1.26], [0, 1.31], [1.3, 0.85], [1.3, 0.8]], true); b.end('L09', 'obstacles', 'down_rail', 'Down rail')
  b.rail('L09_rail', 'rail', [[13.625, 8.6, 1.31], [13.625, 7.3, 0.85]])

  // Invisible boundary around the floor, like the SoMa fence polygon.
  b.begin()
  b.box(-31, -21, -1, -30, 31, 6); b.box(30, -21, -1, 31, 31, 6)
  b.box(-31, -21, -1, 31, -20, 6); b.box(-31, 30, -1, 31, 31, 6)
  b.end('boundary_wall', 'boundary', '', 'Lab boundary')

  // Wall for wallrides.
  b.begin(); b.box(-28, -10, 0, -27.7, 10, 3); b.end('L10', 'walls', '', 'Wall')

  const spots: SpotInfo[] = [
    { id: 'lab_center', label: 'lab center', xy: [0, 0], heading: 0 },
    { id: 'lab_qp_small', label: 'small quarterpipe', xy: [-10, 12], heading: 0 },
    { id: 'lab_vert', label: 'vert ramp', xy: [1, 10], heading: 0 },
    { id: 'lab_bank', label: 'bank', xy: [12, 12], heading: 0 },
    { id: 'lab_ledge', label: 'ledge', xy: [0, -1], heading: 90 },
    { id: 'lab_rail', label: 'flat rail', xy: [-16, 4], heading: 90 },
    { id: 'lab_stairs', label: 'stairs top', xy: [16, 11], heading: 180 },
    { id: 'lab_pad', label: 'manual pad', xy: [-24, 1], heading: 90 },
    { id: 'lab_wall', label: 'wall', xy: [-24, -12], heading: 0 },
  ]
  // Added after everything above, so the lab's own triangles keep their order.
  const lines: LineInfo[] = []
  streetHill(b, spots, lines)
  labSpine(b, spots)
  const positions = new Float32Array(b.positions)
  const indices = new Uint32Array(b.indices)
  const hash = hashBytes(new Uint8Array(positions.buffer)).slice(0, 8) + hashBytes(new Uint8Array(indices.buffer)).slice(0, 8)
  return { name: 'lab', hash, positions, indices, elements: b.elements, rails: b.rails, spots, lines }
}
