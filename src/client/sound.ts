import type { SimEvent } from '../sim/sim.ts'
import type { Thing } from '../sim/thing.ts'
import { Btn } from '../sim/input.ts'
import { raycast, Surface, type Park } from '../sim/park/park.ts'
import type { ParkSource } from '../sim/park/source.ts'
import { soundSchema, type SoundData } from './sound-data.ts'
import { VoiceLines } from './voicelines.ts'

// The game's sound, driven by sim events and the skater's state; numbers in
// data/sound.json. Wheels, grinds, slides, wind, the freeway overhead, sirens and score
// bells are synthesized; board, body and footstep hits are CC0 samples (assets/sound).
//
// Every call takes the audio time to act at, so the same code plays live (an
// AudioContext, now) and renders clips offline (an OfflineAudioContext, tick / 120):
// `./skate clip` turns a replay into a video with this exact sound. Randomness comes
// from a seeded generator, so a clip's sound repeats too.

type Loop = { gain: GainNode; filters: BiquadFilterNode[]; src: AudioBufferSourceNode }
type Kind = keyof SoundData['surfaces']['kinds']

/**
 * A vignette's loop, synthesized once: the busker's strummed chords (plucked strings, G C D Em), the drum circle's
 * djembes (bass, tone and slap) or a boombox breakbeat with a bass line.
 */
function vignetteBuffer(ctx: BaseAudioContext, kind: string): AudioBuffer {
  const sr = ctx.sampleRate, secs = kind === 'guitar' ? 8 : 4, n = Math.floor(sr * secs)
  const buf = ctx.createBuffer(1, n, sr), out = buf.getChannelData(0), r = rng(kind.length * 977)
  const pluck = (at: number, hz: number, vol: number, len = 1.6) => {
    // Karplus-Strong: a burst of noise round a delay line, averaged as it loops.
    const N = Math.max(2, Math.round(sr / hz)), line = new Float32Array(N)
    for (let i = 0; i < N; i++) line[i] = (r() * 2 - 1) * vol
    const start = Math.floor(at * sr), end = Math.min(n, start + Math.floor(len * sr))
    for (let i = start, j = 0; i < end; i++, j++) { const k = j % N, nx = (k + 1) % N; const y = line[k]; line[k] = 0.5 * (line[k] + line[nx]) * 0.996; out[i % n] += y }
  }
  const hit = (at: number, f0: number, f1: number, decay: number, vol: number, noise = 0) => {
    const start = Math.floor(at * sr)
    for (let j = 0, ph = 0; j < sr * decay * 5; j++) {
      const t = j / sr, f = f1 + (f0 - f1) * Math.exp(-t * 30), e = Math.exp(-t / decay)
      ph += (2 * Math.PI * f) / sr
      out[(start + j) % n] += (Math.sin(ph) * (1 - noise) + (r() * 2 - 1) * noise) * e * vol
    }
  }
  if (kind === 'guitar') {
    const chords = [[98, 123.5, 147, 196, 247], [130.8, 164.8, 196, 261.6, 329.6], [146.8, 185, 220, 293.7, 370], [82.4, 123.5, 164.8, 196, 247]]   // G C D Em
    for (let bar = 0; bar < 4; bar++) for (let b = 0; b < 4; b++) {
      const at = bar * 2 + b * 0.5, down = b % 2 === 0
      chords[bar].forEach((hz, i) => pluck(at + (down ? i : 4 - i) * 0.012, hz, (b === 0 ? 0.32 : 0.22) * (down ? 1 : 0.7)))
    }
  } else if (kind === 'drums') {
    const beat = 60 / 100
    for (let i = 0; i < 16; i++) {
      const at = i * beat / 2.4
      if (i % 4 === 0) hit(at, 120, 70, 0.18, 0.6)
      else if (i % 3 === 1) hit(at, 260, 220, 0.08, 0.35)
      else hit(at, 900, 700, 0.03, 0.25, 0.75)
    }
  } else {
    const beat = 60 / 90
    for (let i = 0; i < 16; i++) {
      const at = (i * beat) / 2.66
      if (i % 8 === 0 || i % 8 === 5) hit(at, 150, 50, 0.12, 0.7)
      if (i % 8 === 4) hit(at, 220, 180, 0.12, 0.45, 0.8)
      hit(at, 6000, 6000, 0.012, 0.08, 1)
      if (i % 2 === 0) hit(at, [55, 55, 65.4, 49][(i / 4) | 0] ?? 55, [55, 55, 65.4, 49][(i / 4) | 0] ?? 55, 0.2, 0.28)
    }
  }
  let peak = 0
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(out[i]))
  if (peak > 0) for (let i = 0; i < n; i++) out[i] *= 0.8 / peak
  return buf
}

/** Small seeded generator (mulberry32): clips sound the same every render. */
function rng(seed: number) {
  let a = seed >>> 0
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}

const GROUPS = ['impactPlank_medium', 'impactWood_light', 'impactWood_medium', 'impactWood_heavy', 'impactMetal_light', 'impactMetal_medium', 'impactPlate_light', 'impactSoft_heavy', 'impactSoft_medium', 'impactPunch_medium', 'impactGeneric_light', 'footstep_concrete', 'impactTin_medium']

export class Sound {
  ctx: BaseAudioContext | null = null
  muted = false
  /** The current weather (renderer), for weather sounds: foghorns in Karl the Fog. */
  weather: () => string = () => 'clear'
  private nextFoghorn = 2.5
  /** The skater's character id (data/characters.json), for its voice sounds. */
  character: () => string = () => ''
  private d: SoundData | null = null
  private rand = rng(7)
  private bufs = new Map<string, AudioBuffer[]>()
  private noise: { white: AudioBuffer; pink: AudioBuffer; brown: AudioBuffer; crackle: AudioBuffer } | null = null
  private master!: GainNode
  /** The characters' voices (their own bus: Settings > Audio > Voices). */
  private voiceBus!: GainNode
  /** Spoken lines on the voices bus: the robotaxi's speaker, Muni's PA (data/voices.json). */
  private lines = new VoiceLines()
  /** Captions for the spoken lines (live play only). */
  set onSay(f: VoiceLines['onSay']) { this.lines.onSay = f }
  /** Say a spoken line by its id (data/voices.json), now. */
  say(id: string) { if (!this.muted) void this.lines.say(id) }
  /** The story's lines (data/missions.json, cast.json), said by id in their speakers' voices. */
  addLines(lines: Record<string, { voice: string; text: string }>) { this.lines.addLines(lines) }
  /** A conversation's line (the dialogue box shows the words): now, cutting off the one before. */
  speak(id: string) { if (!this.muted) void this.lines.speak(id) }
  /** The conversation closed: its line stops. */
  stopSpeaking() { this.lines.stopSpeaking() }
  /** Muni's PA chime (the map's Take Muni): two soft tones down. */
  paChime(when = this.ctx?.currentTime ?? 0) { this.bell(when + 0.02, 1175, 0.55, 0.7); this.bell(when + 0.34, 880, 0.9, 0.7) }
  /** Where the next sounds go instead of the effects bus (voices, the crowd), while set. */
  private route: AudioNode | null = null
  private get out(): AudioNode { return this.route ?? this.sfx }
  /** The player's volumes for the buses (0..1; master is setVolume). */
  private vol = { sfx: 1, voices: 1, ambience: 1 }
  /** Settings > Audio: effects, voices, crowd and ambience. */
  setVolumes(v: { sfx: number; voices: number; ambience: number }) {
    this.vol = { ...v }
    if (!this.d || !this.master) return
    this.sfx.gain.value = this.d.master.sfx * v.sfx; this.amb.gain.value = this.d.master.ambience * v.ambience; this.voiceBus.gain.value = v.voices
  }
  private sfx!: GainNode
  private amb!: GainNode
  /** The vignettes' music (vignettes.ts): one loop each, made once per kind. */
  private vloops = new Map<string, { gain: GainNode; level: number }>()
  private vbufs = new Map<string, AudioBuffer>()
  /** Slow motion (director.ts): the effects and ambience through a low-pass, and their playback rate. */
  private slowLp: BiquadFilterNode | null = null
  private rate = 1
  private ui!: GainNode
  private wet!: GainNode
  private loops: Record<string, Loop> = {}
  /** Driving: the engine's two oscillators, their filter and gain (made in init). */
  private engine: { a: OscillatorNode; b: OscillatorNode; lp: BiquadFilterNode; gain: GainNode } | null = null
  private grit!: AudioBufferSourceNode
  // state carried between frames
  private jointDist = 0
  private stepDist = 0
  private wobbleHalf = 0
  private pushT = 0.45
  private lastState = ''
  private nextTruck = 0
  private nextSiren = 0
  private nextBird = 0
  private nextHorn = 8
  private deck: { x0: number; y0: number; w: number; h: number; cells: Uint8Array } | null = null

