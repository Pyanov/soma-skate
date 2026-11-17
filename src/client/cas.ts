import type { CharacterSpec } from './skater/characters.ts'
import type { KitLayer, KitRecipe } from './skater/kitpeople.ts'
import type { CareerCounts } from './unlocks.ts'

// Create-a-Skater (data/cas.json): the player's own skaters, built on the character kit. A skater is a
// choice per row (a piece id, or a colour); casKit turns the choices into a kit recipe and casSpec into a
// full character spec (the rig from the build and height, the attitude's riding style, the special's
// signature, the bail, the taunt), so a created skater rides like the hand-built ones. Up to `slots`
// skaters are kept in this browser (soma-skate:cas), each saved as { id, name, choices, kit } so it reads
// like a kit recipe. Pieces can be locked behind the Story's missions, stickers or the Tour career (each
// piece's unlock in data), or awarded by id (awardPiece). Client only.

export type CasUnlock = { story?: string; sticker?: string; tapes?: number; goals?: number; hint: string }
export type CasItem = { id: string; name: string; unlock?: CasUnlock } & Record<string, unknown>
export type Swatch = { name: string; color: string }
export type CasData = {
  slots: number; nameMax: number; defaultBoard: { graphic: string; wheel: string }
  palettes: Record<'skin' | 'hair' | 'cloth' | 'eyes', Swatch[]>
  bodies: CasItem[]; heights: CasItem[]; faces: CasItem[]; hair: CasItem[]; beards: CasItem[]; hats: CasItem[]; glasses: CasItem[]
  tops: CasItem[]; patterns: CasItem[]; bottoms: CasItem[]; layers: CasItem[]; extras: CasItem[]; props: CasItem[]
  attitudes: CasItem[]; specials: CasItem[]; bails: CasItem[]; emotes: CasItem[]
  random: { loud: number; first: string[]; last: string[] }
}
export type CasChoices = {
  face: string; eyes: string; skin: string; hair: string; hairColor: string; beard: string; hat: string; hatColor: string; glasses: string; glassesColor: string
  body: string; height: string; top: string; topColor: string; pattern: string; patternColor: string; layer: string; layerColor: string; extra: string; extraColor: string
  bottom: string; bottomColor: string; shoes: string; prop: string; attitude: string; special: string; bail: string; emote: string
}
export type CasSkater = { id: string; name: string; choices: CasChoices; kit?: KitRecipe }
type ListKey = 'faces' | 'hair' | 'beards' | 'hats' | 'glasses' | 'bodies' | 'heights' | 'tops' | 'patterns' | 'layers' | 'extras' | 'bottoms' | 'props' | 'attitudes' | 'specials' | 'bails' | 'emotes'
export type CasRow = { key: keyof CasChoices; label: string; section?: string; list?: ListKey; palette?: keyof CasData['palettes'] }

/** The editor's rows, top to bottom, in sections (the randomizer walks the same table). */
export const ROWS: CasRow[] = [
  { section: 'HEAD', key: 'face', label: 'Face', list: 'faces' }, { key: 'eyes', label: 'Eyes', palette: 'eyes' }, { key: 'skin', label: 'Skin', palette: 'skin' },
  { key: 'hair', label: 'Hair', list: 'hair' }, { key: 'hairColor', label: 'Hair colour', palette: 'hair' }, { key: 'beard', label: 'Facial hair', list: 'beards' },
  { key: 'hat', label: 'Hat', list: 'hats' }, { key: 'hatColor', label: 'Hat colour', palette: 'cloth' }, { key: 'glasses', label: 'Glasses', list: 'glasses' }, { key: 'glassesColor', label: 'Frames', palette: 'cloth' },
  { section: 'BODY', key: 'body', label: 'Build', list: 'bodies' }, { key: 'height', label: 'Height', list: 'heights' }, { key: 'top', label: 'Top', list: 'tops' },
  { key: 'topColor', label: 'Top colour', palette: 'cloth' }, { key: 'pattern', label: 'Pattern', list: 'patterns' }, { key: 'patternColor', label: 'Pattern colour', palette: 'cloth' },
  { key: 'layer', label: 'Layer', list: 'layers' }, { key: 'layerColor', label: 'Layer colour', palette: 'cloth' }, { key: 'extra', label: 'Extra', list: 'extras' }, { key: 'extraColor', label: 'Extra colour', palette: 'cloth' },
  { section: 'LEGS', key: 'bottom', label: 'Bottoms', list: 'bottoms' }, { key: 'bottomColor', label: 'Bottoms colour', palette: 'cloth' }, { key: 'shoes', label: 'Shoes', palette: 'cloth' },
  { section: 'STYLE', key: 'prop', label: 'Signature prop', list: 'props' }, { key: 'attitude', label: 'Attitude', list: 'attitudes' }, { key: 'special', label: 'Special', list: 'specials' },
  { key: 'bail', label: 'Bail', list: 'bails' }, { key: 'emote', label: 'Taunt', list: 'emotes' },
]

