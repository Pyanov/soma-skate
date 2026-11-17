import type { SimEvent } from '../sim/sim.ts'

// Spoken lines (data/voices.json): the robotaxi's exterior speaker and Muni's PA, said on sim
// events. The mp3s are generated once (tools/gen_voices.py); each voice has its own speaker
// chain (band limits, a soft clip, an optional slapback) into the Voices bus. Variants are
// picked by the event's tick, so a clip says what the game said.

type Speaker = { highpass: number; lowpass: number; drive: number; gain: number; echo: number; echoMs: number }
export type VoicesData = {
  wait: number
  read?: { wordsPerSecond: number; min: number }   // a caption with no mp3 behind it: up for as long as reading it takes
  voices: Record<string, { name?: string; speaker: Speaker }>
  lines: Record<string, { voice: string; text: string; seconds?: number; cooldown?: number }>
  on: Record<string, string[]>
}

type Rule = { t: string; fields: [string, string][]; ids: string[] }

/** data/voices.json's on: 'event|field=value|...' keys as rules. */
export const parseRules = (on: VoicesData['on']): Rule[] =>
  Object.entries(on).map(([k, ids]) => { const [t, ...f] = k.split('|'); return { t, fields: f.map((x) => { const i = x.indexOf('='); return [x.slice(0, i), x.slice(i + 1)] as [string, string] }), ids } })

export class VoiceLines {
  private bufs = new Map<string, AudioBuffer>()
  private inputs = new Map<string, AudioNode>()
  private busy = new Map<string, number>()
  private saidAt = new Map<Rule | string, number>()   // when each rule (or a line said by id) last spoke, for cooldowns
  private rules: Rule[] = []
  private d: VoicesData | null = null
  private ctx: BaseAudioContext | null = null
  /** A line starts in delay seconds: who says it, the words and how long it lasts (live captions); unvoiced: no audio plays, the caption is all there is. */
  onSay: (who: string, text: string, delay: number, seconds: number, unvoiced?: boolean) => void = () => {}

  /** Fetch the data, decode every line and build each voice's speaker chain into out. */
  async load(ctx: BaseAudioContext, out: AudioNode) {
    this.ctx = ctx
    const d = (this.d = (await (await fetch('data/voices.json', { cache: 'no-store' })).json()) as VoicesData)
    Object.assign(d.lines, this.pending)
    this.rules = parseRules(d.on)
    for (const [v, { speaker: s }] of Object.entries(d.voices)) this.inputs.set(v, chain(ctx, s, out))
    // Only the lines events say (the radio DJs' load with their stations).
    await Promise.all([...new Set(this.rules.flatMap((r) => r.ids))].map(async (id) => {
      const b = await decodeLine(ctx, id)
      if (b) this.bufs.set(id, b)
    }))
  }

  /** Forget who spoke when (a new clip starts its own timeline). */
  reset() { this.busy.clear(); this.saidAt.clear() }

  /** The rules alone (no audio), for tests. */
  static rulesOnly(d: VoicesData): VoiceLines { const v = new VoiceLines(); v.d = d; v.rules = parseRules(d.on); return v }

  /** The line this event says, if any (its id), ignoring timing. */
  lineFor(e: SimEvent): string | null { return this.match(e)?.id ?? null }

  private match(e: SimEvent): { rule: Rule; id: string } | null {
    const ev = e as unknown as Record<string, unknown>
    for (const r of this.rules) if (r.t === e.t && r.fields.every(([k, v]) => String(ev[k]) === v)) return { rule: r, id: r.ids[(e.tick ?? 0) % r.ids.length] }
    return null
  }

  /**
   * When the event's line would start (at, in the caller's seconds) and for how long, or null: not
   * within its cooldown, and after the same voice's last line if that ends within wait seconds.
   * Books the voice, so audio and captions in clips keep the same timing.
   */
  private plan(e: SimEvent, when: number, seconds: (id: string) => number | null) {
    const m = this.match(e)
    return m ? this.book(m.id, m.rule, when, seconds) : null
  }
  private book(id: string, key: Rule | string, when: number, seconds: (id: string) => number | null) {
    const d = this.d, l = d?.lines[id]
    if (!d || !l) return null
    const last = this.saidAt.get(key)
    if (l.cooldown && last !== undefined && when - last < l.cooldown) return null
    const len = seconds(id)
    if (len === null) return null
    const at = Math.max(when, this.busy.get(l.voice) ?? 0)
    if (at - when > d.wait) return null
    this.busy.set(l.voice, at + len); this.saidAt.set(key, at)
    return { id, voice: l.voice, at, seconds: len, who: d.voices[l.voice]?.name ?? l.voice, text: l.text }
  }

  /** The caption the event's line gets in a clip (no audio here: lengths come from the data), at t seconds. */
  captionFor(e: SimEvent, t: number) { return this.plan(e, t, (id) => this.d?.lines[id]?.seconds ?? 3) }