  private park: Park | null

  constructor(park: Park | null = null, src: ParkSource | null = null) {
    this.park = park
    if (src) this.deck = deckGrid(src)
  }

  /** Read what sound needs from a source's triangles (the freeway deck) now, before the page lets them go. */
  static prepare(src: ParkSource) { deckGrid(src) }

  /** Live play: start on the first key press (browsers block audio before a gesture). */
  start() {
    if (this.ctx) return
    void this.init(new AudioContext())
  }

  /** Build the graph on any context (live or offline), into dest (default the speakers). Resolves when samples are decoded. */
  async init(ctx: BaseAudioContext, data?: SoundData, dest: AudioNode = ctx.destination) {
    this.ctx = ctx
    this.d = data ?? soundSchema.parse(await (await fetch('data/sound.json', { cache: 'no-store' })).json())
    this.noise = makeNoise(ctx, rng(1))
    const d = this.d
    const comp = ctx.createDynamicsCompressor()
    comp.threshold.value = -14; comp.knee.value = 12; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.2
    comp.connect(dest)
    this.master = gain(ctx, d.master.gain * this.userVolume, comp)
    this.slowLp = ctx.createBiquadFilter(); this.slowLp.type = 'lowpass'; this.slowLp.frequency.value = 20000; this.slowLp.Q.value = 0.5
    this.slowLp.connect(this.master)
    this.sfx = gain(ctx, d.master.sfx, this.slowLp)
    this.amb = gain(ctx, d.master.ambience, this.slowLp)
    this.ui = gain(ctx, d.master.ui, this.master)
    this.voiceBus = gain(ctx, this.vol.voices, this.master)
    this.sfx.gain.value = d.master.sfx * this.vol.sfx; this.amb.gain.value = d.master.ambience * this.vol.ambience
    const verb = ctx.createConvolver()
    verb.buffer = impulse(ctx, d.master.reverb.seconds, rng(3))
    verb.connect(this.master)
    this.wet = gain(ctx, d.master.reverb.open, verb)
    this.sfx.connect(this.wet)
    this.amb.connect(this.wet)
    const n = this.noise
    // wheels
    this.loops.rumble = this.loop(n.pink, [['bandpass', d.roll.rumbleHz, d.roll.rumbleQ]], this.sfx)
    this.loops.hiss = this.loop(n.white, [['highpass', d.roll.hissHz, 0.7]], this.sfx)
    this.loops.grit = this.loop(n.crackle, [['bandpass', 1400, 0.6]], this.sfx)
    this.grit = this.loops.grit.src
    this.loops.wind = this.loop(n.pink, [['lowpass', d.wind.hz, 0.5]], this.sfx)
    for (const [k, g] of [['grindMetal', d.grind.metal], ['grindConcrete', d.grind.concrete], ['slideMetal', d.slide.metal], ['slideConcrete', d.slide.concrete], ['urethane', d.slide.urethane]] as const) {
      this.loops[k] = this.loop(k === 'grindConcrete' ? n.crackle : n.white, g.bands.map((f) => ['bandpass', f, g.q] as [BiquadFilterType, number, number]), this.sfx)
    }
    // ambience: the freeway overhead never stops, the city hums far away
    this.loops.freeway = this.loop(n.brown, [['lowpass', d.ambience.freeway.hz, 0.7]], this.amb)
    this.loops.city = this.loop(n.pink, [['bandpass', 700, 0.5]], this.amb)
    this.loops.truck = this.loop(n.brown, [['lowpass', 160, 0.9]], this.amb)
    // driving: the engine (two oscillators, filtered) and the tyres' squeal
    {
      const E = d.drive.engine, a = ctx.createOscillator(), b = ctx.createOscillator(), lp = ctx.createBiquadFilter(), g = ctx.createGain()
      a.type = 'sawtooth'; b.type = 'square'; a.frequency.value = E.idleHz; b.frequency.value = E.idleHz / 2
      lp.type = 'lowpass'; lp.frequency.value = E.lowpass; g.gain.value = 0
      a.connect(lp); b.connect(lp); lp.connect(g).connect(this.sfx)
      a.start(); b.start()
      this.engine = { a, b, lp, gain: g }
    }
    this.loops.squeal = this.loop(n.white, [['bandpass', d.drive.squeal.hz, d.drive.squeal.q]], this.sfx)
    const lines = this.lines.load(ctx, this.voiceBus).catch(() => {})
    await Promise.all(GROUPS.map(async (g) => {
      const files = await Promise.all([0, 1, 2, 3, 4].map(async (i) => {
        try { return await ctx.decodeAudioData(await (await fetch(`assets/sound/kenney-impact/${g}_00${i}.ogg`)).arrayBuffer()) } catch { return null }
      }))
      this.bufs.set(g, files.filter((b): b is AudioBuffer => !!b))
    }))
    await lines
    const t0 = ctx.currentTime
    this.nextTruck = t0 + this.between(d.ambience.trucks.every) * 0.4
    this.nextSiren = t0 + this.between(d.ambience.sirens.every)
  }

  /** Hot reload of data/sound.json (live). */
  /** Player volume (settings), 0..1, on top of data/sound.json. */
  private userVolume = 1
  setVolume(v: number) { this.userVolume = v; if (this.master && this.d) this.master.gain.value = this.d.master.gain * v }

  setData(json: unknown) {
    this.d = soundSchema.parse(json)
    if (!this.ctx) return
    this.master.gain.value = this.d.master.gain * this.userVolume; this.sfx.gain.value = this.d.master.sfx * this.vol.sfx
    this.amb.gain.value = this.d.master.ambience * this.vol.ambience; this.ui.gain.value = this.d.master.ui
  }

