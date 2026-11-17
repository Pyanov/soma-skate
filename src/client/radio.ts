import { z } from 'zod'
import { LofiStation } from './lofi.ts'
import { PunkStation } from './punk.ts'
import { HyphyStation } from './hyphy.ts'
import { chain, decodeLine, type VoicesData } from './voicelines.ts'

// In-game radio (data/radio.json): the game's own stations, generated in the browser (lofi.ts, punk.ts,
// hyphy.ts), each with its DJ. A station may instead be a stream URL played from its own server (nothing
// re-hosted); the release ships none, because a stream needs its station's written permission for
// third-party players (docs/roadmap.md). Client only; streams never go into `skate clip` output.

const station = z.object({
  id: z.string(), name: z.string(), where: z.string(), about: z.string(), url: z.string().url().optional(), home: z.string().url().optional(),
  synth: z.enum(['lofi', 'punk', 'hyphy']).optional(),   // generated in the browser (src/client/lofi.ts, punk.ts, hyphy.ts), no stream
  songs: z.array(z.string()).optional(),        // made-up titles for the generated stations' songs
  dj: z.object({ id: z.string(), lines: z.array(z.string()), every: z.number().int().positive(), duck: z.number().min(0).max(1) }).strict().optional(),   // a generated station's DJ (data/voices.json lines)
}).strict()
export const radioSchema = z.object({ _doc: z.string().optional(), volume: z.number().min(0).max(1), pollSeconds: z.number().positive(), startOn: z.boolean(), stations: z.array(station).min(1) }).strict()
export type RadioData = z.infer<typeof radioSchema>

const KEY = 'soma-skate:radio'

export class Radio {
  private d: RadioData
  private el: HTMLAudioElement | null = null
  private i: number
  private on = false
  private poll = 0
  private gens = { lofi: new LofiStation(), punk: new PunkStation(), hyphy: new HyphyStation() }
  /** A generated station starts a new song: show its made-up title. */
  private song(kind: 'lofi' | 'punk' | 'hyphy', n: number) {
    const s = this.d.stations[this.i]
    if (!this.on || s.synth !== kind || !s.songs?.length) return
    // Right after tuning in, let the station's own line show first.
    const wait = this.tunedAt + 3500 - performance.now(), title = s.songs[n % s.songs.length]
    // The DJ: a line every few songs (the station ID was said on tuning in).
    if (s.dj && ++this.djSongs % s.dj.every === 0) void this.say(kind, s.dj.lines[(this.djSongs / s.dj.every - 1) % s.dj.lines.length], s.dj.duck)
    if (wait > 0) { window.setTimeout(() => { if (this.on && this.d.stations[this.i] === s) this.onShow(`📻 ${s.name}`, `now playing: ${title}`) }, wait); return }
    this.onShow(`📻 ${s.name}`, `now playing: ${title}`)
  }
  private djSongs = 0
  private voices: Promise<VoicesData | null> | null = null
  private djBufs = new Map<string, Promise<AudioBuffer | null>>()
  /** Fetch and decode a station's DJ lines (on tuning in, so the ID is ready to say). */
  private djLoad(kind: 'lofi' | 'punk' | 'hyphy', ids: string[]) {
    const a = this.gens[kind].audio
    if (!a) return
    this.voices ??= fetch('data/voices.json', { cache: 'no-store' }).then((r) => r.json() as Promise<VoicesData>).catch(() => null)
    for (const id of ids) if (!this.djBufs.has(id)) this.djBufs.set(id, decodeLine(a.ctx, id))
  }
  /** A DJ line over the generated station, its music ducked under it. */
  private async say(kind: 'lofi' | 'punk' | 'hyphy', id: string, duck: number) {
    const a = this.gens[kind].audio
    if (!a) return
    this.djLoad(kind, [id])
    const voices = await this.voices, buf = await this.djBufs.get(id)
    const line = voices?.lines[id], voice = line && voices.voices[line.voice]
    if (!voice || !buf || !this.on || this.d.stations[this.i].synth !== kind) return
    const { ctx, out } = a, t = ctx.currentTime + 0.05, g = out.gain, v = g.value
    const level = ctx.createGain(); level.gain.value = this.d.volume * this.userVolume
    level.connect(ctx.destination)
    const src = ctx.createBufferSource(); src.buffer = buf; src.connect(chain(ctx, voice.speaker, level))
    src.onended = () => level.disconnect()
    src.start(t + 0.3)
    window.setTimeout(() => this.onCaption(voice.name ?? this.d.stations[this.i].name, line.text, buf.duration), 350)
    g.cancelScheduledValues(t); g.setValueAtTime(v, t); g.linearRampToValueAtTime(v * duck, t + 0.3)
    g.setValueAtTime(v * duck, t + 0.3 + buf.duration); g.linearRampToValueAtTime(v, t + 0.9 + buf.duration)
  }
  private stopGens(except?: 'lofi' | 'punk' | 'hyphy') { for (const [k, g] of Object.entries(this.gens)) if (k !== except) g.stop() }
  onShow: (title: string, line: string) => void = () => {}
  /** A DJ line starts: the station, the words and how long it lasts (captions). */
  onCaption: (who: string, text: string, seconds: number) => void = () => {}

