import * as THREE from 'three'

// The real look's night sky: a gradient dome (the fog colour at the horizon so the city fades into
// it, a warm band of city glow above, a dark zenith), sparse twinkling stars that the glow washes
// out low down, and the moon with a halo. Follows the camera; fades with the night amount.
// Numbers in data/look.json real.nightSky.

export type NightSkyLook = {
  zenith: string; horizon: string; glow: string; glowHeight: number
  stars: number; starBrightness: number
  moon: { dir: [number, number, number]; size: number; color: string; halo: number }
}

function rng(seed: number) {
  let a = seed >>> 0
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}

/** A moon disc with soft maria and a limb, on a transparent canvas (the halo is the sprite behind it). */
function moonTexture(): THREE.CanvasTexture {
  const n = 256, c = document.createElement('canvas'); c.width = c.height = n
  const g = c.getContext('2d')!, r = rng(42)
  const disc = g.createRadialGradient(n * 0.45, n * 0.42, n * 0.05, n / 2, n / 2, n * 0.48)
  disc.addColorStop(0, '#fffdf4'); disc.addColorStop(0.8, '#ece6d6'); disc.addColorStop(1, '#cfc6b2')
  g.fillStyle = disc; g.beginPath(); g.arc(n / 2, n / 2, n * 0.48, 0, Math.PI * 2); g.fill()
  g.save(); g.beginPath(); g.arc(n / 2, n / 2, n * 0.48, 0, Math.PI * 2); g.clip()
  for (const [x, y, s, a] of [[0.38, 0.36, 0.16, 0.22], [0.58, 0.32, 0.11, 0.18], [0.62, 0.55, 0.14, 0.2], [0.42, 0.62, 0.09, 0.14], [0.3, 0.5, 0.07, 0.12]]) {
    const m = g.createRadialGradient(x * n, y * n, 0, x * n, y * n, s * n)
    m.addColorStop(0, `rgba(120,115,105,${a})`); m.addColorStop(1, 'rgba(120,115,105,0)')
    g.fillStyle = m; g.fillRect(0, 0, n, n)
  }
  for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(110,105,95,${0.05 + r() * 0.08})`; g.beginPath(); g.arc(r() * n, r() * n, 1 + r() * 4, 0, Math.PI * 2); g.fill() }
  g.restore()
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace
  return t
}

function haloTexture(): THREE.CanvasTexture {
  const n = 128, c = document.createElement('canvas'); c.width = c.height = n
  const g = c.getContext('2d')!, h = g.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2)
  h.addColorStop(0, 'rgba(255,255,255,0.55)'); h.addColorStop(0.2, 'rgba(255,255,255,0.18)'); h.addColorStop(0.55, 'rgba(255,255,255,0.04)'); h.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = h; g.fillRect(0, 0, n, n)
  return new THREE.CanvasTexture(c)
}

export class NightSky {
  readonly group = new THREE.Group()
  private dome: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>
  private stars: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>
  private moon: THREE.Sprite
  private halo: THREE.Sprite
  private look: NightSkyLook
  private time = 0

  constructor(look: NightSkyLook) {
    this.look = look
    this.group.name = 'night-sky'
    this.group.visible = false
    const c = (h: string) => new THREE.Color(h)
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), new THREE.ShaderMaterial({
      uniforms: { k: { value: 0 }, zenith: { value: c(look.zenith) }, horizon: { value: c(look.horizon) }, glow: { value: c(look.glow) }, glowHeight: { value: look.glowHeight } },
      vertexShader: 'varying vec3 vDir; void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform float k; uniform vec3 zenith, horizon, glow; uniform float glowHeight; varying vec3 vDir;
        void main() {
          float e = normalize(vDir).z;
          vec3 col = mix(horizon, zenith, smoothstep(0.0, 0.55, e));
          col += glow * exp(-max(e, 0.0) / glowHeight) * smoothstep(-0.02, 0.03, e);
          gl_FragColor = vec4(col, k);
        }`,
      side: THREE.BackSide, transparent: true, depthWrite: false, fog: false,
    }))
    this.dome.renderOrder = -10; this.dome.frustumCulled = false
    // Stars on the upper hemisphere: position on the unit sphere, size, base brightness, twinkle phase.
    const r = rng(7), n = look.stars, pos = new Float32Array(n * 3), attr = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) {
      const z = 0.06 + Math.pow(r(), 0.7) * 0.94, a = r() * Math.PI * 2, s = Math.sqrt(1 - z * z)
      pos.set([Math.cos(a) * s, Math.sin(a) * s, z], i * 3)
      const mag = Math.pow(r(), 3)   // a few bright, many faint
      attr.set([1.2 + mag * 2.6, 0.25 + mag * 0.75, r() * 6.28], i * 3)
    }
    const sg = new THREE.BufferGeometry()
    sg.setAttribute('position', new THREE.BufferAttribute(pos, 3)); sg.setAttribute('star', new THREE.BufferAttribute(attr, 3))
    this.stars = new THREE.Points(sg, new THREE.ShaderMaterial({
      uniforms: { k: { value: 0 }, time: { value: 0 }, bright: { value: look.starBrightness }, glowHeight: { value: look.glowHeight }, px: { value: 1 } },
      vertexShader: `attribute vec3 star; uniform float time, bright, glowHeight, px; varying float vA;
        void main() {
          float tw = 0.75 + 0.25 * sin(time * (1.3 + star.z * 0.4) + star.z * 7.0);
          float wash = smoothstep(glowHeight * 0.6, glowHeight * 3.5, position.z);   // the city glow drowns the low ones
          vA = star.y * tw * wash * bright;
          gl_PointSize = star.x * px;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `uniform float k; varying float vA;
        void main() { vec2 d = gl_PointCoord - 0.5; float a = smoothstep(0.5, 0.0, length(d)); gl_FragColor = vec4(vec3(0.92, 0.95, 1.0) * vA, a * vA * k); }`,
      transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending,
    }))
    this.stars.renderOrder = -9; this.stars.frustumCulled = false
    this.halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTexture(), color: c(look.moon.color), transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending }))
    this.moon = new THREE.Sprite(new THREE.SpriteMaterial({ map: moonTexture(), color: c(look.moon.color), transparent: true, depthWrite: false, fog: false }))
    this.halo.renderOrder = -8; this.moon.renderOrder = -7
    this.group.add(this.dome, this.stars, this.halo, this.moon)
  }

  setLook(look: NightSkyLook) {
    this.look = look
    const u = this.dome.material.uniforms
    u.zenith.value.set(look.zenith); u.horizon.value.set(look.horizon); u.glow.value.set(look.glow); u.glowHeight.value = look.glowHeight
    this.stars.material.uniforms.bright.value = look.starBrightness; this.stars.material.uniforms.glowHeight.value = look.glowHeight
    this.moon.material.color.set(look.moon.color); this.halo.material.color.set(look.moon.color)
  }

  /** Every frame: k = how much night (0..1); the sky sits on the camera, just inside the far plane. */
  update(camera: THREE.PerspectiveCamera, k: number, dt: number, pixelRatio: number) {
    this.group.visible = k > 0.01
    if (!this.group.visible) return
    this.time += dt
    const R = camera.far * 0.9
    this.group.position.copy(camera.position)
    this.dome.scale.setScalar(R); this.stars.scale.setScalar(R)
    this.dome.material.uniforms.k.value = k
    const su = this.stars.material.uniforms; su.k.value = k; su.time.value = this.time; su.px.value = pixelRatio
    const m = this.look.moon, d = new THREE.Vector3(...m.dir).normalize().multiplyScalar(R * 0.95)
    const size = 2 * R * 0.95 * Math.tan((m.size * Math.PI) / 360)
    this.moon.position.copy(d); this.moon.scale.setScalar(size)
    this.halo.position.copy(d); this.halo.scale.setScalar(size * 9)
    this.moon.material.opacity = k; this.halo.material.opacity = k * m.halo
  }
}