  private loop(buf: AudioBuffer, filters: [BiquadFilterType, number, number][], out: AudioNode): Loop {
    const ctx = this.ctx!
    const src = ctx.createBufferSource()
    src.buffer = buf; src.loop = true
    // Start each loop at a different point so layers sharing a buffer do not phase.
    src.loopStart = 0; src.loopEnd = buf.duration
    const g = ctx.createGain(); g.gain.value = 0
    const fs = filters.map(([type, f, q]) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b })
    if (fs.length === 1) src.connect(fs[0]).connect(g)
    else for (const f of fs) src.connect(f).connect(g)   // parallel bands
    g.connect(out)
    src.start(0, this.rand() * buf.duration)
    return { gain: g, filters: fs, src }
  }

  private between([a, b]: number[]) { return a + (b - a) * this.rand() }

  /**
   * A vignette's music (vignettes.ts): the busker's guitar, the drum circle, the breakers' boombox, on the ambience
   * bus at level 0..1 (how near the camera is); made the first time it is heard, then kept looping.
   */
  vignetteLoop(id: string, kind: string, level: number, when = this.ctx?.currentTime ?? 0) {
    const ctx = this.ctx
    if (!ctx || !this.amb) return
    let L = this.vloops.get(id)
    if (!L) {
      if (level < 0.01) return
      const buf = this.vbufs.get(kind) ?? vignetteBuffer(ctx, kind)
      this.vbufs.set(kind, buf)
      const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true
      const g = ctx.createGain(); g.gain.value = 0
      src.connect(g).connect(this.amb); src.start(when, (id.length * 0.37) % buf.duration)
      L = { gain: g, level: 0 }
      this.vloops.set(id, L)
    }
    const v = this.muted ? 0 : level * (kind === 'drums' ? 0.55 : kind === 'boombox' ? 0.4 : 0.5)
    if (Math.abs(v - L.level) > 0.005) { L.gain.gain.setTargetAtTime(v, when, 0.25); L.level = v }
  }

  /** A coin in the busker's tip jar: two bright clinks, quieter farther off. */
  tipClink(dist: number, when = this.ctx?.currentTime ?? 0) {
    const v = 0.35 / (1 + dist * 0.15)
    this.bell(when + 0.02, 3520, 0.18, v); this.bell(when + 0.11, 4186, 0.22, v * 0.8)
  }

  /**
   * Slow motion (director.ts): the effects and the ambience play at rate (new sounds and the rolling, grinding and
   * wind loops) through a low-pass at cutoff Hz; 1 and 20000 when it ends. The music and the voices are untouched.
   */
  slowmo(rate: number, cutoff: number, when = this.ctx?.currentTime ?? 0) {
    if (!this.ctx || !this.slowLp || (Math.abs(rate - this.rate) < 0.002 && Math.abs(cutoff - this.slowLp.frequency.value) < 20)) return
    this.rate = rate
    this.slowLp.frequency.setTargetAtTime(cutoff, when, 0.03)
    for (const l of Object.values(this.loops)) if (l.src !== this.grit) l.src.playbackRate.setTargetAtTime(rate, when, 0.03)   // (the grit's rate follows the speed: update)
  }

  private set(l: Loop, v: number, when: number, tau = 0.05) { l.gain.gain.setTargetAtTime(this.muted ? 0 : v, when, tau) }

  /** What the wheels are on: a raycast down, then data/sound.json surfaces. */
  private surface(t: Thing): Kind {
    const S = this.d!.surfaces
    if (!this.park) return S.default as Kind
    const h = raycast(this.park, { x: t.pos.x, y: t.pos.y, z: t.pos.z + 0.05 }, { x: -t.up.x, y: -t.up.y, z: -t.up.z }, 0.6)
    if (!h) return S.default as Kind
    const e = this.park.elements[this.park.elem[h.tri]]
    if (this.park.cls[h.tri] === Surface.rail) return 'metal'
    const k = S.byType[e.type] ?? S.byCollection[e.collection] ?? S.byIdPattern.find(([re]) => new RegExp(re).test(e.id))?.[1] ?? S.default
    return (k in S.kinds ? k : S.default) as Kind
  }

  private underDeck(x: number, y: number): boolean {
    const g = this.deck
    if (!g) return false
    const i = Math.floor(x - g.x0), j = Math.floor(y - g.y0)
    return i >= 0 && j >= 0 && i < g.w && j < g.h && g.cells[j * g.w + i] === 1
  }

  /** Every frame (live) or tick (offline): loops follow the skater; ambience moves on. */
  update(t: Thing, when: number, dt: number, vehicle: Thing | null = null) {
    const d = this.d
    if (!this.ctx || !d || !this.loops.rumble) return
    this.driving(t, vehicle, when)
    const v = Math.hypot(t.vel.x, t.vel.y, t.vel.z)
    const state = t.state as string
    const rolling = state === 'ground' || state === 'wall'
    const kind = rolling ? this.surface(t) : 'concrete'
    const s = d.surfaces.kinds[kind]
    const r = d.roll
    const vr = Math.min(1.6, v / r.refSpeed)
    const wheels = rolling ? (t.manual ? r.manual : 1) : 0
    this.set(this.loops.rumble, r.gain * wheels * s.rumble * Math.pow(vr, 0.8), when)
    this.loops.rumble.filters[0].frequency.setTargetAtTime(r.rumbleHz + v * r.rumblePerMs, when, 0.1)
    this.set(this.loops.hiss, r.gain * r.hiss * wheels * s.hiss * Math.pow(vr, 1.3), when)
    this.set(this.loops.grit, r.gain * r.grit * wheels * s.grit * vr, when)
    this.grit.playbackRate.setTargetAtTime((0.4 + vr * 1.2) * this.rate, when, 0.1)
    // Joints and sidewalk cracks: front wheels then back wheels, a wheelbase apart.
    if (rolling && s.joint > 0 && v > 0.5) {
      this.jointDist += v * dt
      if (this.jointDist >= s.joint) {
        this.jointDist -= s.joint
        const g = s.jointGain * Math.min(1, v / 5)
        this.hit('joint', when, g)
        this.hit('joint', when + r.wheelbase / v, g * 0.8)
      }
    }
    // On foot: a footstep each stride length (the sim counts metres walked).
    if (state === 'walk' && !t.footAir) {
      const stride = d.hits.step.stride ?? 0.75
      if (Math.floor(t.stride / stride) !== Math.floor(this.stepDist / stride)) this.hit('step', when, Math.min(1, 0.5 + v / 6))
    }
    this.stepDist = t.stride
    // Pushing (W held on the ground, below push speed): a foot scuff each stroke.
    if (state === 'ground' && !t.manual && (t.prevB & Btn.up) && v < 8.5) {
      this.pushT += dt
      const every = d.hits.push.seconds ?? 0.62
      if (this.pushT >= every) { this.pushT -= every; this.hit('push', when); this.burst(when + 0.02, 0.16, 0.05, 'lowpass', 1800, 500, 0.7) }
    } else this.pushT = 0.45
    // Wheels scrubbing: a powerslide, or a carve past the grip limit.
    const scrub = rolling ? Math.max(t.powerslide !== 0 ? 1 : 0, Math.min(1, Math.abs(t.slip))) * Math.min(1.3, v / 6) : 0
    this.set(this.loops.urethane, d.slide.urethane.gain * scrub * (1 - d.slide.urethane.jitter * 0.5 + d.slide.urethane.jitter * this.rand()), when, 0.03)
    // Speed wobble: the trucks rattle twice per wobble cycle.
    if (rolling && t.wobble > d.wobble.min) {
      const half = Math.floor(t.wobblePhase / Math.PI)
      if (half !== this.wobbleHalf) this.hit('joint', when, d.wobble.gain * Math.min(1, t.wobble * 1.4))
      this.wobbleHalf = half
    }
    // Grinds and slides by material.
    const g = t.grind
    let gm = 0, gc = 0, sm = 0, sc = 0
    if (state === 'grind' && g && this.park) {
      const line = g.car >= 0 ? null : this.park.grind[g.line]   // a car's edge: metal
      const metal = line ? line.kind !== 'ledge' || /_edge_/.test(line.element) : true
      const gs = Math.min(1.4, Math.abs(g.speed) / 5)
      if (g.slide) { if (metal) sm = gs; else sc = gs } else { if (metal) gm = gs; else gc = gs }
    }
    const jit = (j: number) => 1 - j * 0.5 + j * this.rand()
    this.set(this.loops.grindMetal, d.grind.metal.gain * gm * jit(d.grind.metal.jitter), when, 0.02)
    this.set(this.loops.grindConcrete, d.grind.concrete.gain * gc * jit(d.grind.concrete.jitter), when, 0.02)
    this.set(this.loops.slideMetal, d.slide.metal.gain * sm * jit(d.slide.metal.jitter), when, 0.03)
    this.set(this.loops.slideConcrete, d.slide.concrete.gain * sc * jit(d.slide.concrete.jitter), when, 0.03)
    // Skitching: the tow's engine rumble from the car right in front.
    this.set(this.loops.truck, t.skitch ? 0.18 + Math.min(0.2, v * 0.02) : 0, when, 0.1)
    // Wind: in the air and when bombing.
    const vw = v / d.wind.refSpeed
    this.set(this.loops.wind, d.wind.gain * Math.min(2, vw * vw) * (state === 'air' ? 1.3 : 1), when, 0.15)
    this.loops.wind.filters[0].frequency.setTargetAtTime(d.wind.hz + v * d.wind.perMs, when, 0.2)
    // Under the freeway: louder rumble, more echo.
    const under = this.underDeck(t.pos.x, t.pos.y)
    const A = d.ambience
    this.set(this.loops.freeway, A.freeway.gain * (under ? A.freeway.underDeck : 1), when, 0.6)
    // Out from under the freeway: the city opens up (hum, birds, far horns).
    const street = A.streets
    this.set(this.loops.city, under || !street ? A.city.gain : street.city, when, 1.5)
    if (street && !under) {
      if (when >= this.nextBird) { this.chirp(when, street.birds.gain); this.nextBird = when + this.between(street.birds.every) }
      if (when >= this.nextHorn) { this.farHorn(when, street.horns.gain); this.nextHorn = when + this.between(street.horns.every) }
    }
    this.wet.gain.setTargetAtTime(under ? d.master.reverb.underDeck : d.master.reverb.open, when, 0.4)
    if (when >= this.nextTruck) { this.truck(when); this.nextTruck = when + this.between(A.trucks.every) }
    if ((this.weather() === 'karl' || this.weather() === 'fognight') && when >= this.nextFoghorn) { this.foghorn(when); this.nextFoghorn = when + this.between([24, 42]) }
    if (when >= this.nextSiren) { this.siren(when); this.nextSiren = when + this.between(A.sirens.every) }
    this.lastState = state
  }

  /**
   * Driving (data/sound.json drive): the engine's note from the speed through the gears and the pedal
   * (the skater's buttons ride on it while it drives), the truck lower; the tyres squeal with the
   * handbrake or a sideways slide. Silent on foot and on the board.
   */
  private driving(t: Thing, c: Thing | null, when: number) {
    const D = this.d!.drive, E = D.engine, eng = this.engine
    if (!eng || !this.loops.squeal) return
    if (t.state !== 'drive' || !c || !c.car?.drive) { eng.gain.gain.setTargetAtTime(0, when, 0.15); this.set(this.loops.squeal, 0, when, 0.05); return }
    const v = Math.hypot(c.vel.x, c.vel.y), up = (t.prevB & Btn.up) !== 0, down = (t.prevB & Btn.down) !== 0
    // Through the gears: the pitch climbs from idle to the shift speed, then drops back.
    let lo = 0
    for (const g of E.gears) { if (v < g) break; lo = g }
    const scoot = c.car.drive.ride !== undefined   // a rental scooter: the motor's high whine, quieter
    const pitch = (E.idleHz + (v - lo) * E.perMs + (up ? E.throttleHz : 0)) * (c.car.drive.type === 'garbage' ? E.truck : scoot ? E.scooter : 1)
    eng.a.frequency.setTargetAtTime(pitch, when, 0.08)
    eng.b.frequency.setTargetAtTime(pitch / 2, when, 0.08)
    eng.gain.gain.setTargetAtTime(this.muted ? 0 : (E.idleGain + (up || down ? E.gain : 0)) * (scoot ? E.scooterGain : 1), when, 0.1)
    // The tyres: the handbrake or a slide sideways past squeal.slip.
    const f = c.fwd, side = Math.abs(c.vel.x * f.y - c.vel.y * f.x), S = D.squeal
    const sq = (t.prevB & Btn.slide) !== 0 || side > S.slip ? Math.min(1, v / S.fullSpeed) : 0
    this.set(this.loops.squeal, S.gain * sq * (0.85 + 0.3 * this.rand()), when, 0.04)
  }

  /** A truck crossing the deck: a swell of rumble with the expansion joints' ka-thunk. */
  private truck(when: number) {
    const T = this.d!.ambience.trucks
    const g = this.loops.truck.gain.gain
    g.cancelScheduledValues(when)
    g.setValueAtTime(0, when)
    g.linearRampToValueAtTime(T.gain, when + T.seconds * 0.45)
    g.linearRampToValueAtTime(0, when + T.seconds)
    for (let i = 0; i < T.joints; i++) {
      const at = when + T.seconds * (0.38 + i * 0.08)
      this.thump(at, 0.55, 48, this.amb); this.thump(at + 0.12, 0.45, 44, this.amb)
    }
  }

  /** A foghorn out on the Bay: two long low tones (the Golden Gate's diaphone), far and wet. */
  private foghorn(when: number) {
    const ctx = this.ctx!
    for (const [at, f, len] of [[0, 155, 2.2], [2.6, 116, 2.8]] as const) {
      const o = ctx.createOscillator(), o2 = ctx.createOscillator(), lp = ctx.createBiquadFilter(), g = ctx.createGain()
      o.type = 'sawtooth'; o.frequency.value = f; o2.type = 'square'; o2.frequency.value = f * 0.501
      lp.type = 'lowpass'; lp.frequency.value = 420; lp.Q.value = 0.8
      const t0 = when + at
      g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.09, t0 + 0.35)
      g.gain.setValueAtTime(0.09, t0 + len - 0.6); g.gain.exponentialRampToValueAtTime(0.0001, t0 + len)
      o.connect(lp); o2.connect(lp); lp.connect(g).connect(this.amb)
      o.start(t0); o2.start(t0); o.stop(t0 + len + 0.05); o2.stop(t0 + len + 0.05)
    }
  }

  /** A small bird: two to four quick falling chirps. */
  private chirp(when: number, vol: number) {
    const ctx = this.ctx!, n = 2 + Math.floor(this.rand() * 3), f0 = 2800 + this.rand() * 1800
    for (let i = 0; i < n; i++) {
      const at = when + i * (0.09 + this.rand() * 0.05), o = ctx.createOscillator(), g = ctx.createGain()
      o.frequency.setValueAtTime(f0 * (1 + this.rand() * 0.1), at); o.frequency.exponentialRampToValueAtTime(f0 * 0.62, at + 0.07)
      g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(vol, at + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, at + 0.08)
      o.connect(g).connect(this.amb); o.start(at); o.stop(at + 0.1)
    }
  }

  /** A horn a few blocks away: short, muffled. */
  private farHorn(when: number, vol: number) {
    const ctx = this.ctx!, lp = ctx.createBiquadFilter(), g = ctx.createGain()
    lp.type = 'lowpass'; lp.frequency.value = 900
    g.gain.setValueAtTime(0.0001, when); g.gain.exponentialRampToValueAtTime(vol, when + 0.03); g.gain.setValueAtTime(vol, when + 0.25); g.gain.exponentialRampToValueAtTime(0.0001, when + 0.32)
    lp.connect(g).connect(this.amb)
    for (const f of [392, 494]) { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.connect(lp); o.start(when); o.stop(when + 0.34) }
  }

  /** A far-off siren: two-tone wail, lowpassed by distance. */
  private siren(when: number) {
    const ctx = this.ctx!, S = this.d!.ambience.sirens
    const o = ctx.createOscillator(), lfo = ctx.createOscillator(), depth = ctx.createGain(), lp = ctx.createBiquadFilter(), g = ctx.createGain()
    o.type = 'sawtooth'; o.frequency.value = 820
    lfo.frequency.value = 0.35; depth.gain.value = 180
    lfo.connect(depth).connect(o.frequency)
    lp.type = 'lowpass'; lp.frequency.value = 1300
    g.gain.setValueAtTime(0, when)
    g.gain.linearRampToValueAtTime(S.gain, when + S.seconds * 0.4)
    g.gain.linearRampToValueAtTime(0, when + S.seconds)
    o.connect(lp).connect(g).connect(this.amb)
    o.start(when); lfo.start(when); o.stop(when + S.seconds); lfo.stop(when + S.seconds)
  }

  /** One sample from a group in data/sound.json hits. */
  private hit(name: keyof SoundData['hits'], when: number, scale = 1, out?: AudioNode) {
    const ctx = this.ctx, h = this.d?.hits[name]
    if (!ctx || !h || this.muted || !h.files) return
    const list = this.bufs.get(h.files)
    if (!list?.length) return
    const src = ctx.createBufferSource()
    src.buffer = list[Math.floor(this.rand() * list.length)]
    const [a, b] = h.rate ?? [1, 1]
    src.playbackRate.value = (a + (b - a) * this.rand()) * this.rate
    const g = ctx.createGain(); g.gain.value = h.gain * scale
    src.connect(g).connect(out ?? this.out)
    src.start(when)
  }

  /** Low body thump: a sine dropping in pitch. */
  private thump(when: number, vol: number, hz: number, out?: AudioNode) {
    const ctx = this.ctx
    if (!ctx || this.muted) return
    const o = ctx.createOscillator(), g = ctx.createGain()
    o.frequency.setValueAtTime(hz * 1.8 * this.rate, when)
    o.frequency.exponentialRampToValueAtTime(hz * this.rate, when + 0.06)
    g.gain.setValueAtTime(vol, when)
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.22)
    o.connect(g).connect(out ?? this.out)
    o.start(when); o.stop(when + 0.25)
  }

  /** Short filtered noise: the tail's crack, a flip's whoosh, a revert's scrub. */
  private burst(when: number, dur: number, vol: number, type: BiquadFilterType, f0: number, f1: number, q = 1) {
    const ctx = this.ctx
    if (!ctx || !this.noise || this.muted) return
    const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain()
    src.buffer = this.noise.white; src.playbackRate.value = this.rate
    f.type = type; f.Q.value = q
    f.frequency.setValueAtTime(f0, when); f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), when + dur)
    g.gain.setValueAtTime(0.0001, when)
    g.gain.exponentialRampToValueAtTime(vol, when + Math.min(0.02, dur * 0.3))
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur)
    src.connect(f).connect(g).connect(this.out)
    src.start(when, this.rand() * 1.5); src.stop(when + dur + 0.05)
  }

  /** FM bell for score stingers. */
  private bell(when: number, hz: number, dur: number, vol: number) {
    const ctx = this.ctx, S = this.d?.score
    if (!ctx || !S || this.muted) return
    const c = ctx.createOscillator(), m = ctx.createOscillator(), mg = ctx.createGain(), g = ctx.createGain()
    c.frequency.value = hz; m.frequency.value = hz * S.ratio
    mg.gain.setValueAtTime(hz * S.index, when); mg.gain.exponentialRampToValueAtTime(hz * 0.05, when + dur)
    m.connect(mg).connect(c.frequency)
    g.gain.setValueAtTime(0.0001, when); g.gain.exponentialRampToValueAtTime(vol * S.gain, when + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, when + dur)
    c.connect(g).connect(this.route ?? this.ui)
    c.start(when); m.start(when); c.stop(when + dur + 0.05); m.stop(when + dur + 0.05)
  }

  /** A car horn (two-tone) or a robotaxi's polite chime, quieter with distance. */
  /** A car's horn (a robotaxi's polite chime), or a streetcar's bell, dist metres away. */
  horn(robo: boolean, dist: number, when = this.ctx?.currentTime ?? 0, tram = false) {
    const ctx = this.ctx
    if (!ctx || this.muted) return
    const g0 = Math.min(1, 6 / Math.max(6, dist)) * 0.22
    if (tram) { for (const d of [0, 0.22]) { this.bell(when + d, 1245, 0.9, g0 * 3.6); this.bell(when + d, 1870, 0.5, g0 * 1.4) } return }   // clang clang
    if (robo) { this.bell(when, 988, 0.35, g0 * 4); this.bell(when + 0.18, 740, 0.5, g0 * 4); return }
    for (const f of [415, 523]) {
      const o = ctx.createOscillator(), g = ctx.createGain(), lp = ctx.createBiquadFilter()
      o.type = 'sawtooth'; o.frequency.value = f
      lp.type = 'lowpass'; lp.frequency.value = 1800
      g.gain.setValueAtTime(0.0001, when); g.gain.exponentialRampToValueAtTime(g0, when + 0.02)
      g.gain.setValueAtTime(g0, when + 0.32); g.gain.exponentialRampToValueAtTime(0.0001, when + 0.4)
      o.connect(lp).connect(g).connect(this.amb); o.start(when); o.stop(when + 0.42)
    }
  }

  /** The van's horn (data/sound.json drive.horn): two tones, lower and longer than a car's, right here. */
  private vanHorn(when: number) {
    const ctx = this.ctx, H = this.d?.drive.horn
    if (!ctx || !H || this.muted) return
    for (const f of H.hz) {
      const o = ctx.createOscillator(), g = ctx.createGain(), lp = ctx.createBiquadFilter()
      o.type = 'sawtooth'; o.frequency.value = f
      lp.type = 'lowpass'; lp.frequency.value = 1400
      g.gain.setValueAtTime(0.0001, when); g.gain.exponentialRampToValueAtTime(H.gain, when + 0.02)
      g.gain.setValueAtTime(H.gain, when + H.seconds - 0.08); g.gain.exponentialRampToValueAtTime(0.0001, when + H.seconds)
      o.connect(lp).connect(g).connect(this.sfx); o.start(when); o.stop(when + H.seconds + 0.02)
    }
  }

  /** A vehicle's door: a low thump and the latch's click. */
  private door(when: number) {
    const D = this.d?.drive.door
    if (!D) return
    this.thump(when, D.gain, D.hz)
    this.burst(when + 0.01, 0.03, D.gain * 0.25, 'bandpass', 3200, 2400, 2)
  }

  /** Character voice recipes: short, cartoonish extras on pop, land and bail. */
  /** The character's emote (the taunt key): its voice recipes from data/sound.json voices.<id>.emote. */
  emote(when = this.ctx?.currentTime ?? 0) { if (this.ctx) this.voice('emote', when) }

  /** The fans on the ledges cheer a big combo: applause (claps scattered over a second or two) and a
   *  "woo" or two, louder with more fans. data/sound.json applause. */
  /** The crowd and the dogs go on the ambience bus (Settings > Audio > Crowd and ambience). */
  applause(fans: number, when = this.ctx?.currentTime ?? 0) {
    this.route = this.amb
    try { this.applauseNow(fans, when) } finally { this.route = null }
  }
  private applauseNow(fans: number, when = this.ctx?.currentTime ?? 0) {
    const ctx = this.ctx, n = this.noise, A = this.d?.applause
    if (!ctx || !n || !A || fans <= 0) return
    const k = 0.35 + 0.65 * Math.min(1, fans / A.fullAt), claps = Math.round(A.claps * (0.4 + 0.6 * k))
    const r = (i: number) => { const x = Math.sin((when * 997 + i) * 12.9898) * 43758.5453; return x - Math.floor(x) }   // view-only scatter
    for (let i = 0; i < claps; i++) {
      const t = when + A.delay + Math.pow(r(i), 1.6) * A.seconds, src = ctx.createBufferSource(), bp = ctx.createBiquadFilter(), g = ctx.createGain()
      src.buffer = n.white; bp.type = 'bandpass'; bp.frequency.value = A.hz[0] + r(i + 50) * (A.hz[1] - A.hz[0]); bp.Q.value = 1.2
      const v = A.gain * k * (0.5 + r(i + 90) * 0.5) * (1 - (t - when) / (A.seconds + A.delay + 0.3))
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(0.0002, v), t + 0.002); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.03)
      src.connect(bp).connect(g).connect(this.out); src.start(t, r(i + 7) * 1.5); src.stop(t + 0.04)
    }
    // A woo: a voice-ish glide through a vowel band.
    for (let w = 0; w < Math.min(A.woos, Math.ceil(fans / 3)); w++) {
      const t = when + A.delay + 0.1 + w * 0.35 + r(w + 200) * 0.2, f0 = 520 + r(w + 300) * 260
      const o = ctx.createOscillator(), bp = ctx.createBiquadFilter(), g = ctx.createGain()
      o.type = 'sawtooth'; o.frequency.setValueAtTime(f0 * 0.8, t); o.frequency.exponentialRampToValueAtTime(f0 * 1.35, t + 0.18); o.frequency.exponentialRampToValueAtTime(f0 * 1.1, t + 0.55)
      bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 2.5
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(0.0002, A.wooGain * k), t + 0.06); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6)
      o.connect(bp).connect(g).connect(this.out); o.start(t); o.stop(t + 0.65)
    }
  }

  /**
   * An NPC skater's sounds, quieter with distance (data/sound.json npc): its catch, grind, landing
   * and bail, and its character's voice on the landing and the bail; a cheer's tail taps (taps: when
   * each slaps down, seconds) clack. Nothing beyond npc.far.
   */
  npc(e: SimEvent, character: string, dist: number, when = this.ctx?.currentTime ?? 0, taps: number[] = []) {
    const N = this.d?.npc
    if (!this.ctx || !N || dist > N.far) return
    const k = N.gain * Math.min(1, N.near / Math.max(N.near, dist)) * (1 - Math.max(0, (dist - N.far * 0.7) / (N.far * 0.3)))
    switch (e.t) {
      case 'npcTrick': this.hit('catch', when, k); break
      case 'npcGrind': this.hit('grindConcrete', when, k); break
      case 'npcLand': this.hit('land', when, k); this.hit('landClack', when + 0.012, k * 0.9); this.voice('land', when, k, character); break
      case 'npcBail': this.hit('bailBody', when, k); this.voice('bail', when, k, character); break
      case 'npcCheer': for (const s of taps) this.hit('landClack', when + s, k * 0.8); this.voice('land', when + 0.1, k * 0.8, character); break
    }
  }

  /**
   * A flock of seagulls taking off (data/birds.json): two or three of the western gull's laughing
   * "kyow" calls, each a squealing tone that leaps up and falls away, quieter far off (to far metres).
   * On the ambience bus.
   */
  gulls(dist: number, far: number, when = this.ctx?.currentTime ?? 0) {
    const ctx = this.ctx
    if (!ctx || this.muted || dist > far) return
    this.route = this.amb
    try {
      const k = 0.5 * Math.min(1, 8 / Math.max(8, dist)) * (1 - Math.max(0, (dist - far * 0.6) / (far * 0.4)))
      const n = 2 + Math.floor(this.rand() * 2)
      for (let i = 0; i < n; i++) {
        const t0 = when + i * (0.22 + this.rand() * 0.18), dur = 0.28 + this.rand() * 0.1, f0 = 1500 + this.rand() * 500
        const o = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain()
        o.type = 'sawtooth'
        o.frequency.setValueAtTime(f0 * 0.7, t0); o.frequency.exponentialRampToValueAtTime(f0 * 1.15, t0 + 0.05); o.frequency.exponentialRampToValueAtTime(f0 * 0.6, t0 + dur)
        f.type = 'bandpass'; f.frequency.value = f0 * 1.6; f.Q.value = 2
        g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.18 * k, t0 + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
        o.connect(f).connect(g).connect(this.out)
        o.start(t0); o.stop(t0 + dur + 0.02)
      }
    } finally { this.route = null }
  }

  /**
   * The K-dock's sea lions (src/client/sealions.ts): a bark of n "orks", a little lower than the Sea Lion
   * skater's (grown-ups), or the splash of one going in; quieter with distance, silent past far metres.
   * On the ambience bus.
   */
  seaLions(kind: 'bark' | 'splash', dist: number, n: number, far: number, when = this.ctx?.currentTime ?? 0) {
    if (!this.ctx || this.muted || dist > far) return
    this.route = this.amb
    try {
      const k = Math.min(1, 10 / Math.max(10, dist)) * (1 - Math.max(0, (dist - far * 0.6) / (far * 0.4)))
      if (kind === 'bark') this.seaLionBark(when, n, 0.75 * k, 0.82)
      else { this.sample('impactSoft_heavy', when, 0.5 * k, 0.8, 1.0); this.burst(when, 0.45, 0.18 * k, 'bandpass', 1800, 500, 1.1) }
    } finally { this.route = null }
  }

  /** A park dog's bark: a woof or two (data/sound.json dogs), higher for a small dog, quieter far off. */
  /** The crowd and the dogs go on the ambience bus (Settings > Audio > Crowd and ambience). */
  bark(size: number, dist: number, when = this.ctx?.currentTime ?? 0) {
    this.route = this.amb
    try { this.barkNow(size, dist, when) } finally { this.route = null }
  }
  private barkNow(size: number, dist: number, when = this.ctx?.currentTime ?? 0) {
    const ctx = this.ctx, B = this.d?.dogs
    if (!ctx || !B || this.muted || dist > B.far) return
    const k = B.gain * Math.min(1, B.near / Math.max(B.near, dist)) * (1 - Math.max(0, (dist - B.far * 0.6) / (B.far * 0.4)))
    const n = B.woofs[0] + Math.floor(this.rand() * (B.woofs[1] - B.woofs[0] + 1))
    const top = B.hz[1] / Math.max(0.6, size), low = B.hz[0] / Math.max(0.6, size)
    for (let i = 0; i < n; i++) {
      const t0 = when + i * (B.seconds + 0.06 + this.rand() * 0.05)
      const o = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain()
      o.type = 'sawtooth'
      o.frequency.setValueAtTime(top * (0.9 + this.rand() * 0.2), t0); o.frequency.exponentialRampToValueAtTime(low, t0 + B.seconds)
      f.type = 'bandpass'; f.frequency.setValueAtTime(top * 2.2, t0); f.frequency.exponentialRampToValueAtTime(low * 1.6, t0 + B.seconds); f.Q.value = 2.5
      g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.5 * k, t0 + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t0 + B.seconds)
      o.connect(f).connect(g).connect(this.out)
      o.start(t0); o.stop(t0 + B.seconds + 0.02)
      this.burst(t0, B.seconds * 0.7, 0.12 * k, 'bandpass', top * 3, low * 2, 1.2)
    }
  }

  private voice(kind: 'pop' | 'land' | 'bail' | 'emote', when: number, scale = 1, who?: string) {
    this.route = this.voiceBus
    try { this.voiceNow(kind, when, scale, who) } finally { this.route = null }
  }
  private voiceNow(kind: 'pop' | 'land' | 'bail' | 'emote', when: number, scale = 1, who?: string) {
    const V = this.d?.voices
    const v = V?.[who ?? this.character()]
    if (!V || !v || typeof v !== 'object') return
    const g = V.gain * scale
    for (const r of v[kind] ?? []) {
      switch (r) {
        case 'tink': this.sample('impactTin_medium', when, 0.5 * g, 1.5, 1.8); break
        case 'tinkHeavy': this.sample('impactTin_medium', when, 0.8 * g, 0.9, 1.1); this.sample('impactMetal_light', when + 0.05, 0.4 * g, 1.2, 1.4); break
        case 'fizz': this.burst(when + 0.03, 0.55, 0.12 * g, 'highpass', 5200, 7800, 0.7); break
        case 'squish': this.sample('impactSoft_medium', when, 0.7 * g, 1.2, 1.5); this.burst(when, 0.22, 0.25 * g, 'lowpass', 900, 160, 4); break
        case 'splat': this.sample('impactSoft_heavy', when, 0.9 * g, 0.7, 0.85); this.burst(when, 0.4, 0.35 * g, 'lowpass', 700, 90, 5); break
        case 'fluff': this.sample('impactSoft_medium', when, 0.45 * g, 0.8, 1.0); break
        case 'cape': this.burst(when, 0.32, 0.2 * g, 'bandpass', 300, 1300, 0.8); break
        case 'rattle': for (let i = 0; i < 5; i++) this.sample('impactWood_light', when + i * (0.022 + this.rand() * 0.02), 0.28 * g, 1.7, 2.2); break
        case 'rattleBig': for (let i = 0; i < 11; i++) this.sample('impactWood_light', when + i * (0.03 + this.rand() * 0.035), 0.32 * g * Math.pow(0.88, i), 1.5, 2.3); break
        case 'ding': this.bell(when + 0.05, 1568, 0.35, 0.8 * g); this.bell(when + 0.13, 2093, 0.5, 0.8 * g); break
        case 'sadDing': this.bell(when + 0.1, 784, 0.4, 0.7 * g); this.bell(when + 0.3, 587, 0.7, 0.7 * g); break
        case 'whoosh': this.burst(when, 0.5, 0.16 * g, 'bandpass', 260, 1300, 0.7); break
        case 'whooshBig': this.burst(when, 0.9, 0.2 * g, 'bandpass', 1500, 180, 0.6); this.burst(when + 0.35, 0.8, 0.12 * g, 'lowpass', 900, 200, 0.7); break
        case 'crinkle': for (let i = 0; i < 7; i++) this.burst(when + i * 0.03 + this.rand() * 0.02, 0.035, 0.09 * g, 'highpass', 4500 + this.rand() * 2500, 7000, 0.9); break
        case 'super': this.bell(when + 0.02, 1047, 0.25, 0.6 * g); this.bell(when + 0.1, 1319, 0.25, 0.6 * g); this.bell(when + 0.18, 1568, 0.55, 0.7 * g); break
        case 'flap': for (let i = 0; i < 3; i++) this.burst(when + i * 0.07, 0.06, 0.14 * g, 'lowpass', 1400, 500, 0.8); break
        case 'coo': { // a pigeon's two-part coo: a soft low tone with a wobble, rising then falling
          const ctx = this.ctx!, o = ctx.createOscillator(), lfo = ctx.createOscillator(), lg = ctx.createGain(), gg = ctx.createGain(), f = ctx.createBiquadFilter()
          const t0 = when + this.rand() * 0.04
          o.type = 'triangle'; o.frequency.setValueAtTime(330, t0); o.frequency.linearRampToValueAtTime(420, t0 + 0.12); o.frequency.linearRampToValueAtTime(300, t0 + 0.42)
          lfo.frequency.value = 22; lg.gain.value = 14
          lfo.connect(lg).connect(o.frequency)
          f.type = 'lowpass'; f.frequency.value = 1200
          gg.gain.setValueAtTime(0.0001, t0); gg.gain.exponentialRampToValueAtTime(0.22 * g, t0 + 0.05); gg.gain.exponentialRampToValueAtTime(0.08 * g, t0 + 0.18)
          gg.gain.exponentialRampToValueAtTime(0.18 * g, t0 + 0.26); gg.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.46)
          o.connect(f).connect(gg).connect(this.out); o.start(t0); lfo.start(t0); o.stop(t0 + 0.5); lfo.stop(t0 + 0.5)
          break
        }
        case 'bark': this.seaLionBark(when, 2, g); break   // the sea lion: ork ork
        case 'barkBig': this.seaLionBark(when + 0.12, 4, g * 1.15); break
        case 'flop': this.sample('impactSoft_heavy', when, 0.6 * g, 1.1, 1.3); this.burst(when, 0.3, 0.2 * g, 'bandpass', 2400, 700, 1.2); break   // a wet slap
        case 'whir': this.burst(when, 0.25, 0.12 * g, 'bandpass', 1800, 3600, 4); break   // the lidar spinning up
        case 'chime': this.bell(when + 0.02, 1175, 0.55, 0.7 * g); this.bell(when + 0.34, 880, 0.9, 0.7 * g); break   // "Arriving now."
        case 'errorTone': this.bell(when + 0.06, 660, 0.25, 0.6 * g); this.bell(when + 0.3, 494, 0.55, 0.6 * g); break   // "I'm sorry, I can't do that."
        case 'clang': this.bell(when, 1245, 1.1, 0.85 * g); this.bell(when, 1870, 0.6, 0.35 * g); break   // the cable car's bell
        case 'clangClang': for (const d of [0, 0.22]) { this.bell(when + d, 1245, 0.9, 0.8 * g); this.bell(when + d, 1870, 0.5, 0.3 * g) } break
        case 'screech': this.burst(when, 0.6, 0.22 * g, 'bandpass', 3200, 1700, 7); this.sample('impactMetal_light', when + 0.05, 0.6 * g, 0.8, 1.0); break
        case 'clunk': this.sample('impactMetal_light', when, 0.5 * g, 0.7, 0.9); break
        case 'honk': { // a squeaky clown-nose honk
          const ctx = this.ctx!, o = ctx.createOscillator(), gg = ctx.createGain(), f = ctx.createBiquadFilter()
          o.type = 'sawtooth'; o.frequency.setValueAtTime(520, when + 0.15); o.frequency.linearRampToValueAtTime(380, when + 0.4)
          f.type = 'bandpass'; f.frequency.value = 900; f.Q.value = 3
          gg.gain.setValueAtTime(0.0001, when + 0.15); gg.gain.exponentialRampToValueAtTime(0.25 * g, when + 0.18); gg.gain.exponentialRampToValueAtTime(0.0001, when + 0.42)
          o.connect(f).connect(gg).connect(this.out); o.start(when + 0.15); o.stop(when + 0.45)
          break
        }
      }
    }
  }

  /**
   * A sea lion's bark, n times: a honking, nasal "ork" (a buzzy low tone through a vowel formant that
   * drops in pitch, a breathy edge), each a little different.
   */
  private seaLionBark(when: number, n: number, g: number, pitch = 1) {
    const ctx = this.ctx
    if (!ctx) return
    for (let i = 0; i < n; i++) {
      const t0 = when + i * (0.24 + this.rand() * 0.06), dur = 0.17 + this.rand() * 0.05
      const f0 = (230 + this.rand() * 40) * pitch
      const o = ctx.createOscillator(), f = ctx.createBiquadFilter(), f2 = ctx.createBiquadFilter(), gg = ctx.createGain()
      o.type = 'sawtooth'
      o.frequency.setValueAtTime(f0 * 1.25, t0); o.frequency.exponentialRampToValueAtTime(f0, t0 + 0.04); o.frequency.exponentialRampToValueAtTime(f0 * 0.72, t0 + dur)
      f.type = 'bandpass'; f.frequency.setValueAtTime(900, t0); f.frequency.exponentialRampToValueAtTime(600, t0 + dur); f.Q.value = 4
      f2.type = 'lowpass'; f2.frequency.value = 2600
      gg.gain.setValueAtTime(0.0001, t0); gg.gain.exponentialRampToValueAtTime(0.42 * g, t0 + 0.02); gg.gain.exponentialRampToValueAtTime(0.25 * g, t0 + dur * 0.6); gg.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
      o.connect(f).connect(f2).connect(gg).connect(this.out)
      o.start(t0); o.stop(t0 + dur + 0.02)
      this.burst(t0, dur * 0.8, 0.08 * g, 'bandpass', 1400, 700, 1.5)
    }
  }

  /** One sample from a named group at a gain and a random rate in [a, b]. */
  private sample(group: string, when: number, vol: number, a: number, b: number) {
    const ctx = this.ctx, list = this.bufs.get(group)
    if (!ctx || !list?.length || this.muted) return
    const src = ctx.createBufferSource()
    src.buffer = list[Math.floor(this.rand() * list.length)]
    src.playbackRate.value = (a + (b - a) * this.rand()) * this.rate
    const g = ctx.createGain(); g.gain.value = vol
    src.connect(g).connect(this.out)
    src.start(when)
  }

  event(e: SimEvent, t: Thing | null, when: number) {
    const d = this.d
    if (!this.ctx || !d) return
    const H = d.hits
    this.lines.event(e, when)
    if (e.t === 'pop') this.voice('pop', when)
    if (e.t === 'land') this.voice('land', when)
    if (e.t === 'bail') this.voice('bail', when)
    // A curb hop (the feel pass's bump event, { height } m): the wheels knock up the kerb, a short clack and a small thump.
    if ((e as { t: string }).t === 'bump') {
      const k = Math.min(1, 0.45 + ((e as unknown as { height?: number }).height ?? 0.15) * 2.5)
      this.hit('landClack', when, k * 0.7); this.thump(when, H.thump.gain * k * 0.45, (H.thump.hz ?? 72) * 1.3)
    }
    switch (e.t) {
      case 'pop': {
        const k = 0.65 + Math.min(1, e.charge / 40) * 0.35
        this.hit('pop', when, k)
        const hz = H.popCrack.hz ?? 2400
        this.burst(when, 0.03, H.popCrack.gain * k, 'bandpass', hz, hz * 0.7, 1.5)
        break
      }
      case 'trickStart': {
        const flip = t?.trick?.kind === 'flip'
        if (flip) this.burst(when + 0.02, H.flip.seconds ?? 0.28, H.flip.gain, 'bandpass', 900, 3200, 1.2)
        else this.burst(when, 0.18, H.flip.gain * 0.5, 'lowpass', 600, 1500, 0.7)
        break
      }
      case 'trickEnd': if (t?.trick?.kind === 'flip' || /flip|heel|shuv|varial|impossible/i.test(e.trick)) this.hit('catch', when); break
      case 'land': {
        const drop = t ? Math.max(0, e.peakZ - t.pos.z) : 1
        const k = Math.min(1.2, Math.sqrt(2 * 9.81 * drop) / 6 + 0.25)
        this.hit('land', when, k)
        this.hit('landClack', when + 0.012, k * 0.9)
        this.thump(when, H.thump.gain * k, H.thump.hz ?? 72)
        this.jointDist = 0
        break
      }
      case 'grindStart': {
        const line = this.park && t?.grind && t.grind.car < 0 ? this.park.grind[t.grind.line] : null
        const metal = line ? line.kind !== 'ledge' || /_edge_/.test(line.element) : true
        this.hit(metal ? 'grindMetal' : 'grindConcrete', when)
        break
      }
      case 'lipStart': this.hit('lip', when); break
      case 'stepOff': this.hit('pickup', when); break
      case 'boardDrop': this.hit('drop', when); this.thump(when, 0.35, 95); break
      case 'footLand': this.hit('footLand', when, Math.min(1.2, 0.5 + e.impact / 6)); break
      case 'jump': this.hit('step', when, 0.6); break
      case 'wallplant': this.hit('landClack', when, 0.8); this.thump(when, 0.4, 90); break
      case 'revert': this.burst(when, 0.35, 0.22, 'bandpass', 1800, 900, 2); break
      case 'manualStart': this.hit('catch', when, 0.6); break
      case 'bail': {
        this.hit('bailBody', when)
        this.hit('bailHit', when + 0.05)
        this.thump(when, 0.8, 60)
        const C = H.clatter
        let at = when + 0.12
        for (let i = 0; i < (C.count ?? 4); i++) { this.hit('clatter', at, Math.pow(0.7, i)); at += 0.09 + this.rand() * 0.16 }
        this.burst(when + 0.05, 0.6, 0.18, 'lowpass', 1200, 300, 0.7)
        break
      }
      // score stingers
      case 'comboLanded': {
        const notes = e.points >= d.score.bigCombo * 4 ? [523, 659, 784, 1046, 1318] : e.points >= d.score.bigCombo ? [523, 659, 784, 1046] : [659, 988]
        notes.forEach((f, i) => this.bell(when + i * 0.07, f, 0.9, 1))
        break
      }
      case 'comboLost': { this.bell(when, 220, 0.6, 0.7); this.bell(when + 0.16, 185, 0.8, 0.7); break }
      case 'gap': [784, 1175].forEach((f, i) => this.bell(when + i * 0.06, f, 0.5, 0.9)); break
      case 'letter': [880, 1108, 1318].forEach((f, i) => this.bell(when + i * 0.06, f, 0.7, 1)); break
      case 'honk': if (e.van) this.vanHorn(when); else if (t) this.horn(e.robo, Math.hypot(e.x - t.pos.x, e.y - t.pos.y), when, !!(e as { tram?: boolean }).tram); break
      // Driving: the door (in, out), a bump, a hard landing.
      case 'vehicleEnter': case 'vehicleExit': { const U = this.d?.drive.unlock; if (U && U.types.includes(e.type)) { const [a, b] = e.t === 'vehicleEnter' ? U.hz : [U.hz[1], U.hz[0]]; this.bell(when, a, 0.09, U.gain); this.bell(when + 0.1, b, 0.12, U.gain) } else this.door(when); break }   // a scooter chirps (unlocked, locked), a van's door thumps
      case 'vanBump': this.thump(when, d.drive.bump.gain * Math.min(1, e.speed / 8), d.drive.bump.hz); break
      case 'vanLand': this.thump(when, d.drive.bump.gain * Math.min(1, e.speed / 6), d.drive.bump.hz * 1.3); break
      case 'carHit': {
        this.sample('impactMetal_medium', when, 0.9, 0.7, 0.85); this.sample('impactPlate_light', when + 0.03, 0.7, 0.8, 1.0)
        this.thump(when, 0.9, 55)
        if (e.robo) { this.bell(when + 0.35, 880, 0.4, 0.8); this.bell(when + 0.55, 660, 0.6, 0.8) }   // the robotaxi apologises
        break
      }
      case 'skitchStart': this.sample('impactMetal_light', when, 0.7, 1.1, 1.3); this.sample('impactPlate_light', when + 0.02, 0.4, 1.2, 1.4); break
      case 'skitchEnd': if (e.reason === 'let go' || e.reason === 'ollie' || e.reason === 'void') this.burst(when, 0.4, 0.15, 'bandpass', 2000, 700, 1.5); else this.hit('bailHit', when, 0.6); break   // void: a skitch under 1 s, let go
      case 'spineTransfer': this.burst(when, 0.55, 0.28, 'bandpass', 500, 2600, 1.1); this.bell(when + 0.1, 1175, 0.6, 0.8); break
      case 'carLand': this.sample('impactMetal_light', when, 0.8, 0.9, 1.05); this.thump(when, 0.5, 80); break
      case 'goalComplete': [523, 659, 784, 1046, 1318].forEach((f, i) => this.bell(when + i * 0.08, f, 1.0, 1)); break
      case 'courierPickup': [784, 988].forEach((f, i) => this.bell(when + i * 0.07, f, 0.5, 0.9)); break
      case 'courierDeliver': [523, 659, 784, 1046].forEach((f, i) => this.bell(when + i * 0.07, f, 0.8, 1)); break
      case 'bombStart': this.bell(when, 1568, 0.5, 1); break
      case 'bombCheckpoint': this.bell(when, 1318, 0.4, 0.9); this.bell(when + 0.08, 1760, 0.5, 0.9); break
      case 'bombFinish': [784, 988, 1175, 1568].forEach((f, i) => this.bell(when + i * 0.1, f, 1.1, 1)); break
      case 'courierFail': case 'bombFail': [392, 330, 262].forEach((f, i) => this.bell(when + i * 0.18, f, 0.9, 0.8)); break
      case 'burrito': this.sample('impactSoft_medium', when, 0.5, 1.4, 1.6); [659, 988, 1318].forEach((f, i) => this.bell(when + 0.04 + i * 0.05, f, 0.5, 0.9)); break
      case 'goal': [523, 659, 784, 1046, 1318, 1568].forEach((f, i) => this.bell(when + i * 0.09, f, 1.1, 1)); break
      case 'specialReady': this.burst(when, 0.6, 0.2, 'bandpass', 400, 4000, 3); this.bell(when + 0.4, 1318, 1.2, 1); break
      case 'runOver': [784, 659, 523, 392].forEach((f, i) => this.bell(when + i * 0.18, f, 1.2, 1)); break
      // Pedestrians: a near miss is a whoosh past; a hit, a thump and an "oof".
      case 'nearMiss': this.burst(when, 0.45, 0.22, 'bandpass', 700, 2400, 1.2); break
      case 'pedHit': this.thump(when, e.bail ? 0.7 : 0.35, 110); if (e.bail) this.burst(when + 0.03, 0.4, 0.18, 'bandpass', 500, 300, 2.5); break
      // Game of S.K.A.T.E.: a set lands, a match lands (bright), a letter (sour), the end (who won).
      case 'skateSet': this.bell(when, 988, 0.5, 0.9); this.bell(when + 0.07, 1318, 0.6, 0.9); break
      case 'skateMatch': if (e.ok) [784, 1175].forEach((f, i) => this.bell(when + i * 0.07, f, 0.6, 0.9)); break
      case 'skateLetter': [466, 349].forEach((f, i) => this.bell(when + i * 0.16, f, 0.9, e.who === 'player' ? 0.9 : 0.7)); break
      case 'skateOver': (e.winner === 'player' ? [523, 659, 784, 1046, 1318] : [392, 330, 262, 196]).forEach((f, i) => this.bell(when + i * 0.12, f, 1.1, 1)); break
    }
  }
}

