// SoMa Skate FM: lo-fi beats generated live (no files, no internet). A swung boom-bap kit,
// a bass line, jazzy seventh chords through a warm lowpass, vinyl crackle, and a new chord
// progression and drum variation every eight bars from a seeded generator. Scheduled a bar
// ahead on its own AudioContext so it never competes with the game's sound timing.

function rng(seed: number) {
  let a = seed >>> 0
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}

const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12)
// Seventh chords as semitones over the root, and progressions as scale-degree roots (in a minor key).
const CHORDS: Record<string, number[]> = { m7: [0, 3, 7, 10], maj7: [0, 4, 7, 11], dom7: [0, 4, 7, 10], m9: [0, 3, 7, 10, 14] }
const PROGRESSIONS: [number, string][][] = [
  [[0, 'm9'], [5, 'm7'], [10, 'maj7'], [3, 'maj7']],
  [[0, 'm7'], [8, 'maj7'], [3, 'maj7'], [10, 'dom7']],
  [[5, 'm7'], [10, 'dom7'], [3, 'maj7'], [8, 'maj7']],
  [[0, 'm9'], [3, 'maj7'], [8, 'maj7'], [7, 'dom7']],
]

export class LofiStation {
  private ctx: AudioContext | null = null
  private out!: GainNode
  private timer = 0
  private nextBar = 0
  private bar = 0
  private r = rng(1712)
  private key = 57   // A minor
  private prog = PROGRESSIONS[0]
  private noise!: AudioBuffer
  private crackle: AudioBufferSourceNode | null = null
  private volume = 0.5
  playing = false
  /** A new song starts (every 32 bars; its number), called when it is heard. */
  onSong: (n: number) => void = () => {}

  setVolume(v: number) { this.volume = v; if (this.out) this.out.gain.value = v * 0.55 }

