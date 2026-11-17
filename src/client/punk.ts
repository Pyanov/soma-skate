// Fog City Punk: fast skate punk generated live (no files, no internet). Distorted power chords
// doubled left and right, a bass that follows the root in eighths, a 180 bpm kit with crashes on
// the downbeats, and songs built from verse (palm-muted), chorus (open strums, a "whoa-oh" lead)
// and a tom-fill break, in a new key and progression every song. Same shape as LofiStation:
// scheduled a bar ahead on its own AudioContext.

function rng(seed: number) {
  let a = seed >>> 0
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}

const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12)
// Progressions as semitones over the key's root (major keys), four bars each.
const PROGRESSIONS = [
  [0, 7, 9, 5],    // I V vi IV
  [0, 5, 7, 5],    // I IV V IV
  [9, 5, 0, 7],    // vi IV I V
  [0, 10, 5, 0],   // I bVII IV I
  [0, 3, 5, 7],    // I bIII IV V
]
const KEYS = [40, 45, 43, 38, 42]   // E, A, G, D, F# (guitar-friendly)
// One song: section names with lengths in bars.
const FORM: [kind: 'intro' | 'verse' | 'chorus' | 'break', bars: number][] = [['intro', 4], ['verse', 8], ['chorus', 8], ['verse', 8], ['chorus', 8], ['break', 2], ['chorus', 8]]

export class PunkStation {
  private ctx: BaseAudioContext | null = null
  private out!: GainNode
  private amp!: { pre: GainNode; pan: StereoPannerNode }[]
  private timer = 0
  private nextBar = 0
  private r = rng(1977)
  private key = KEYS[0]
  private prog = PROGRESSIONS[0]
  private section = 0
  private barInSection = 0
  private noise!: AudioBuffer
  private volume = 0.5
  playing = false
  /** A new song starts (its number); called when it is heard, not when it is scheduled. */
  onSong: (n: number) => void = () => {}
  private songs = 0

  setVolume(v: number) { this.volume = v; if (this.out) this.out.gain.value = v * 0.5 }

  start() {
    if (this.playing) return
    if (!this.ctx) this.build(new AudioContext())
    const ctx = this.ctx as AudioContext
    void ctx.resume()
    this.playing = true
    this.nextBar = ctx.currentTime + 0.1
    const tick = () => {
      if (!this.ctx || !this.playing) return
      while (this.nextBar < ctx.currentTime + 1.0) { this.scheduleBar(this.nextBar); this.nextBar += this.barSeconds() }
      this.timer = window.setTimeout(tick, 200)
    }
    tick()
  }

  stop() {
    this.playing = false
    clearTimeout(this.timer)
    void (this.ctx as AudioContext | null)?.suspend()
  }

