import * as THREE from 'three'

// The skyline beyond the city (draw-only): the DEM's hills out to 3.5 km around the city's extent
// and Sutro Tower on Mount Sutro, from the export's city.skyline. Both are far beyond the camera's
// far plane, so the vertex shader pulls every vertex along its line of sight to at most CLAMP
// metres from the eye: the picture is unchanged and the city in front still hides them. San
// Francisco's fog lies low, so the haze here thins with height: the hills and the tower stand
// above it (the city's own fog swallows everything low past its far end). At night the tower's
// aircraft lights blink red.

export type SkylineData = {
  grid: { x0: number; y0: number; step: number; nx: number; ny: number; z: number[] }   // z in decimetres, rows from y0
  tower: { x: number; y: number; z: number; height: number }
  downtown?: { name: string; x: number; y: number; z: number; height: number; shape: string; w: number; d: number }[]
  bridge?: { points: { name: string; x: number; y: number; kind: string }[]; water: number; deck: number; tower: number; anchor: number }
}

const CLAMP = 510

const VERT = `
attribute vec3 color;
attribute float emit;
attribute float win;
attribute float water;
attribute float lamp;
uniform float clampDist;
varying vec3 vColor; varying vec3 vN; varying float vDist; varying float vZ; varying float vEmit; varying float vWin; varying vec3 vWP; varying float vWater; varying float vLamp;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vec3 d = wp.xyz - cameraPosition;
  float l = length(d);
  vec3 p = cameraPosition + d * min(1.0, clampDist / max(l, 1e-3));
  vColor = color; vN = normalize(mat3(modelMatrix) * normal); vDist = l; vZ = wp.z; vEmit = emit; vWin = win; vWP = wp.xyz; vWater = water; vLamp = lamp;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`