export const CAS_KEY = 'soma-skate:cas'
const AWARDS = 'soma-skate:cas-awards'
export const casId = (slot: number) => `cas${slot + 1}`

/** A new skater's choices: plain and ready to change. */
export function defaultChoices(d: CasData): CasChoices {
  const C = d.palettes.cloth
  return {
    face: 'smile', eyes: d.palettes.eyes[0].color, skin: d.palettes.skin[2].color, hair: 'tousled', hairColor: d.palettes.hair[2].color, beard: 'none',
    hat: 'backcap', hatColor: C[0].color, glasses: 'none', glassesColor: C[3].color, body: 'average', height: 'medium', top: 'tee', topColor: C[1].color,
    pattern: 'plain', patternColor: C[2].color, layer: 'none', layerColor: C[6].color, extra: 'none', extraColor: C[5].color, bottom: 'pants', bottomColor: C[6].color,
    shoes: C[13].color, prop: 'cup', attitude: 'chill', special: 'giggle', bail: 'classic', emote: 'coolnod',
  }
}

const item = (d: CasData, list: ListKey, id: string): CasItem => d[list].find((x) => x.id === id) ?? d[list][0]
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)
const num = (v: unknown, d: number): number => (typeof v === 'number' ? v : d)
/** Ink or cream, whichever reads on this colour (a hat's band, a shirt's collar). */
export function contrast(hex: string): string {
  const n = parseInt(hex.replace('#', ''), 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255
  return 0.299 * r + 0.587 * g + 0.114 * b > 140 ? '#1f1f22' : '#f4efe0'
}

/** The kit recipe the choices make (kitpeople.ts). */
export function casKit(c: CasChoices, d: CasData): KitRecipe {
  const body = item(d, 'bodies', c.body), hair = item(d, 'hair', c.hair), beard = item(d, 'beards', c.beard), hat = item(d, 'hats', c.hat), gl = item(d, 'glasses', c.glasses)
  const top = item(d, 'tops', c.top), pat = item(d, 'patterns', c.pattern), bottom = item(d, 'bottoms', c.bottom), layer = item(d, 'layers', c.layer), extra = item(d, 'extras', c.extra)
  const prop = item(d, 'props', c.prop), face = item(d, 'faces', c.face)
  const layers: KitLayer[] = []
  if (str(layer.kind)) layers.push({ kind: str(layer.kind)!, color: c.layerColor, ...(str(layer.color2) ? { color2: str(layer.color2)! } : {}) })
  if (str(extra.kind)) layers.push({ kind: str(extra.kind)!, color: c.extraColor })
  return {
    body: { girth: num(body.girth, 1), belly: num(body.belly, 0), bust: num(body.bust, 0) },
    ...(str(hair.style) && hair.style !== 'none' ? { hair: { style: str(hair.style)!, color: c.hairColor, ...(str(hair.bun) ? { bun: str(hair.bun) as 'top' | 'back' | 'messy' } : {}) } } : {}),
    ...(str(beard.style) ? { beard: { style: str(beard.style)!, color: c.hairColor } } : {}),
    ...(str(hat.kind) ? { hat: { kind: str(hat.kind)!, color: str(hat.color) ?? c.hatColor, band: str(hat.band) ?? contrast(c.hatColor), ...(str(hat.trim) ? { trim: str(hat.trim)! } : {}) } } : {}),
    ...(str(gl.kind) ? { glasses: { kind: str(gl.kind)!, color: str(gl.color) ?? c.glassesColor, ...(str(gl.lens) ? { lens: str(gl.lens)! } : {}) } } : {}),
    top: { color: c.topColor, ...(str(pat.kind) ? { pattern: { kind: str(pat.kind) as 'stripes', colors: [c.patternColor] } } : {}), ...(str(top.neck) ? { neck: str(top.neck)!, collar: contrast(c.topColor) === '#1f1f22' ? '#fbfaf3' : c.topColor } : {}) },
    bottom: { kind: (str(bottom.kind) ?? 'pants') as 'pants', color: c.bottomColor, ...(bottom.kind === 'skirt' ? { legs: c.skin } : {}) },
    shoes: { color: c.shoes, sole: '#ecebe6' },
    ...(layers.length ? { layers } : {}),
    ...(str(prop.prop) ? { signature: str(prop.prop)! } : {}),
    face: { iris: c.eyes, brow: c.hairColor, neutral: (str(face.neutral) ?? 'neutral') as 'neutral' },
    idle: 'none',
  }
}

/** The rig a build and height make (proportions, metres: kit.ts RigSpec). */
export function casRig(c: CasChoices, d: CasData): CharacterSpec['rig'] {
  const b = item(d, 'bodies', c.body), h = item(d, 'heights', c.height), s = num(h.spine, 1), r = (x: number) => Math.round(x * 1e4) / 1e4
  return { ankle: 0.08, shin: num(h.leg, 0.42), thigh: num(h.leg, 0.42), hipX: r(0.09 * num(b.girth, 1)), hipDrop: 0.05, toe: [0.14, 0.03], spine: [r(0.12 * s), r(0.14 * s), r(0.14 * s), r(0.09 * s)], neck: 0.07, clavicle: [0.04, 0, 0], shoulder: [num(b.shoulder, 0.19), -0.03, 0], upperArm: r(0.28 * s), foreArm: r(0.26 * s), palm: 0.08, finger: 0.032, headScale: num(h.head, 1.3) }
}

/** A created skater as a character spec: the kit recipe on the full skater rig, riding in its attitude. */
export function casSpec(k: CasSkater, d: CasData): CharacterSpec {
  const c = k.choices, a = item(d, 'attitudes', c.attitude), sp = item(d, 'specials', c.special), bail = item(d, 'bails', c.bail), em = item(d, 'emotes', c.emote), face = item(d, 'faces', c.face)
  return {
    id: k.id, name: k.name, lazy: true,
    bio: [`Made in Create-a-Skater. ${a.name} on a board.`, `Special: ${sp.name}. Taunt: ${em.name}.`],
    rig: casRig(c, d), colors: { skin: c.skin, hair: c.hairColor },
    style: {
      bend: num(a.bend, 0.5), arms: num(a.arms, 0.7), stretch: num(a.stretch, 1.1), swing: num(a.swing, 0.4), squash: num(a.squash, 0.2),
      celebrate: (a.celebrate as string[]) ?? ['nod'], idle: str(a.idle) ?? 'breathe', idles: (a.idles as string[]) ?? undefined, neutral: str(face.neutral) ?? 'neutral',
      flair: { catch: str(a.catch) ?? 'catchCool', tweak: (a.tweak as [number, number, number]) ?? [0, 0, 0], free: (a.free as [number, number, number]) ?? [0.3, 0.1, 0.2], ...(str(bail.bail) ? { bail: str(bail.bail) as 'flop' } : {}) },
      ...(str(sp.signature) ? { signature: str(sp.signature) as 'giggle' } : {}),
      board: d.defaultBoard,
      emote: { kind: str(em.kind) ?? 'coolnod', say: str(em.say) ?? '' },
    } as CharacterSpec['style'],
    kit: casKit(c, d),
  }
}

/** The special's names for the HUD and the picker (data/ui.json signatures' shape). */
export const casSpecialNames = (k: CasSkater, d: CasData): Record<string, string> => (item(d, 'specials', k.choices.special).names as Record<string, string>) ?? {}

// ---------------------------------------------------------------- locks and awards

/** Which pieces are open: their unlock against the Story's save, the sticker book, the career and awards. */
export class CasLocks {
  private career: CareerCounts
  private sticker: (id: string) => boolean
  private override: Set<string> | 'all' | 'none' | null
  constructor(career: CareerCounts, sticker: (id: string) => boolean, override: string | null = null) {
    this.career = career; this.sticker = sticker
    const o = (override ?? '').trim()
    this.override = !o ? null : o === 'all' ? 'all' : o === 'none' ? 'none' : new Set(o.split(',').map((x) => x.trim()))
  }
  locked(it: CasItem): boolean {
    const U = it.unlock
    if (!U) return false
    if (this.override === 'all') return false
    if (this.override === 'none') return true
    if (this.override && this.override.has(it.id)) return false
    if (awarded().has(it.id)) return false
    if (U.story !== undefined && !this.career.story?.(U.story)) return true
    if (U.sticker !== undefined && !this.sticker(U.sticker)) return true
    if (U.tapes !== undefined && this.career.count('tape') < U.tapes) return true
    if (U.goals !== undefined && this.career.total < U.goals) return true
    return false
  }
  hint(it: CasItem): string { return it.unlock?.hint ?? '' }
  /**
   * Pieces opened and not announced yet (each comes back once; soma-skate:cas-seen): after a mission or
   * a sticker. quiet: just remember the ones open now (at startup).
   */
  fresh(d: CasData, quiet = false): CasItem[] {
    let seen: string[] = []
    try { seen = JSON.parse(localStorage.getItem(SEEN) ?? '[]') as string[] } catch { seen = [] }
    const all = unlockable(d).filter((it) => it.unlock && !this.locked(it) && !seen.includes(it.id))
    if (!all.length) return []
    if (!this.override) try { localStorage.setItem(SEEN, JSON.stringify([...seen, ...all.map((x) => x.id)])) } catch { /* private window */ }
    return quiet ? [] : all
  }
}
const SEEN = 'soma-skate:cas-seen'

/** The rows whose pieces can be locked (data/cas.json unlock), every piece of them: the Story's rewards and the 100% page read these. */
export const UNLOCK_ROWS = ['hair', 'hats', 'glasses', 'patterns', 'layers', 'extras', 'props'] as const
export const unlockable = (d: CasData): CasItem[] => UNLOCK_ROWS.flatMap((k) => d[k])

/** Pieces awarded by id (the story can give one from anywhere: awardPiece('skipper')). */
export function awarded(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(AWARDS) ?? '[]') as string[]) } catch { return new Set() }
}
export function awardPiece(id: string) {
  const s = awarded()
  if (s.has(id)) return
  s.add(id)
  try { localStorage.setItem(AWARDS, JSON.stringify([...s])) } catch { /* private window: given for this session only */ }
}

