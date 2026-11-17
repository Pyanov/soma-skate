// Settings (data/settings.json), saved in this browser: pages of options that cycle through their
// values when chosen. The game reads them through get(); applying them is main.ts's (camera, HUD,
// audio buses, units, palette, touch). Older saves (sound, radio, camera) carry over.

export type SettingValue = string | number | boolean
export type SettingDef = { id: string; label: string; values: [SettingValue, string][]; default: SettingValue; note?: string }
export type Palette = { p1: string; p2: string; safe: string; mid: string; danger: string; hatch: boolean; landed: string; bailed: string; goal: string }
export type SettingsData = {
  groups: { id: string; label: string; options: SettingDef[] }[]
  reduceMotion: { fovScale: number }
  palettes: Record<string, Palette>
  mph: number
  /** The first-frames check of a new browser: frames skipped, frames timed, the median frame time (ms) that means slow, the toast then. */
  bench: { skipFrames: number; frames: number; slowMs: number; phoneSlowMs?: number; toast: string }
  /** On auto: a frame rate under fps for seconds while skating switches to low, once. */
  autoStepDown?: { fps: number; seconds: number; toast: string }
  /** What each Quality draws (render.ts QualityPreset). */
  presets?: Record<string, import('./render.ts').QualityPreset>
}

/** The first save's names for what are now master, music and camera distance. */
const LEGACY: Record<string, string> = { sound: 'master', radio: 'music', camera: 'cameraDistance' }

export class Settings {
  readonly d: SettingsData
  private v: Record<string, SettingValue> = {}
  private key: string
  constructor(d: SettingsData, key = 'soma-skate:settings') {
    this.d = d
    this.key = key
    for (const o of this.all) this.v[o.id] = o.default
    let saved: Record<string, SettingValue> = {}
    try { saved = JSON.parse(localStorage.getItem(key) ?? '{}') } catch { /* private window */ }
    for (const [k, val] of Object.entries(saved)) {
      const id = LEGACY[k] && saved[LEGACY[k]] === undefined ? LEGACY[k] : k
      const def = this.def(id)
      if (def && def.values.some(([x]) => x === val)) this.v[id] = val
    }
  }
  get all(): SettingDef[] { return this.d.groups.flatMap((g) => g.options) }
  def(id: string) { return this.all.find((o) => o.id === id) }
  get<T extends SettingValue>(id: string): T { return this.v[id] as T }
  /** The value's label (for the menu). */
  label(id: string) { const d = this.def(id); return d?.values.find(([x]) => x === this.v[id])?.[1] ?? String(this.v[id]) }
  set(id: string, val: SettingValue) { this.v[id] = val; this.save() }
  /** The next value (wrapping), saved. */
  cycle(id: string) {
    const d = this.def(id)
    if (!d) return
    const i = d.values.findIndex(([x]) => x === this.v[id])
    this.set(id, d.values[(i + 1) % d.values.length][0])
  }
  /** Back to every default. */
  reset() { for (const o of this.all) this.v[o.id] = o.default; this.save() }
  get palette(): Palette { return this.d.palettes[String(this.v.palette)] ?? Object.values(this.d.palettes)[0] }
  private save() { try { localStorage.setItem(this.key, JSON.stringify(this.v)) } catch { /* private window */ } }
}

/** The balance meter's gradients for a palette (side to side and upright): safe in the middle, danger at the ends (the stripes on the ends are CSS: body.meter-hatch). */
export function balanceGradients(p: Palette): { across: string; up: string } {
  const stops = `${p.danger} 0%, ${p.mid} 22%, ${p.safe} 42%, ${p.safe} 58%, ${p.mid} 78%, ${p.danger} 100%`
  return { across: `linear-gradient(90deg, ${stops})`, up: `linear-gradient(0deg, ${stops})` }
}