function gain(ctx: BaseAudioContext, v: number, out: AudioNode) { const g = ctx.createGain(); g.gain.value = v; g.connect(out); return g }

/** White, pink, brown noise and a sparse crackle (asphalt grit), 3 s each, seeded. */
function makeNoise(ctx: BaseAudioContext, r: () => number) {
  const len = Math.floor(ctx.sampleRate * 3)
  const mk = (fill: (d: Float32Array) => void) => { const b = ctx.createBuffer(1, len, ctx.sampleRate); fill(b.getChannelData(0)); return b }
  const white = mk((d) => { for (let i = 0; i < d.length; i++) d[i] = r() * 2 - 1 })
  const pink = mk((d) => {
    let b0 = 0, b1 = 0, b2 = 0
    for (let i = 0; i < d.length; i++) { const w = r() * 2 - 1; b0 = 0.99765 * b0 + w * 0.099046; b1 = 0.963 * b1 + w * 0.2965164; b2 = 0.57 * b2 + w * 1.0526913; d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2 }
  })
  const brown = mk((d) => { let x = 0; for (let i = 0; i < d.length; i++) { x = (x + 0.02 * (r() * 2 - 1)) / 1.02; d[i] = x * 3.5 } })
  const crackle = mk((d) => {
    for (let i = 0; i < d.length; i++) d[i] = (r() * 2 - 1) * 0.03
    const n = Math.floor(len / ctx.sampleRate * 260)
    for (let k = 0; k < n; k++) {
      const at = Math.floor(r() * (len - 64)), a = (0.2 + r() * 0.8) * (r() < 0.5 ? -1 : 1)
      for (let j = 0; j < 48; j++) d[at + j] += a * Math.exp(-j / 6) * (j % 2 ? -1 : 1)
    }
  })
  return { white, pink, brown, crackle }
}

