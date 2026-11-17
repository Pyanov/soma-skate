// All sim math goes through this file. Trig is our own (fdlibm's kernels, under 1 ulp), built
// only from + - * / and sqrt, which IEEE 754 makes identical everywhere: Node 25's and headless
// Chromium's Math.sin/cos/atan2/acos/exp round differently in the last bit for 1.5-19% of inputs
// (measured 2026-10-16), and one such bit diverged a replay. sqrt, hypot and ** agree.
//
// The sin, cos and atan kernels and their constants are ported from fdlibm as kept in FreeBSD's
// msun (k_sin.c, k_cos.c, e_rem_pio2.c, s_atan.c, e_atan2.c), whose notice is:
//   Copyright (C) 1993 by Sun Microsystems, Inc. All rights reserved.
//   Developed at SunSoft, a Sun Microsystems, Inc. business.
//   Permission to use, copy, modify, and distribute this software is freely granted, provided
//   that this notice is preserved.

export type Vec3 = { x: number; y: number; z: number }

// ---- sin / cos (FreeBSD k_sin.c, k_cos.c; medium range reduction from e_rem_pio2.c) ----
const S1 = -1.66666666666666324348e-01, S2 = 8.33333333332248946124e-03, S3 = -1.98412698298579493134e-04
const S4 = 2.75573137070700676789e-06, S5 = -2.50507602534068634195e-08, S6 = 1.58969099521155010221e-10
const C1 = 4.16666666666666019037e-02, C2 = -1.38888888888741095749e-03, C3 = 2.48015872894767294178e-05
const C4 = -2.75573143513906633035e-07, C5 = 2.08757232129817482790e-09, C6 = -1.13596475577881948265e-11
const INV_PIO2 = 6.36619772367581382433e-01
const PIO2_1 = 1.57079632673412561417e+00, PIO2_1T = 6.07710050650619224932e-11
const PIO2_2 = 6.07710050630396597660e-11, PIO2_2T = 2.02226624879595063154e-21

/** sin(x + y) for |x + y| <= pi/4, y the tail of a reduced argument. */
function kSin(x: number, y: number) {
  const z = x * x, v = z * x, r = S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)))
  return x - ((z * (0.5 * y - v * r) - y) - v * S1)
}
/** cos(x + y) for |x + y| <= pi/4. */
function kCos(x: number, y: number) {
  const z = x * x, r = z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))))
  const hz = 0.5 * z, w = 1 - hz
  return w + (((1 - w) - hz) + (z * r - x * y))
}
/** x = n pi/2 + (y0 + y1), |y0 + y1| <= pi/4 (two-step Cody-Waite; fine for game-sized angles). */
function reduce(x: number): [number, number, number] {
  const fn = Math.round(x * INV_PIO2)
  let r = x - fn * PIO2_1
  let w = fn * PIO2_1T
  const t = r
  w = fn * PIO2_2
  r = t - w
  w = fn * PIO2_2T - ((t - r) - w)
  const y0 = r - w
  return [fn, y0, (r - y0) - w]
}
export function sin(x: number): number {
  if (!Number.isFinite(x)) return NaN
  if (x > -0.7853981633974483 && x < 0.7853981633974483) return x === 0 ? x : kSin(x, 0)
  const [n, y0, y1] = reduce(x)
  switch (((n % 4) + 4) % 4) {
    case 0: return kSin(y0, y1)
    case 1: return kCos(y0, y1)
    case 2: return -kSin(y0, y1)
    default: return -kCos(y0, y1)
  }
}
export function cos(x: number): number {
  if (!Number.isFinite(x)) return NaN
  if (x > -0.7853981633974483 && x < 0.7853981633974483) return kCos(x, 0)
  const [n, y0, y1] = reduce(x)
  switch (((n % 4) + 4) % 4) {
    case 0: return kCos(y0, y1)
    case 1: return -kSin(y0, y1)
    case 2: return -kCos(y0, y1)
    default: return kSin(y0, y1)
  }
}
export const tan = (x: number) => sin(x) / cos(x)

// ---- atan / atan2 (FreeBSD s_atan.c, e_atan2.c) ----
const ATANHI = [4.63647609000806093515e-01, 7.85398163397448278999e-01, 9.82793723247329054082e-01, 1.57079632679489655800e+00]
const ATANLO = [2.26987774529616870924e-17, 3.06161699786838301793e-17, 1.39033110312309984516e-17, 6.12323399573676603587e-17]
const AT = [3.33333333333329318027e-01, -1.99999999998764832476e-01, 1.42857142725034663711e-01, -1.11111104054623557880e-01,
  9.09088713343650656196e-02, -7.69187620504482999495e-02, 6.66107313738753120669e-02, -5.83357013379057348645e-02,
  4.97687799461593236017e-02, -3.65315727442169155270e-02, 1.62858201153657823623e-02]
