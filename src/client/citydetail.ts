import * as THREE from 'three'

// Landmarks and art the city export places but does not model (draw-only, world sf, real look):
// the Clarion Alley, Balmy Alley and Lilac Street murals (original art, assets/real/city/murals.jpg,
// murals-balmy.jpg and murals-lilac.jpg, made by tools/gen_murals.py), the papel picado over 24th St, Chinatown's lanterns over Grant Ave,
// the Castro Theatre's vertical CASTRO sign and its marquee (text from data/signs.json castro),
// and the rainbow flag at Harvey Milk Plaza. Positions come from the manifest (city.murals,
// city.castro, city.flag; the world generator's city/). Lit at night through the lamp chunk and the
// shared glow (signs and bulbs glow themselves).

export type MuralPiece = { a: number[]; e: number[]; za: number; ze: number; top: number; h: number; n: number[]; m: number; u0: number; u1: number; atlas?: number }
const MURAL_ATLASES = ['assets/real/city/murals.jpg', 'assets/real/city/murals-balmy.jpg', 'assets/real/city/murals-lilac.jpg']
export type CastroData = { x: number; y: number; z: number; top: number; n: number[]; t: number[]; width: number }
export type FlagData = { x: number; y: number; z: number; height: number }
export type ShopSign = { text: string; x: number; y: number; z: number; heading: number; width: number; height: number }
type CastroText = { marquee?: string[]; left?: string[]; right?: string[] }

const MURAL_COLS = 3, MURAL_ROWS = 4
type LampLit = (m: THREE.MeshStandardMaterial, key: string) => THREE.MeshStandardMaterial

export class CityDetail {
  readonly group = new THREE.Group()
  private glowMats: { m: THREE.MeshStandardMaterial; day: number; night: number; pulse?: number }[] = []
  private flagTime: { value: number } = { value: 0 }
  private papelTime: { value: number } = { value: 0 }
  private lanternTime: { value: number } = { value: 0 }

  static async create(data: { murals?: MuralPiece[]; castro?: CastroData | null; flag?: FlagData | null; papel?: number[][]; lanterns?: number[][]; shopsigns?: ShopSign[] }, lampLit: LampLit): Promise<CityDetail> {
    const d = new CityDetail()
    const jobs: Promise<void>[] = []
    if (data.murals?.length) {
      for (let a = 0; a < MURAL_ATLASES.length; a++) {
        const set = data.murals.filter((p) => (p.atlas ?? 0) === a)
        if (set.length) jobs.push(d.murals(set, MURAL_ATLASES[a], lampLit))
      }
    }
    if (data.papel?.length) d.papel(data.papel, lampLit)
    if (data.lanterns?.length) d.lanterns(data.lanterns, lampLit)
    if (data.shopsigns?.length) jobs.push(d.shopSigns(data.shopsigns, lampLit))
    if (data.castro) jobs.push(d.castro(data.castro, lampLit))
    if (data.flag) d.flag(data.flag, lampLit)
    await Promise.all(jobs)
    return d
  }

  /** Each frame: neon and bulbs follow the night glow (0 by day, 1 at night); the flag waves. */
  update(timeSec: number, glow: number) {
    this.flagTime.value = timeSec
    this.papelTime.value = timeSec
    this.lanternTime.value = timeSec
    for (const g of this.glowMats) {
      const pulse = g.pulse ? 0.85 + 0.15 * Math.sin(timeSec * g.pulse) : 1
      g.m.emissiveIntensity = (g.day + (g.night - g.day) * glow) * pulse
    }
  }

