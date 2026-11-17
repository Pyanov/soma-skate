import * as THREE from 'three'
import { freeTextureAfterUpload } from './memory.ts'
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import type { Look } from '../data/schema.ts'
import { fetchBin } from './fetchbin.ts'

// The real look: the park painted with the 26 photos of 2026-09-20, projected onto the
// exact geometry the game collides with (the world generator's blender/project_photos.py
// --profile game, exported by ./skate park), lit by an overcast sky with a sun,
// physically based materials with tiling CC0 surface detail (assets/real/), soft
// shadows from the park, ambient occlusion and filmic tone mapping. Draw-only.

export type RealLook = Look['real']

/** Photo paint for each park triangle, aligned with soma.park.bin's triangle order. */
export type Paint = {
  uv: Float32Array          // 6 per triangle (atlas uv per corner)
  page: Uint8Array          // atlas page per triangle; 255 = no photo texel
  mat: Uint8Array           // index into materials per triangle
  materials: string[]
  palette: Record<string, { color: number[]; roughness: number; metalness: number }>
  pages: THREE.Texture[]
  coverage: THREE.Texture[]  // per page: how surely a photo saw each texel (0 = never)
}

export type PaintManifest = { binary: string; pages: string[]; coverage?: string[]; materials: string[]; palette: Paint['palette'] } | null | undefined

const DECODE = { imageOrientation: 'flipY', premultiplyAlpha: 'none', colorSpaceConversion: 'none' } as const

/** A JPEG's pixel size from its frame header, or null (then it is decoded at full size). */
async function jpegSize(blob: Blob): Promise<[number, number] | null> {
  const b = new Uint8Array(await blob.slice(0, 1 << 16).arrayBuffer())
  if (b[0] !== 0xff || b[1] !== 0xd8) return null
  for (let i = 2; i + 9 < b.length;) {
    if (b[i] !== 0xff) return null
    const m = b[i + 1]
    if (m === 0xff) { i++; continue }
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return [(b[i + 7] << 8) | b[i + 8], (b[i + 5] << 8) | b[i + 6]]
    i += 2 + ((b[i + 2] << 8) | b[i + 3])
  }
  return null
}

/**
 * Load the photo paint next to a park manifest, or null when the park has none (lab, unbaked).
 * preview: decode the atlases at half size for a fast first frame (uploading the three full
 * 8192 x 8192 pages took 1.45 s of it) and keep the files for sharpenPaint.
 */
export async function loadPaint(base: string, manifest: { triangleCount: number; paint?: PaintManifest }, preview = false): Promise<Paint | null> {
  const p = manifest.paint
  if (!p) return null
  const n = manifest.triangleCount
  let bin: ArrayBuffer
  try { bin = await fetchBin(`${base}/${p.binary}`) } catch { return null }
  if (bin.byteLength !== n * 6 * 4 + n * 2) throw new Error('park paint binary does not match the park triangles')
  // Decoded off the main thread as ImageBitmaps (flipped at decode, as three's flipY would): from
  // plain images the big JPEGs decoded inside the first texture upload, about 1.9 s of frozen frame.
  const load = async (url: string) => {
    const blob = await (await fetch(url)).blob()
    const size = preview ? await jpegSize(blob) : null
    const bmp = await createImageBitmap(blob, size ? { ...DECODE, resizeWidth: size[0] >> 1, resizeHeight: size[1] >> 1, resizeQuality: 'medium' } : DECODE)
    const t = new THREE.Texture(bmp); t.flipY = false; t.needsUpdate = true
    if (size) t.userData.full = blob
    // Once on the GPU the decoded page goes (a 4096 square page is 64 MB): low keeps these half-size
    // pages for the whole run, and sharpening only needs the JPEG (userData.full).
    freeTextureAfterUpload(t)
    return t
  }
  // One atlas page at a time (and the coverage maps beside them, one at a time): the decoder holds a page
  // at full size (8192 square, 256 MB) while it scales it, and all six side by side were the biggest
  // moment of the whole load, 1.3 GB on top of the rest.
  const one = async (files: string[]) => { const out: THREE.Texture[] = []; for (const f of files) out.push(await load(`${base}/${f}`)); return out }
  const [pages, coverage] = await Promise.all([one(p.pages), one(p.coverage ?? [])])
  for (const t of pages) { t.colorSpace = THREE.SRGBColorSpace; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter }
  for (const t of coverage) t.colorSpace = THREE.NoColorSpace
  return {
    uv: new Float32Array(bin, 0, n * 6),
    page: new Uint8Array(bin, n * 24, n),
    mat: new Uint8Array(bin, n * 25, n),
    materials: p.materials, palette: p.palette, pages, coverage,
  }
}

/**
 * Swap preview atlases (loadPaint with preview) for the full ones without a frozen frame: each is
 * decoded off the main thread, cut into strips of about a million texels, uploaded one strip per
 * frame into a full-size texture, mipmapped after its last strip and then swapped into the park
 * material. Resolves when all are sharp; nothing to do when the paint was loaded at full size.
 */
