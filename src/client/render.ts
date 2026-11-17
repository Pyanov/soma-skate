import * as THREE from 'three'
import { freeGeometryAfterUpload, release, uploadPending } from './memory.ts'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { classifySource, raycast, Surface, type Park } from '../sim/park/park.ts'
import type { ParkSource } from '../sim/park/source.ts'
import type { GameData, Physics } from '../sim/data.ts'
import type { Thing } from '../sim/thing.ts'
import type { CamPose } from './camera.ts'
import type { SkaterView } from './skater/view.ts'
import type { Look } from '../data/schema.ts'
import { applyMaterials, InkPass, makeClouds, makeSky, paintFor, toonGradient, toonify, toonMaterial } from './look.ts'
import { lampUniforms, lensFit, parkMaterial, readableUniforms, RealPass, retuneParkMaterial, sharpenPaint, type Paint, type RealAssets } from './real.ts'
import { isCity, type CityView } from './city.ts'
import { NightSky } from './nightsky.ts'
import { DaySky } from './daysky.ts'

// Renderer: draws sim state, never changes it. Three styles: real (the park painted with
// the photos, sky light, sun, PBR, ambient occlusion; src/client/real.ts), cute (painted
// park, toon light, ink outlines, sky) and grey (flat colours per surface class with edge
// lines, for judging shape); all tuned in data/look.json. The skater and board are a
// SkaterView (src/client/skater/), posed from sim state.

export type Style = 'real' | 'cute' | 'grey'
/** A part of the canvas in CSS px, from its bottom left (WebGL's viewport): one player's view in split screen. */
export type ViewRect = { x: number; y: number; w: number; h: number }
/** A phone: a coarse pointer on a screen under 600 px across. */
export const isPhone = () => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 600
/** A quality preset (data/settings.json presets): what the renderer draws and how sharply. */
export type QualityPreset = { aoScale?: number; pixelRatio: number; phonePixelRatio?: number; scale: [number, number]; ao: boolean; msaa: number; shadowMap: number; shadowReach: number; cityShadows: boolean; drawDistance: number; npcDistance: number; npcDetail: number; birds: number; paintFull?: boolean; sealions?: number; carDetail?: number; vignettes?: number; castSimple?: number }
type Wx = { fogNear: number; fogFar: number; fog: THREE.Color; sunI: number; sun: THREE.Color; from: THREE.Vector3; env: number; exposure: number; bgFog: number; night: number; hfog: number; bloom: number
  skyZ: THREE.Color; skyH: THREE.Color; skyGlow: THREE.Color; glow: number; clouds: number }
/** The picture settings (data/settings.json video: lens, picture): the filmer's fisheye and the PS2 picture. */
export type Picture = { lens: boolean; ps2: boolean }
const TONE = { neutral: THREE.NeutralToneMapping, aces: THREE.ACESFilmicToneMapping, agx: THREE.AgXToneMapping } as const
export const STYLES: Style[] = ['real', 'cute', 'grey']
const GREY = { background: 0xcfd7dd, hemiSky: 0xe8eef3, hemiGround: 0x8a8278, hemi: 1.1, sun: 0xffffff, sunI: 1.6 }

THREE.Object3D.DEFAULT_UP.set(0, 0, 1)

export const LAYERS = ['park', 'context', 'skater', 'hud', 'rails', 'debug', 'shadows', 'pins'] as const
export type Layer = (typeof LAYERS)[number]

const COLORS: Record<number, number> = {
  [Surface.none]: 0x8c9096,
  [Surface.flat]: 0xc4c1ba,
  [Surface.bank]: 0xa9bccd,
  [Surface.steep]: 0x9fb0c4,
  [Surface.vert]: 0xcfa9a2,
  [Surface.stair]: 0xd2c79f,
  [Surface.wall]: 0x9a9894,
  [Surface.rail]: 0x4f6f96,
}

/**
 * EdgesGeometry also draws triangulation seams (unwelded or T-junction edges inside a
 * flat face). Drop a segment when the surface just either side of it is the same
 * height and orientation; keep real edges (drops, creases, vertical edges).
 */
function dropSeams(g: THREE.BufferGeometry, park: Park): THREE.BufferGeometry {
  const a = g.getAttribute('position')
  const keep: number[] = []
  const down = { x: 0, y: 0, z: -1 }
  for (let i = 0; i < a.count; i += 2) {
    const x0 = a.getX(i), y0 = a.getY(i), z0 = a.getZ(i), x1 = a.getX(i + 1), y1 = a.getY(i + 1), z1 = a.getZ(i + 1)
    const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0
    const hl = Math.hypot(dx, dy)
    let seam = false
    if (hl > 1e-6 && Math.abs(dz) < hl) {
      const px = -dy / hl, py = dx / hl, mx = (x0 + x1) / 2, my = (y0 + y1) / 2, mz = (z0 + z1) / 2
      const side = (s: number) => raycast(park, { x: mx + px * 0.03 * s, y: my + py * 0.03 * s, z: mz + 0.06 }, down, 0.2)
      const l = side(1), r = side(-1)
      seam = !!l && !!r && Math.abs(l.point.z - r.point.z) < 0.01 && Math.abs(l.point.z - mz) < 0.02 &&
        l.normal.x * r.normal.x + l.normal.y * r.normal.y + l.normal.z * r.normal.z > 0.996
    }
    if (!seam) keep.push(x0, y0, z0, x1, y1, z1)
  }
  const out = new THREE.BufferGeometry()
  out.setAttribute('position', new THREE.Float32BufferAttribute(keep, 3))
  return out
}