  private async murals(pieces: MuralPiece[], url: string, lampLit: LampLit) {
    const tex = await new THREE.TextureLoader().loadAsync(url)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.anisotropy = 8
    const pos: number[] = [], uv: number[] = [], nrm: number[] = [], idx: number[] = []
    const inset = 0.004
    for (const p of pieces) {
      const off = 0.03
      const [nx, ny] = p.n
      const ax = p.a[0] + nx * off, ay = p.a[1] + ny * off, ex = p.e[0] + nx * off, ey = p.e[1] + ny * off
      const ta = Math.min(p.top, p.za + p.h), te = Math.min(p.top, p.ze + p.h)
      // A wall lower than the mural shows its middle band (centre crop), never a squashed mural.
      const fa = Math.max(0, Math.min(1, (ta - p.za) / p.h)), fe = Math.max(0, Math.min(1, (te - p.ze) / p.h))
      if (fa < 0.15 && fe < 0.15) continue
      const col = p.m % MURAL_COLS, row = Math.floor(p.m / MURAL_COLS) % MURAL_ROWS
      const U = (u: number) => (col + inset + u * (1 - 2 * inset)) / MURAL_COLS
      const V = (v: number) => 1 - (row + 1 - (inset + v * (1 - 2 * inset))) / MURAL_ROWS   // flipY: row 0 at the top
      const k = pos.length / 3
      pos.push(ax, ay, p.za, ex, ey, p.ze, ex, ey, te, ax, ay, ta)
      uv.push(U(p.u0), V((1 - fa) / 2), U(p.u1), V((1 - fe) / 2), U(p.u1), V((1 + fe) / 2), U(p.u0), V((1 + fa) / 2))
      for (let i = 0; i < 4; i++) nrm.push(nx, ny, 0)
      idx.push(k, k + 1, k + 2, k, k + 2, k + 3)
    }
    if (!idx.length) return
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3))
    g.setIndex(idx)
    g.computeBoundingSphere()
    const m = lampLit(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.88, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }), 'soma-city-mural')
    const mesh = new THREE.Mesh(g, m)
    mesh.receiveShadow = true
    mesh.name = 'murals'
    this.group.add(mesh)
  }

  private async castro(c: CastroData, lampLit: LampLit) {
    let text: CastroText = {}
    try { text = ((await (await fetch('data/signs.json', { cache: 'no-store' })).json()) as { castro?: CastroText }).castro ?? {} } catch { /* defaults below */ }
    try { await document.fonts.load('500 48px Inter') } catch { /* system fallback */ }
    const n = new THREE.Vector3(c.n[0], c.n[1], 0), t = new THREE.Vector3(c.t[0], c.t[1], 0)
    const at = (s: number, o: number, z: number) => new THREE.Vector3(c.x, c.y, c.z + z).addScaledVector(t, s).addScaledVector(n, o)
    const quad = (a: THREE.Vector3, b: THREE.Vector3, cc: THREE.Vector3, d: THREE.Vector3, mat: THREE.Material) => {
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.Float32BufferAttribute([...a.toArray(), ...b.toArray(), ...cc.toArray(), ...d.toArray()], 3))
      g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2))
      g.setIndex([0, 1, 2, 0, 2, 3])
      g.computeVertexNormals(); g.computeBoundingSphere()
      const m = new THREE.Mesh(g, mat)
      m.castShadow = true; m.receiveShadow = true
      this.group.add(m)
    }
    const glowing = (map: THREE.Texture, emi: THREE.Texture, day: number, night: number, pulse?: number) => {
      const m = lampLit(new THREE.MeshStandardMaterial({ map, emissiveMap: emi, emissive: 0xffffff, emissiveIntensity: day, roughness: 0.55, side: THREE.DoubleSide }), 'soma-city-castro')
      this.glowMats.push({ m, day, night, pulse })
      return m
    }
    // The vertical blade: CASTRO top to bottom on both faces, red neon on cream inside a bulb border.
    const z0 = 5.3, z1 = Math.max(c.top - c.z + 3.0, 17.5)
    const [bladeMap, bladeEmi] = bladeCanvas(z1 - z0)
    const bm = glowing(bladeMap, bladeEmi, 0.12, 2.2)
    const o0 = 0.3, o1 = 3.0, hw = 0.35
    // Each face reads left to right for someone looking at it (u runs toward the wall on the +t face).
    quad(at(hw, o1, z0), at(hw, o0, z0), at(hw, o0, z1), at(hw, o1, z1), bm)
    quad(at(-hw, o0, z0), at(-hw, o1, z0), at(-hw, o1, z1), at(-hw, o0, z1), bm)
    const edgeMat = lampLit(new THREE.MeshStandardMaterial({ color: 0xe9dcc0, roughness: 0.6, emissive: 0xffd27a, emissiveIntensity: 0 }), 'soma-city-castro-edge')
    this.glowMats.push({ m: edgeMat, day: 0, night: 0.5, pulse: 3.1 })
    quad(at(-hw, o1, z0), at(hw, o1, z0), at(hw, o1, z1), at(-hw, o1, z1), edgeMat)
    quad(at(-hw, o0, z1), at(hw, o0, z1), at(hw, o1, z1), at(-hw, o1, z1), edgeMat)
    // A small crown on top.
    const tip = at(0, (o0 + o1) / 2, z1 + 1.6)
    for (const [a, b] of [[at(-hw, o0, z1), at(hw, o0, z1)], [at(hw, o0, z1), at(hw, o1, z1)], [at(hw, o1, z1), at(-hw, o1, z1)], [at(-hw, o1, z1), at(-hw, o0, z1)]]) {
      const g = new THREE.BufferGeometry().setFromPoints([a, b, tip]); g.computeVertexNormals()
      this.group.add(new THREE.Mesh(g, edgeMat))
    }
    // The marquee: a trapezoid canopy over the doors, readerboards on its three faces, bulbs under it.
    const mz0 = 3.5, mz1 = 5.1, back = Math.min(c.width * 0.8, 11), front = back - 2.6, dep = 2.4
    const lines = text.marquee ?? ["TONIGHT: KARL THE FOG IN", "'THE LONG GREY SUMMER'"]
    const [fMap, fEmi] = marqueeCanvas(lines, 1024, Math.round(1024 * (mz1 - mz0) / front))
    const fm = glowing(fMap, fEmi, 0.1, 1.4)
    quad(at(-front / 2, dep, mz0), at(front / 2, dep, mz0), at(front / 2, dep, mz1), at(-front / 2, dep, mz1), fm)
    const sideW = Math.hypot(dep, (back - front) / 2)
    for (const [s, key] of [[-1, 'left'], [1, 'right']] as const) {
      const [sMap, sEmi] = marqueeCanvas(text[key] ?? (s < 0 ? ['MIDNIGHT:', 'BURRITO II'] : ['SING-ALONG:', 'MUNI IS LATE']), 512, Math.round(512 * (mz1 - mz0) / sideW))
      const sm = glowing(sMap, sEmi, 0.1, 1.4)
      const a = at(s * back / 2, 0.05, mz0), b = at(s * front / 2, dep, mz0), cc = at(s * front / 2, dep, mz1), d = at(s * back / 2, 0.05, mz1)
      if (s < 0) quad(a, b, cc, d, sm); else quad(b, a, d, cc, sm)
    }
    const [soffMap, soffEmi] = bulbCanvas()
    const so = glowing(soffMap, soffEmi, 0.05, 1.8, 2.3)
    quad(at(-back / 2, 0.05, mz0), at(-front / 2, dep, mz0), at(front / 2, dep, mz0), at(back / 2, 0.05, mz0), so)
    const topMat = lampLit(new THREE.MeshStandardMaterial({ color: 0x5a1a1a, roughness: 0.7 }), 'soma-city-castro-top')
    quad(at(-back / 2, 0.05, mz1), at(back / 2, 0.05, mz1), at(front / 2, dep, mz1), at(-front / 2, dep, mz1), topMat)
  }

  /**
   * Papel picado: each string (two ends, metres) hangs in a shallow curve with a cut-paper flag every
   * 45 cm, colours in turn; the flags flutter in the vertex shader (one instanced mesh for all).
   */
  private papel(strings: number[][], lampLit: LampLit) {
    const COLS = ['#e8337a', '#f28c28', '#f5d327', '#3fb64a', '#2f8fd8', '#8e44ad', '#ffffff']
    const W = 0.34, H = 0.44, step = 0.45, sag = 0.7
    const mats: THREE.Matrix4[] = [], cols: THREE.Color[] = []
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1)
    for (const [x1, y1, z1, x2, y2, z2] of strings) {
      const L = Math.hypot(x2 - x1, y2 - y1)
      const n = Math.max(2, Math.floor(L / step))
      const yaw = Math.atan2(y2 - y1, x2 - x1)
      q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), yaw)
      for (let i = 0; i <= n; i++) {
        const t = i / n
        pos.set(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, z1 + (z2 - z1) * t - sag * 4 * t * (1 - t))
        m.compose(pos, q, one)
        mats.push(m.clone()); cols.push(new THREE.Color(COLS[(i + Math.round(x1 * 7)) % COLS.length]))
      }
    }
    if (!mats.length) return
    // The flag hangs from its top edge (local x along the string, z down).
    const g = new THREE.PlaneGeometry(W, H, 1, 3)
    g.rotateX(Math.PI / 2)
    g.translate(0, 0, -H / 2 - 0.02)
    const c = document.createElement('canvas'); c.width = 64; c.height = 84
    const x = c.getContext('2d')!
    x.fillStyle = '#fff'; x.fillRect(0, 0, 64, 84)
    x.globalCompositeOperation = 'destination-out'
    // Cut-outs: a flower, a ring of holes, a scalloped hem (alpha-tested).
    x.beginPath(); for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; x.moveTo(32, 36); x.ellipse(32 + Math.cos(a) * 8, 36 + Math.sin(a) * 8, 5, 3, a, 0, Math.PI * 2) } x.fill()
    x.beginPath(); x.arc(32, 36, 4, 0, Math.PI * 2); x.fill()
    for (let k = 0; k < 6; k++) { x.beginPath(); x.arc(9 + k * 9.2, 12, 2.6, 0, Math.PI * 2); x.fill() }
    for (let k = 0; k < 7; k++) { x.beginPath(); x.arc(4.5 + k * 9.2, 86, 5.5, 0, Math.PI * 2); x.fill() }
    const tex = new THREE.CanvasTexture(c)
    tex.colorSpace = THREE.SRGBColorSpace
    const mat = lampLit(new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.8, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0 }), 'soma-city-papel')
    this.glowMats.push({ m: mat, day: 0, night: 0.18 })
    const time = this.papelTime
    const prev = mat.onBeforeCompile
    mat.onBeforeCompile = (sh, r) => {
      prev.call(mat, sh, r)
      sh.uniforms.papelTime = time
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float papelTime;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
// Flutter: the lower edge swings across the string, more the lower it hangs; each flag its own phase.
float hang = clamp(-position.z / 0.46, 0.0, 1.0);
#ifdef USE_INSTANCING
float ph = instanceMatrix[3].x * 1.7 + instanceMatrix[3].y * 2.3;
#else
float ph = 0.0;
#endif
transformed.y += sin(papelTime * 3.1 + ph) * 0.13 * hang + sin(papelTime * 7.3 + ph * 1.9) * 0.03 * hang;`)
    }
    mat.customProgramCacheKey = () => 'soma-city-papel'
    const mesh = new THREE.InstancedMesh(g, mat, mats.length)
    mats.forEach((mm, i) => { mesh.setMatrixAt(i, mm); mesh.setColorAt(i, cols[i]) })
    mesh.computeBoundingSphere()
    mesh.frustumCulled = true
    mesh.name = 'papel picado'
    this.group.add(mesh)
  }

  /**
   * Chinatown's lanterns over Grant Ave (city.lanterns, the papel picado's strings): red paper lanterns
   * a metre and a half apart on each sagging string, gold caps and tassel, swaying a little; lit from
   * inside at night. One instanced mesh for all of them.
   */
  private lanterns(strings: number[][], lampLit: LampLit) {
    const step = 1.5, sag = 0.6
    const mats: THREE.Matrix4[] = []
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1)
    for (const [x1, y1, z1, x2, y2, z2] of strings) {
      const L = Math.hypot(x2 - x1, y2 - y1)
      const n = Math.max(2, Math.floor(L / step))
      q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.atan2(y2 - y1, x2 - x1))
      for (let i = 1; i < n; i++) {
        const t = i / n
        pos.set(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, z1 + (z2 - z1) * t - sag * 4 * t * (1 - t))
        m.compose(pos, q, one)
        mats.push(m.clone())
      }
    }
    if (!mats.length) return
    // A lantern hangs from the string: a fat red barrel (a lathe), gold caps top and bottom, a tassel.
    const prof: THREE.Vector2[] = []
    for (let k = 0; k <= 8; k++) { const a = (k / 8) * Math.PI; prof.push(new THREE.Vector2(0.06 + 0.2 * Math.sin(a), -0.08 - 0.42 * (k / 8))) }
    const body = new THREE.LatheGeometry(prof, 10)
    body.rotateX(Math.PI / 2)
    const capTop = new THREE.CylinderGeometry(0.08, 0.08, 0.06, 8); capTop.rotateX(Math.PI / 2); capTop.translate(0, 0, -0.07)
    const capBot = new THREE.CylinderGeometry(0.08, 0.08, 0.05, 8); capBot.rotateX(Math.PI / 2); capBot.translate(0, 0, -0.52)
    const tassel = new THREE.CylinderGeometry(0.015, 0.03, 0.22, 5); tassel.rotateX(Math.PI / 2); tassel.translate(0, 0, -0.66)
    const red = lampLit(new THREE.MeshStandardMaterial({ color: 0xc8261e, roughness: 0.75, emissive: 0xff5a2a, emissiveIntensity: 0, side: THREE.DoubleSide }), 'soma-city-lantern')
    const gold = lampLit(new THREE.MeshStandardMaterial({ color: 0xd9a531, roughness: 0.45, metalness: 0.5 }), 'soma-city-lantern-gold')
    this.glowMats.push({ m: red, day: 0, night: 0.9 })
    const time = this.lanternTime
    for (const mat of [red, gold]) {
      const prev = mat.onBeforeCompile
      mat.onBeforeCompile = (sh, r) => {
        prev.call(mat, sh, r)
        sh.uniforms.lanternTime = time
        sh.vertexShader = sh.vertexShader
          .replace('#include <common>', '#include <common>\nuniform float lanternTime;')
          .replace('#include <begin_vertex>', `#include <begin_vertex>
// A slow sway across the string, the lower the more; each lantern its own phase.
#ifdef USE_INSTANCING
float ph = instanceMatrix[3].x * 1.3 + instanceMatrix[3].y * 0.7;
#else
float ph = 0.0;
#endif
transformed.y += sin(lanternTime * 1.4 + ph) * 0.06 * clamp(-position.z / 0.6, 0.0, 1.0);`)
      }
      const key = mat === red ? 'soma-city-lantern' : 'soma-city-lantern-gold'
      mat.customProgramCacheKey = () => key
    }
    for (const [g, mat, name] of [[body, red, 'lanterns'], [capTop, gold, 'lantern caps'], [capBot, gold, 'lantern caps'], [tassel, red, 'lantern tassels']] as [THREE.BufferGeometry, THREE.Material, string][]) {
      const mesh = new THREE.InstancedMesh(g, mat, mats.length)
      mats.forEach((mm, i) => mesh.setMatrixAt(i, mm))
      mesh.computeBoundingSphere()
      mesh.name = name
      this.group.add(mesh)
    }
  }

  /**
   * The boards over the interiors' doors (city.shopsigns, city/interiors.py): the shop's name in the
   * UI face, cream on a dark board with a thin gold rule, lit from behind at night. Both faces read
   * left to right.
   */
  private async shopSigns(signs: ShopSign[], lampLit: LampLit) {
    try { await document.fonts.load('600 64px Inter') } catch { /* system fallback */ }
    for (const sg of signs) {
      const px = 128, cw = Math.max(256, Math.round((sg.width / sg.height) * px)), c = document.createElement('canvas')
      c.width = cw; c.height = px
      const x = c.getContext('2d')!
      x.fillStyle = '#1d2420'; x.fillRect(0, 0, cw, px)
      x.strokeStyle = '#c9a24a'; x.lineWidth = 6; x.strokeRect(8, 8, cw - 16, px - 16)
      x.fillStyle = '#f3ead2'; x.textAlign = 'center'; x.textBaseline = 'middle'
      let size = 72
      do { x.font = `600 ${size}px Inter, Helvetica, Arial, sans-serif`; size -= 4 } while (x.measureText(sg.text.toUpperCase()).width > cw - 48 && size > 20)
      x.fillText(sg.text.toUpperCase(), cw / 2, px / 2 + 4)
      const tex = new THREE.CanvasTexture(c)
      tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8
      const m = lampLit(new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.05, roughness: 0.6, side: THREE.FrontSide }), 'soma-city-shopsign')
      this.glowMats.push({ m, day: 0.05, night: 0.9 })
      const h = (sg.heading * Math.PI) / 180, n = new THREE.Vector3(Math.sin(h), Math.cos(h), 0), t = new THREE.Vector3(-n.y, n.x, 0)   // t x up = n: a proper rotation, the text left to right
      for (const face of [1, -1]) {   // the front, and the back (seen from inside the room, read the right way round too)
        const g = new THREE.PlaneGeometry(sg.width, sg.height)
        const mesh = new THREE.Mesh(g, m)
        const basis = new THREE.Matrix4().makeBasis(t.clone().multiplyScalar(face), new THREE.Vector3(0, 0, 1), n.clone().multiplyScalar(face))
        mesh.quaternion.setFromRotationMatrix(basis)
        mesh.position.set(sg.x, sg.y, sg.z).addScaledVector(n, face * 0.04)
        mesh.name = 'shop sign'
        this.group.add(mesh)
      }
    }
  }

  private flag(f: FlagData, lampLit: LampLit) {
    const H = f.height
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.2, H, 12), lampLit(new THREE.MeshStandardMaterial({ color: 0xd8d8d4, roughness: 0.35, metalness: 0.6 }), 'soma-city-flagpole'))
    pole.rotation.x = Math.PI / 2
    pole.position.set(f.x, f.y, f.z + H / 2)
    pole.castShadow = true
    this.group.add(pole)
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 8), pole.material)
    ball.position.set(f.x, f.y, f.z + H + 0.2)
    this.group.add(ball)
    // 30 by 20 ft, the six-stripe rainbow, flying east with the sea breeze.
    const L = 9.1, W = 6.1
    const g = new THREE.PlaneGeometry(L, W, 28, 10)
    g.translate(L / 2 + 0.15, 0, 0)
    g.rotateX(Math.PI / 2)
    const c = document.createElement('canvas'); c.width = 4; c.height = 6
    const x = c.getContext('2d')!
    ;['#e40303', '#ff8c00', '#ffed00', '#008026', '#004dff', '#750787'].forEach((h, i) => { x.fillStyle = h; x.fillRect(0, i, 4, 1) })
    const tex = new THREE.CanvasTexture(c)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.LinearFilter; tex.generateMipmaps = false
    const m = lampLit(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8, side: THREE.DoubleSide, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0 }), 'soma-city-flag')
    this.glowMats.push({ m, day: 0, night: 0.25 })
    const time = this.flagTime
    const prev = m.onBeforeCompile
    m.onBeforeCompile = (sh, r) => {
      prev.call(m, sh, r)
      sh.uniforms.flagTime = time
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float flagTime;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
// Waves run out from the pole and grow toward the fly end; the cloth sags a little.
float fx = max(position.x, 0.0) / 9.25;
float wave = sin(position.x * 0.9 - flagTime * 5.2) * 0.45 + sin(position.x * 1.7 + position.z * 0.8 - flagTime * 7.9) * 0.18;
transformed.y += wave * fx;
transformed.z -= fx * fx * 0.35;`)
        .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