export async function sharpenPaint(renderer: THREE.WebGLRenderer, paint: Paint, uniforms: Record<string, { value: unknown }>): Promise<void> {
  const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()))
  const at = new THREE.Vector2()
  for (const [name, list] of [['atlas', paint.pages], ['cov', paint.coverage]] as const) {
    for (let i = 0; i < list.length; i++) {
      const small = list[i], blob = small.userData.full as Blob | undefined
      if (!blob) continue
      const bmp = await createImageBitmap(blob, DECODE)
      const big = new THREE.Texture()
      big.image = { width: bmp.width, height: bmp.height }
      big.source.dataReady = false   // allocate only; the strips fill it
      big.flipY = false; big.colorSpace = small.colorSpace; big.anisotropy = small.anisotropy
      big.generateMipmaps = small.generateMipmaps; big.minFilter = small.minFilter
      big.needsUpdate = true
      renderer.initTexture(big)
      const rows = Math.max(16, Math.floor((1 << 20) / bmp.width))
      for (let y = 0; y < bmp.height; y += rows) {
        const h = Math.min(rows, bmp.height - y)
        const strip = new THREE.Texture(await createImageBitmap(bmp, 0, y, bmp.width, h, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' }))
        await frame()
        big.generateMipmaps = small.generateMipmaps && y + h >= bmp.height   // mipmap once, after the last strip
        renderer.copyTextureToTexture(strip, big, null, at.set(0, y))
        ;(strip.image as ImageBitmap).close()
      }
      big.generateMipmaps = small.generateMipmaps
      bmp.close()
      list[i] = big
      if (uniforms[`${name}${i}`]) uniforms[`${name}${i}`].value = big
      small.dispose(); (small.image as ImageBitmap).close()
    }
  }
}

const LAYERS = ['concrete', 'wall', 'asphalt', 'metal', 'bark'] as const
type Detail = { diff: THREE.DataArrayTexture; nor: THREE.DataArrayTexture; rough: THREE.DataArrayTexture; avg: number[]; roughAvg: number[] }

async function pixels(url: string, size: number): Promise<Uint8ClampedArray> {
  const img = await createImageBitmap(await (await fetch(url)).blob())
  const c = new OffscreenCanvas(size, size)
  const g = c.getContext('2d')!
  g.drawImage(img, 0, 0, size, size)
  return g.getImageData(0, 0, size, size).data
}

/** Tiling detail textures as three texture arrays (one layer per surface kind). */
async function loadDetail(look: RealLook): Promise<Detail> {
  const S = 1024
  const sets = await Promise.all(LAYERS.map((k) => {
    const t = look.detail[k].texture
    return Promise.all(['diffuse', 'nor_gl', 'rough'].map((m) => pixels(`assets/real/${t}_${m}.jpg`, S)))
  }))
  const arr = (i: number, srgb: boolean) => {
    const data = new Uint8Array(S * S * 4 * LAYERS.length)
    sets.forEach((s, l) => data.set(s[i], l * S * S * 4))
    const t = new THREE.DataArrayTexture(data, S, S, LAYERS.length)
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter
    t.generateMipmaps = true
    t.anisotropy = 8
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace
    t.needsUpdate = true
    freeTextureAfterUpload(t)   // 4 MB a layer, on the GPU after the first frame
    return t
  }
  const mean = (d: Uint8ClampedArray, f: (r: number, g: number, b: number) => number) => {
    let s = 0
    for (let i = 0; i < d.length; i += 64) s += f(d[i], d[i + 1], d[i + 2])
    return s / (d.length / 64) / 255
  }
  // Mean luminance in the same (linear) space the shader samples in.
  const lin = (c: number) => { const v = c / 255; return (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)) * 255 }
  return {
    diff: arr(0, true), nor: arr(1, false), rough: arr(2, false),
    avg: sets.map((s) => mean(s[0], (r, g, b) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b))),
    roughAvg: sets.map((s) => mean(s[2], (_r, g) => g)),
  }
}

export type RealAssets = { detail: Detail; sky: THREE.DataTexture }

export async function loadRealAssets(look: RealLook): Promise<RealAssets> {
  const [detail, sky] = await Promise.all([loadDetail(look), new HDRLoader().setDataType(THREE.FloatType).loadAsync(`assets/real/${look.sky.hdri}`)])
  sky.mapping = THREE.EquirectangularReflectionMapping
  // The overcast dome is many times brighter than the horizon and blows out to a white
  // blob when you look up. Compress luminance above the knee (soft, keeps cloud shapes).
  const { knee, span } = look.sky.highlights
  const d = sky.image.data as Float32Array
  for (let i = 0; i < d.length; i += 4) {
    const L = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]
    if (L <= knee) continue
    const x = L - knee, s = (knee + x / (1 + x / span)) / L
    d[i] *= s; d[i + 1] *= s; d[i + 2] *= s
  }
  sky.needsUpdate = true
  freeTextureAfterUpload(sky)   // 32 MB of floats; the environment and the background are made from it on the GPU
  return { detail, sky }
}

const MAX_MATS = 32

/**
 * Night lamp lighting shared by every lit material (the park here; the city can inject the
 * same chunk): one set of uniforms, updated once per frame by the renderer.
 */