const FRAG = `
uniform vec3 fogColor; uniform float fogNear; uniform float fogFar;
uniform vec3 sunDir; uniform float daylight; uniform float glow; uniform float blink; uniform float hfog;
varying vec3 vColor; varying vec3 vN; varying float vDist; varying float vZ; varying float vEmit; varying float vWin; varying vec3 vWP; varying float vWater; varying float vLamp;
float h21(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
void main() {
  vec3 n = normalize(vN);
  float diff = max(dot(n, normalize(sunDir)), 0.0);
  vec3 col = vColor * (0.42 + 0.58 * diff) * daylight;
  // Office towers: floors of windows (3.6 m), glassier bands by day, about a third lit at night.
  float lit = 0.0;
  if (vWin > 0.5 && abs(n.z) < 0.5) {
    float u = abs(n.x) > abs(n.y) ? vWP.y : vWP.x;
    vec2 cell = vec2(floor(u / 2.4), floor(vWP.z / 3.6));
    float inWin = step(0.22, fract(vWP.z / 3.6)) * step(0.15, fract(u / 2.4));
    // Kilometres away a window is under a pixel: fade the grid to its average (no sparkle when the
    // camera moves), first per block of floors (lit offices come in groups), then per tower.
    float fw = max(fwidth(u), fwidth(vWP.z));
    float fine = 1.0 - smoothstep(0.5, 1.3, fw), coarse = 1.0 - smoothstep(4.0, 10.0, fw);
    float bl = h21(floor(cell / vec2(6.0, 3.0)) + floor(vWP.xy / 50.0) + 7.0);
    float block = 0.55 * bl * bl;
    col *= mix(0.8, mix(1.0, 0.72, inWin), fine);
    lit = mix(mix(0.1, block, coarse), inWin * step(0.62, h21(cell + floor(vWP.xy / 50.0))), fine);
  }
  // The bay: dark water that takes the sky at a grazing angle, a sun glint, the city's lights at night.
  if (vWater > 0.5) {
    vec3 V = normalize(cameraPosition - vWP);
    float fres = pow(1.0 - clamp(V.z, 0.0, 1.0), 5.0);
    col = mix(vec3(0.07, 0.13, 0.16) * daylight, fogColor * (0.55 + 0.45 * daylight), 0.2 + 0.7 * fres);
    vec3 R = reflect(-V, vec3(0.0, 0.0, 1.0));
    col += vec3(1.0, 0.95, 0.85) * pow(max(dot(R, normalize(sunDir)), 0.0), 90.0) * daylight * 0.6;
    col += vec3(1.0, 0.8, 0.55) * glow * 0.05 * step(0.82, h21(floor(vWP.xy / vec2(5.0, 16.0))));
  }
  // Low fog, thin above it: by distance, and much less above 250 m.
  float layer = 1.0 - smoothstep(25.0, 260.0, vZ);
  float far = 1.0 - exp(-vDist / 2200.0);
  float haze = clamp(far * (0.26 + 0.42 * layer) + 0.03, 0.0, 0.96);   // under the day sky the haze is its bright horizon: a touch less of it keeps the towers
  haze = max(haze, smoothstep(fogNear, fogFar, vDist) * layer * 0.8);
  // Karl the Fog (the weather's height fog, hfog 0..1): a bank over the bay as thick as the city's own.
  // The skyline is drawn pulled in to the camera's far plane, so the city's height-fog pass, which
  // reads depth, sees it far too near and leaves it clear; here it fades by its true distance, the
  // water, the bridge deck and its towers (160 m) all the way, the hills and the tallest towers
  // standing above the bank.
  float bank = hfog * (1.0 - smoothstep(170.0, 330.0, vZ)) * (1.0 - exp(-vDist / 300.0));
  haze = max(haze, bank);
  // Distant blocks take a cooler, darker haze than the bright horizon behind them (aerial perspective), so the
  // towers read as silhouettes against the sky; Karl's bank is the fog's own colour.
  col = mix(col, fogColor * mix(vec3(0.8, 0.85, 0.93), vec3(1.0), max(bank, 1.0 - daylight)), haze);
  // Aircraft lights: red, blinking, at night (through the haze).
  col += vec3(1.0, 0.08, 0.04) * vEmit * glow * blink * 7.0;
  col += vec3(1.0, 0.86, 0.62) * lit * glow * (1.0 - haze * 0.6) * (1.0 - bank) * 1.6;
  // The Bay Lights: the bridge's cables and deck lamps, white, at night (gone in the fog bank).
  col += vec3(0.95, 0.96, 1.0) * vLamp * glow * (1.0 - haze * 0.5) * (1.0 - bank) * 2.2;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`

export class Skyline {
  readonly group = new THREE.Group()
  readonly uniforms = {
    clampDist: { value: CLAMP }, fogColor: { value: new THREE.Color(0xc7cacd) }, fogNear: { value: 60 }, fogFar: { value: 340 },
    sunDir: { value: new THREE.Vector3(0.4, -0.3, 0.85) }, daylight: { value: 1 }, glow: { value: 0 }, blink: { value: 0 }, hfog: { value: 0 },
  }
  private ground: THREE.Mesh
  private tower: THREE.Mesh
  private grid: SkylineData['grid']