float fxn = max(position.x, 0.0) / 9.25;
float dw = cos(position.x * 0.9 - flagTime * 5.2) * 0.45 * 0.9 + cos(position.x * 1.7 + position.z * 0.8 - flagTime * 7.9) * 0.18 * 1.7;
objectNormal = normalize(vec3(-dw * fxn, 1.0, 0.0));`)
    }
    m.customProgramCacheKey = () => 'soma-city-flag'
    const mesh = new THREE.Mesh(g, m)
    mesh.position.set(f.x, f.y, f.z + H - 0.4 - W / 2)
    mesh.castShadow = true
    mesh.frustumCulled = false
    this.group.add(mesh)
  }
}

/** The blade: map (cream face, red letters, bulb border) and its emissive (letters and bulbs only). */
function bladeCanvas(height: number): [THREE.CanvasTexture, THREE.CanvasTexture] {
  const W = 192, H = Math.round(W * height / 2.7)
  const draw = (night: boolean) => {
    const c = document.createElement('canvas'); c.width = W; c.height = H
    const g = c.getContext('2d')!
    g.fillStyle = night ? '#000' : '#efe3c4'; g.fillRect(0, 0, W, H)
    if (!night) { g.fillStyle = '#8c1d1d'; g.fillRect(0, 0, W, 10); g.fillRect(0, H - 10, W, 10); g.fillRect(0, 0, 10, H); g.fillRect(W - 10, 0, 10, H) }
    // Bulbs round the edge.
    g.fillStyle = night ? '#ffd27a' : '#fff4d0'
    for (let y = 22; y < H - 16; y += 26) { for (const x of [20, W - 20]) { g.beginPath(); g.arc(x, y, 5, 0, Math.PI * 2); g.fill() } }
    const letters = 'CASTRO'
    const cell = (H - 60) / letters.length
    g.font = `500 ${Math.round(Math.min(cell * 0.86, W * 0.95))}px Inter, Helvetica, Arial, sans-serif`
    g.textAlign = 'center'; g.textBaseline = 'middle'
    for (let i = 0; i < letters.length; i++) {
      const y = 30 + cell * (i + 0.5)
      if (!night) { g.lineWidth = 8; g.strokeStyle = '#3a0a0a'; g.strokeText(letters[i], W / 2, y) }
      g.fillStyle = night ? '#ff3b2e' : '#d42a24'
      g.fillText(letters[i], W / 2, y)
    }
    const t = new THREE.CanvasTexture(c)
    t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8
    return t
  }
  return [draw(false), draw(true)]
}

/** A readerboard: black changeable letters on a lit white board, a red band with CASTRO on top. */
function marqueeCanvas(lines: string[], W: number, H: number): [THREE.CanvasTexture, THREE.CanvasTexture] {
  const band = Math.round(H * 0.24)
  const draw = (night: boolean) => {
    const c = document.createElement('canvas'); c.width = W; c.height = H
    const g = c.getContext('2d')!
    g.fillStyle = night ? '#000' : '#7a1717'; g.fillRect(0, 0, W, H)
    g.fillStyle = night ? '#d9d2bd' : '#f6f1e2'; g.fillRect(8, band + 6, W - 16, H - band - 14)   // the board glows at night
    g.textAlign = 'center'; g.textBaseline = 'middle'
    g.fillStyle = night ? '#ffcf5a' : '#ffd88a'
    g.font = `500 ${Math.round(band * 0.8)}px Inter, Helvetica, Arial, sans-serif`
    g.fillText('CASTRO', W / 2, band / 2 + 3)
    const rows = Math.max(1, lines.length)
    const rh = (H - band - 20) / rows
    for (let i = 0; i < rows; i++) {
      let size = Math.round(rh * 0.78)
      g.font = `500 ${size}px Inter, Helvetica, Arial, sans-serif`
      while (size > 10 && g.measureText(lines[i]).width > W - 40) { size -= 2; g.font = `500 ${size}px Inter, Helvetica, Arial, sans-serif` }
      g.fillStyle = night ? '#000' : '#141414'
      g.fillText(lines[i], W / 2, band + 10 + rh * (i + 0.5))
    }
    const t = new THREE.CanvasTexture(c)
    t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8
    return t
  }
  return [draw(false), draw(true)]
}

/** The marquee's soffit: rows of bulbs. */
function bulbCanvas(): [THREE.CanvasTexture, THREE.CanvasTexture] {
  const draw = (night: boolean) => {
    const c = document.createElement('canvas'); c.width = 512; c.height = 128
    const g = c.getContext('2d')!
    g.fillStyle = night ? '#000' : '#4a1212'; g.fillRect(0, 0, 512, 128)
    g.fillStyle = night ? '#ffe2a0' : '#f3e6c0'
    for (let y = 16; y < 128; y += 24) for (let x = 12; x < 512; x += 24) { g.beginPath(); g.arc(x, y, 5, 0, Math.PI * 2); g.fill() }
    const t = new THREE.CanvasTexture(c)
    t.colorSpace = THREE.SRGBColorSpace
    return t
  }
  return [draw(false), draw(true)]
}