export const lampUniforms = {
  glow: { value: 0 },
  lamps: { value: Array.from({ length: 32 }, () => new THREE.Vector4(0, 0, -1e4, 1)) }, lampCount: { value: 0 },
  lampColor: { value: new THREE.Color(1.0, 0.72, 0.42) },
  /** How strongly the lamps' pools light the ground (data/look.json real.moonlight.lamps; not lampGain, the interiors' own uniform). */
  lampPool: { value: 2.2 },
}
export const LAMP_GLSL_DECL = 'uniform float glow; uniform vec4 lamps[32]; uniform int lampCount; uniform vec3 lampColor; uniform float lampPool;'
/** The longest lamp reach the renderer sends (park LEDs 16 m, street lights 13 m; main.ts). */
const LAMP_REACH = '16.0'
/**
 * GLSL adding lamp light to totalEmissiveRadiance; needs a world position and a world normal.
 * The renderer sends the lamps nearest the camera sorted by ground distance from it, so only
 * lamps whose distance from the camera is within LAMP_REACH of the fragment's own can reach it:
 * nearer ones are skipped, the loop stops at the first farther one, and a fragment beyond the
 * last lamp's reach skips the loop (most fragments touch a handful of lamps; same light as
 * testing all 32, which cost 2-5 fps at 3200x1800 in the city).
 */
export const lampGlsl = (pos: string, nrm: string) => `
if (glow > 0.0 && lampCount > 0) {
  vec3 lampLight = vec3(0.0);
  float lampEye = length(${pos}.xy - cameraPosition.xy);
  vec2 lampLast = lamps[lampCount - 1].xy - cameraPosition.xy;
  if (lampEye < length(lampLast) + ${LAMP_REACH}) {
    float lampLo = max(lampEye - ${LAMP_REACH}, 0.0), lampHi = lampEye + ${LAMP_REACH};
    lampLo *= lampLo; lampHi *= lampHi;
    for (int i = 0; i < 32; i++) {
      if (i >= lampCount) break;
      vec4 L = lamps[i]; vec2 lc = L.xy - cameraPosition.xy; float lc2 = dot(lc, lc);
      if (lc2 > lampHi) break;
      if (lc2 < lampLo) continue;
      vec3 dv = L.xyz - ${pos}; float d = length(dv);
      if (d < L.w) { float f = 1.0 - d / L.w; lampLight += vec3(f * f * (0.35 + 0.65 * max(dot(${nrm}, dv / d), 0.0))); }
    }
  }
  totalEmissiveRadiance += diffuseColor.rgb * lampColor * lampLight * glow * lampPool;
}`

/**
 * One physically based material for the whole park: base colour from the photo atlas
 * (or the palette where no photo saw the surface), roughness and metalness per park
 * material, and triplanar world-space detail (albedo grain, normal, roughness) by kind.
 */
export function parkMaterial(paint: Paint, assets: RealAssets, look: RealLook): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide })
  const white = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1); white.needsUpdate = true
  const black = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1); black.needsUpdate = true
  const pbr = Array.from({ length: MAX_MATS }, () => new THREE.Vector4(0.8, 0, -1, 0))
  const col = Array.from({ length: MAX_MATS }, () => new THREE.Color(0.5, 0.5, 0.5))
  paint.materials.forEach((name, i) => {
    const p = paint.palette[name] ?? { color: [0.5, 0.5, 0.5], roughness: 0.8, metalness: 0 }
    const kind = look.materials[name] ?? 'none'
    const o = look.pbr[name] ?? p
    pbr[i].set(o.roughness, o.metalness, kind === 'none' ? -1 : LAYERS.indexOf(kind), look.lamps.includes(name) ? 1 : 0)
    col[i].setRGB(p.color[0], p.color[1], p.color[2])
  })
  const d = assets.detail
  const uniforms = {
    atlas0: { value: paint.pages[0] ?? white }, atlas1: { value: paint.pages[1] ?? white }, atlas2: { value: paint.pages[2] ?? white },
    cov0: { value: paint.coverage[0] ?? black }, cov1: { value: paint.coverage[1] ?? black }, cov2: { value: paint.coverage[2] ?? black },
    unseen: { value: new THREE.Vector3(look.unseen.albedo, look.unseen.stains, look.unseen.stainScale) },
    nearFade: { value: new THREE.Vector2(look.nearFade[0], look.nearFade[1]) },
    ...lampUniforms,
    detailDiff: { value: d.diff }, detailNor: { value: d.nor }, detailRough: { value: d.rough },
    detailScale: { value: LAYERS.map((k) => look.detail[k].scale) },
    detailAvg: { value: d.avg }, detailRoughAvg: { value: d.roughAvg },
    detailMix: { value: LAYERS.map((k) => new THREE.Vector4(look.detail[k].albedo, look.detail[k].normal, look.detail[k].rough, 0)) },
    atlasGain: { value: look.atlasGain },
    matPbr: { value: pbr }, matColor: { value: col },
  }
  m.userData.uniforms = uniforms
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms)
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec2 auv; attribute float apage; attribute float amat;
uniform vec4 matPbr[${MAX_MATS}]; uniform vec3 matColor[${MAX_MATS}];
varying vec2 vAtlasUv; varying float vPage; varying vec4 vPbr; varying vec3 vFallback; varying vec3 vWPos; varying vec3 vWNrm;`)
      .replace('#include <project_vertex>', `#include <project_vertex>