const PI_LO = 1.2246467991473531772e-16

export function atan(x: number): number {
  if (Number.isNaN(x)) return NaN
  const neg = x < 0
  let a = neg ? -x : x
  if (a >= 7.378697629483821e19) return neg ? -(ATANHI[3] + ATANLO[3]) : ATANHI[3] + ATANLO[3]
  let id = -1
  if (a < 0.4375) { if (a < 3.725290298461914e-9) return x }
  else if (a < 1.1875) {
    if (a < 0.6875) { id = 0; a = (2 * a - 1) / (2 + a) } else { id = 1; a = (a - 1) / (a + 1) }
  } else if (a < 2.4375) { id = 2; a = (a - 1.5) / (1 + 1.5 * a) } else { id = 3; a = -1 / a }
  const z = a * a, w = z * z
  const s1 = z * (AT[0] + w * (AT[2] + w * (AT[4] + w * (AT[6] + w * (AT[8] + w * AT[10])))))
  const s2 = w * (AT[1] + w * (AT[3] + w * (AT[5] + w * (AT[7] + w * AT[9]))))
  if (id < 0) return (neg ? -1 : 1) * (a - a * (s1 + s2))
  const r = ATANHI[id] - ((a * (s1 + s2) - ATANLO[id]) - a)
  return neg ? -r : r
}
export function atan2(y: number, x: number): number {
  if (Number.isNaN(x) || Number.isNaN(y)) return NaN
  if (y === 0) return x > 0 || (x === 0 && 1 / x > 0) ? y : 1 / y > 0 ? Math.PI : -Math.PI
  if (x === 0) return y > 0 ? Math.PI / 2 : -Math.PI / 2
  const r = Math.abs(y / x)
  const z = r > 1e18 ? Math.PI / 2 + 0.5 * PI_LO : x < 0 && r < 1e-18 ? 0 : atan(r)
  if (x > 0) return y > 0 ? z : -z
  return y > 0 ? Math.PI - (z - PI_LO) : (z - PI_LO) - Math.PI
}
export const acos = (v: number) => { const c = clamp(v, -1, 1); return atan2(Math.sqrt((1 - c) * (1 + c)), c) }

export const sqrt = Math.sqrt
export const abs = Math.abs
export const min = Math.min
export const max = Math.max
export const floor = Math.floor
export const ceil = Math.ceil
export const PI = Math.PI
export const DEG = PI / 180

export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v)
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t

export const v3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z })
export const copy = (a: Vec3): Vec3 => ({ x: a.x, y: a.y, z: a.z })
export const set = (o: Vec3, a: Vec3): Vec3 => { o.x = a.x; o.y = a.y; o.z = a.z; return o }
export const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z })
export const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z })
export const scale = (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s })
export const madd = (a: Vec3, b: Vec3, s: number): Vec3 => ({ x: a.x + b.x * s, y: a.y + b.y * s, z: a.z + b.z * s })
export const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z
export const cross = (a: Vec3, b: Vec3): Vec3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x })
export const len = (a: Vec3) => sqrt(a.x * a.x + a.y * a.y + a.z * a.z)
export const dist = (a: Vec3, b: Vec3) => len(sub(a, b))
export const norm = (a: Vec3, fallback: Vec3 = { x: 0, y: 0, z: 1 }): Vec3 => {
  const l = len(a)
  return l > 1e-12 ? scale(a, 1 / l) : copy(fallback)
}
/** Component of a in the plane with normal n (n unit length). */
export const flatten = (a: Vec3, n: Vec3): Vec3 => madd(a, n, -dot(a, n))
export const angleBetween = (a: Vec3, b: Vec3) => acos(dot(norm(a), norm(b)))
export const isFiniteVec = (a: Vec3) => Number.isFinite(a.x) && Number.isFinite(a.y) && Number.isFinite(a.z)

/** Unit vector for a heading in radians, clockwise from north (+y), in the xy plane. */
export const headingDir = (h: number): Vec3 => ({ x: sin(h), y: cos(h), z: 0 })
export const headingOf = (d: Vec3) => atan2(d.x, d.y)
/** Rotate v around unit axis k by angle a (Rodrigues); + is counterclockwise looking down k. */
export function rotateAround(v: Vec3, k: Vec3, a: number): Vec3 {
  const c = cos(a), s = sin(a)
  const kxv = cross(k, v)
  return madd(madd(scale(v, c), kxv, s), k, dot(k, v) * (1 - c))
}

/** Signed angle from a to b about n (a and b in the plane of n), + counterclockwise looking down n. */
export const signedAngle = (a: Vec3, b: Vec3, n: Vec3) => atan2(dot(cross(a, b), n), dot(a, b))

export const wrapAngle = (a: number) => {
  let r = a % (2 * PI)
  if (r > PI) r -= 2 * PI
  if (r < -PI) r += 2 * PI
  return r
}