/** A concrete underpass: stereo decaying noise, darker as it fades. */
function impulse(ctx: BaseAudioContext, seconds: number, r: () => number): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds)
  const b = ctx.createBuffer(2, len, ctx.sampleRate)
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c)
    let lp = 0
    for (let i = 0; i < len; i++) {
      const t = i / len
      const k = 0.2 + 0.75 * t   // more smoothing later = darker tail
      lp = lp * k + (r() * 2 - 1) * (1 - k)
      d[i] = (i < ctx.sampleRate * 0.012 ? 0 : lp) * Math.pow(1 - t, 3.2) * 2.2
    }
  }
  return b
}

/** Which 1 m cells lie under the freeway deck (for echo and rumble); once per source (clips make their own Sound later). */
const decks = new WeakMap<ParkSource, ReturnType<typeof deckGridOf>>()
function deckGrid(src: ParkSource) {
  if (!decks.has(src)) decks.set(src, deckGridOf(src))
  return decks.get(src)!
}
function deckGridOf(src: ParkSource) {
  const deck = src.elements.filter((e) => e.collection === 'freeway_deck')
  if (!deck.length) return null
  const p = src.positions, ix = src.indices
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const e of deck) for (let t = e.tris[0]; t < e.tris[0] + e.tris[1]; t++) for (let k = 0; k < 3; k++) {
    const v = ix[t * 3 + k] * 3; x0 = Math.min(x0, p[v]); y0 = Math.min(y0, p[v + 1]); x1 = Math.max(x1, p[v]); y1 = Math.max(y1, p[v + 1])
  }
  x0 = Math.floor(x0); y0 = Math.floor(y0)
  const w = Math.ceil(x1 - x0) + 1, h = Math.ceil(y1 - y0) + 1
  const cells = new Uint8Array(w * h)
  for (const e of deck) for (let t = e.tris[0]; t < e.tris[0] + e.tris[1]; t++) {
    const a = ix[t * 3] * 3, b = ix[t * 3 + 1] * 3, c = ix[t * 3 + 2] * 3
    const ax = p[a] - x0, ay = p[a + 1] - y0, bx = p[b] - x0, by = p[b + 1] - y0, cx = p[c] - x0, cy = p[c + 1] - y0
    const den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
    if (Math.abs(den) < 1e-9) continue
    for (let j = Math.floor(Math.min(ay, by, cy)); j <= Math.ceil(Math.max(ay, by, cy)); j++) for (let i = Math.floor(Math.min(ax, bx, cx)); i <= Math.ceil(Math.max(ax, bx, cx)); i++) {
      const px = i + 0.5, py = j + 0.5
      const l1 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / den, l2 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / den
      if (l1 >= 0 && l2 >= 0 && l1 + l2 <= 1 && i >= 0 && j >= 0 && i < w && j < h) cells[j * w + i] = 1
    }
  }
  return { x0, y0, w, h, cells }
}