  private water = -1e9
  private core: { x0: number; y0: number; x1: number; y1: number } | undefined
  constructor(data: SkylineData, extent: { x0: number; y0: number; x1: number; y1: number }, style: 'real' | 'cute' | 'grey' = 'real', core?: { x0: number; y0: number; x1: number; y1: number }) {
    this.core = core
    this.grid = data.grid
    if (data.bridge) this.water = data.bridge.water
    const mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: this.uniforms, side: THREE.DoubleSide })
    this.ground = new THREE.Mesh(this.groundGeometry(extent, style), mat)
    this.tower = new THREE.Mesh(towerGeometry(data.tower), mat)
    const city = new THREE.Mesh(downtownGeometry(data.downtown ?? []), mat)
    const parts = [this.ground, this.tower, city]
    if (data.bridge) parts.push(new THREE.Mesh(bridgeGeometry(data.bridge, (x, y) => this.heightAt(x, y)), mat))
    for (const m of parts) { m.frustumCulled = false; m.renderOrder = -1 }
    this.group.add(...parts)
  }

  /** Height of the far terrain (site z) at x, y: bilinear on the grid. */
  heightAt(x: number, y: number): number {
    const g = this.grid
    const fx = Math.min(Math.max((x - g.x0) / g.step, 0), g.nx - 1.001), fy = Math.min(Math.max((y - g.y0) / g.step, 0), g.ny - 1.001)
    const i = Math.floor(fx), j = Math.floor(fy), u = fx - i, v = fy - j
    const z = (a: number, b: number) => g.z[b * g.nx + a] / 10
    return (z(i, j) * (1 - u) + z(i + 1, j) * u) * (1 - v) + (z(i, j + 1) * (1 - u) + z(i + 1, j + 1) * u) * v
  }

  private groundGeometry(ext: { x0: number; y0: number; x1: number; y1: number }, style: string): THREE.BufferGeometry {
    const g = this.grid
    const pos: number[] = [], col: number[] = [], emit: number[] = [], idx: number[] = [], water: number[] = []
    const sea = style === 'cute' ? new THREE.Color('#7cc4e0') : style === 'grey' ? new THREE.Color('#a9adb0') : new THREE.Color('#1d3440')
    const base = style === 'cute' ? new THREE.Color('#9fc79a') : style === 'grey' ? new THREE.Color('#b8b9b7') : new THREE.Color('#5c6253')
    const scrub = style === 'cute' ? new THREE.Color('#c9d9a8') : style === 'grey' ? new THREE.Color('#c4c4c2') : new THREE.Color('#7d7a62')
    const inside = (x: number, y: number) => x > ext.x0 && x < ext.x1 && y > ext.y0 && y < ext.y1
    // Left out only where the city's own plain context covers everything (the core rectangle when the
    // export gives one: past it the extent is mostly downtown, filled only along the corridors).
    const K = this.core ?? ext
    const covered = (x: number, y: number) => x > K.x0 && x < K.x1 && y > K.y0 && y < K.y1
    const c = new THREE.Color()
    for (let j = 0; j < g.ny; j++) for (let i = 0; i < g.nx; i++) {
      const x = g.x0 + i * g.step, y = g.y0 + j * g.step
      let z = g.z[j * g.nx + i] / 10
      if (inside(x, y)) z -= 4   // under the city's own ground where a boundary cell reaches in
      pos.push(x, y, z)
      c.copy(base).lerp(scrub, Math.min(1, Math.max(0, (z - 60) / 180)))   // bare scrub on the high ridges
      const wet = z <= this.water + 0.6 && !inside(x, y)   // the bay: the DEM's water is flat near sea level
      if (wet) { z = this.water; c.copy(sea); pos[pos.length - 1] = z }
      water.push(wet && style === 'real' ? 1 : 0)
      col.push(c.r, c.g, c.b); emit.push(0)
    }
    for (let j = 0; j < g.ny - 1; j++) for (let i = 0; i < g.nx - 1; i++) {
      const x = g.x0 + i * g.step, y = g.y0 + j * g.step
      if (covered(x, y) && covered(x + g.step, y) && covered(x, y + g.step) && covered(x + g.step, y + g.step)) continue
      const a = j * g.nx + i, b = a + 1, d = a + g.nx, e = d + 1
      idx.push(a, b, e, a, e, d)
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
    geo.setAttribute('emit', new THREE.Float32BufferAttribute(emit, 1))
    geo.setAttribute('win', new THREE.Float32BufferAttribute(new Float32Array(emit.length), 1))
    geo.setAttribute('water', new THREE.Float32BufferAttribute(water, 1))
    geo.setAttribute('lamp', new THREE.Float32BufferAttribute(new Float32Array(emit.length), 1))
    geo.setIndex(idx)
    geo.computeVertexNormals()
    return geo
  }

  /** Every frame: the city's fog, the time of day, the blink and the weather's height fog (0..1). */
  update(fog: THREE.Fog | null, glow: number, timeSec: number, cameraFar = 600, heightFog = 0) {
    const u = this.uniforms
    u.hfog.value = heightFog
    u.clampDist.value = cameraFar * 0.85   // inside the night sky dome (0.9 far), which draws over anything behind it
    if (fog) { u.fogColor.value.copy(fog.color); u.fogNear.value = fog.near; u.fogFar.value = fog.far }
    else { u.fogNear.value = 1e6; u.fogFar.value = 2e6 }
    u.glow.value = glow
    u.daylight.value = 1 - 0.93 * glow
    u.blink.value = Math.sin(timeSec * Math.PI * 2 * 0.5) > 0.2 ? 1 : 0.15   // about 1 s on, 1 s off
  }
}