int mi = int(amat + 0.5);
vAtlasUv = auv; vPage = apage; vPbr = matPbr[mi]; vFallback = matColor[mi];
vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz; vWNrm = normalize(mat3(modelMatrix) * objectNormal);`)
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform sampler2D atlas0, atlas1, atlas2, cov0, cov1, cov2;
uniform vec3 unseen;
uniform vec2 nearFade;
${LAMP_GLSL_DECL}
uniform highp sampler2DArray detailDiff, detailNor, detailRough;
uniform float detailScale[${LAYERS.length}], detailAvg[${LAYERS.length}], detailRoughAvg[${LAYERS.length}];
uniform vec4 detailMix[${LAYERS.length}];
uniform float atlasGain;
varying vec2 vAtlasUv; varying float vPage; varying vec4 vPbr; varying vec3 vFallback; varying vec3 vWPos; varying vec3 vWNrm;
// Triplanar fetches only for the planes that count (most park faces are axis-aligned, so usually
// one), with explicit gradients so mip selection stays right inside the branches.
vec3 triRGB(highp sampler2DArray t, vec3 p, vec3 gx, vec3 gy, float lay, vec3 bw) {
  vec3 c = vec3(0.0);
  if (bw.x > 0.0) c += textureGrad(t, vec3(p.zy, lay), gx.zy, gy.zy).rgb * bw.x;
  if (bw.y > 0.0) c += textureGrad(t, vec3(p.xz, lay), gx.xz, gy.xz).rgb * bw.y;
  if (bw.z > 0.0) c += textureGrad(t, vec3(p.xy, lay), gx.xy, gy.xy).rgb * bw.z;
  return c;
}
vec3 triTap(highp sampler2DArray t, vec2 p, vec2 gx, vec2 gy, float lay, float w) { return w > 0.0 ? textureGrad(t, vec3(p, lay), gx, gy).xyz : vec3(0.5, 0.5, 1.0); }`)
      .replace('#include <map_fragment>', `
// Walls and columns right at the lens (a freeway column beside the chase camera) dissolve
// instead of filling the frame; ground never does.
float camD = distance(vWPos, cameraPosition);
if (camD < nearFade.y && abs(vWNrm.z) < 0.6 && smoothstep(nearFade.x, nearFade.y, camD) < fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))))) discard;
// Photo atlas: only this triangle's page (explicit gradients keep the mips right in the branch).
vec2 adx = dFdx(vAtlasUv), ady = dFdy(vAtlasUv);
vec3 albedo = vFallback; float seen = 0.0;
if (vPage < 0.5) { albedo = textureGrad(atlas0, vAtlasUv, adx, ady).rgb; seen = textureGrad(cov0, vAtlasUv, adx, ady).r; }
else if (vPage < 1.5) { albedo = textureGrad(atlas1, vAtlasUv, adx, ady).rgb; seen = textureGrad(cov1, vAtlasUv, adx, ady).r; }
else if (vPage < 2.5) { albedo = textureGrad(atlas2, vAtlasUv, adx, ady).rgb; seen = textureGrad(cov2, vAtlasUv, adx, ady).r; }
if (vPage < 2.5) albedo *= atlasGain;
float notSeen = 1.0 - seen;
// Triplanar tiling detail for this surface kind (layer -1 = none).
float hasDetail = step(-0.5, vPbr.z);
int li = int(max(vPbr.z, 0.0) + 0.5);
float lay = float(li);
vec3 rW = normalize(vWNrm) * (gl_FrontFacing ? 1.0 : -1.0);
vec3 bw = pow(abs(rW), vec3(4.0)); bw /= (bw.x + bw.y + bw.z);
bw *= step(0.02, bw); bw /= (bw.x + bw.y + bw.z);   // planes under 2% skip their fetches
vec3 dp = vWPos / detailScale[li], gx = dFdx(dp), gy = dFdy(dp);
vec4 dmix = detailMix[li] * hasDetail;
float dlum = dot(triRGB(detailDiff, dp, gx, gy, lay, bw), vec3(0.2126, 0.7152, 0.0722));
// Where no photo saw the surface, the tiling texture shows harder, plus big soft stains.
albedo *= max(mix(1.0, dlum / detailAvg[li], dmix.x * mix(1.0, unseen.x, notSeen)), 0.0);
float stainK = unseen.y * notSeen * hasDetail;
if (stainK > 0.0) {
  vec3 sp = vWPos / unseen.z, sk = vec3(detailScale[li] / unseen.z);
  float slum = dot(triRGB(detailDiff, sp, gx * sk, gy * sk, lay, bw), vec3(0.2126, 0.7152, 0.0722));
  albedo *= mix(1.0, slum / detailAvg[li], stainK);
}
float drough = triRGB(detailRough, dp, gx, gy, lay, bw).g;
float detailRoughness = mix(1.0, drough / max(detailRoughAvg[li], 0.05), dmix.z);
vec3 tX = triTap(detailNor, dp.zy, gx.zy, gy.zy, lay, bw.x) * 2.0 - 1.0, tY = triTap(detailNor, dp.xz, gx.xz, gy.xz, lay, bw.y) * 2.0 - 1.0, tZ = triTap(detailNor, dp.xy, gx.xy, gy.xy, lay, bw.z) * 2.0 - 1.0;
tX = vec3(tX.xy + rW.zy, abs(tX.z) * rW.x); tY = vec3(tY.xy + rW.xz, abs(tY.z) * rW.y); tZ = vec3(tZ.xy + rW.xy, abs(tZ.z) * rW.z);
vec3 detailNormal = normalize(mix(rW, normalize(tX.zyx * bw.x + tY.xzy * bw.y + tZ.xyz * bw.z), dmix.y));
diffuseColor.rgb *= albedo;`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = clamp(vPbr.x * detailRoughness, 0.04, 1.0);')
      // Night: lamp lenses (data/look.json real.lamps) glow.
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
totalEmissiveRadiance += vec3(1.0, 0.86, 0.62) * glow * step(0.5, vPbr.w) * 8.0;
// Night: the nearest lamps light the paint (albedo x lamp colour, soft falloff, facing).
${lampGlsl('vWPos', 'rW')}`)
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = vPbr.y;')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = normalize((viewMatrix * vec4(detailNormal, 0.0)).xyz);')
  }
  m.customProgramCacheKey = () => 'soma-real-park'
  return m
}

/** Retune a park material from look.json without recompiling. */
export function retuneParkMaterial(m: THREE.MeshStandardMaterial, look: RealLook) {
  const u = m.userData.uniforms
  u.detailScale.value = LAYERS.map((k) => look.detail[k].scale)
  u.detailMix.value = LAYERS.map((k) => new THREE.Vector4(look.detail[k].albedo, look.detail[k].normal, look.detail[k].rough, 0))
  u.atlasGain.value = look.atlasGain
  u.unseen.value.set(look.unseen.albedo, look.unseen.stains, look.unseen.stainScale)
  u.nearFade.value.set(look.nearFade[0], look.nearFade[1])
}

/**
 * Standard (physically based) twins of the skater's materials for the real look: the
 * asset's own PBR material when it carries one (userData.real: skater and board maps).
 */
export function realSkaterMaterial(src: THREE.Material): THREE.MeshStandardMaterial {
  if (src.userData.real) return readable(src.userData.real as THREE.MeshStandardMaterial)
  const l = src as THREE.MeshLambertMaterial
  return readable(new THREE.MeshStandardMaterial({ color: l.color, map: l.map, vertexColors: l.vertexColors, side: l.side, transparent: l.transparent, opacity: l.opacity, roughness: 0.78, metalness: 0 }))
}

/**
 * The characters always read (the player and the board, and everyone drawn like them): in the real look a soft
 * floor under their light (never darker than albedo x fill, eased in so it never clips flat) and a rim from the
 * edges that face away from the camera (the sky's colour by day, lamplight at night), so a skater in the
 * freeway's shade or a dark room still separates from what is behind. The renderer sets these per frame
 * (data/look.json real.readable, by how night it is).
 */
export const readableUniforms = { charFill: { value: 0 }, charRim: { value: 0 }, charRimColor: { value: new THREE.Color(1, 1, 1) } }
function readable(m: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
  if (m.userData.readable) return m
  m.userData.readable = true
  const prev = m.onBeforeCompile.bind(m), key0 = m.customProgramCacheKey()   // the key before the wrap (the default key is the hook's source)
  m.onBeforeCompile = (sh, r) => {
    prev(sh, r)
    Object.assign(sh.uniforms, readableUniforms)
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float charFill, charRim; uniform vec3 charRimColor;')
      .replace('#include <opaque_fragment>', `{
  // Right at the lens (a room's ceiling camera, a crowd by the door) a character dissolves instead of filling the frame.
  float camD = length(vViewPosition);
  if (camD < 0.9 && smoothstep(0.3, 0.9, camD) < fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))))) discard;
  float ndv = clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
  if (ndv != ndv) ndv = 1.0;   // a degenerate normal: no rim (a NaN here would bloom over the night frame)
  outgoingLight += charRimColor * charRim * pow(1.0 - ndv, 3.0) * mix(vec3(1.0), diffuseColor.rgb, 0.5);
  vec3 floorLight = diffuseColor.rgb * charFill;
  outgoingLight += max(floorLight - outgoingLight, 0.0) * 0.85;
}
#include <opaque_fragment>`)
  }
  m.customProgramCacheKey = () => `${key0}-readable`
  return m
}

