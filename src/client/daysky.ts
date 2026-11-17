import * as THREE from 'three'

// The real look's day sky: a dome on the camera, drawn where nothing else is (as the night sky is), so the city
// fades into its horizon (the renderer makes the fog that colour: haze takes the sky's colour). A gradient from
// a warm hazy horizon to the zenith, the sun's glow round where the sun is, and thin streaks of cloud (value noise
// on a plane overhead; lit warm toward the sun, shaded away from it).
// Numbers in data/look.json real.daySky (and per weather); fades out at night and in fog.

export type DaySkyLook = { zenith: string; horizon: string; sunGlow: string; glow: number; clouds: number; cloudColor: string; cloudShade: string }

export class DaySky {
  readonly mesh: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>
  constructor(look: DaySkyLook) {
    const c = (h: string) => new THREE.Color(h)
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), new THREE.ShaderMaterial({
      uniforms: {
        k: { value: 0 }, zenith: { value: c(look.zenith) }, horizon: { value: c(look.horizon) }, sunGlow: { value: c(look.sunGlow) }, glow: { value: look.glow },
        clouds: { value: look.clouds }, cloudColor: { value: c(look.cloudColor) }, cloudShade: { value: c(look.cloudShade) },
        sunDir: { value: new THREE.Vector3(0, -1, 1).normalize() }, turn: { value: 0 },
      },
      vertexShader: 'varying vec3 vDir; void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: /* glsl */ `uniform float k, glow, clouds, turn; uniform vec3 zenith, horizon, sunGlow, cloudColor, cloudShade, sunDir; varying vec3 vDir;
        float h2(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
        float vnoise(vec2 x) { vec2 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f); return mix(mix(h2(i), h2(i + vec2(1.0, 0.0)), f.x), mix(h2(i + vec2(0.0, 1.0)), h2(i + vec2(1.0, 1.0)), f.x), f.y); }
        void main() {
          vec3 d = normalize(vDir);
          float e = d.z, s = max(dot(d, sunDir), 0.0);
          vec3 col = mix(horizon, zenith, pow(smoothstep(-0.02, 0.62, e), 0.75));
          // The sun's glow: wide and faint, then a tight bright core (no disc: the photo look keeps it soft).
          col += sunGlow * glow * (0.22 * pow(s, 6.0) + 0.55 * pow(s, 48.0) + 1.4 * pow(s, 900.0)) * smoothstep(-0.1, 0.05, e);
          // Cloud: thin drifts of value noise on a plane overhead (stretched one way, so they streak), thinning into the haze.
          if (clouds > 0.0 && e > 0.0) {
            vec2 p = vec2(cos(turn) * d.x - sin(turn) * d.y, sin(turn) * d.x + cos(turn) * d.y) / (e + 0.12);
            p *= vec2(0.55, 1.4);
            float n = 0.0, w = 0.5;
            for (int i = 0; i < 3; i++) { n += w * vnoise(p); p = p * 2.03 + vec2(1.7, 9.2); w *= 0.5; }
            float cov = smoothstep(0.44, 0.7, n) * clouds * smoothstep(0.03, 0.3, e);
            vec3 cc = mix(cloudShade, cloudColor, 0.35 + 0.65 * pow(s, 2.0));
            col = mix(col, cc, cov);
          }
          gl_FragColor = vec4(col, k);
        }`,
      side: THREE.BackSide, transparent: true, depthWrite: false, fog: false,
    }))
    this.mesh.renderOrder = -11
    this.mesh.frustumCulled = false
    this.mesh.visible = false
  }

  /** Colours and amounts (a weather blend), the sun's direction (toward it), the clouds' turn (degrees, the sky's turn). */
  set(zenith: THREE.Color, horizon: THREE.Color, sunGlow: THREE.Color, glow: number, clouds: number, sunDir: THREE.Vector3, turn: number) {
    const u = this.mesh.material.uniforms
    u.zenith.value.copy(zenith); u.horizon.value.copy(horizon); u.sunGlow.value.copy(sunGlow); u.glow.value = glow
    u.clouds.value = clouds; u.sunDir.value.copy(sunDir).normalize(); u.turn.value = THREE.MathUtils.degToRad(turn)
  }
  setCloudLook(look: DaySkyLook) { const u = this.mesh.material.uniforms; u.cloudColor.value.set(look.cloudColor); u.cloudShade.value.set(look.cloudShade) }

  /** Every frame: k = how much day sky (0 night or fog .. 1); sits on the camera just inside the far plane. */
  update(camera: THREE.PerspectiveCamera, k: number) {
    this.mesh.visible = k > 0.01
    if (!this.mesh.visible) return
    this.mesh.position.copy(camera.position)
    this.mesh.scale.setScalar(camera.far * 0.92)
    this.mesh.material.uniforms.k.value = k
  }
}