/**
 * Sutro Tower, low-poly from its real size: three legs from a base about 52 m across rising
 * to the upper crossbars at about 225 m, a lower crossbar at 140 m, three masts to 298 m; red
 * and white bands; aircraft lights on the mast tops and the crossbar ends.
 */
function towerGeometry(t: SkylineData['tower']): THREE.BufferGeometry {
  const pos: number[] = [], col: number[] = [], emit: number[] = []
  const red = new THREE.Color('#c8341f'), white = new THREE.Color('#ece9e2')
  const band = (z: number) => (Math.floor(z / 21) % 2 === 0 ? red : white)
  const quad = (a: number[], b: number[], c: number[], d: number[], cc: THREE.Color, e = 0) => {
    for (const p of [a, b, c, a, c, d]) { pos.push(p[0], p[1], p[2]); col.push(cc.r, cc.g, cc.b); emit.push(e) }
  }
  // A tapered square prism from p0 (half size h0) to p1 (half size h1), split into bands.
  const prism = (p0: number[], p1: number[], h0: number, h1: number, steps: number, e = 0, colour?: THREE.Color) => {
    for (let s = 0; s < steps; s++) {
      const k0 = s / steps, k1 = (s + 1) / steps
      const A = p0.map((v, i) => v + (p1[i] - v) * k0), B = p0.map((v, i) => v + (p1[i] - v) * k1)
      const ha = h0 + (h1 - h0) * k0, hb = h0 + (h1 - h0) * k1
      const cc = colour ?? band((A[2] + B[2]) / 2 - t.z)
      const corners = (P: number[], h: number) => [[P[0] - h, P[1] - h, P[2]], [P[0] + h, P[1] - h, P[2]], [P[0] + h, P[1] + h, P[2]], [P[0] - h, P[1] + h, P[2]]]
      const ca = corners(A, ha), cb = corners(B, hb)
      for (let k = 0; k < 4; k++) quad(ca[k], ca[(k + 1) % 4], cb[(k + 1) % 4], cb[k], cc, e)
    }
  }
  const beam = (a: number[], b: number[], w: number, hgt: number, cc: THREE.Color) => {
    const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy), nx = -dy / l * w / 2, ny = dx / l * w / 2
    const lo = (p: number[], s: number) => [p[0] + nx * s, p[1] + ny * s, p[2]]
    const hi = (p: number[], s: number) => [p[0] + nx * s, p[1] + ny * s, p[2] + hgt]
    quad(lo(a, 1), lo(b, 1), hi(b, 1), hi(a, 1), cc); quad(lo(b, -1), lo(a, -1), hi(a, -1), hi(b, -1), cc)
    quad(hi(a, 1), hi(b, 1), hi(b, -1), hi(a, -1), cc); quad(lo(a, -1), lo(b, -1), lo(b, 1), lo(a, 1), cc)
  }
  const legTop = 225, mastTop = t.height
  const angles = [Math.PI / 2, Math.PI / 2 + (2 * Math.PI) / 3, Math.PI / 2 + (4 * Math.PI) / 3]
  const at = (a: number, r: number, z: number) => [t.x + Math.cos(a) * r, t.y + Math.sin(a) * r, t.z + z]
  for (const a of angles) {
    // Legs and masts drawn about 1.5x their real girth, so the tower still reads from 3 km away.
    prism(at(a, 26, -5), at(a, 16, legTop), 3.4, 2.2, 11)
    prism(at(a, 16, legTop), at(a, 16, mastTop - 6), 1.3, 0.8, 4)
    prism(at(a, 16, mastTop - 6), at(a, 16, mastTop), 0.35, 0.2, 1, 0, white)
  }
  for (let k = 0; k < 3; k++) {
    const a = angles[k], b = angles[(k + 1) % 3]
    beam(at(a, 21.5, 138), at(b, 21.5, 138), 2.6, 3.0, white)
    beam(at(a, 22, legTop - 2), at(b, 22, legTop - 2), 3.5, 5.0, red)
  }
  // Aircraft lights: small boxes that glow red at night.
  for (const a of angles) {
    prism(at(a, 16, mastTop), at(a, 16, mastTop + 2.4), 1.2, 1.2, 1, 1, red)
    prism(at(a, 26, legTop + 3), at(a, 26, legTop + 5.4), 1.2, 1.2, 1, 1, red)
    prism(at(a, 21, 141), at(a, 21, 143.4), 1.2, 1.2, 1, 1, red)
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
  geo.setAttribute('emit', new THREE.Float32BufferAttribute(emit, 1))
  geo.setAttribute('win', new THREE.Float32BufferAttribute(new Float32Array(emit.length), 1))
  zeroAttrs(geo, emit.length)
  geo.computeVertexNormals()
  return geo
}