// ---------------------------------------------------------------- saving

/** The kept skaters (empty slots null); unknown pieces fall back to the first of their row. */
export function loadSkaters(d: CasData): (CasSkater | null)[] {
  let raw: unknown = null
  try { raw = JSON.parse(localStorage.getItem(CAS_KEY) ?? 'null') } catch { raw = null }
  const out: (CasSkater | null)[] = Array.from({ length: d.slots }, () => null)
  if (!Array.isArray(raw)) return out
  raw.slice(0, d.slots).forEach((s, i) => {
    const o = s as { name?: unknown; choices?: unknown } | null
    if (!o || typeof o.name !== 'string' || typeof o.choices !== 'object' || !o.choices) return
    const base = defaultChoices(d), ch = { ...base }
    for (const k of Object.keys(base) as (keyof CasChoices)[]) { const v = (o.choices as Record<string, unknown>)[k]; if (typeof v === 'string') ch[k] = v }
    out[i] = { id: casId(i), name: o.name.slice(0, d.nameMax), choices: ch }
  })
  return out
}
export function saveSkaters(list: (CasSkater | null)[], d: CasData) {
  const data = list.map((s) => (s ? { id: s.id, name: s.name, choices: s.choices, kit: casKit(s.choices, d) } : null))
  try { localStorage.setItem(CAS_KEY, JSON.stringify(data)) } catch { /* private window: kept for this session only */ }
}

