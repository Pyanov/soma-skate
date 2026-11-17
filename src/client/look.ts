import * as THREE from 'three'
import type { ParkSource } from '../sim/park/source.ts'
import type { Look } from '../data/schema.ts'
import { realSkaterMaterial } from './real.ts'

// The cute look: painted park, toon light, ink outlines, sky. Numbers and colours come
// from data/look.json. Draw-only; nothing here touches the sim.

type Element = ParkSource['elements'][number]

/** Paint for one park element: id, id pattern, role, feature type, collection, then default. */
export function paintFor(look: Look, e: Element, featureType: string, buildingIndex: number): number {
  const P = look.paint
  const hex = P.id[e.id]
    ?? P.idPattern.find(([re]) => new RegExp(re).test(e.id))?.[1]
    ?? (e.role ? P.role[e.role] : undefined)
    ?? (e.collection === 'obstacles' ? P.type[featureType] : undefined)
    ?? (e.collection === 'buildings' ? P.buildings[buildingIndex % P.buildings.length] : undefined)
    ?? P.collection[e.collection]
    ?? P.default
  return new THREE.Color(hex).getHex()
}

/** Light levels for MeshToonMaterial: hard steps from shadow to full sun. */
export function toonGradient(bands: number[]): THREE.DataTexture {
  const data = new Uint8Array(bands.length * 4)
  bands.forEach((b, i) => { const v = Math.round(Math.min(1, b) * 255); data.set([v, v, v, 255], i * 4) })
  const t = new THREE.DataTexture(data, bands.length, 1, THREE.RGBAFormat)
  t.minFilter = t.magFilter = THREE.NearestFilter
  t.generateMipmaps = false
  t.needsUpdate = true
  return t
}

/**
 * Toon material. mottle > 0 adds soft, large blotches of lighter and darker paint in world
 * space (two octaves of value noise), so big flat slabs read as painted concrete.
 */
export function toonMaterial(params: THREE.MeshToonMaterialParameters, gradient: THREE.Texture, mottle = 0, tag = 1): THREE.MeshToonMaterial {
  const m = new THREE.MeshToonMaterial({ ...params, gradientMap: gradient })
  if (mottle > 0 || tag !== 1) {
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uMottle = { value: mottle }
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWorldPos;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;')
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
varying vec3 vWorldPos;
uniform float uMottle;
float lookHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float lookNoise(vec3 x) {
  vec3 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(lookHash(i), lookHash(i + vec3(1, 0, 0)), f.x), mix(lookHash(i + vec3(0, 1, 0)), lookHash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(lookHash(i + vec3(0, 0, 1)), lookHash(i + vec3(1, 0, 1)), f.x), mix(lookHash(i + vec3(0, 1, 1)), lookHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}`)
        .replace('#include <color_fragment>', `#include <color_fragment>
float lookN = lookNoise(vWorldPos * 0.45) * 0.65 + lookNoise(vWorldPos * 1.7) * 0.35;
diffuseColor.rgb *= 1.0 + uMottle * (lookN - 0.5) * 2.0;`)
        // Alpha carries a tag for the ink pass: 1 park and skater, 0.5 context, 0 sky.
        .replace('#include <opaque_fragment>', `#include <opaque_fragment>\ngl_FragColor.a = ${tag.toFixed(2)};`)
    }
    m.customProgramCacheKey = () => `mottle${mottle}tag${tag}`
  }
  return m
}

/** Swap every Lambert material under root for a toon one (skater and board). Keeps the originals for grey. */
export function toonify(root: THREE.Object3D, gradient: THREE.Texture) {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh
    const mats = mesh.material ? (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) : []
    if (!mats.length || !(mats[0] instanceof THREE.MeshLambertMaterial)) return
    const toon = mats.map((m) => {
      const l = m as THREE.MeshLambertMaterial
      return toonMaterial({ color: l.color, map: l.map, vertexColors: l.vertexColors, side: l.side, transparent: l.transparent, opacity: l.opacity, alphaTest: l.alphaTest }, gradient)
    })
    const real = mats.map(realSkaterMaterial)
    mesh.userData.looks = { grey: mesh.material, cute: Array.isArray(mesh.material) ? toon : toon[0], real: Array.isArray(mesh.material) ? real : real[0] }
  })
}

/** Point every toonified mesh under root at one style's materials. */
export function applyMaterials(root: THREE.Object3D, style: 'real' | 'cute' | 'grey') {
  root.traverse((o) => {
    const looks = o.userData.looks as { grey: THREE.Material; cute: THREE.Material; real: THREE.Material } | undefined
    if (looks) (o as THREE.Mesh).material = looks[style]
  })
}

/** A sky dome: warm horizon to blue top, drawn behind everything (no depth, so outlines see the sky as far). */
export function makeSky(look: Look): THREE.Mesh {
  const m = new THREE.ShaderMaterial({
    uniforms: {
      top: { value: new THREE.Color(look.sky.top) },
      horizon: { value: new THREE.Color(look.sky.horizon) },
      below: { value: new THREE.Color(look.sky.below) },
    },
    vertexShader: `varying vec3 vDir;
void main() { vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }`,
    fragmentShader: `uniform vec3 top, horizon, below; varying vec3 vDir;
void main() {
  float h = vDir.z;
  vec3 c = h > 0.0 ? mix(horizon, top, pow(smoothstep(0.0, 0.55, h), 0.8)) : mix(horizon, below, smoothstep(0.0, 0.15, -h));
  gl_FragColor = vec4(c, 0.0);
  #include <colorspace_fragment>
}`,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
  })
  const sky = new THREE.Mesh(new THREE.SphereGeometry(400, 32, 16), m)
  sky.renderOrder = -10
  sky.frustumCulled = false
  return sky
}

