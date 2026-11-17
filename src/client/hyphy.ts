// KSOMA Hyphy Hour: Bay Area beats generated live (no files, no internet). A booming 808 kick and
// sliding 808 bass on a minor progression, claps on two and four, hats with triplet rolls, and the
// whistly portamento lead the Bay loves. A new key, tempo and motif every song. Same shape as the
// other stations: scheduled a bar ahead on its own AudioContext, or rendered into a clip.

function rng(seed: number) {
  let a = seed >>> 0
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}

const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12)
const PROGRESSIONS = [[0, 0, 8, 7], [0, 3, 8, 7], [0, 10, 8, 10], [0, 5, 3, 7]]   // minor-key roots, a bar each
const KEYS = [36, 38, 39, 41, 43]   // C, D, Eb, F, G (808 territory)
const SONG_BARS = 32

export class HyphyStation {
  private ctx: AudioContext | null = null
  private out!: GainNode
  private timer = 0
  private nextBar = 0
  private bar = 0
  private r = rng(510)
  private key = KEYS[0]
  private prog = PROGRESSIONS[0]
  private motif: number[] = []
  private bpm = 98
  private noise!: AudioBuffer
  private volume = 0.5
  private songs = 0
  playing = false
  /** A new song starts (its number); called when it is heard. */
  onSong: (n: number) => void = () => {}

  setVolume(v: number) { this.volume = v; if (this.out) this.out.gain.value = v * 0.42 }