  /** Say the event's line at audio time when. */
  event(e: SimEvent, when: number) {
    const ctx = this.ctx
    if (!ctx) return
    const p = this.plan(e, when, (id) => (this.bufs.get(id) && this.inputs.get(this.d!.lines[id].voice) ? this.bufs.get(id)!.duration : null))
    if (!p) return
    const src = ctx.createBufferSource()
    src.buffer = this.bufs.get(p.id)!; src.connect(this.inputs.get(p.voice)!); src.start(p.at)
    this.onSay(p.who, p.text, p.at - when, p.seconds)
  }

  /** More lines said by id (the story's: data/missions.json, data/cast.json), each in its speaker's voice. */
  addLines(lines: Record<string, { voice: string; text: string }>) {
    if (this.d) Object.assign(this.d.lines, lines)
    else this.pending = { ...this.pending, ...lines }
  }
  private pending: Record<string, { voice: string; text: string }> = {}
  private speaking: AudioBufferSourceNode | null = null
  private speakSeq = 0

  /**
   * A line of a conversation (the dialogue box shows its words, so no caption): it starts now, cutting
   * off the one before (the player went on before it finished); decoded the first time.
   */
  async speak(id: string) {
    const ctx = this.ctx, seq = ++this.speakSeq
    this.stopSpeaking()
    if (!ctx || !this.d?.lines[id]) return
    if (!this.bufs.has(id)) { const b = await decodeLine(ctx, id); if (!b) return; this.bufs.set(id, b) }
    const input = this.inputs.get(this.d.lines[id].voice)
    if (seq !== this.speakSeq || !input) return   // a newer line came while this one loaded
    const src = ctx.createBufferSource()
    src.buffer = this.bufs.get(id)!; src.connect(input); src.start()
    this.speaking = src
    this.busy.set(this.d.lines[id].voice, ctx.currentTime + src.buffer.duration)
  }
  /** Cut the conversation's line short (the dialogue closed). */
  stopSpeaking() { try { this.speaking?.stop() } catch { /* not started */ } this.speaking = null }

  private silent = new Set<string>()   // lines said by id that have no mp3 yet

  /**
   * Say a line by id now (the story's barks, the EMB locals' lines: no event rule says them); decoded the first
   * time. A line with no mp3 yet (written since the last voice run, tools/gen_voices.py) is captioned alone.
   */
  async say(id: string) {
    const ctx = this.ctx
    if (!ctx || !this.d?.lines[id]) return
    if (!this.bufs.has(id) && !this.silent.has(id)) { const b = await decodeLine(ctx, id); if (b) this.bufs.set(id, b); else this.silent.add(id) }
    if (this.silent.has(id)) { this.caption(id, ctx.currentTime); return }
    const when = ctx.currentTime, p = this.book(id, id, when, (x) => this.bufs.get(x)?.duration ?? null)
    if (!p || !this.inputs.get(p.voice)) return
    const src = ctx.createBufferSource()
    src.buffer = this.bufs.get(p.id)!; src.connect(this.inputs.get(p.voice)!); src.start(p.at)
    this.onSay(p.who, p.text, p.at - when, p.seconds)
  }

  /**
   * A line's caption alone at audio time when (a line with no mp3 yet): booked in its voice like a spoken line
   * (it waits for that voice, or is dropped past wait), up for as long as reading it takes (data read), and
   * shown with captions off too (onSay unvoiced), since nothing is heard.
   */
  caption(id: string, when: number) {
    const l = this.d?.lines[id], r = this.d?.read
    if (!l || !r) return
    const p = this.book(id, id, when, () => readSeconds(l.text, r))
    if (p) this.onSay(p.who, p.text, p.at - when, p.seconds, true)
  }
}

/** How long a caption with no audio stays up: its words at read.wordsPerSecond, at least read.min seconds (to 0.1 s). */
export const readSeconds = (text: string, read: { wordsPerSecond: number; min: number }) =>
  Math.max(read.min, Math.round((text.split(/\s+/).filter(Boolean).length / read.wordsPerSecond) * 10) / 10)

/** One line's audio (null if it is missing or will not decode). */
export async function decodeLine(ctx: BaseAudioContext, id: string): Promise<AudioBuffer | null> {
  try { return await ctx.decodeAudioData(await (await fetch(`assets/sound/voice/${id}.mp3`)).arrayBuffer()) } catch { return null }
}

/** A small speaker: band-limited, softly clipped, with an optional slapback, at its gain. */
export function chain(ctx: BaseAudioContext, s: Speaker, out: AudioNode): AudioNode {
  const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = s.highpass; hp.Q.value = 0.7
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = s.lowpass; lp.Q.value = 0.7
  const sh = ctx.createWaveShaper(), curve = new Float32Array(512), k = Math.max(1, s.drive)
  for (let i = 0; i < 512; i++) { const x = i / 255.5 - 1; curve[i] = Math.tanh(x * k) / Math.tanh(k) }
  sh.curve = curve
  const g = ctx.createGain(); g.gain.value = s.gain
  hp.connect(lp).connect(sh).connect(g).connect(out)
  if (s.echo > 0) {
    const dl = ctx.createDelay(1); dl.delayTime.value = s.echoMs / 1000
    const eg = ctx.createGain(); eg.gain.value = s.echo
    g.connect(dl).connect(eg).connect(out)
  }
  return hp
}
