// A top-down map of the sf world as the sim has it (docs/squeeze.md): every triangle coloured by its collection,
// highest wins, with the traffic paths over it and the place spots. For checking joins and routes by eye.
//   node tools/squeeze/topdown.ts out.png [x0,y0,x1,y1] [m-per-px] [--traffic] [--routes]
import { writeFileSync, readdirSync, readFileSync } from 'node:fs'
import { crc32, deflateSync } from 'node:zlib'
import { loadData, loadPark, loadParkSource, rel } from '../../src/harness/io.ts'

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'))
const [outFile, boxArg, mppArg] = args
const [bx0, by0, bx1, by1] = (boxArg ?? '-750,-520,760,1080').split(',').map(Number)
const mpp = Number(mppArg ?? 0.5)
const W = Math.ceil((bx1 - bx0) / mpp), H = Math.ceil((by1 - by0) / mpp)
const src = loadParkSource('sf')
const rgb = new Uint8Array(W * H * 3).fill(255), zb = new Float32Array(W * H).fill(-Infinity)
const COL: Record<string, [number, number, number]> = {
  city_road: [95, 95, 100], city_median: [120, 140, 110], city_sidewalk: [205, 200, 190], city_curb: [160, 160, 160], city_lot: [215, 195, 160], city_park: [140, 190, 110],
  city_path: [225, 215, 190], city_alley: [120, 110, 105], city_building: [170, 90, 70], city_roof: [190, 120, 100], city_roof_high: [190, 120, 100], city_stoop: [200, 150, 120],
  city_water: [120, 170, 230], city_freeway: [150, 90, 200], city_column: [110, 50, 160], city_squeeze_wall: [230, 0, 200], city_squeeze_stairs: [255, 140, 0], city_squeeze_railing: [230, 0, 200],
  boundary: [0, 0, 0], city_spot: [250, 220, 0], city_massing: [235, 225, 225], city_context: [240, 240, 236],
}
const skip = new Set(['city_car', 'city_car_top', 'city_trunk', 'city_prop', 'city_pole', 'city_detail', 'city_marking', 'city_furniture', 'city_hitbox', 'city_spot_furniture'])
const P = src.positions, I = src.indices
for (const e of src.elements) {
  if (skip.has(e.collection)) continue
  const c = COL[e.collection] ?? (e.role === 'ground' ? [180, 180, 180] : e.role === 'wall' ? [150, 110, 100] : null)
  if (!c) continue
  const lowPri = e.collection === 'city_massing' || e.collection === 'city_context' ? -1000 : 0
  for (let t = e.tris[0]; t < e.tris[0] + e.tris[1]; t++) {
    const a = I[t * 3], b = I[t * 3 + 1], d = I[t * 3 + 2]
    const xs = [P[a * 3], P[b * 3], P[d * 3]].map((x) => (x - bx0) / mpp), ys = [P[a * 3 + 1], P[b * 3 + 1], P[d * 3 + 1]].map((y) => (by1 - y) / mpp)
    const z = Math.max(P[a * 3 + 2], P[b * 3 + 2], P[d * 3 + 2]) + lowPri
    const minx = Math.max(0, Math.floor(Math.min(...xs))), maxx = Math.min(W - 1, Math.ceil(Math.max(...xs)))
    const miny = Math.max(0, Math.floor(Math.min(...ys))), maxy = Math.min(H - 1, Math.ceil(Math.max(...ys)))
    if (minx > maxx || miny > maxy) continue
    const area = (xs[1] - xs[0]) * (ys[2] - ys[0]) - (xs[2] - xs[0]) * (ys[1] - ys[0])
    const thin = Math.abs(area) < 0.5
    for (let py = miny; py <= maxy; py++) for (let px = minx; px <= maxx; px++) {
      const x = px + 0.5, y = py + 0.5
      if (!thin) {
        const w0 = (xs[1] - x) * (ys[2] - y) - (xs[2] - x) * (ys[1] - y), w1 = (xs[2] - x) * (ys[0] - y) - (xs[0] - x) * (ys[2] - y), w2 = (xs[0] - x) * (ys[1] - y) - (xs[1] - x) * (ys[0] - y)
        if (!((w0 >= 0 && w1 >= 0 && w2 >= 0) || (w0 <= 0 && w1 <= 0 && w2 <= 0))) continue
      } else if (e.role !== 'wall' && e.collection !== 'city_squeeze_wall') continue
      const k = py * W + px
      if (z < zb[k]) continue
      zb[k] = z; rgb[k * 3] = c[0]; rgb[k * 3 + 1] = c[1]; rgb[k * 3 + 2] = c[2]
    }
  }
}
const plot = (x: number, y: number, c: number[], r = 1) => {
  const px = Math.round((x - bx0) / mpp), py = Math.round((by1 - y) / mpp)
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    const qx = px + dx, qy = py + dy
    if (qx < 0 || qy < 0 || qx >= W || qy >= H) continue
    const k = qy * W + qx; rgb[k * 3] = c[0]; rgb[k * 3 + 1] = c[1]; rgb[k * 3 + 2] = c[2]
  }
}
const line = (a: number[], b: number[], c: number[], r = 0) => {
  const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / (mpp * 0.7)) + 1
  for (let i = 0; i <= n; i++) plot(a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n, c, r)
}
if (process.argv.includes('--traffic')) {
  const park = loadPark('sf', loadData())
  for (const p of park.traffic.paths) {
    for (let i = 1; i < p.points.length; i++) line(p.points[i - 1], p.points[i], [0, 200, 255], 0)
    plot(p.points[0][0], p.points[0][1], [0, 90, 255], 2); plot(p.points[p.points.length - 1][0], p.points[p.points.length - 1][1], [0, 90, 255], 2)
  }
}
if (process.argv.includes('--reach')) {   // the route network: reached from the park in red, the rest in cyan, joins in green
  const net = await import('./net.ts')
  const { dist } = net.dijkstra(net.nearest(46, -10)[0])
  for (let i = 0; i < net.X.length; i++) for (const [j] of net.adj[i]) if (j > i) {
    const same = net.P[i] === net.P[j]
    line([net.X[i], net.Y[i]], [net.X[j], net.Y[j]], !same ? [0, 220, 0] : Number.isFinite(dist[i]) ? [230, 0, 0] : [0, 190, 255], 0)
  }
  net.paths.forEach((p) => { for (const q of [p.points[0], p.points[p.points.length - 1]]) plot(q[0], q[1], [0, 0, 160], 1) })
}
if (process.argv.includes('--routes')) {
  const dir = rel('scenarios/squeeze-routes')
  for (const f of readdirSync(dir)) {
    const m = readFileSync(`${dir}/${f}`, 'utf8').match(/bot drive (.*?) from/)
    if (!m) continue
    const pts = m[1].split(' ').map((s) => s.split(',').map(Number))
    for (let i = 1; i < pts.length; i++) line(pts[i - 1], pts[i], [255, 0, 0], 0)
  }
}
for (const s of src.spots as unknown as { xy?: number[]; pos?: { x: number; y: number } }[]) { const p = s.pos ? [s.pos.x, s.pos.y] : s.xy; if (p) plot(p[0], p[1], [255, 230, 0], 3) }
for (let gx = Math.ceil(bx0 / 100) * 100; gx <= bx1; gx += 100) for (let y = by0; y < by1; y += mpp * 3) plot(gx, y, [0, 0, 0], 0)
for (let gy = Math.ceil(by0 / 100) * 100; gy <= by1; gy += 100) for (let x = bx0; x < bx1; x += mpp * 3) plot(x, gy, [0, 0, 0], 0)
// PNG
const raw = Buffer.alloc((W * 3 + 1) * H)
for (let y = 0; y < H; y++) { raw[y * (W * 3 + 1)] = 0; Buffer.from(rgb.buffer, y * W * 3, W * 3).copy(raw, y * (W * 3 + 1) + 1) }
const chunk = (type: string, body: Buffer) => { const len = Buffer.alloc(4); len.writeUInt32BE(body.length); const tb = Buffer.concat([Buffer.from(type), body]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(tb)); return Buffer.concat([len, tb, c]) }
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2
writeFileSync(outFile, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]))
console.log(`${outFile} ${W}x${H}, ${mpp} m/px, x ${bx0}..${bx1}, y ${by0}..${by1}; grid every 100 m`)