  build(ctx: BaseAudioContext, dest: AudioNode = ctx.destination) {
    this.ctx = ctx as AudioContext
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.15
    this.out = ctx.createGain(); this.out.gain.value = this.volume * 0.42
    this.out.connect(comp).connect(dest)
    const len = ctx.sampleRate
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate)
    const d = this.noise.getChannelData(0), nr = rng(3)
    for (let i = 0; i < len; i++) d[i] = nr() * 2 - 1
    this.newSong()
  }

  renderInto(ctx: BaseAudioContext, secs: number) {
    this.build(ctx)
    for (let t = 0.05; t < secs; t += this.barSeconds()) this.scheduleBar(t)
  }

  start() {
    if (this.playing) return
    if (!this.ctx) this.build(new AudioContext())
    const ctx = this.ctx!
    void ctx.resume()
    this.playing = true
    this.nextBar = ctx.currentTime + 0.1
    const tick = () => {
      if (!this.ctx || !this.playing) return
      while (this.nextBar < ctx.currentTime + 1.2) { this.scheduleBar(this.nextBar); this.nextBar += this.barSeconds() }
      this.timer = window.setTimeout(tick, 250)
    }
    tick()
  }

  stop() {
    this.playing = false
    clearTimeout(this.timer)
    void this.ctx?.suspend()
  }

  /** The live context and this station's output, for the DJ talking over it (radio.ts). */
  get audio() { return this.ctx instanceof AudioContext && this.out ? { ctx: this.ctx, out: this.out } : null }

  barSeconds() { return (60 / this.bpm) * 4 }

  private newSong() {
    const r = this.r
    this.key = KEYS[Math.floor(r() * KEYS.length)]
    this.prog = PROGRESSIONS[Math.floor(r() * PROGRESSIONS.length)]
    this.bpm = 92 + Math.floor(r() * 4) * 3
    // A two-bar whistle motif: 16th-note slots, scale degrees in minor pentatonic, -1 = rest.
    const scale = [0, 3, 5, 7, 10, 12, 15]
    this.motif = Array.from({ length: 32 }, (_, i) => (i % 4 === 0 || r() < 0.3 ? scale[Math.floor(r() * scale.length)] : -1))
  }

  scheduleBar(t0: number) {
    const r = this.r
    if (this.bar > 0 && this.bar % SONG_BARS === 0) this.newSong()
    if (this.bar % SONG_BARS === 0 && this.ctx instanceof AudioContext) {
      const n = this.songs++, ctx = this.ctx
      window.setTimeout(() => { if (this.playing) this.onSong(n) }, Math.max(0, (t0 - ctx.currentTime) * 1000))
    }
    const inSong = this.bar % SONG_BARS, intro = inSong < 2, breakdown = inSong >= 24 && inSong < 26
    const s16 = (60 / this.bpm) / 4, at = (i: number) => t0 + i * s16
    const root = this.key + this.prog[inSong % 4]
    // Drums: 808 kick pattern with a skip, claps on 2 and 4, hats in 8ths with triplet rolls.
    if (!intro) {
      for (const i of r() < 0.5 ? [0, 6, 10] : [0, 3, 10, 14]) this.kick808(at(i))
      if (!breakdown) for (const i of [4, 12]) this.clap(at(i))
    }
    for (let i = 0; i < 16; i += 2) {
      if (r() < 0.18 && i < 14) { const tr = (s16 * 2) / 3; for (let k = 0; k < 3; k++) this.hat(at(i) + k * tr, 0.45) }   // a roll
      else this.hat(at(i), i % 4 === 0 ? 0.6 : 0.4)
    }
    // 808 bass: the root on the one, a slide to the next chord near the end of the bar.
    if (!intro && !breakdown) {
      const next = this.key + this.prog[(inSong + 1) % 4]
      this.bass808(at(0), midi(root - 12), midi(root - 12), s16 * 7)
      this.bass808(at(10), midi(root - 12), midi(next - 12), s16 * 6)
    }
    // Whistle lead: the motif on the second half of each four-bar phrase.
    if (inSong % 4 >= 2 && !intro) {
      const half = (inSong % 2) * 16
      let prev = -1
      for (let i = 0; i < 16; i++) {
        const deg = this.motif[half + i]
        if (deg < 0) continue
        let len = 1; while (i + len < 16 && this.motif[half + i + len] < 0 && len < 4) len++
        this.whistle(at(i), midi(this.key + 24 + deg), prev >= 0 ? midi(this.key + 24 + prev) : midi(this.key + 24 + deg), s16 * len * 0.95)
        prev = deg
      }
    }
    this.bar++
  }

  private kick808(t: number) {
    const ctx = this.ctx!, o = ctx.createOscillator(), g = ctx.createGain()
    o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(48, t + 0.09)
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(1, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5)
    o.connect(g).connect(this.out); o.start(t); o.stop(t + 0.55)
  }
  private bass808(t: number, f0: number, f1: number, dur: number) {
    const ctx = this.ctx!, o = ctx.createOscillator(), sh = ctx.createWaveShaper(), g = ctx.createGain()
    const curve = new Float32Array(256); for (let i = 0; i < 256; i++) { const x = i / 127.5 - 1; curve[i] = Math.tanh(x * 2.2) }
    sh.curve = curve
    o.type = 'sine'; o.frequency.setValueAtTime(f0, t); if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur * 0.8)
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.55, t + 0.01); g.gain.setValueAtTime(0.5, t + dur * 0.75); g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    o.connect(sh).connect(g).connect(this.out); o.start(t); o.stop(t + dur + 0.02)
  }
  private clap(t: number) {
    // Three quick noise bursts then a short tail: a hand clap.
    for (const [dt, v, dec] of [[0, 0.9, 0.012], [0.011, 0.8, 0.012], [0.022, 1.0, 0.18]]) {
      const ctx = this.ctx!, src = ctx.createBufferSource(), bp = ctx.createBiquadFilter(), g = ctx.createGain()
      src.buffer = this.noise; bp.type = 'bandpass'; bp.frequency.value = 1300; bp.Q.value = 1.1
      const s = t + dt
      g.gain.setValueAtTime(0.0001, s); g.gain.exponentialRampToValueAtTime(v, s + 0.002); g.gain.exponentialRampToValueAtTime(0.0001, s + dec)
      src.connect(bp).connect(g).connect(this.out); src.start(s, this.r() * 0.8); src.stop(s + dec + 0.02)
    }
  }
  private hat(t: number, v: number) {
    const ctx = this.ctx!, src = ctx.createBufferSource(), hp = ctx.createBiquadFilter(), g = ctx.createGain()
    src.buffer = this.noise; hp.type = 'highpass'; hp.frequency.value = 9000
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.13 * v, t + 0.002); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.035)
    src.connect(hp).connect(g).connect(this.out); src.start(t, this.r() * 0.8); src.stop(t + 0.045)
  }
  /** The whistle: a pure-ish tone gliding from the last note, with vibrato that comes in late. */
  private whistle(t: number, f: number, from: number, dur: number) {
    const ctx = this.ctx!, o = ctx.createOscillator(), g = ctx.createGain(), lp = ctx.createBiquadFilter()
    const lfo = ctx.createOscillator(), depth = ctx.createGain()
    o.type = 'triangle'; o.frequency.setValueAtTime(from, t); o.frequency.exponentialRampToValueAtTime(f, t + Math.min(0.06, dur * 0.4))
    lfo.frequency.value = 6; depth.gain.setValueAtTime(0, t); depth.gain.linearRampToValueAtTime(f * 0.012, t + dur)
    lfo.connect(depth).connect(o.frequency)
    lp.type = 'lowpass'; lp.frequency.value = 4200
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.11, t + 0.015); g.gain.setValueAtTime(0.1, t + dur * 0.8); g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    o.connect(lp).connect(g).connect(this.out); o.start(t); o.stop(t + dur + 0.02); lfo.start(t); lfo.stop(t + dur + 0.02)
  }
}
