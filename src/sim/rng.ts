// The only source of randomness in the sim. sfc32, state stored in the world so
// snapshots carry it. Every random call goes through these functions.

export type RngState = [number, number, number, number]

export function seedRng(seed: number): RngState {
  // splitmix32 expands one seed into four state words.
  let s = seed >>> 0
  const next = () => {
    s = (s + 0x9e3779b9) >>> 0
    let z = s
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0
    return (z ^ (z >>> 16)) >>> 0
  }
  const st: RngState = [next(), next(), next(), next()]
  for (let i = 0; i < 12; i++) nextU32(st)
  return st
}

export function nextU32(st: RngState): number {
  let [a, b, c, d] = st
  const t = (((a + b) >>> 0) + d) >>> 0
  d = (d + 1) >>> 0
  a = b ^ (b >>> 9)
  b = (c + (c << 3)) >>> 0
  c = ((c << 21) | (c >>> 11)) >>> 0
  c = (c + t) >>> 0
  st[0] = a >>> 0; st[1] = b; st[2] = c; st[3] = d
  return t
}

/** Uniform in [0, 1). */
export const nextFloat = (st: RngState) => nextU32(st) / 4294967296
/** Uniform in [lo, hi). */
export const nextRange = (st: RngState, lo: number, hi: number) => lo + (hi - lo) * nextFloat(st)