/** Puffy low-poly clouds in a ring far out (fixed layout, so shots repeat). */
export function makeClouds(gradient: THREE.Texture): THREE.Group {
  const g = new THREE.Group()
  const mat = toonMaterial({ color: 0xffffff, emissive: 0x6d7fa3, emissiveIntensity: 0.35 }, gradient, 0, 0.5)
  const ball = new THREE.IcosahedronGeometry(1, 1)
  let seed = 7
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 }
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2 + rnd() * 0.3
    const r = 170 + rnd() * 90
    const cloud = new THREE.Group()
    cloud.position.set(40 + Math.cos(a) * r, 20 + Math.sin(a) * r, 45 + rnd() * 35)
    const n = 4 + Math.floor(rnd() * 3)
    for (let k = 0; k < n; k++) {
      const m = new THREE.Mesh(ball, mat)
      const s = 7 + rnd() * 6
      m.scale.set(s, s, s * 0.75)
      m.position.set((k - n / 2) * 8 + rnd() * 3, rnd() * 5, (k === 0 || k === n - 1 ? -2 : 1) * rnd() * 3)
      cloud.add(m)
    }
    cloud.rotation.z = a + Math.PI / 2
    g.add(cloud)
  }
  return g
}

/**
 * Ink outlines from the depth buffer. 1/z is linear across any flat face in screen space,
 * so its second difference is zero on faces and jumps at silhouettes and folds: a line
 * wherever it is large relative to 1/z itself. Lines darken toward the ink colour and fade
 * with distance like the fog.
 */
export class InkPass {
  private rt: THREE.WebGLRenderTarget
  private quad: THREE.Mesh
  private mat: THREE.ShaderMaterial
  private ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  private scene = new THREE.Scene()
  private width = 1

  constructor(look: Look) {
    this.rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 })
    this.rt.depthTexture = new THREE.DepthTexture(1, 1, THREE.FloatType)
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        tColor: { value: this.rt.texture },
        tDepth: { value: this.rt.depthTexture },
        texel: { value: new THREE.Vector2() },
        near: { value: 0.05 }, far: { value: 600 },
        ink: { value: new THREE.Color() }, width: { value: 1 }, crease: { value: 0.1 }, strength: { value: 0.8 },
        fade: { value: new THREE.Vector2(40, 150) },
      },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: `#include <packing>
uniform sampler2D tColor, tDepth; uniform vec2 texel, fade; uniform float near, far, width, crease, strength; uniform vec3 ink;
varying vec2 vUv;
float viewDist(vec2 uv) { return -perspectiveDepthToViewZ(texture2D(tDepth, uv).x, near, far); }
void main() {
  vec4 c4 = texture2D(tColor, vUv);
  vec3 c = c4.rgb;
  float z = viewDist(vUv);
  vec2 ox = vec2(texel.x * width, 0.0), oy = vec2(0.0, texel.y * width);
  // Tag (alpha): context (0.5) gets fewer, fainter lines; park and skater (1) or sky (0) full ones.
  float tag = max(max(max(texture2D(tColor, vUv - ox).a, texture2D(tColor, vUv + ox).a), max(texture2D(tColor, vUv - oy).a, texture2D(tColor, vUv + oy).a)), c4.a);
  float ctx = tag > 0.25 && tag < 0.75 ? 1.0 : 0.0;
  float w = 1.0 / z;
  float lap = abs(1.0 / viewDist(vUv - ox) + 1.0 / viewDist(vUv + ox) - 2.0 * w)
            + abs(1.0 / viewDist(vUv - oy) + 1.0 / viewDist(vUv + oy) - 2.0 * w);
  float zn = min(min(viewDist(vUv - ox), viewDist(vUv + ox)), min(min(viewDist(vUv - oy), viewDist(vUv + oy)), z));
  // Far away a fold needs to be sharper to get a line, so fine detail does not turn to hatching.
  float k = crease * (1.0 + zn / 40.0) * (1.0 + ctx * 4.0);
  float edge = smoothstep(k, k * 2.5, lap / w) * (1.0 - smoothstep(fade.x, fade.y, zn)) * (1.0 - ctx * 0.45);
  vec3 inked = mix(c * 0.3, ink, 0.55);
  gl_FragColor = vec4(mix(c, inked, edge * strength), 1.0);
  #include <colorspace_fragment>
}`,
      depthTest: false,
      depthWrite: false,
    })
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat)
    this.quad.frustumCulled = false
    this.scene.add(this.quad)
    this.setLook(look)
  }

  setLook(look: Look) {
    const u = this.mat.uniforms, o = look.outline
    u.ink.value.set(o.ink); this.width = o.width; u.crease.value = o.crease; u.strength.value = o.strength
    u.fade.value.set(o.fade[0], o.fade[1])
  }

  /** rect: a part of the canvas (split screen; CSS px), drawn through the renderer's viewport and scissor. */
  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, rect: { w: number; h: number } | null = null) {
    const pr = renderer.getPixelRatio()
    const size = rect ? new THREE.Vector2(Math.round(rect.w * pr), Math.round(rect.h * pr)) : renderer.getDrawingBufferSize(new THREE.Vector2())
    if (this.rt.width !== size.x || this.rt.height !== size.y) this.rt.setSize(size.x, size.y)
    const u = this.mat.uniforms
    u.texel.value.set(1 / size.x, 1 / size.y)
    u.near.value = camera.near; u.far.value = camera.far
    u.width.value = this.width * renderer.getPixelRatio()
    renderer.setRenderTarget(this.rt)
    renderer.render(scene, camera)
    renderer.setRenderTarget(null)
    renderer.render(this.scene, this.ortho)
  }
}