/** The water and lamp attributes, zero, for meshes that have neither. */
function zeroAttrs(geo: THREE.BufferGeometry, n: number) {
  geo.setAttribute('water', new THREE.Float32BufferAttribute(new Float32Array(n), 1))
  geo.setAttribute('lamp', new THREE.Float32BufferAttribute(new Float32Array(n), 1))
}

/**
 * The Bay Bridge's west spans (the export's city.skyline.bridge): from the San Francisco anchorage
 * to Yerba Buena Island, four towers (two either side of the central anchorage), the double deck, the
 * main cables sagging between the tower tops, all drawn thicker than life so they read from 2 km;
 * at night the cables and the deck lamps glow white (The Bay Lights) and the tower tops blink red.
 */
function bridgeGeometry(b: NonNullable<SkylineData['bridge']>, heightAt: (x: number, y: number) => number): THREE.BufferGeometry {
  const pos: number[] = [], col: number[] = [], emit: number[] = [], lamp: number[] = []
  const grey = new THREE.Color('#9aa3a8'), dark = new THREE.Color('#6f777c'), concrete = new THREE.Color('#b9b6ae')
  const quad = (a: number[], c1: number[], c: number[], d: number[], cc: THREE.Color, e = 0, l = 0) => {
    for (const p of [a, c1, c, a, c, d]) { pos.push(p[0], p[1], p[2]); col.push(cc.r, cc.g, cc.b); emit.push(e); lamp.push(l) }
  }
  // A box from a to b (centre line, any slope) of width w and height h, sideways along n.
  const beam = (a: number[], c: number[], n: number[], w: number, h: number, cc: THREE.Color, e = 0, l = 0) => {
    const o = (p: number[], s: number, t: number) => [p[0] + n[0] * s * w / 2, p[1] + n[1] * s * w / 2, p[2] + t * h / 2]
    quad(o(a, -1, -1), o(c, -1, -1), o(c, -1, 1), o(a, -1, 1), cc, e, l); quad(o(c, 1, -1), o(a, 1, -1), o(a, 1, 1), o(c, 1, 1), cc, e, l)
    quad(o(a, -1, 1), o(c, -1, 1), o(c, 1, 1), o(a, 1, 1), cc, e, l); quad(o(a, 1, -1), o(c, 1, -1), o(c, -1, -1), o(a, -1, -1), cc, e, l)
  }
  const P = b.points
  const A = P[0], Z = P[P.length - 1]
  const L = Math.hypot(Z.x - A.x, Z.y - A.y), dx = (Z.x - A.x) / L, dy = (Z.y - A.y) / L, n = [-dy, dx]
  // The supports: the ends and the central anchorage, and two towers in each half.
  const at = (f: number) => [A.x + (Z.x - A.x) * f, A.y + (Z.y - A.y) * f]
  const W = b.water, deck = W + b.deck
  const sup: { f: number; kind: string; top: number }[] = [
    { f: 0, kind: 'end', top: deck + 2 }, { f: 0.12, kind: 'tower', top: W + b.tower }, { f: 0.37, kind: 'tower', top: W + b.tower },
    { f: 0.5, kind: 'anchor', top: W + b.anchor }, { f: 0.63, kind: 'tower', top: W + b.tower }, { f: 0.88, kind: 'tower', top: W + b.tower }, { f: 1, kind: 'end', top: deck + 2 }]
  // The deck: two levels in one box, 20 m wide, lamps along both edges.
  beam([...at(0), deck], [...at(1), deck], n, 20, 8, dark)
  for (const s of [-1, 1]) beam([...at(0), deck + 4.5].map((v, i) => v + (i < 2 ? n[i] * s * 9.6 : 0)), [...at(1), deck + 4.5].map((v, i) => v + (i < 2 ? n[i] * s * 9.6 : 0)), n, 0.8, 0.8, grey, 0, 0.6)
  for (const s of sup) {
    const [x, y] = at(s.f)
    if (s.kind === 'tower') {
      for (const side of [-1, 1]) beam([x + n[0] * side * 11, y + n[1] * side * 11, W - 2], [x + n[0] * side * 11, y + n[1] * side * 11, s.top], [dx, dy], 7, 6, grey)
      for (const z of [deck + 18, deck + 58, s.top - 4]) beam([x - n[0] * 11, y - n[1] * 11, z], [x + n[0] * 11, y + n[1] * 11, z], [dx, dy], 5, 5, grey)
      for (const side of [-1, 1]) beam([x + n[0] * side * 11, y + n[1] * side * 11, s.top], [x + n[0] * side * 11, y + n[1] * side * 11, s.top + 3], [dx, dy], 3, 3, grey, 1)
    } else if (s.kind === 'anchor') {
      beam([x - dx * 25, y - dy * 25, W - 2 + (s.top - W) / 2], [x + dx * 25, y + dy * 25, W - 2 + (s.top - W) / 2], n, 34, s.top - W + 2, concrete)
    } else {
      const g = Math.max(heightAt(x, y), W)
      beam([x, y, g - 2 + (deck - g) / 2], [x + dx * (s.f === 0 ? 30 : -30), y + dy * (s.f === 0 ? 30 : -30), g - 2 + (deck - g) / 2], n, 30, deck - g + 4, concrete)
    }
  }
  // The main cables: between neighbouring supports, sagging to just over the deck in the main spans.
  for (let k = 0; k + 1 < sup.length; k++) {
    const s0 = sup[k], s1 = sup[k + 1]
    const main = s0.kind === 'tower' && s1.kind === 'tower'
    const low = main ? deck + 5 : Math.min(s0.top, s1.top) - 12
    const steps = 14
    for (const side of [-1, 1]) {
      let prev: number[] | null = null
      for (let i = 0; i <= steps; i++) {
        const u = i / steps, f = s0.f + (s1.f - s0.f) * u
        const chord = s0.top + (s1.top - s0.top) * u
        const z = main ? low + (s0.top - low) * Math.pow(2 * u - 1, 2) : chord - (chord - low) * 4 * u * (1 - u) * 0.25
        const [x, y] = at(f)
        const p = [x + n[0] * side * 11, y + n[1] * side * 11, z]
        if (prev) beam(prev, p, n, 1.6, 1.6, grey, 0, 1)
        prev = p
      }
    }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
  geo.setAttribute('emit', new THREE.Float32BufferAttribute(emit, 1))
  geo.setAttribute('win', new THREE.Float32BufferAttribute(new Float32Array(emit.length), 1))
  geo.setAttribute('water', new THREE.Float32BufferAttribute(new Float32Array(emit.length), 1))
  geo.setAttribute('lamp', new THREE.Float32BufferAttribute(lamp, 1))
  geo.computeVertexNormals()
  return geo
}

/**
 * Downtown: low-poly towers at their real positions and heights (the export's city.skyline.downtown):
 * Salesforce Tower's tapering rounded shaft and crown, the Transamerica Pyramid with its spire,
 * 181 Fremont's spire, the dark Bank of America Center, 345 California's twin spires, Coit Tower's fluted column, and plain
 * boxes for the rest. Window floors (lit at night) come from the shader.
 */
function downtownGeometry(list: NonNullable<SkylineData['downtown']>): THREE.BufferGeometry {
  const pos: number[] = [], col: number[] = [], emit: number[] = [], win: number[] = []
  const tri = (a: number[], b: number[], c: number[], cc: THREE.Color, w = 1, e = 0) => {
    for (const p of [a, b, c]) { pos.push(p[0], p[1], p[2]); col.push(cc.r, cc.g, cc.b); emit.push(e); win.push(w) }
  }
  const quad = (a: number[], b: number[], c: number[], d: number[], cc: THREE.Color, w = 1, e = 0) => { tri(a, b, c, cc, w, e); tri(a, c, d, cc, w, e) }
  // A prism with n sides, from z0 (radius r0) to z1 (radius r1); square ones are rotated to the plan.
  const prism = (x: number, y: number, z0: number, z1: number, rx0: number, ry0: number, rx1: number, ry1: number, n: number, cc: THREE.Color, w = 1, cap = true) => {
    const off = n === 4 ? Math.PI / 4 : Math.PI / n
    const ring = (z: number, rx: number, ry: number) => Array.from({ length: n }, (_, k) => {
      const a = off + (k / n) * Math.PI * 2
      return [x + Math.cos(a) * rx * (n === 4 ? Math.SQRT2 : 1), y + Math.sin(a) * ry * (n === 4 ? Math.SQRT2 : 1), z]
    })
    const A = ring(z0, rx0, ry0), B = ring(z1, rx1, ry1)
    for (let k = 0; k < n; k++) quad(A[k], A[(k + 1) % n], B[(k + 1) % n], B[k], cc, w)
    if (cap) for (let k = 1; k < n - 1; k++) tri(B[0], B[k], B[k + 1], cc, 0)
  }
  const C = (h: string) => new THREE.Color(h)
  for (const t of list) {
    const { x, y, z, height: H, w, d } = t
    const hw = w / 2, hd = d / 2
    if (t.shape === 'salesforce') {
      const c = C('#cfd2d4')
      prism(x, y, z - 5, z + H * 0.82, hw, hd, hw * 0.86, hd * 0.86, 12, c)
      prism(x, y, z + H * 0.82, z + H * 0.95, hw * 0.86, hd * 0.86, hw * 0.62, hd * 0.62, 12, C('#e4e6e8'), 0)
      prism(x, y, z + H * 0.95, z + H, hw * 0.62, hd * 0.62, hw * 0.3, hd * 0.3, 12, C('#e4e6e8'), 0)
    } else if (t.shape === 'pyramid') {
      const c = C('#ebe9e2')
      prism(x, y, z - 5, z + H * 0.82, hw, hd, hw * 0.08, hd * 0.08, 4, c)
      prism(x, y, z + H * 0.82, z + H, hw * 0.08, hd * 0.08, 0.6, 0.6, 4, c, 0)
    } else if (t.shape === 'spire') {
      const c = C('#c3c9cd')
      prism(x, y, z - 5, z + H * 0.86, hw, hd, hw * 0.9, hd * 0.9, 4, c)
      prism(x, y, z + H * 0.86, z + H, 1.2, 1.2, 0.3, 0.3, 4, c, 0)
    } else if (t.shape === 'dark') {
      const c = C('#4b3c37')
      prism(x, y, z - 5, z + H * 0.7, hw, hd, hw, hd, 4, c)
      prism(x, y, z + H * 0.7, z + H * 0.9, hw * 0.92, hd * 0.85, hw * 0.92, hd * 0.85, 4, c)
      prism(x, y, z + H * 0.9, z + H, hw * 0.8, hd * 0.7, hw * 0.8, hd * 0.7, 4, c)
    } else if (t.shape === 'coit') {
      // Coit Tower: a fluted concrete column (16 flutes) on Telegraph Hill, an arcaded observation
      // storey near the top (darker openings), a plain cap and a low lantern. No window floors.
      const c = C('#e7e1d1'), dark = C('#8d877c'), n = 32
      const ring = (z: number, r: number) => Array.from({ length: n }, (_, k) => {
        const a = (k / n) * Math.PI * 2, rr = r * (k % 2 ? 0.9 : 1)
        return [x + Math.cos(a) * rr, y + Math.sin(a) * rr, z]
      })
      const band = (z0: number, z1: number, r0: number, r1: number, cc: THREE.Color) => {
        const A = ring(z0, r0), B = ring(z1, r1)
        for (let k = 0; k < n; k++) quad(A[k], A[(k + 1) % n], B[(k + 1) % n], B[k], cc, 0)
      }
      band(z - 5, z + H * 0.84, hw, hw * 0.96, c)
      band(z + H * 0.84, z + H * 0.9, hw * 0.96, hw * 0.96, dark)   // the arcade's openings
      band(z + H * 0.9, z + H * 0.95, hw * 0.96, hw * 1.02, c)
      prism(x, y, z + H * 0.95, z + H, hw * 1.02, hd * 1.02, hw * 0.7, hd * 0.7, 16, c, 0)
      prism(x, y, z + H, z + H + 3, hw * 0.25, hd * 0.25, hw * 0.2, hd * 0.2, 8, c, 0)
    } else if (t.shape === 'twin') {
      const c = C('#bfb9ae')
      prism(x, y, z - 5, z + H * 0.82, hw, hd, hw, hd, 4, c)
      for (const s of [-1, 1]) prism(x + s * hw * 0.5, y, z + H * 0.82, z + H, 1.0, 1.0, 0.4, 0.4, 4, c, 0)
    } else {
      const shades = ['#b8bec3', '#c7c1b6', '#a9b0b6', '#d2cdc3', '#9fa7ad']
      const c = C(shades[Math.abs(Math.round(x + y)) % shades.length])
      prism(x, y, z - 5, z + H * 0.92, hw, hd, hw, hd, 4, c)
      prism(x, y, z + H * 0.92, z + H, hw * 0.75, hd * 0.75, hw * 0.75, hd * 0.75, 4, c)
    }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
  geo.setAttribute('emit', new THREE.Float32BufferAttribute(emit, 1))
  geo.setAttribute('win', new THREE.Float32BufferAttribute(win, 1))
  zeroAttrs(geo, emit.length)
  geo.computeVertexNormals()
  return geo
}