  /** The signal chain: two guitar amps (distortion into a cabinet, panned apart) and a bus compressor. */
  build(ctx: BaseAudioContext, dest: AudioNode = ctx.destination) {
    this.ctx = ctx
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -18; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.12
    this.out = ctx.createGain(); this.out.gain.value = this.volume * 0.5
    this.out.connect(comp).connect(dest)
    const curve = new Float32Array(2048), k = 90
    for (let i = 0; i < curve.length; i++) { const x = (i / (curve.length - 1)) * 2 - 1; curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x)) }
    this.amp = [-0.65, 0.65].map((p) => {
      const pre = ctx.createGain(); pre.gain.value = 1
      const shaper = ctx.createWaveShaper(); shaper.curve = curve; shaper.oversample = '2x'
      // Cabinet: cut the fizz and the mud, a little mid bite.
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 90
      const mid = ctx.createBiquadFilter(); mid.type = 'peaking'; mid.frequency.value = 1400; mid.gain.value = 4; mid.Q.value = 0.8
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3800; lp.Q.value = 0.6
      const lvl = ctx.createGain(); lvl.gain.value = 0.16
      const pan = ctx.createStereoPanner(); pan.pan.value = p
      pre.connect(shaper).connect(hp).connect(mid).connect(lp).connect(lvl).connect(pan).connect(this.out)
      return { pre, pan }
    })
    const len = ctx.sampleRate * 2
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate)
    const d = this.noise.getChannelData(0), nr = rng(5)
    for (let i = 0; i < len; i++) d[i] = nr() * 2 - 1
  }

  /** A whole stretch at once on an offline context (clips): secs of music from t = 0, from a verse. */
  renderInto(ctx: BaseAudioContext, secs: number) {
    this.build(ctx); this.section = 1; this.barInSection = 0
    for (let t = 0.05; t < secs; t += this.barSeconds()) this.scheduleBar(t)
  }

  private bpm = 180
  /** The live context and this station's output, for the DJ talking over it (radio.ts). */
  get audio() { return this.ctx instanceof AudioContext && this.out ? { ctx: this.ctx, out: this.out } : null }

  barSeconds() { return (60 / this.bpm) * 4 }

  scheduleBar(t0: number) {
    const r = this.r
    let [kind, bars] = FORM[this.section]
    if (this.barInSection >= bars) {
      this.section = (this.section + 1) % FORM.length; this.barInSection = 0
      if (this.section === 0) {   // a new song: key, progression, tempo
        this.key = KEYS[Math.floor(r() * KEYS.length)]
        this.prog = PROGRESSIONS[Math.floor(r() * PROGRESSIONS.length)]
        this.bpm = 172 + Math.floor(r() * 4) * 6
      }
      ;[kind, bars] = FORM[this.section]
    }
    const bar = this.barInSection++
    if (this.section === 0 && bar === 0 && typeof window !== 'undefined' && this.ctx instanceof AudioContext) {
      const n = this.songs++, ctx = this.ctx
      window.setTimeout(() => { if (this.playing) this.onSong(n) }, Math.max(0, (t0 - ctx.currentTime) * 1000))
    }
    const beat = 60 / this.bpm, e = (i: number) => t0 + i * beat / 2
    const root = this.key + this.prog[bar % 4]
    const last = bar === bars - 1
    if (kind === 'break') {
      // Stop-time: one big hit, then a tom roll into the chorus.
      if (bar === 0) { this.crash(t0); this.kick(t0); this.strum(t0, root, beat * 1.8, false) }
      else for (let i = 0; i < 8; i++) this.tom(e(i), 1 - i / 10, 150 - i * 11)
      return
    }
    // Drums. Intro: hats and kicks building; verse: skank beat (kick on the beat, snare on the off);
    // chorus: driving 8ths with the snare on 2 and 4.
    if (bar === 0 || (kind === 'chorus' && bar % 4 === 0)) this.crash(t0)
    if (kind === 'verse') {
      for (let i = 0; i < 8; i++) { if (i % 2 === 0) this.kick(e(i)); else this.snare(e(i), 0.7); this.hat(e(i), 0.5) }
    } else if (kind === 'chorus') {
      for (const i of [0, 3, 4, 7]) this.kick(e(i))
      for (const i of [2, 6]) this.snare(e(i), 1)
      for (let i = 0; i < 8; i++) this.ride(e(i), i % 2 ? 0.45 : 0.7)
    } else {
      for (let i = 0; i < 8; i++) this.hat(e(i), bar < 2 ? 0.35 : 0.6)
      if (bar >= 2) for (const i of [0, 4]) this.kick(e(i))
    }
    if (last && kind !== 'intro') for (let i = 4; i < 8; i++) this.snare(e(i), 0.5 + (i - 4) * 0.15)   // a fill into the next part
    // Guitars and bass.
    const muted = kind === 'verse' || (kind === 'intro' && bar < 2)
    if (kind === 'intro' && bar < 2) { this.strum(t0, root, beat * 3.5, false); return }
    for (let i = 0; i < 8; i++) {
      this.strum(e(i), root, muted ? beat * 0.32 : beat * 0.5, muted)
      this.bass(e(i), midi(root - 12), beat * 0.45)
    }
    // Whoa-oh: a lead on the chorus, a two-bar phrase over the progression.
    if (kind === 'chorus' && r() < 0.85) {
      const phrase = bar % 2 === 0 ? [[0, 4, 7], [4, 4, 4]] : [[0, 3, 9], [3, 5, 7]]
      for (const [at, len, iv] of phrase) this.whoa(e(at), midi(root + 12 + iv), beat * len * 0.5 * 0.95)
    }
  }

  /** A power chord (root, fifth, octave) on both amps; muted is a palm mute (short, dark, chunky). */
  private strum(t: number, root: number, dur: number, muted: boolean) {
    const ctx = this.ctx!
    for (const [side, a] of this.amp.entries()) {
      const tone = ctx.createBiquadFilter(); tone.type = 'lowpass'; tone.frequency.value = muted ? 700 : 2600
      const g = ctx.createGain()
      const off = side * 0.006   // the second guitarist is a hair late
      g.gain.setValueAtTime(0.0001, t + off); g.gain.exponentialRampToValueAtTime(muted ? 0.55 : 0.8, t + off + 0.004)
      g.gain.setValueAtTime(muted ? 0.4 : 0.7, t + off + dur * 0.6); g.gain.exponentialRampToValueAtTime(0.0001, t + off + dur)
      tone.connect(g).connect(a.pre)
      for (const n of [0, 7, 12]) {
        const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = midi(root + n); o.detune.value = side ? 7 : -7
        o.connect(tone); o.start(t + off); o.stop(t + off + dur + 0.02)
      }
    }
  }
  private bass(t: number, f: number, dur: number) {
    const ctx = this.ctx!, o = ctx.createOscillator(), lp = ctx.createBiquadFilter(), g = ctx.createGain()
    o.type = 'sawtooth'; o.frequency.value = f; lp.type = 'lowpass'; lp.frequency.value = 520; lp.Q.value = 1.2
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.36, t + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    o.connect(lp).connect(g).connect(this.out); o.start(t); o.stop(t + dur + 0.02)
  }
  /** A gang-vocal-ish "whoa": two detuned saws through vowel formants, with a little scoop and vibrato. */
  private whoa(t: number, f: number, dur: number) {
    const ctx = this.ctx!, g = ctx.createGain(), mix = ctx.createGain(); mix.gain.value = 1
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.14, t + 0.06); g.gain.setValueAtTime(0.12, t + dur * 0.8); g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    for (const [fr, q, lvl] of [[620, 6, 1], [1050, 8, 0.6], [2500, 10, 0.25]]) {   // "oh"
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = fr; bp.Q.value = q
      const l = ctx.createGain(); l.gain.value = lvl * 3
      mix.connect(bp).connect(l).connect(g)
    }
    g.connect(this.out)
    const lfo = ctx.createOscillator(), depth = ctx.createGain(); lfo.frequency.value = 5.5; depth.gain.value = 9
    lfo.connect(depth); lfo.start(t); lfo.stop(t + dur + 0.05)
    for (const det of [-10, 0, 12]) {
      const o = ctx.createOscillator(); o.type = 'sawtooth'
      o.frequency.setValueAtTime(f * 0.94, t); o.frequency.exponentialRampToValueAtTime(f, t + 0.08); o.detune.value = det
      depth.connect(o.detune); o.connect(mix); o.start(t); o.stop(t + dur + 0.05)
    }
  }
  private kick(t: number) {
    const ctx = this.ctx!, o = ctx.createOscillator(), g = ctx.createGain()
    o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(48, t + 0.08)
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(1, t + 0.003); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22)
    o.connect(g).connect(this.out); o.start(t); o.stop(t + 0.25)
    this.noiseHit(t, 'highpass', 3000, 0.25, 0.012)   // beater click
  }
  private snare(t: number, v: number) {
    this.noiseHit(t, 'bandpass', 2200, 0.55 * v, 0.16, 0.6)
    const ctx = this.ctx!, o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'triangle'
    o.frequency.setValueAtTime(240, t); o.frequency.exponentialRampToValueAtTime(170, t + 0.05)
    g.gain.setValueAtTime(0.3 * v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.08)
    o.connect(g).connect(this.out); o.start(t); o.stop(t + 0.1)
  }
  private hat(t: number, v: number) { this.noiseHit(t, 'highpass', 8000, 0.14 * v, 0.04) }
  private ride(t: number, v: number) { this.noiseHit(t, 'bandpass', 6500, 0.12 * v, 0.22, 1.5) }
  private crash(t: number) { this.noiseHit(t, 'highpass', 4500, 0.32, 1.4) }
  private tom(t: number, v: number, f: number) {
    const ctx = this.ctx!, o = ctx.createOscillator(), g = ctx.createGain()
    o.frequency.setValueAtTime(f * 1.4, t); o.frequency.exponentialRampToValueAtTime(f, t + 0.05)
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.6 * v, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3)
    o.connect(g).connect(this.out); o.start(t); o.stop(t + 0.32)
  }
  private noiseHit(t: number, type: BiquadFilterType, f: number, v: number, decay: number, q = 0.7) {
    const ctx = this.ctx!, src = ctx.createBufferSource(), flt = ctx.createBiquadFilter(), g = ctx.createGain()
    src.buffer = this.noise; flt.type = type; flt.frequency.value = f; flt.Q.value = q
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v, t + 0.002); g.gain.exponentialRampToValueAtTime(0.0001, t + decay)
    src.connect(flt).connect(g).connect(this.out); src.start(t, this.r() * 1.2); src.stop(t + decay + 0.02)
  }
}