/** GTAO at a fraction of the screen (its normal pass and AO pass dominate the frame cost). */
class ScaledGTAOPass extends GTAOPass {
  scale = 0.5
  setSize(width: number, height: number) { super.setSize(Math.max(1, Math.round(width * this.scale)), Math.max(1, Math.round(height * this.scale))) }
  // The AO normal/depth pass draws every visible object with one opaque material: sprites
  // (burritos, letters, pins) and the night beacon would come out as solid black quads.
  // Hide anything transparent or sprite-like for that pass, as three already does for lines.
  _overrideVisibility() {
    const self = this as unknown as { scene: THREE.Scene; _visibilityCache: THREE.Object3D[] }
    self.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | undefined
      if (o.visible && ((o as THREE.Sprite).isSprite || (o as THREE.Points).isPoints || (o as THREE.Line).isLine || (m && !Array.isArray(m) && m.transparent))) { o.visible = false; self._visibilityCache.push(o) }
    })
  }
}

/**
 * Bloom at half the screen (it starts at half again inside): a soft night glow does not need full-res mips.
 * Its bright-pass drops any NaN or infinite texel: one bad pixel (a degenerate normal, a half-float overflow) would
 * otherwise be blurred over the whole frame and turn the night picture black (seen once in a play run).
 */
