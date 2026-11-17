// Triangle primitives on flat Float64 arrays (9 numbers per triangle).

export type ClosestOut = { x: number; y: number; z: number }

/** Closest point on triangle t (offset o in tv) to p. Ericson, Real-Time Collision Detection 5.1.5. */
export function closestOnTri(tv: Float64Array, o: number, px: number, py: number, pz: number, out: ClosestOut) {
  const ax = tv[o], ay = tv[o + 1], az = tv[o + 2]
  const bx = tv[o + 3], by = tv[o + 4], bz = tv[o + 5]
  const cx = tv[o + 6], cy = tv[o + 7], cz = tv[o + 8]
  const abx = bx - ax, aby = by - ay, abz = bz - az
  const acx = cx - ax, acy = cy - ay, acz = cz - az
  const apx = px - ax, apy = py - ay, apz = pz - az
  const d1 = abx * apx + aby * apy + abz * apz
  const d2 = acx * apx + acy * apy + acz * apz
  if (d1 <= 0 && d2 <= 0) { out.x = ax; out.y = ay; out.z = az; return }
  const bpx = px - bx, bpy = py - by, bpz = pz - bz
  const d3 = abx * bpx + aby * bpy + abz * bpz
  const d4 = acx * bpx + acy * bpy + acz * bpz
  if (d3 >= 0 && d4 <= d3) { out.x = bx; out.y = by; out.z = bz; return }
  const vc = d1 * d4 - d3 * d2
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3)
    out.x = ax + abx * v; out.y = ay + aby * v; out.z = az + abz * v; return
  }
  const cpx = px - cx, cpy = py - cy, cpz = pz - cz
  const d5 = abx * cpx + aby * cpy + abz * cpz
  const d6 = acx * cpx + acy * cpy + acz * cpz
  if (d6 >= 0 && d5 <= d6) { out.x = cx; out.y = cy; out.z = cz; return }
  const vb = d5 * d2 - d1 * d6
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6)
    out.x = ax + acx * w; out.y = ay + acy * w; out.z = az + acz * w; return
  }
  const va = d3 * d6 - d5 * d4
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / ((d4 - d3) + (d5 - d6))
    out.x = bx + (cx - bx) * w; out.y = by + (cy - by) * w; out.z = bz + (cz - bz) * w; return
  }
  const denom = 1 / (va + vb + vc)
  const v = vb * denom, w = vc * denom
  out.x = ax + abx * v + acx * w; out.y = ay + aby * v + acy * w; out.z = az + abz * v + acz * w
}

/** Two-sided ray/triangle (Moller-Trumbore). Returns t or -1. */
export function rayTri(tv: Float64Array, o: number, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number): number {
  const ax = tv[o], ay = tv[o + 1], az = tv[o + 2]
  const e1x = tv[o + 3] - ax, e1y = tv[o + 4] - ay, e1z = tv[o + 5] - az
  const e2x = tv[o + 6] - ax, e2y = tv[o + 7] - ay, e2z = tv[o + 8] - az
  const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x
  const det = e1x * px + e1y * py + e1z * pz
  if (det > -1e-12 && det < 1e-12) return -1
  const inv = 1 / det
  const tx = ox - ax, ty = oy - ay, tz = oz - az
  const u = (tx * px + ty * py + tz * pz) * inv
  if (u < 0 || u > 1) return -1
  const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x
  const v = (dx * qx + dy * qy + dz * qz) * inv
  if (v < 0 || u + v > 1) return -1
  const t = (e2x * qx + e2y * qy + e2z * qz) * inv
  return t >= 0 ? t : -1
}