  /** The signal chain on a context (a live AudioContext, or an offline one for clips). */
  build(ctx: BaseAudioContext, dest: AudioNode = ctx.destination) {
    this.ctx = ctx as AudioContext
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -16; comp.ratio.value = 3
    this.out = ctx.createGain(); this.out.gain.value = this.volume * 0.55
    // Warm and a bit dusty: everything through a gentle lowpass.
    const warm = ctx.createBiquadFilter(); warm.type = 'lowpass'; warm.frequency.value = 5200; warm.Q.value = 0.5
    this.out.connect(warm).connect(comp).connect(dest)
    const len = ctx.sampleRate * 2
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate)
    const d = this.noise.getChannelData(0), nr = rng(9)
    for (let i = 0; i < len; i++) d[i] = nr() * 2 - 1
  }

  /** A whole stretch at once on an offline context (clips): secs of music from t = 0. */
  renderInto(ctx: BaseAudioContext, secs: number) {
    this.build(ctx); this.vinyl()
    for (let t = 0.05; t < secs; t += this.barSeconds()) this.scheduleBar(t)
  }

  start() {
    if (this.playing) return
    if (!this.ctx) this.build(new AudioContext())
    void this.ctx!.resume()
    this.playing = true
    this.nextBar = this.ctx!.currentTime + 0.1
    this.vinyl()
    const tick = () => {
      if (!this.ctx || !this.playing) return
      while (this.nextBar < this.ctx.currentTime + 1.2) { this.scheduleBar(this.nextBar); this.nextBar += this.barSeconds() }
      this.timer = window.setTimeout(tick, 250)
    }
    tick()
  }

  stop() {
    this.playing = false
    clearTimeout(this.timer)
    this.crackle?.stop(); this.crackle = null
    void this.ctx?.suspend()
  }

  /** The live context and this station's output, for the DJ talking over it (radio.ts). */
  get audio() { return this.ctx instanceof AudioContext && this.out ? { ctx: this.ctx, out: this.out } : null }

  private barSeconds() { return (60 / 82) * 4 }

  /** Vinyl crackle: sparse clicks over a quiet hiss, looped. */
  private vinyl() {
    const ctx = this.ctx!, len = ctx.sampleRate * 3, b = ctx.createBuffer(1, len, ctx.sampleRate), d = b.getChannelData(0), cr = rng(77)
    for (let i = 0; i < len; i++) d[i] = (cr() * 2 - 1) * 0.012
    for (let k = 0; k < 90; k++) { const at = Math.floor(cr() * (len - 40)), a = (0.2 + cr() * 0.6) * (cr() < 0.5 ? -1 : 1); for (let j = 0; j < 30; j++) d[at + j] += a * Math.exp(-j / 4) }
    const src = ctx.createBufferSource(); src.buffer = b; src.loop = true
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 800
    const g = ctx.createGain(); g.gain.value = 0.35
    src.connect(hp).connect(g).connect(this.out); src.start()
    this.crackle = src
  }

  private scheduleBar(t0: number) {
    const r = this.r
    if (this.bar % 32 === 0 && this.ctx instanceof AudioContext) {
      const n = this.bar / 32, ctx = this.ctx
      window.setTimeout(() => { if (this.playing) this.onSong(n) }, Math.max(0, (t0 - ctx.currentTime) * 1000))
    }
    if (this.bar % 8 === 0) {   // a new progression (and sometimes a new key) every eight bars
      this.prog = PROGRESSIONS[Math.floor(r() * PROGRESSIONS.length)]
      if (this.bar > 0 && r() < 0.3) this.key = [55, 57, 58, 60, 62][Math.floor(r() * 5)]
    }
    const beat = 60 / 82, swing = 0.58   // swung eighths
    const eighth = (i: number) => t0 + Math.floor(i / 2) * beat + (i % 2 ? beat * swing : 0)
    const [deg, kind] = this.prog[this.bar % 4]
    const root = this.key + deg
    // Drums: boom-bap with a little variation.
    const kicks = r() < 0.7 ? [0, 5] : [0, 3, 5]
    for (const k of kicks) this.kick(eighth(k), k === 0 ? 1 : 0.8)
    for (const s of [2, 6]) this.snare(eighth(s))
    for (let i = 0; i < 8; i++) if (i % 2 === 0 || r() < 0.7) this.hat(eighth(i), i % 2 ? 0.35 : 0.55)
    // Bass: root on the one, a fifth or octave walk.
    this.bass(eighth(0), midi(root - 24), beat * 1.6)
    this.bass(eighth(3), midi(root - 24 + (r() < 0.5 ? 7 : 12)), beat * 0.6)
    this.bass(eighth(5), midi(root - 24 + (r() < 0.5 ? 10 : 3)), beat * 0.9)
    // Chords: a soft Rhodes-ish stab on the one and an echo on the and-of-three.
    const notes = CHORDS[kind].map((n) => midi(root + n))
    this.chord(t0 + 0.01, notes, beat * 2.2, 0.06)
    if (r() < 0.6) this.chord(eighth(5), notes, beat * 1.4, 0.035)
    this.bar++
  }

  private kick(t: number, v: number) {
    const ctx = this.ctx!, o = ctx.createOscillator(), g = ctx.createGain()
    o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.12)
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.9 * v, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35)
    o.connect(g).connect(this.out); o.start(t); o.stop(t + 0.4)
  }
  private snare(t: number) {
    const ctx = this.ctx!, src = ctx.createBufferSource(), bp = ctx.createBiquadFilter(), g = ctx.createGain()
    src.buffer = this.noise; bp.type = 'bandpass'; bp.frequency.value = 1800; bp.Q.value = 0.7
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.45, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22)
    src.connect(bp).connect(g).connect(this.out); src.start(t, this.r() * 1.5); src.stop(t + 0.25)
    const o = ctx.createOscillator(), og = ctx.createGain(); o.frequency.value = 190
    og.gain.setValueAtTime(0.25, t); og.gain.exponentialRampToValueAtTime(0.0001, t + 0.09)
    o.connect(og).connect(this.out); o.start(t); o.stop(t + 0.1)
  }
  private hat(t: number, v: number) {
    const ctx = this.ctx!, src = ctx.createBufferSource(), hp = ctx.createBiquadFilter(), g = ctx.createGain()
    src.buffer = this.noise; hp.type = 'highpass'; hp.frequency.value = 7500
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.12 * v, t + 0.002); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05)
    src.connect(hp).connect(g).connect(this.out); src.start(t, this.r() * 1.5); src.stop(t + 0.06)
  }
  private bass(t: number, f: number, dur: number) {
    const ctx = this.ctx!, o = ctx.createOscillator(), lp = ctx.createBiquadFilter(), g = ctx.createGain()
    o.type = 'triangle'; o.frequency.value = f; lp.type = 'lowpass'; lp.frequency.value = 600
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.32, t + 0.02); g.gain.setValueAtTime(0.32, t + dur * 0.7); g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    o.connect(lp).connect(g).connect(this.out); o.start(t); o.stop(t + dur + 0.05)
  }
  private chord(t: number, notes: number[], dur: number, vol: number) {
    const ctx = this.ctx!, lp = ctx.createBiquadFilter(), g = ctx.createGain()
    lp.type = 'lowpass'; lp.frequency.setValueAtTime(1800, t); lp.frequency.exponentialRampToValueAtTime(700, t + dur)
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    lp.connect(g).connect(this.out)
    for (const f of notes) for (const det of [-6, 5]) {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = det
      o.connect(lp); o.start(t); o.stop(t + dur + 0.05)
    }
  }
}