/** The contact shadow's patch: a unit square, an elliptic soft dark falloff (placed and scaled per frame: placeContact). */
function makeContactShadow(): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    uniforms: { k: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform float k; varying vec2 vUv;
      void main() { vec2 d = (vUv - 0.5) * 2.0; float r = dot(d, d); float a = (1.0 - smoothstep(0.0, 1.0, r)) * (0.55 + 0.45 * (1.0 - smoothstep(0.0, 0.3, r))); gl_FragColor = vec4(0.0, 0.0, 0.0, a * k * 0.62); }`,
    transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  })
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat)
  m.matrixAutoUpdate = false
  m.frustumCulled = false
  m.renderOrder = 2
  m.name = 'contact-shadow'
  return m
}

export class Renderer {
  readonly renderer: THREE.WebGLRenderer
  readonly scene = new THREE.Scene()
  readonly camera: THREE.PerspectiveCamera
  private layers: Record<Exclude<Layer, 'hud'>, THREE.Object3D[]> = { park: [], context: [], skater: [], rails: [], debug: [], shadows: [], pins: [] }
  private visible: Record<Layer, boolean> = { park: true, context: true, skater: true, hud: true, rails: false, debug: false, shadows: true, pins: false }
  readonly skater: SkaterView
  private sun: THREE.DirectionalLight
  private hemi: THREE.HemisphereLight
  private look: Look
  style: Style
  /** The style data/look.json asks for (G cycles away from it in play); real needs the baked photo paint. */
  get defaultStyle(): Style { return this.look.style === 'real' && !this.realMat ? 'cute' : this.look.style }
  /** Styles this park can draw (real only when the photo paint is baked). */
  get styles(): Style[] { return STYLES.filter((s) => s !== 'real' || this.realMat) }
  private realMat: THREE.MeshStandardMaterial | null = null
  private realPass: RealPass | null = null
  private nightSky: NightSky | null = null
  private daySky: DaySky | null = null
  /** A soft dark patch on the ground under the board (all looks but grey): grounds the skater where the sun's shadow is faint. */
  private contact!: THREE.Mesh
  /** The sim's park for the contact shadow's ground ray (attachPark). */
  private groundPark: Park | null = null
  private picture: Picture = { lens: true, ps2: false }
  private lastRender = 0
  private envMap: THREE.Texture | null = null
  private paintData: Paint | null
  private realAssets: RealAssets | null
  private parkBox = new THREE.Box3()
  private gradient: THREE.DataTexture
  private ink: InkPass
  private sky: THREE.Mesh
  private clouds: THREE.Group
  private edges!: THREE.LineSegments
  private greyMats!: { solid: THREE.Material; ctx: THREE.Material }
  private cuteMats!: { solid: THREE.MeshToonMaterial; ctx: THREE.MeshToonMaterial }
  private colors!: { solidGrey: Float32Array; solidCute: Float32Array; ctxGrey: Float32Array; ctxCute: Float32Array }
  private velArrow: THREE.ArrowHelper
  private upArrow: THREE.ArrowHelper
  private sphere: THREE.Mesh
  private solidMesh!: THREE.Mesh
  private ctxMesh!: THREE.Mesh
  private solidElem: number[] = []     // element index per rendered triangle
  private ctxElem: number[] = []
  private src: ParkSource
  private pinGroup = new THREE.Group()
  private letterGroup = new THREE.Group()
  private letterSprites = new Map<string, THREE.Sprite>()
  onLayerChange: (layer: Layer, on: boolean) => void = () => {}

  /** The city around the park (world sf), drawn by src/client/city.ts. */
  private city: CityView | null
  constructor(canvas: HTMLCanvasElement, src: ParkSource, park: Park | null, physics: Physics, skater: SkaterView, look: Look, paint: Paint | null = null, real: RealAssets | null = null, city: CityView | null = null) {
    this.city = city
    this.paintData = paint
    this.realAssets = real
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.prCap))
    this.renderer.shadowMap.enabled = true
    this.renderer.info.autoReset = false   // counted per frame across the post passes (reset in renderView)
    this.renderer.shadowMap.type = THREE.PCFShadowMap   // three r18x removed PCFSoft (it fell back to PCF with a warning)
    this.scene.background = new THREE.Color(GREY.background)
    this.scene.fog = new THREE.Fog(GREY.background, 70, 260)
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.05, 600)
    this.look = look
    this.style = look.style
    this.gradient = toonGradient(look.toon.bands)
    this.ink = new InkPass(look)
    this.sky = makeSky(look)
    this.clouds = makeClouds(this.gradient)
    this.scene.add(this.sky, this.clouds)

    this.hemi = new THREE.HemisphereLight(GREY.hemiSky, GREY.hemiGround, GREY.hemi)
    this.scene.add(this.hemi)
    this.sun = new THREE.DirectionalLight(GREY.sun, GREY.sunI)
    this.sun.position.set(-30, -40, 60)
    this.sun.castShadow = true
    this.sun.shadow.mapSize.set(2048, 2048)
    const sc = this.sun.shadow.camera
    sc.left = -14; sc.right = 14; sc.top = 14; sc.bottom = -14; sc.near = 1; sc.far = 200
    this.sun.shadow.bias = -0.0005
    this.scene.add(this.sun, this.sun.target)

    this.src = src
    this.buildPark(src, physics)
    if (city) { this.scene.add(city.park, city.context); this.layers.park.push(city.park); this.layers.context.push(city.context) }
    this.scene.add(this.pinGroup); this.layers.pins.push(this.pinGroup)
    this.scene.add(this.letterGroup)
    if (park) this.attachPark(park)
    this.skater = skater
    this.buildSkater()
    toonify(skater.root, this.gradient)
    if (paint && real) {
      this.realMat = parkMaterial(paint, real, look.real)
      for (const t of paint.pages) t.anisotropy = this.renderer.capabilities.getMaxAnisotropy()
      const pmrem = new THREE.PMREMGenerator(this.renderer)
      this.envMap = pmrem.fromEquirectangular(real.sky).texture
      pmrem.dispose()
      this.realPass = new RealPass(this.renderer, this.scene, this.camera, look.real)
      if (look.real.nightSky) { this.nightSky = new NightSky(look.real.nightSky); this.scene.add(this.nightSky.group) }
      if (look.real.daySky) { this.daySky = new DaySky(look.real.daySky); this.scene.add(this.daySky.mesh) }
    }
    this.contact = makeContactShadow()
    this.scene.add(this.contact); this.layers.skater.push(this.contact)
    this.velArrow = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(), 1, 0xff3b30)
    this.upArrow = new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), new THREE.Vector3(), 0.8, 0x34c759)
    this.sphere = new THREE.Mesh(new THREE.SphereGeometry(physics.skater.radius, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffcc00, wireframe: true }))
    for (const o of [this.velArrow, this.upArrow, this.sphere]) { this.scene.add(o); this.layers.debug.push(o) }
    this.setStyle(this.defaultStyle)
  }

  /** real, cute or grey: materials, colours, lights, sky, shadows and post. */
  setStyle(style: Style) {
    if (style === 'real' && !this.realMat) style = 'cute'
    this.style = style
    const cute = style === 'cute', real = style === 'real'
    const L = this.look, R = L.real
    const sg = this.solidMesh.geometry, cg = this.ctxMesh.geometry
    sg.setAttribute('color', new THREE.BufferAttribute(cute ? this.colors.solidCute : this.colors.solidGrey, 3))
    cg.setAttribute('color', new THREE.BufferAttribute(cute ? this.colors.ctxCute : this.colors.ctxGrey, 3))
    this.solidMesh.material = real ? this.realMat! : cute ? this.cuteMats.solid : this.greyMats.solid
    this.ctxMesh.material = real ? this.realMat! : cute ? this.cuteMats.ctx : this.greyMats.ctx
    applyMaterials(this.skater.root, style)
    for (const v of this.others) applyMaterials(v.root, style)
    this.hemi.color.set(cute ? L.hemi.sky : GREY.hemiSky)
    this.hemi.groundColor.set(cute ? L.hemi.ground : GREY.hemiGround)
    this.hemi.intensity = real ? 0 : cute ? L.hemi.intensity : GREY.hemi
    this.sun.color.set(real ? R.sun.color : cute ? L.sun.color : GREY.sun)
    this.sun.intensity = real ? R.sun.intensity : cute ? L.sun.intensity : GREY.sunI
    const fog = this.scene.fog as THREE.Fog
    fog.color.set(real ? R.fog.color : cute ? L.sky.horizon : GREY.background)
    const dk = this.q?.drawDistance ?? 1   // the preset's draw distance: the fog (and so the city's culling) comes closer
    fog.near = (real ? R.fog.near : cute ? L.fog.near : 70) * dk; fog.far = (real ? R.fog.far : cute ? L.fog.far : 260) * dk
    // Real: the sky lights the park and shows behind it; equirect skies are y-up, the site is z-up.
    const turn = THREE.MathUtils.degToRad(R.sky.turn)
    this.scene.environment = real ? this.envMap : null
    this.scene.environmentIntensity = R.sky.environment
    this.scene.environmentRotation.set(Math.PI / 2, 0, turn, 'ZYX')
    this.scene.background = real && this.realAssets ? this.realAssets.sky : new THREE.Color(cute ? L.sky.horizon : GREY.background)
    this.scene.backgroundIntensity = real ? R.sky.background : 1
    this.scene.backgroundRotation.set(Math.PI / 2, 0, turn, 'ZYX')
    this.renderer.toneMapping = real ? TONE[R.toneMapping ?? 'neutral'] : THREE.NoToneMapping
    this.renderer.toneMappingExposure = real ? R.exposure : 1
    // Real: the sun stands still over the park and the whole park casts and catches
    // shadows (one big map); otherwise a small map follows the skater.
    this.solidMesh.castShadow = real
    const sc = this.sun.shadow.camera
    const size = real ? Math.min(this.city && L.city ? L.city.shadowMap : R.sun.shadowMap, this.q?.shadowMap ?? Infinity, this.renderer.capabilities.maxTextureSize) : Math.min(2048, this.q?.shadowMap ?? 2048)
    if (this.sun.shadow.mapSize.x !== size) { this.sun.shadow.mapSize.set(size, size); this.sun.shadow.map?.dispose(); this.sun.shadow.map = null }
    this.city?.setStyle(style)
    if (real) {
      // In the city the shadowed square follows the skater (setSkater); over the park alone it covers the park.
      const c = this.city ? this.sunAt.clone() : this.parkBox.getCenter(new THREE.Vector3()), f = R.sun.from
      const reach = this.city ? this.cityShadowReach : this.parkBox.getSize(new THREE.Vector3()).length() / 2
      this.sun.target.position.copy(c)
      this.sun.position.set(c.x + f[0], c.y + f[1], c.z + f[2])
      sc.left = -reach; sc.right = reach; sc.top = reach; sc.bottom = -reach
      sc.near = 1; sc.far = Math.max(new THREE.Vector3(...f).length(), 120) + reach * 2
      this.sun.shadow.bias = -0.0002; this.sun.shadow.normalBias = 0.02
      // Soft edges (the filter's reach in texels, kept about the same in metres whatever the map's size) and not quite black.
      this.sun.shadow.radius = (R.sun.shadowRadius ?? 1) * Math.max(1, Math.sqrt(size / 4096))
      this.sun.shadow.intensity = R.sun.shadowIntensity ?? 1
      this.wxFrom = this.wxTo = this.preset(this.wxName); this.wxT = 1
    } else {
      sc.left = -14; sc.right = 14; sc.top = 14; sc.bottom = -14; sc.near = 1; sc.far = 200
      this.sun.shadow.bias = -0.0005; this.sun.shadow.normalBias = 0
      this.sun.shadow.radius = 1; this.sun.shadow.intensity = 1
    }
    sc.updateProjectionMatrix()
    this.applyLayers()
    if (real) this.applyWeather()
    else this.nightLight.intensity = 0   // night lights the real look only (G at night used to keep it on)
  }

  // ---- weather (real look): presets in data/look.json real.weather, blended over a few seconds ----
  private wxName = 'clear'
  private wxFrom: Wx | null = null
  private wxTo: Wx | null = null
  private wxT = 1
  get weather() { return this.wxName }
  get weathers(): { id: string; label: string }[] { return [{ id: 'clear', label: 'Clear' }, ...Object.entries(this.look.real.weather ?? {}).map(([id, w]) => ({ id, label: w.label }))] }
  private preset(name: string): Wx {
    const R = this.look.real, w: Partial<NonNullable<Look['real']['weather']>[string]> = R.weather?.[name] ?? {}
    const D = R.daySky, S = w.daySky ?? {}, sky = !!D && w.sky !== 'fog'
    const skyH = new THREE.Color(S.horizon ?? D?.horizon ?? R.fog.color)
    return {
      // Under the day sky the haze is the sky's own horizon colour, so the far city fades into the sky.
      fogNear: w.fog?.near ?? R.fog.near, fogFar: w.fog?.far ?? R.fog.far, fog: sky ? skyH.clone() : new THREE.Color(w.fog?.color ?? R.fog.color),
      sunI: w.sun?.intensity ?? R.sun.intensity, sun: new THREE.Color(w.sun?.color ?? R.sun.color), from: new THREE.Vector3(...(w.sun?.from ?? R.sun.from)),
      env: w.environment ?? R.sky.environment, exposure: w.exposure ?? R.exposure, bgFog: w.sky === 'fog' ? 1 : 0, night: w.night ? 1 : 0, hfog: w.heightFog ?? 0, bloom: w.bloom ?? 0,
      skyZ: new THREE.Color(S.zenith ?? D?.zenith ?? R.fog.color), skyH, skyGlow: new THREE.Color(S.sunGlow ?? D?.sunGlow ?? '#000000'), glow: S.glow ?? D?.glow ?? 0, clouds: S.clouds ?? D?.clouds ?? 0,
    }
  }
  private wxNow(): Wx {
    const a = this.wxFrom ?? this.preset(this.wxName), b = this.wxTo ?? a, k = this.wxT * this.wxT * (3 - 2 * this.wxT)
    const l = (x: number, y: number) => x + (y - x) * k
    return { fogNear: l(a.fogNear, b.fogNear), fogFar: l(a.fogFar, b.fogFar), fog: a.fog.clone().lerp(b.fog, k), sunI: l(a.sunI, b.sunI), sun: a.sun.clone().lerp(b.sun, k),
      from: a.from.clone().lerp(b.from, k), env: l(a.env, b.env), exposure: l(a.exposure, b.exposure), bgFog: l(a.bgFog, b.bgFog), night: l(a.night, b.night), hfog: l(a.hfog, b.hfog), bloom: l(a.bloom, b.bloom),
      skyZ: a.skyZ.clone().lerp(b.skyZ, k), skyH: a.skyH.clone().lerp(b.skyH, k), skyGlow: a.skyGlow.clone().lerp(b.skyGlow, k), glow: l(a.glow, b.glow), clouds: l(a.clouds, b.clouds) }
  }
  setWeather(name: string, instant = false) {
    this.wxFrom = this.wxNow(); this.wxTo = this.preset(name); this.wxT = 0; this.wxName = name
    if (this.style !== 'real' || instant) { this.wxFrom = this.wxTo; this.wxT = 1; if (this.style === 'real') this.applyWeather() }
  }
  /** Every frame: blend toward the chosen weather. */
  tickWeather(dt: number) {
    if (this.wxT >= 1 || this.style !== 'real') return
    this.wxT = Math.min(1, this.wxT + dt / 3.5)
    this.applyWeather()
  }
  private applyWeather() {
    const w = this.wxNow(), fog = this.scene.fog as THREE.Fog
    const dk = this.q?.drawDistance ?? 1
    fog.color.copy(w.fog); fog.near = w.fogNear * dk; fog.far = w.fogFar * dk
    this.sun.color.copy(w.sun); this.sun.intensity = w.sunI
    this.scene.environmentIntensity = w.env
    this.renderer.toneMappingExposure = w.exposure
    if (this.visible.context && this.realAssets) this.scene.background = w.bgFog > 0.5 ? w.fog.clone() : this.realAssets.sky
    // Night: lamp lenses glow, light pools under the lamps, bloom halos.
    lampUniforms.glow.value = w.night
    this.dayBloom = w.bloom
    if (this.realPass) { this.applyBloom(w.night); this.realPass.setNight(w.night); this.realPass.setHeightFog(w.hfog, w.fog, this.look.real) }
    this.nightK = w.night
    this.hfogK = w.hfog
    // Night: a cool moonlit ambient from above (the hemisphere light, otherwise off in the real look) and the lamps' pools a
    // little stronger, so the ground and the obstacles read by sight while it still reads as night (real.moonlight).
    const M = this.look.real.moonlight
    if (M) { this.hemi.color.set(M.sky); this.hemi.groundColor.set(M.ground); this.hemi.intensity = M.intensity * w.night * (1 - 0.5 * w.hfog) }
    lampUniforms.lampPool.value = 2.2 + ((M?.lamps ?? 2.2) - 2.2) * w.night
    this.skyK = (1 - w.night) * (1 - w.bgFog)
    this.hazeFog.copy(w.fog); this.hazeSun.copy(w.skyGlow).multiplyScalar(w.glow); this.hazeFrom.copy(w.from)
    this.daySky?.set(w.skyZ, w.skyH, w.skyGlow, w.glow, w.clouds, w.from, this.look.real.sky.turn)
    if (this.city) { this.sunAt.set(1e9, 0, 0); this.followSun(this.lastSkater) }
    else { const c = this.parkBox.getCenter(new THREE.Vector3()); this.sun.target.position.copy(c); this.sun.position.copy(c).add(w.from) }
  }
  private lastSkater = { x: 0, y: 0, z: 0 }

  /** Clips: weather that moves (Karl's fog banks) follows the clip's clock (seconds), not the wall. */
  setClock(t: number | null) { this.realPass?.setFogClock(t) }
  /** Ambient occlusion allowed (split screen may turn it off; data/split.json). */
  setAo(on: boolean) { this.realPass?.allowAo(on) }

  /** Lamps (head position and reach); at night the nearest 32 to the camera light the park shader. */
  private lampList: { x: number; y: number; z: number; r: number }[] = []
  private nightK = 0
  /** How night it is now (0 day .. 1 night): the weather's (the interiors' light pools brighten with it). */
  get night(): number { return this.nightK }
  /** The night bloom's share while the camera is inside a city room (interiors.ts: 1 outdoors); a room's lamps would haze it. */
  setBloomShare(k: number) {
    if (Math.abs(k - this.bloomShare) < 0.005) return
    this.bloomShare = k
    this.applyBloom(this.nightK)
  }
  private bloomShare = 1
  /** The weather's bloom by day (golden hour's low sun on glass and paint), 0..1 of the night's. */
  private dayBloom = 0
  /** Bloom: full at night, the weather's share by day; times the share indoors (setBloomShare). */
  private applyBloom(night: number) {
    const b = this.look.real.bloom
    if (!this.realPass) return
    const k = night > 0.05 ? 1 : this.dayBloom
    this.realPass.bloom.enabled = k > 0.01
    if (b) this.realPass.bloom.strength = b.strength * k * this.bloomShare
  }
  private hfogK = 0
  private skyK = 1
  /** The haze's colour from the weather, the sun's glow and where the sun is: renderView leans the fog toward the glow when looking sunward. */
  private hazeFog = new THREE.Color()
  private hazeSun = new THREE.Color()
  private hazeFrom = new THREE.Vector3(0, -1, 1)
  setLamps(lamps: { x: number; y: number; z: number; r: number }[]) { this.lampList = lamps }
  /** The lamp nearest the skater also lights the skater, cars and pigeons (one real point light). */
  private nightLight = new THREE.PointLight(0xffb878, 0, 22, 1.4)
  private updateLamps() {
    const u = lampUniforms
    if (!this.nightLight.parent) this.scene.add(this.nightLight)
    this.nightLight.intensity = 0
    if (this.nightK <= 0 || !this.lampList.length) { u.lampCount.value = 0; return }
    const s = this.lastSkater
    let best = this.lampList[0], bd = Infinity
    for (const l of this.lampList) { const d = (l.x - s.x) ** 2 + (l.y - s.y) ** 2; if (d < bd) { bd = d; best = l } }
    // A lamp that reaches less (a room's own ceiling lamp: interiors.ts indoorLamps) lights the skater less and nearer,
    // or one at the ceiling of a small room blows its walls and the bloom out.
    const k = Math.min(1, best.r / 13)
    this.nightLight.position.set(best.x, best.y, best.z)
    this.nightLight.distance = 22 * k
    this.nightLight.intensity = this.nightK * 60 * k * k
    const c = this.camera.position
    const near = this.lampList.map((l) => ({ l, d: (l.x - c.x) ** 2 + (l.y - c.y) ** 2 })).sort((a, b) => a.d - b.d).slice(0, 32)
    near.forEach(({ l }, i) => u.lamps.value[i].set(l.x, l.y, l.z, l.r))
    u.lampCount.value = near.length
  }

  /**
   * Swap the half-size photo atlases of a fast first frame for the full ones, a strip per frame. Not on a
   * preset with paintFull false (low): the half-size pages stay (the full ones decode at 256 MB a page and
   * hold about 1 GB more on the GPU); switching to a preset that wants them sharpens then.
   */
  sharpen(): Promise<void> {
    if (!this.paintData || !this.realMat || this.sharpState === 'started') return Promise.resolve()
    if (this.q?.paintFull === false) { this.sharpState = 'held'; return Promise.resolve() }
    this.sharpState = 'started'
    return sharpenPaint(this.renderer, this.paintData, this.realMat.userData.uniforms)
  }
  private sharpState: 'waiting' | 'held' | 'started' = 'waiting'

  /** Hot reload of data/look.json: repaint and retune without rebuilding the park. */
  setLook(look: Look) {
    this.look = look
    if (this.realMat) retuneParkMaterial(this.realMat, look.real)
    this.realPass?.setLook(look.real)
    this.applyBloom(this.nightK)
    if (look.real.nightSky) this.nightSky?.setLook(look.real.nightSky)
    this.gradient.dispose()
    this.gradient = toonGradient(look.toon.bands)
    this.paint()
    this.cuteMats.solid.dispose(); this.cuteMats.ctx.dispose()
    this.cuteMats = this.makeCuteMats()
    for (const v of [this.skater, ...this.others]) v.root.traverse((o) => { const l = o.userData.looks; if (l) for (const m of [l.cute].flat()) (m as THREE.MeshToonMaterial).gradientMap = this.gradient })
    this.scene.remove(this.sky); this.sky = makeSky(look); this.scene.add(this.sky)
    this.ink.setLook(look)
    this.setStyle(this.style)
  }

  private makeCuteMats() {
    return {
      solid: toonMaterial({ vertexColors: true, side: THREE.DoubleSide }, this.gradient, this.look.mottle),
      ctx: toonMaterial({ vertexColors: true, side: THREE.DoubleSide }, this.gradient, this.look.mottle * 0.6, 0.5),
    }
  }

  /** Cute colours per vertex from data/look.json paint. */
  private paint() {
    const src = this.src
    const featureType = new Map(src.elements.filter((e) => e.role === 'body').map((e) => [e.feature, e.type]))
    const color = new THREE.Color()
    const solid: number[] = [], ctx: number[] = []
    let building = 0
    src.elements.forEach((e) => {
      if (e.collection === 'boundary' || isCity(e)) return
      const hex = paintFor(this.look, e, featureType.get(e.feature) ?? '', e.collection === 'buildings' ? building++ : 0)
      color.setHex(hex)
      const [start, count] = e.tris
      for (let t = start; t < start + count; t++) {
        const target = this.triIsCtx[t] ? ctx : solid
        for (let k = 0; k < 3; k++) target.push(color.r, color.g, color.b)
      }
    })
    this.colors.solidCute = new Float32Array(solid)
    this.colors.ctxCute = new Float32Array(ctx)
  }
  private triIsCtx: boolean[] = []

  private buildPark(src: ParkSource, physics: Physics) {
    const cls = classifySource(src, physics.surfaces)
    const solid: number[] = [], solidColor: number[] = [], context: number[] = []
    // Photo paint per corner (real look): atlas uv, page, park material.
    const P = this.paintData
    const real = { solid: { uv: [] as number[], page: [] as number[], mat: [] as number[] }, ctx: { uv: [] as number[], page: [] as number[], mat: [] as number[] } }
    const p = src.positions, ix = src.indices
    const color = new THREE.Color()
    // Edge lines on obstacles only: the ground's triangulation seams would draw as stray lines.
    const edgeElems = new Set(src.elements.filter((e) => e.collection === 'obstacles' || e.collection === 'freeway_columns' || e.collection === 'walls').map((e) => e.id))
    const edgePos: number[] = []
    const featureType = new Map(src.elements.filter((e) => e.role === 'body').map((e) => [e.feature, e.type]))
    src.elements.forEach((e, ei) => {
      if (e.collection === 'boundary' || isCity(e)) return   // invisible wall; the city draws itself
      const [start, count] = e.tris
      // Coping pipes on transitions are drawn orange: the real steel, so it lines up by construction.
      const coping = /_edge_(COP|CP30)_\d+$/.test(e.id) && /quarterpipe|transition/.test(featureType.get(e.feature) ?? '')
      // Draw-only: the ground slab sits a few mm low so ramp toes lying on it do not z-fight.
      const sink = e.collection === 'ground' || e.id === 'catch_floor' ? 0.008 : e.collection === 'ground_detail' ? 0.004 : 0
      for (let t = start; t < start + count; t++) {
        const target = cls[t] === Surface.none ? context : solid
        this.triIsCtx[t] = target === context
        ;(target === solid ? this.solidElem : this.ctxElem).push(ei)
        color.setHex(coping ? 0xff7a1a : COLORS[cls[t]])
        if (P) {
          const r = target === solid ? real.solid : real.ctx
          for (let k = 0; k < 3; k++) { r.uv.push(P.uv[t * 6 + k * 2], P.uv[t * 6 + k * 2 + 1]); r.page.push(P.page[t]); r.mat.push(P.mat[t]) }
        }
        for (let k = 0; k < 3; k++) {
          const v = ix[t * 3 + k] * 3
          if (target === solid) this.parkBox.expandByPoint(new THREE.Vector3(p[v], p[v + 1], p[v + 2]))
          target.push(p[v], p[v + 1], p[v + 2] - sink)
          if (target === solid) solidColor.push(color.r, color.g, color.b)
          if (edgeElems.has(e.id)) edgePos.push(p[v], p[v + 1], p[v + 2])
        }
      }
    })
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(solid, 3))
    g.setAttribute('color', new THREE.Float32BufferAttribute(solidColor, 3))
    g.computeVertexNormals()
    const addReal = (geo: THREE.BufferGeometry, r: typeof real.solid) => {
      if (!P) return
      geo.setAttribute('auv', new THREE.Float32BufferAttribute(r.uv, 2))
      geo.setAttribute('apage', new THREE.Float32BufferAttribute(r.page, 1))
      geo.setAttribute('amat', new THREE.Float32BufferAttribute(r.mat, 1))
    }
    addReal(g, real.solid)
    this.greyMats = {
      solid: new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }),
      ctx: new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }),
    }
    const mesh = new THREE.Mesh(g, this.greyMats.solid)
    mesh.receiveShadow = true
    const cg = new THREE.BufferGeometry()
    cg.setAttribute('position', new THREE.Float32BufferAttribute(context, 3))
    cg.computeVertexNormals()
    addReal(cg, real.ctx)
    const none = new THREE.Color(COLORS[Surface.none])
    const ctxGrey = new Float32Array(context.length)
    for (let i = 0; i < ctxGrey.length; i += 3) ctxGrey.set([none.r, none.g, none.b], i)
    const ctx = new THREE.Mesh(cg, this.greyMats.ctx)
    ctx.receiveShadow = true
    this.colors = { solidGrey: new Float32Array(solidColor), solidCute: new Float32Array(0), ctxGrey, ctxCute: new Float32Array(0) }
    const eg = new THREE.BufferGeometry()
    eg.setAttribute('position', new THREE.Float32BufferAttribute(edgePos, 3))
    // The edge lines wait for the sim's park (attachPark) to drop the seams that lie on it.
    this.edgesSource = eg
    const edges = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x33363a, transparent: true, opacity: 0.55 }))
    for (const o of [mesh, edges]) { this.scene.add(o); this.layers.park.push(o) }
    this.scene.add(ctx); this.layers.context.push(ctx)
    this.solidMesh = mesh; this.ctxMesh = ctx; this.edges = edges
    this.paint()
    this.cuteMats = this.makeCuteMats()
    // On the GPU after the first frame (the colours stay: the looks swap them); the paint's per-triangle
    // arrays went into the attributes above.
    freeGeometryAfterUpload(g, ['color']); freeGeometryAfterUpload(cg, ['color'])
    if (P && import.meta.env.PROD) { P.uv = release(P.uv); P.page = release(P.page); P.mat = release(P.mat) }
  }

  /**
   * Debug layer: the grind lines the sim actually uses (derived from the geometry). Built the
   * first time the layer is shown, as one mesh: the city has some 50k lines (every parked car's
   * edges), and a scene object per segment cost frame time even while hidden.
   */
  private railsPark: Park | null = null
  /**
   * The sim's park, when it is ready (it is built in a worker while the renderer is): the grind lines'
   * debug layer and the edge lines (seams lying on the park dropped) need its collision data.
   */
  attachPark(park: Park) {
    this.railsPark = park
    this.seamPark = park
    this.groundPark = park
    if (this.style === 'grey') this.buildEdges()
  }

  /**
   * Every mesh in the scene and every texture made to be freed goes to the GPU now. The built site lets
   * each one's JS copy go once it is uploaded (memory.ts), so the city's geometry and the textures (some
   * 250 MB) go at boot, before the sim's park comes over, instead of mesh by mesh as each first comes
   * into view (and nothing uploads mid-run). Geometry uploads when it is drawn: one draw of the whole
   * scene, culling and the shadow pass off, with one plain material (the looks' own shaders compile with
   * the first frame, as before) into a 1x1 target; textures upload directly.
   */
  uploadAll() {
    const target = new THREE.WebGLRenderTarget(1, 1)
    const plain = new THREE.MeshBasicMaterial()
    const culled: THREE.Object3D[] = []
    this.scene.traverse((o) => { if (o.frustumCulled) { o.frustumCulled = false; culled.push(o) } })
    const prev = this.renderer.getRenderTarget(), shadows = this.renderer.shadowMap.autoUpdate
    this.renderer.shadowMap.autoUpdate = false
    this.scene.overrideMaterial = plain
    this.renderer.setRenderTarget(target)
    this.renderer.render(this.scene, this.camera)
    this.renderer.setRenderTarget(prev)
    this.scene.overrideMaterial = null
    this.renderer.shadowMap.autoUpdate = shadows
    for (const o of culled) o.frustumCulled = true
    uploadPending(this.renderer)
    plain.dispose(); target.dispose()
  }
  private edgesSource: THREE.BufferGeometry | null = null
  private seamPark: Park | null = null
  /** The grey look's edge lines, made the first time they show (dropping the seams costs a raycast an edge). */
  private buildEdges() {
    if (!this.edgesSource || !this.seamPark) return
    const geo = dropSeams(new THREE.EdgesGeometry(this.edgesSource, 28), this.seamPark)
    this.edgesSource.dispose(); this.edgesSource = null; this.seamPark = null
    this.edges.geometry.dispose(); this.edges.geometry = geo
    freeGeometryAfterUpload(geo)
  }
  private buildRailsNow() {
    const park = this.railsPark
    if (!park) return
    this.railsPark = null
    const mat = new THREE.MeshLambertMaterial({ color: 0xff7a1a, emissive: 0x552200 })
    // One straight tube per segment: a single tube over the whole polyline samples evenly
    // and cuts the corners (north audit, pins 20/23).
    const parts: THREE.BufferGeometry[] = []
    for (const r of park.grind) {
      for (let i = 0; i < r.points.length - 1; i++) {
        const a = r.points[i], b = r.points[i + 1]
        const curve = new THREE.LineCurve3(new THREE.Vector3(a.x, a.y, a.z + 0.012), new THREE.Vector3(b.x, b.y, b.z + 0.012))
        parts.push(new THREE.TubeGeometry(curve, 1, 0.022, 6, false))
      }
    }
    if (!parts.length) return
    const m = new THREE.Mesh(mergeGeometries(parts), mat)
    for (const g of parts) g.dispose()
    m.visible = this.visible.rails
    this.scene.add(m); this.layers.rails.push(m)
  }

  private buildSkater() {
    this.scene.add(this.skater.root)
    this.layers.skater.push(this.skater.root)
  }
  /** More skater views drawn like the player's (player 2's): in the scene, toon-lit, in every style. */
  private others: SkaterView[] = []
  addSkater(view: SkaterView) {
    toonify(view.root, this.gradient)
    applyMaterials(view.root, this.style)
    this.scene.add(view.root)
    this.layers.skater.push(view.root)
    view.root.visible = this.visible.skater
    this.others.push(view)
  }

  setLayer(layer: Layer, on: boolean) {
    if (layer === 'rails' && on) this.buildRailsNow()
    this.visible[layer] = on
    this.applyLayers()
    this.onLayerChange(layer, on)
  }
  toggleLayer(layer: Layer) { this.setLayer(layer, !this.visible[layer]) }
  isVisible(layer: Layer) { return this.visible[layer] }

  private applyLayers() {
    for (const [k, objs] of Object.entries(this.layers)) for (const o of objs) o.visible = this.visible[k as Layer]
    // Cute draws folds with ink outlines; the grey edge lines are for judging shape.
    this.edges.visible = this.visible.park && this.style === 'grey'
    if (this.edges.visible) this.buildEdges()
    this.sky.visible = this.clouds.visible = this.style === 'cute' && this.visible.context
    if (this.style === 'real' && !this.visible.context) this.scene.background = new THREE.Color(this.look.real.fog.color)
    else if (this.style === 'real' && this.realAssets) this.scene.background = this.realAssets.sky
    this.renderer.shadowMap.enabled = this.visible.shadows
    this.sun.castShadow = this.visible.shadows
    this.scene.traverse((o) => { if ((o as THREE.Mesh).material) ((o as THREE.Mesh).material as THREE.Material).needsUpdate = true })
  }

  /** Place and pose the skater from (interpolated) sim state; alpha = progress into the next tick. */
  setSkater(t: Thing, data: GameData, alpha: number) {
    this.skater.update(t, data, alpha)
    const up = new THREE.Vector3(t.up.x, t.up.y, t.up.z).normalize()
    this.sphere.position.set(t.pos.x, t.pos.y, t.pos.z)
    const v = new THREE.Vector3(t.vel.x, t.vel.y, t.vel.z)
    this.velArrow.position.copy(this.sphere.position)
    if (v.length() > 0.01) { this.velArrow.setDirection(v.clone().normalize()); this.velArrow.setLength(Math.max(0.3, v.length() * 0.25)) }
    this.upArrow.position.copy(this.sphere.position)
    this.upArrow.setDirection(up)
    this.lastSkater = { x: t.pos.x, y: t.pos.y, z: t.pos.z }
    this.placeContact(t)
    if (this.style === 'real') { if (this.city) this.followSun(t.pos); return }   // the real sun stands still over the whole park
    this.sun.target.position.set(t.pos.x, t.pos.y, t.pos.z)
    const f = this.style === 'cute' ? this.look.sun.from : [-30, -40, 60]
    this.sun.position.set(t.pos.x + f[0], t.pos.y + f[1], t.pos.z + f[2])
  }

  /**
   * The contact shadow: on the ground straight under the board (a ray down from the skater), lying on that ground,
   * along the board, fading as the skater rises (gone by 2.4 m) and while walking or driving (the body is not on a board).
   */
  private placeContact(t: Thing) {
    const m = this.contact, mat = m.material as THREE.ShaderMaterial
    const park = this.groundPark
    const on = this.style !== 'grey' && !!park && t.alive !== false && t.state !== 'drive'
    const hit = on ? raycast(park!, { x: t.pos.x, y: t.pos.y, z: t.pos.z + 0.1 }, { x: 0, y: 0, z: -1 }, 3) : null
    if (!hit || hit.normal.z < 0.3) { mat.uniforms.k.value = 0; m.visible = false; return }
    const h = Math.max(0, t.pos.z - hit.point.z - 0.12)
    const k = (1 - Math.min(1, h / 2.4)) ** 2 * (t.state === 'walk' ? 0.7 : 1)
    m.visible = this.visible.skater && k > 0.02
    mat.uniforms.k.value = k
    const n = new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z).normalize()
    const f = new THREE.Vector3(t.fwd.x, t.fwd.y, t.fwd.z)
    f.addScaledVector(n, -f.dot(n))
    if (f.lengthSq() < 1e-6) f.set(1, 0, 0).addScaledVector(n, -n.x)
    f.normalize()
    const s = new THREE.Vector3().crossVectors(n, f)
    m.matrix.makeBasis(f, s, n)
    const grow = 1 + h * 0.35
    m.matrix.scale(new THREE.Vector3(0.95 * grow, 0.5 * grow, 1))
    m.matrix.setPosition(hit.point.x + n.x * 0.012, hit.point.y + n.y * 0.012, hit.point.z + n.z * 0.012)
    m.matrixWorldNeedsUpdate = true
  }

  /** City, real look: move the shadowed square with the skater in whole-texel steps (no shimmer). */
  private sunAt = new THREE.Vector3()
  shadowAt(p: { x: number; y: number; z: number }) { if (this.city && this.style === 'real') this.followSun(p) }
  private followSun(p: { x: number; y: number; z: number }) {
    const reach = this.cityShadowReach, step = (2 * reach) / this.sun.shadow.mapSize.x
    const fv = this.wxNow().from, f = [fv.x, fv.y, fv.z]
    const d = fv.clone().normalize()
    // Snap in the light's own frame so the shadow map grid stays put while the square moves.
    const right = new THREE.Vector3(0, 0, 1).cross(d).normalize(), up = d.clone().cross(right)
    const q = new THREE.Vector3(p.x, p.y, p.z)
    const a = Math.round(q.dot(right) / step) * step, b = Math.round(q.dot(up) / step) * step, c = q.dot(d)
    const snapped = right.multiplyScalar(a).add(up.multiplyScalar(b)).add(d.multiplyScalar(c))
    if (snapped.distanceTo(this.sunAt) < 1e-6) return
    this.sunAt.copy(snapped)
    this.sun.target.position.copy(snapped)
    this.sun.position.set(snapped.x + f[0], snapped.y + f[1], snapped.z + f[2])
  }

  /** What is under a screen point (normalized device coords): site point, normal, park element. */
  pick(ndcX: number, ndcY: number) {
    const ray = new THREE.Raycaster()
    ray.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera)
    const targets = [this.solidMesh, this.ctxMesh].filter((m) => m.visible)
    const hit = ray.intersectObjects(targets, false)[0]
    if (!hit || hit.faceIndex == null) return null
    const ei = (hit.object === this.solidMesh ? this.solidElem : this.ctxElem)[hit.faceIndex]
    const e = this.src.elements[ei]
    const n = hit.face ? hit.face.normal.clone() : new THREE.Vector3(0, 0, 1)
    if (n.dot(ray.ray.direction) > 0) n.negate()
    return { point: hit.point.clone(), normal: n, element: e }
  }

  /** Numbered markers for park comments (open ones orange, done grey). */
  setPins(pins: { n: number; point: number[]; done: boolean }[]) {
    this.pinGroup.clear()
    for (const p of pins) {
      const c = document.createElement('canvas')
      c.width = c.height = 64
      const g = c.getContext('2d')!
      g.fillStyle = p.done ? '#8e8e93' : '#ff7a1a'
      g.beginPath(); g.arc(32, 32, 28, 0, Math.PI * 2); g.fill()
      g.fillStyle = '#fff'; g.font = 'bold 30px ui-monospace, Menlo, monospace'; g.textAlign = 'center'; g.textBaseline = 'middle'
      g.fillText(String(p.n), 32, 34)
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false }))
      sprite.scale.set(0.45, 0.45, 1)
      sprite.position.set(p.point[0], p.point[1], p.point[2] + 0.35)
      sprite.renderOrder = 10
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.35, 6), new THREE.MeshBasicMaterial({ color: p.done ? 0x8e8e93 : 0xff7a1a }))
      stem.rotation.x = Math.PI / 2
      stem.position.set(p.point[0], p.point[1], p.point[2] + 0.175)
      this.pinGroup.add(sprite, stem)
    }
  }

  /**
   * Where to go next in a game mode (courier stop, hill bomb gate) or a mission: a thin shaft of the accent colour
   * (International Orange) fading upward, and a flat ring on the ground; ring: the ring alone (the S.K.A.T.E. mark).
   * Flat colour, normal blending, no glow: it sits in the filmed picture instead of on top of it.
   */
  private beacon: THREE.Group | null = null
  setBeacon(p: { x: number; y: number; z: number; ring?: boolean } | null, time = 0) {
    if (!this.beacon) {
      const g = new THREE.Group()
      const accent = new THREE.Color('#ff4f1f')
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 14, 20, 1, true).rotateX(Math.PI / 2).translate(0, 0, 7), new THREE.ShaderMaterial({
        uniforms: { color: { value: accent } },
        vertexShader: 'varying float vH; void main() { vH = position.z / 14.0; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: 'uniform vec3 color; varying float vH; void main() { gl_FragColor = vec4(color, 0.62 * pow(1.0 - vH, 1.6) * smoothstep(0.0, 0.04, vH)); }',
        transparent: true, depthWrite: false, side: THREE.DoubleSide,
      }))
      const ring = new THREE.Mesh(new THREE.RingGeometry(1.55, 1.72, 48), new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }))
      ring.position.z = 0.03
      g.add(shaft, ring); g.renderOrder = 5
      this.beacon = g; this.scene.add(g)
    }
    this.beacon.visible = !!p
    if (p) {
      this.beacon.position.set(p.x, p.y, p.z)
      this.beacon.children[0].visible = !p.ring
      const s = (p.ring ? 0.75 : 1) * (1 + Math.sin(time * 3) * 0.04); this.beacon.children[1].scale.set(s, s, 1)
    }
  }

  /** The Tour's secret tape: a VHS cassette spinning and bobbing where it hides, with a soft glow; gone once found. */
  private tape: THREE.Group | null = null
  setTape(pos: number[] | null, time: number) {
    if (!this.tape) {
      const g = new THREE.Group()
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.24, 0.07), new THREE.MeshStandardMaterial({ color: 0x18181c, roughness: 0.5 }))
      const label = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.1, 0.072), new THREE.MeshStandardMaterial({ color: 0xff4f00, emissive: 0xff4f00, emissiveIntensity: 0.6 }))
      label.position.y = 0.04
      const reels = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.05, 0.074), new THREE.MeshStandardMaterial({ color: 0xfff6e6, emissive: 0xfff6e6, emissiveIntensity: 0.3 }))
      reels.position.y = -0.055
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0xffd23f, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending }))
      glow.scale.set(1.1, 1.1, 1)
      g.add(body, label, reels, glow)
      this.tape = g; this.scene.add(g)
    }
    this.tape.visible = !!pos
    if (pos) { this.tape.position.set(pos[0], pos[1], pos[2] + Math.sin(time * 2.4) * 0.1); this.tape.rotation.set(Math.PI / 2, time * 1.8, 0, 'ZXY') }
  }

  /**
   * Burritos: a foil-wrapped burrito, a low model in the world (not the sticker: the art direction keeps drawn
   * illustrations out of the picture), floating, turning and bobbing; collected ones disappear.
   */
  private burritoGroup = new THREE.Group()
  private burritoParts: { geo: THREE.BufferGeometry[]; mat: THREE.Material[] } | null = null
  setBurritos(list: { pos: number[] }[], have: number[], time: number) {
    if (!this.burritoParts) {
      const foil = new THREE.MeshStandardMaterial({ color: 0xc9ccd1, metalness: 0.85, roughness: 0.38 })
      const tortilla = new THREE.MeshStandardMaterial({ color: 0xd9b77a, roughness: 0.8 })
      const paper = new THREE.MeshStandardMaterial({ color: 0xece4d2, roughness: 0.9 })
      const body = new THREE.CapsuleGeometry(0.12, 0.3, 4, 12).rotateZ(Math.PI / 2)
      const end = new THREE.SphereGeometry(0.118, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2).rotateZ(-Math.PI / 2).translate(0.15, 0, 0)
      const band = new THREE.CylinderGeometry(0.124, 0.124, 0.12, 16, 1, true).rotateZ(Math.PI / 2).translate(-0.04, 0, 0)
      this.burritoParts = { geo: [body, end, band], mat: [foil, tortilla, paper] }
      this.scene.add(this.burritoGroup)
    }
    while (this.burritoGroup.children.length < list.length) {
      const g = new THREE.Group(), P = this.burritoParts
      P.geo.forEach((geo, k) => { const m = new THREE.Mesh(geo, P.mat[k]); m.castShadow = true; g.add(m) })
      g.scale.setScalar(1.6)
      this.burritoGroup.add(g)
    }
    list.forEach((b, i) => {
      const g = this.burritoGroup.children[i]
      g.visible = !have.includes(i)
      g.position.set(b.pos[0], b.pos[1], b.pos[2] + Math.sin(time * 2.2 + i) * 0.12)
      g.rotation.set(0.35 * Math.sin(time * 1.6 + i), 0, time * 1.4 + i)
    })
  }

  /** S-K-A-T-E letters floating in the park; collected ones disappear. */
  setLetters(letters: { letter: string; pos: number[] }[], have: string, time: number) {
    for (const L of letters) {
      let sp = this.letterSprites.get(L.letter)
      if (!sp) {
        const c = document.createElement('canvas')
        c.width = c.height = 128
        const g = c.getContext('2d')!
        g.fillStyle = '#ffcc00'; g.strokeStyle = '#1e1e1e'; g.lineWidth = 8
        g.font = 'bold 104px ui-sans-serif, system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'
        g.strokeText(L.letter, 64, 70); g.fillText(L.letter, 64, 70)
        sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c) }))
        sp.scale.set(0.8, 0.8, 1)
        this.letterGroup.add(sp)
        this.letterSprites.set(L.letter, sp)
      }
      sp.visible = !have.includes(L.letter)
      sp.position.set(L.pos[0], L.pos[1], L.pos[2] + Math.sin(time * 2 + L.pos[0]) * 0.08)
    }
  }

  setCamera(c: CamPose, up?: number[]) {
    this.camera.position.set(c.pos.x, c.pos.y, c.pos.z)
    if (up) this.camera.up.set(up[0], up[1], up[2])
    else this.camera.up.set(0, 0, 1)
    this.camera.lookAt(c.look.x, c.look.y, c.look.z)
    // The filmer's lens: the film pass bends the picture, so the camera draws a little wider (lensFit) and the
    // middle of the frame keeps the pose's own field of view.
    const k = this.lensK(c), aspect = this.camera.aspect
    this.realPass?.setLens(k, aspect)
    const fov = k > 0 ? (2 * Math.atan(Math.tan((c.fov * Math.PI) / 360) * lensFit(k, aspect)) * 180) / Math.PI : c.fov
    if (this.camera.fov !== fov) { this.camera.fov = fov; this.camera.updateProjectionMatrix() }
  }
  /** The lens's strength for a pose: the chase camera's, toward the trick cameras' as the director swings in (pose.lens); none off the real look, in split screen or with the setting off. */
  private lensK(c: CamPose): number {
    const L = this.look.real.film?.lens
    if (!L || c.lens === undefined || !this.picture.lens || this.style !== 'real' || !this.realPass || this.splitting) return 0
    return L.chase + (L.trick - L.chase) * Math.min(1, Math.max(0, c.lens))
  }
  private splitting = false

  /**
   * Settings > Video: the lens (the filmer's fisheye and darker corners, stronger on the trick cameras) and the
   * picture (standard, or PS2: drawn at a PS2's height, shown with hard pixels, ordered dither).
   */
  setPicture(p: Picture) {
    if (p.lens === this.picture.lens && p.ps2 === this.picture.ps2) return
    this.picture = { ...p }
    const P = this.look.real.film?.ps2
    this.realPass?.setDither(p.ps2 && P ? P.levels : 0)
    this.renderer.domElement.style.imageRendering = p.ps2 ? 'pixelated' : ''
    this.applyPixelRatio()
  }
  /** The drawing buffer's pixels per CSS pixel: the preset's cap times the render scale, or a PS2's height. */
  private applyPixelRatio() {
    const el = this.renderer.domElement, P = this.look.real.film?.ps2
    const h = el.clientHeight || window.innerHeight
    const pr = this.picture.ps2 && P ? P.height / Math.max(1, h) : Math.min(window.devicePixelRatio, this.prCap) * this.scale
    this.renderer.setPixelRatio(pr)
    this.resize(el.clientWidth || window.innerWidth, h)
  }

  /** The quality preset in force (null: the defaults, as before presets). */
  private q: QualityPreset | null = null
  /** The highest device pixel ratio drawn (a dpr 3 phone is not drawn at 3; a phone's own cap where the preset has one: its GPU is the part the CPU-side timing cannot see). */
  private get prCap() { return (isPhone() && this.q?.phonePixelRatio) || (this.q?.pixelRatio ?? 2) }
  /** Half the side of the shadowed square that follows the skater in the city (the preset can shrink it). */
  private get cityShadowReach() { return Math.min(this.look.city?.shadowReach ?? 110, this.q?.shadowReach ?? Infinity) }
  /**
   * Apply a quality preset: the pixel ratio cap, ambient occlusion and multisampling, the shadow map's
   * size and reach, whether the city casts shadows, and the draw distance (the fog, which also culls the
   * city). Restyles once, so it is for settings changes, not every frame.
   */
  setPreset(q: QualityPreset) {
    this.q = q
    this.applyPixelRatio()
    this.realPass?.setQuality(q.ao, q.msaa, q.aoScale ?? 1)
    this.city?.setShadows(q.cityShadows)
    this.setStyle(this.style)
    if (this.sharpState === 'held' && q.paintFull !== false) void this.sharpen()
  }

  /** Render resolution as a fraction of the screen's (dynamic resolution). */
  private scale = 1
  setScale(s: number) {
    if (Math.abs(s - this.scale) < 1e-3) return
    this.scale = s
    this.applyPixelRatio()
  }
  get renderScale() { return this.scale }

  resize(w: number, h: number) {
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
  }

  render() { this.renderView() }

  /** The part of the canvas the view being drawn goes into (split screen), or null for all of it. */
  private viewRect: ViewRect | null = null
  /**
   * Split screen: each view's camera pose drawn into its own part of the one canvas (viewport and
   * scissor), with the same scene and post chain. The shadow map is drawn once a frame (by the first
   * view); everything that follows the camera (sky, city culling, lamps, stars) follows each view's.
   * Afterwards the camera is back on the first view's pose and the whole canvas.
   */
  renderViews(views: { pose: CamPose; rect: ViewRect }[]) {
    const R = this.renderer, auto = R.shadowMap.autoUpdate, full = R.getSize(new THREE.Vector2())
    this.splitting = true   // no lens in split screen (each half has its own shape)
    views.forEach((v, i) => {
      this.setCamera(v.pose)
      this.camera.aspect = v.rect.w / v.rect.h
      this.camera.updateProjectionMatrix()
      R.setViewport(v.rect.x, v.rect.y, v.rect.w, v.rect.h)
      R.setScissor(v.rect.x, v.rect.y, v.rect.w, v.rect.h)
      R.setScissorTest(true)
      if (i > 0) R.shadowMap.autoUpdate = false
      this.viewRect = v.rect
      this.renderView()
    })
    this.viewRect = null
    this.splitting = false
    R.shadowMap.autoUpdate = auto
    R.setScissorTest(false)
    R.setViewport(0, 0, full.x, full.y)
    this.camera.aspect = full.x / full.y
    this.camera.updateProjectionMatrix()
    if (views[0]) this.setCamera(views[0].pose)
  }

  private renderView() {
    if (!this.viewRect || this.viewRect.x === 0) this.renderer.info.reset()
    // In the city the camera roams far from the park: the cute sky dome and clouds come along.
    if (this.city) {
      this.sky.position.copy(this.camera.position); this.clouds.position.set(this.camera.position.x - 40, this.camera.position.y - 20, this.camera.position.z - 2)
      // City tiles wholly inside the fog are not drawn (fog = null in overviews: draw everything).
      const fog = this.scene.fog as THREE.Fog | null
      this.city.cull(this.camera, fog ? fog.far : Infinity, fog, this.style === 'real' ? this.hfogK : 0)
    }
    if (this.style === 'real') this.updateLamps()
    const now = performance.now(), dt = this.lastRender ? Math.min(0.1, (now - this.lastRender) / 1000) : 0; this.lastRender = now
    this.nightSky?.update(this.camera, this.style === 'real' && this.visible.context ? this.nightK * (1 - this.hfogK) : 0, dt, this.renderer.getPixelRatio())   // no stars through the fog
    this.daySky?.update(this.camera, this.style === 'real' && this.visible.context ? this.skyK : 0)
    if (this.style === 'real') this.realFrame()
    if (this.style === 'real' && this.realPass) this.realPass.render(this.renderer, this.viewRect)
    else if (this.style === 'cute') this.ink.render(this.renderer, this.scene, this.camera, this.viewRect)
    else this.renderer.render(this.scene, this.camera)
  }

  /**
   * Per frame in the real look: the characters' fill and rim (real.readable, day to night; the rim takes the sky's
   * horizon by day, lamplight at night), and the haze leaning toward the sun's glow as the camera looks sunward
   * (real.sunHaze: one fog colour a frame, so it costs nothing in the shaders).
   */
  private realFrame() {
    const R = this.look.real, rd = R.readable, n = this.nightK, u = readableUniforms
    if (rd) {
      u.charFill.value = rd.fill[0] + (rd.fill[1] - rd.fill[0]) * n
      u.charRim.value = rd.rim[0] + (rd.rim[1] - rd.rim[0]) * n
      u.charRimColor.value.copy(this.hazeFog).lerp(this.rimNight.set(rd.rimNight), n)
    }
    const fog = this.scene.fog as THREE.Fog | null
    if (!fog || !R.sunHaze) return
    const f = this.camera.getWorldDirection(this.camDir), sx = this.hazeFrom.x, sy = this.hazeFrom.y, sl = Math.hypot(sx, sy) || 1, fl = Math.hypot(f.x, f.y) || 1
    const toward = Math.max(0, (f.x * sx + f.y * sy) / (sl * fl))
    fog.color.copy(this.hazeFog).lerp(this.hazeTint.copy(this.hazeFog).add(this.hazeSun), R.sunHaze * toward * toward * this.skyK)
  }
  private camDir = new THREE.Vector3()
  private hazeTint = new THREE.Color()
  private rimNight = new THREE.Color()

  /** Screen rectangle (CSS px) around the skater, for cropped shots. */
  skaterRect(pad = 40): { x: number; y: number; width: number; height: number } {
    this.skater.root.updateMatrixWorld(true)
    const box = new THREE.Box3().setFromObject(this.skater.root, true)
    const el = this.renderer.domElement
    const w = el.clientWidth, h = el.clientHeight
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
      const p = new THREE.Vector3(x, y, z).project(this.camera)
      const sx = ((p.x + 1) / 2) * w, sy = ((1 - p.y) / 2) * h
      x0 = Math.min(x0, sx); y0 = Math.min(y0, sy); x1 = Math.max(x1, sx); y1 = Math.max(y1, sy)
    }
    x0 = Math.max(0, Math.floor(x0 - pad)); y0 = Math.max(0, Math.floor(y0 - pad))
    x1 = Math.min(w, Math.ceil(x1 + pad)); y1 = Math.min(h, Math.ceil(y1 + pad))
    return { x: x0, y: y0, width: Math.max(1, x1 - x0), height: Math.max(1, y1 - y0) }
  }
}