class HalfBloomPass extends UnrealBloomPass {
  constructor(resolution: THREE.Vector2, strength: number, radius: number, threshold: number) {
    super(resolution, strength, radius, threshold)
    const m = (this as unknown as { materialHighPassFilter: THREE.ShaderMaterial }).materialHighPassFilter
    m.fragmentShader = m.fragmentShader.replace('vec4 texel = texture2D( tDiffuse, vUv );', 'vec4 texel = texture2D( tDiffuse, vUv );\n\t\t\tif ( any( isnan( texel ) ) || any( isinf( texel ) ) ) texel = vec4( 0.0 );')
    m.needsUpdate = true
  }
  setSize(width: number, height: number) { super.setSize(Math.max(1, Math.round(width / 2)), Math.max(1, Math.round(height / 2))) }
}

/**
 * Karl the Fog, rolling in: height fog that is thick near the ground and thins with height
 * (analytic along each view ray), broken into drifting banks by moving noise. Reads the scene's
 * depth; runs before AO in linear light. Only on while the weather asks for it (heightFog > 0).
 */
class HeightFogPass extends ShaderPass {
  private cam: THREE.PerspectiveCamera
  private t0 = performance.now()
  /** Clips drive the drift with their own clock (seconds); null = wall time. */
  clock: number | null = null
  constructor(camera: THREE.PerspectiveCamera) {
    super({
      uniforms: {
        tDiffuse: { value: null }, tDepth: { value: null }, projInv: { value: new THREE.Matrix4() }, camWorld: { value: new THREE.Matrix4() },
        camPos: { value: new THREE.Vector3() }, fogColor: { value: new THREE.Color() }, amount: { value: 0 }, density: { value: 0.03 },
        base: { value: 0 }, falloff: { value: 12 }, noiseScale: { value: 0.025 }, wind: { value: new THREE.Vector2(1.5, 0.6) }, time: { value: 0 }, far: { value: 600 },
      },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform sampler2D tDiffuse, tDepth; uniform mat4 projInv, camWorld; uniform vec3 camPos, fogColor;
uniform float amount, density, base, falloff, noiseScale, time, far; uniform vec2 wind; varying vec2 vUv;
float h3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float vnoise(vec3 x) { vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h3(i), h3(i + vec3(1,0,0)), f.x), mix(h3(i + vec3(0,1,0)), h3(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(h3(i + vec3(0,0,1)), h3(i + vec3(1,0,1)), f.x), mix(h3(i + vec3(0,1,1)), h3(i + vec3(1,1,1)), f.x), f.y), f.z); }
float banks(vec3 p) { vec3 q = p * noiseScale * vec3(1.0, 1.0, 2.5) - vec3(wind * time * noiseScale, time * 0.015); return 0.6 * vnoise(q) + 0.3 * vnoise(q * 2.3 + 11.0) + 0.1 * vnoise(q * 5.1 + 3.0); }
void main() {
  vec4 col = texture2D(tDiffuse, vUv);
  float d = texture2D(tDepth, vUv).x;
  vec4 v = projInv * vec4(vUv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0); v /= v.w;
  vec3 wp = (camWorld * vec4(v.xyz, 1.0)).xyz;
  vec3 ray = wp - camPos; float dist = length(ray); vec3 dir = ray / max(dist, 1e-4);
  if (d >= 1.0) dist = far;
  dist = min(dist, far);
  // Exponential height fog integrated along the ray.
  float k = 1.0 / falloff, dz = dir.z * dist * k;
  float att = density * exp(-(camPos.z - base) * k);
  float integral = abs(dz) > 1e-3 ? att * dist * (1.0 - exp(-dz)) / dz : att * dist;
  // Drifting banks: patchy noise near and far along the ray (clear gaps and thick walls).
  float nNear = banks(camPos + dir * min(dist, 28.0)), nFar = banks(camPos + dir * min(dist, 110.0));
  float n = mix(nNear, nFar, smoothstep(20.0, 120.0, dist));
  n = smoothstep(0.38, 0.72, n) * 2.6 + 0.08;
  float f = (1.0 - exp(-integral * n)) * amount;
  gl_FragColor = vec4(mix(col.rgb, fogColor, clamp(f, 0.0, 0.97)), col.a);
}`,
    })
    this.cam = camera
  }
  render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget, deltaTime: number, maskActive: boolean) {
    const u = this.uniforms as Record<string, THREE.IUniform>
    u.tDepth.value = readBuffer.depthTexture
    u.projInv.value.copy(this.cam.projectionMatrixInverse); u.camWorld.value.copy(this.cam.matrixWorld)
    u.camPos.value.setFromMatrixPosition(this.cam.matrixWorld); u.far.value = this.cam.far * 0.95
    u.time.value = this.clock ?? (performance.now() - this.t0) / 1000
    super.render(renderer, writeBuffer, readBuffer, deltaTime, maskActive)
  }
}

/**
 * The film pass, last in the chain and in display space (after tone mapping): the look of a 2002 skate video.
 * One full-screen pass doing all of it: a film curve (lifted blacks, a soft shoulder, contrast about mid grey,
 * saturation), a split tone (cool shadows, warm highlights), the filmer's lens (barrel distortion: the render is
 * made wider by fit, see lensFit, and bent back so the middle keeps its scale and the edges bow; darker corners),
 * a little luminance grain at one CSS pixel, and the PS2 picture's ordered dither.
 */
const FILM_FRAG = /* glsl */ `uniform sampler2D tDiffuse;
uniform float contrast, saturation, vignette, lift, shoulder, split, grain, grainScale, seed, lensK, lensFit, aspect, lensVig, levels;
uniform vec3 warm, cool;
varying vec2 vUv;
float hash(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float bayer4(vec2 p) {
  ivec2 q = ivec2(mod(floor(p), 4.0));
  float m[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
  return (m[q.y * 4 + q.x] + 0.5) / 16.0;
}
void main() {
  vec2 q = (vUv * 2.0 - 1.0) * vec2(aspect, 1.0);
  float r2 = dot(q, q);
  vec2 uv = vUv;
  if (lensK > 0.0) uv = q * (1.0 + lensK * r2) / lensFit / vec2(aspect, 1.0) * 0.5 + 0.5;
  vec3 c = texture2D(tDiffuse, uv).rgb;
  // Film curve: a soft shoulder rolls the top off, contrast about mid grey, then the blacks lift (faded stock).
  c = c / (1.0 + shoulder * c * c * c * c) * (1.0 + shoulder);
  c = clamp((c - 0.5) * contrast + 0.5, 0.0, 1.0);
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, saturation);
  // Split tone: shadows lean cool, highlights warm (multiplied, so mid grey stays grey).
  c *= mix(vec3(1.0), mix(cool, warm, smoothstep(0.1, 0.75, l)), split);
  c = lift + (1.0 - lift) * c;
  // The lens's corners: the base vignette plus the fisheye's own falloff.
  float rr = r2 / (aspect * aspect + 1.0);
  c *= 1.0 - vignette * smoothstep(0.25, 1.0, rr) - lensVig * lensK * 6.0 * rr * rr;
  // Grain: one CSS pixel, stronger in the shadows and mids than the highlights.
  if (grain > 0.0) {
    vec2 gp = floor(gl_FragCoord.xy / grainScale);
    float n = hash(gp + seed * 17.13) + hash(gp * 1.7 + seed * 5.31) - 1.0;
    c += n * grain * (1.0 - 0.7 * l);
  }
  // PS2 picture: an ordered dither down to a few levels per channel.
  if (levels > 0.0) c = floor(c * (levels - 1.0) + bayer4(gl_FragCoord.xy)) / (levels - 1.0);
  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`

/** The fisheye's fit: how much wider (in tangent) the render must be for the bent picture to reach the corners. */
export const lensFit = (k: number, aspect: number) => 1 + k * (aspect * aspect + 1)

/** Render path for the real look: scene → ambient occlusion → tone map and output → film. */
export class RealPass {
  private composer: EffectComposer
  private gtao: ScaledGTAOPass
  private grade: ShaderPass
  /** Night glow around lamps; off in daylight (it costs a few passes). */
  readonly bloom: UnrealBloomPass
  /** Karl the Fog's rolling banks (height fog), on in that weather only. */
  private fog: HeightFogPass
  private size = new THREE.Vector2()

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, look: RealLook) {
    const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4, depthTexture: new THREE.DepthTexture(1, 1) })
    this.composer = new EffectComposer(renderer, rt)
    this.composer.addPass(new RenderPass(scene, camera))
    this.fog = new HeightFogPass(camera)
    this.fog.enabled = false
    this.composer.addPass(this.fog)
    this.gtao = new ScaledGTAOPass(scene, camera, 1, 1)
    this.composer.addPass(this.gtao)
    this.bloom = new HalfBloomPass(new THREE.Vector2(256, 256), 0.7, 0.5, 0.85)
    this.bloom.enabled = false
    this.composer.addPass(this.bloom)
    this.composer.addPass(new OutputPass())
    // The film pass, in display space after tone mapping (FILM_FRAG); it replaces the old grade at the same cost.
    this.grade = new ShaderPass({
      uniforms: {
        tDiffuse: { value: null }, contrast: { value: 1 }, saturation: { value: 1 }, vignette: { value: 0 },
        lift: { value: 0 }, shoulder: { value: 0 }, split: { value: 0 }, warm: { value: new THREE.Vector3(1, 1, 1) }, cool: { value: new THREE.Vector3(1, 1, 1) },
        grain: { value: 0 }, grainScale: { value: 1 }, seed: { value: 0 }, lensK: { value: 0 }, lensFit: { value: 1 }, aspect: { value: 16 / 9 }, lensVig: { value: 0 }, levels: { value: 0 },
      },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: FILM_FRAG,
    })
    this.composer.addPass(this.grade)
    this.setLook(look)
  }

  /** The lens this frame: barrel strength k (0 = none) at this aspect (Renderer.setCamera widens the camera by lensFit). */
  setLens(k: number, aspect: number) {
    const g = this.grade.uniforms
    g.lensK.value = k; g.aspect.value = aspect; g.lensFit.value = lensFit(k, aspect)
  }
  /** PS2 picture: dither levels per channel (0 = off). */
  setDither(levels: number) { this.grade.uniforms.levels.value = levels }
  private frame = 0

  /** Night: contact shadows barely show in the dark and are the frame's biggest cost; bloom takes their budget. */
  private aoOn = true
  private aoAllowed = true
  private night = 0
  setNight(k: number) { this.night = k; this.gtao.enabled = this.aoOn && this.aoAllowed && this.aoPreset && k < 0.5 }
  /**
   * The quality preset: ambient occlusion on or off, and the multisampling of the scene target (0 on
   * low: the biggest fill cost on a phone).
   */
  private aoPreset = true
  /** The preset's scale on the look's ambient occlusion resolution (ultra draws it finer). */
  private aoScale = 1
  private aoRes = 0.5
  setQuality(ao: boolean, msaa: number, aoScale = 1) {
    this.aoPreset = ao
    if (aoScale !== this.aoScale) { this.aoScale = aoScale; this.gtao.scale = Math.min(1, this.aoRes * aoScale); (this.composer as unknown as { _width: number })._width = -1 }
    this.setNight(this.night)
    const c = this.composer as unknown as { renderTarget1: THREE.WebGLRenderTarget; renderTarget2: THREE.WebGLRenderTarget }
    for (const t of [c.renderTarget1, c.renderTarget2]) if (t.samples !== msaa) { t.samples = msaa; t.dispose() }
  }
  /** Split screen can turn ambient occlusion off (data/split.json ao) to keep the frame rate. */
  allowAo(on: boolean) { this.aoAllowed = on; this.setNight(this.night) }
  /** The fog's drift clock for clips (seconds), or null for wall time. */
  setFogClock(t: number | null) { this.fog.clock = t }
  /** Height fog amount (0 = off) in this colour; numbers from data/look.json real.heightFog. */
  setHeightFog(k: number, color: THREE.Color, look: RealLook) {
    const H = look.heightFog, u = this.fog.uniforms as Record<string, THREE.IUniform>
    this.fog.enabled = !!H && k > 0.01
    if (!H) return
    u.amount.value = k; u.fogColor.value.copy(color); u.density.value = H.density; u.base.value = H.base; u.falloff.value = H.falloff
    u.noiseScale.value = H.noiseScale; u.wind.value.set(H.wind[0], H.wind[1])
  }

  setLook(look: RealLook) {
    this.aoOn = look.ao.intensity > 0
    this.gtao.enabled = look.ao.intensity > 0 && this.aoAllowed && this.aoPreset && this.night < 0.5
    this.aoRes = look.ao.resolution
    const res = Math.min(1, look.ao.resolution * this.aoScale)
    if (this.gtao.scale !== res) { this.gtao.scale = res; (this.composer as unknown as { _width: number })._width = -1 }
    this.gtao.blendIntensity = look.ao.intensity
    if (look.bloom) { this.bloom.strength = look.bloom.strength; this.bloom.radius = look.bloom.radius; this.bloom.threshold = look.bloom.threshold }
    this.gtao.updateGtaoMaterial({ radius: look.ao.radius, distanceExponent: 1.5, thickness: 1, scale: 1, samples: look.ao.samples ?? 16 })
    this.gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: look.ao.denoise ?? 16 })
    const g = this.grade.uniforms, F = look.film
    g.contrast.value = look.grade.contrast; g.saturation.value = look.grade.saturation; g.vignette.value = look.grade.vignette
    g.lift.value = F?.lift ?? 0; g.shoulder.value = F?.shoulder ?? 0; g.split.value = F?.split ?? 0; g.grain.value = F?.grain ?? 0
    g.warm.value.set(...(F?.warm ?? [1, 1, 1])); g.cool.value.set(...(F?.cool ?? [1, 1, 1])); g.lensVig.value = F?.lens.vignette ?? 0
  }

  /** rect: a part of the canvas (split screen; CSS px), drawn through the renderer's viewport and scissor. */
  render(renderer: THREE.WebGLRenderer, rect: { w: number; h: number } | null = null) {
    renderer.getDrawingBufferSize(this.size)
    const pr = renderer.getPixelRatio()
    const w = rect ? rect.w : Math.round(this.size.x / pr), h = rect ? rect.h : Math.round(this.size.y / pr)
    const cmp = this.composer as unknown as { _width: number; _height: number; _pixelRatio: number }
    if (cmp._width !== w || cmp._height !== h || cmp._pixelRatio !== pr) {
      this.composer.setPixelRatio(pr)
      this.composer.setSize(w, h)
    }
    // Grain moves every frame (clips: with their own clock), one CSS pixel per grain.
    const g = this.grade.uniforms, clock = this.fog.clock
    g.grainScale.value = Math.max(1, pr); g.seed.value = clock !== null ? Math.floor(clock * 30) % 997 : (this.frame = (this.frame + 1) % 997)
    this.composer.render()
  }
}