  constructor(data: RadioData) {
    this.d = data
    this.gens.lofi.onSong = (n) => this.song('lofi', n)
    this.gens.punk.onSong = (n) => this.song('punk', n)
    this.gens.hyphy.onSong = (n) => this.song('hyphy', n)
    let saved: { i?: number; on?: boolean } = {}
    try { saved = JSON.parse(localStorage.getItem(KEY) ?? '{}') } catch { /* private window */ }
    this.i = Math.max(0, Math.min(data.stations.length - 1, saved.i ?? 0))
    this.on = saved.on ?? data.startOn
  }

  static async load(): Promise<Radio | null> {
    try { return new Radio(radioSchema.parse(await (await fetch('data/radio.json', { cache: 'no-store' })).json())) } catch { return null }
  }

  /** Stations for the menu picker. */
  get stations() { return this.d.stations.map((s, i) => ({ i, name: s.name, where: s.where, about: s.about, on: this.on && i === this.i })) }
  /** Tune a station by index (menu picker). */
  pick(i: number) { this.dir = 1; this.tune(i) }
  get isOn() { return this.on }
  /** The generated station playing now (lofi or punk), for share clips; null for streams or off. */
  get synthPlaying() { return this.on ? this.d.stations[this.i].synth ?? null : null }
  /** Its volume as heard (data volume x the player's), for mixing it into a clip. */
  get level() { return this.d.volume * this.userVolume }

  /** Station name for the menu, or 'off'. */
  get current() { return this.on ? this.d.stations[this.i].name : 'off' }

  /** After the first key press (browsers block audio before a gesture). */
  start() { if (this.on) this.tune(this.i) }

  setData(json: unknown) {
    this.d = radioSchema.parse(json)
    if (this.el) this.el.volume = this.d.volume * this.userVolume
  }

  /** Player volume (settings), 0..1, on top of data/radio.json. */
  private userVolume = 1
  setVolume(v: number) { this.userVolume = v; if (this.el) this.el.volume = this.d.volume * v; for (const g of Object.values(this.gens)) g.setVolume(this.d.volume * v) }

  private dir = 1   // the way the player is tuning, so a dead station is skipped in that direction
  next(dir = 1) {
    const n = this.d.stations.length
    this.dir = dir
    this.tune(this.on ? (this.i + dir + n) % n : this.i)
  }

  toggle() {
    if (this.on) this.off()
    else this.tune(this.i)
  }

  private off() {
    this.on = false
    this.stopGens()
    this.el?.pause()
    if (this.el) { this.el.removeAttribute('src'); this.el.load() }
    clearInterval(this.poll)
    this.save()
    this.onShow('radio off', '')
  }

  private skipped = 0
  private tunedAt = 0
  private tune(i: number, auto = false) {
    this.tunedAt = performance.now()
    this.djSongs = 0
    if (!auto) this.skipped = 0
    this.i = i; this.on = true
    const s = this.d.stations[i]
    if (s.synth) {
      // The built-in station: stop any stream, play the generator.
      if (this.el) { this.el.pause(); this.el.removeAttribute('src'); this.el.load() }
      clearInterval(this.poll)
      this.stopGens(s.synth)
      const g = this.gens[s.synth]; g.setVolume(this.d.volume * this.userVolume); g.start()
      const dj = s.dj, kind = s.synth
      if (dj) this.djLoad(kind, [dj.id, ...dj.lines])
      if (dj) window.setTimeout(() => { if (this.on && this.d.stations[this.i] === s) void this.say(kind, dj.id, dj.duck) }, 1200)
      this.save()
      this.onShow(`📻 ${s.name}`, `${s.where} · ${s.about}`)
      return
    }
    this.stopGens()
    if (!this.el) {
      this.el = new Audio(); this.el.preload = 'none'
      // A stream that drops or refuses: move on to the next station (once per tune, no loops).
      this.el.addEventListener('error', () => {
        if (!this.on || !this.el?.getAttribute('src') || this.skipped >= this.d.stations.length - 1) return
        this.skipped++
        this.onShow(`${this.d.stations[this.i].name} is off the air`, 'tuning the next station…')
        setTimeout(() => { const n = this.d.stations.length; if (this.on) this.tune((this.i + this.dir + n) % n, true) }, 900)
      })
    }
    this.el.src = s.url ?? ''
    this.el.volume = this.d.volume * this.userVolume
    this.el.play().catch((e: Error) => { if (e.name !== 'AbortError') this.onShow(`${s.name} is not answering`, 'try the next station: ]') })
    this.save()
    this.onShow(`📻 ${s.name}`, `${s.where} · ${s.about}`)
    clearInterval(this.poll)
  }

  private save() { try { localStorage.setItem(KEY, JSON.stringify({ i: this.i, on: this.on })) } catch { /* private window */ } }
}