// ---------------------------------------------------------------- the randomizer

/** A seeded random (shots and tests repeat): mulberry32. */
export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}

/** A funny name: a first part and a last (Lil' Pothole, Professor Waffles). */
export function randomName(d: CasData, r: () => number): string {
  const f = d.random.first[Math.floor(r() * d.random.first.length)], l = d.random.last[Math.floor(r() * d.random.last.length)]
  return `${f} ${l}`.slice(0, d.nameMax)
}

/**
 * Funny random choices: any open piece and colour per row; on a loud roll the colours clash on purpose
 * and the head gets a hat, glasses and facial hair at once.
 */
export function randomChoices(d: CasData, r: () => number, open: (it: CasItem) => boolean = () => true): CasChoices {
  const c = defaultChoices(d), loud = r() < d.random.loud
  const pickItem = (list: ListKey, avoidFirst = false) => { const ok = d[list].filter((x) => open(x) && !(avoidFirst && x === d[list][0])); return ok[Math.floor(r() * ok.length)]?.id ?? d[list][0].id }
  const pickColour = (p: keyof CasData['palettes']) => d.palettes[p][Math.floor(r() * d.palettes[p].length)].color
  for (const row of ROWS) {
    if (row.palette) c[row.key] = pickColour(row.palette)
    else if (row.list) c[row.key] = pickItem(row.list, loud && (row.key === 'hat' || row.key === 'glasses' || row.key === 'beard' || row.key === 'extra'))
  }
  // Skin stays natural most of the time; a loud skater may go mint or sky.
  const natural = d.palettes.skin.filter((s) => !s.name.includes('fun'))
  if (!loud || r() < 0.7) c.skin = natural[Math.floor(r() * natural.length)].color
  if (r() < 0.35) c.layer = 'none'
  if (r() < 0.4) c.pattern = 'plain'
  return c
}
