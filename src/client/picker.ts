import * as THREE from 'three'
import type { CamPose } from './camera.ts'
import type { SkaterView } from './skater/view.ts'

// Character select: a full-screen overlay in the game UI with the roster, and the 3D skater
// on a turntable behind it (the camera circles the skater while the overlay is open). The
// pick is remembered in localStorage; the default comes from data/characters.json.

const KEY = 'soma-skate.character'
/** The board shop's choices (data/boards.json): the first deck and wheel are the character's own. */
/** The colours panel's palette and each character's slots (data/paints.json). */
export type Paints = { palette: { name: string; color: string }[]; slots: Record<string, { name: string; keys: Record<string, number> }[]> }
export type BoardShop = { decks: { graphic: string; name: string }[]; wheels: { color: string; name: string }[] }
const esc = (s: string) => s.replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[ch]!)

const CSS = `
#ui.in-picker > :not(.picker):not(.hud-radio):not(.hud-toast) { opacity: 0 !important; }
.picker { inset: 0; display: none; pointer-events: auto; background: rgba(11, 11, 12, 0.55); }
.picker.on { display: block; }
.picker-left { position: absolute; left: var(--gutter); top: 13vh; bottom: 12vh; width: min(460px, 84vw); display: flex; flex-direction: column; text-shadow: var(--shadow); }
.picker-left > * { flex: none; }
.picker-title { font: 500 11px/1 var(--mono); letter-spacing: 0.06em; text-transform: uppercase; color: var(--paper-2); }
.picker-name { margin: 14px 0 18px; font-family: var(--display); font-weight: 900; font-stretch: 125%; text-transform: uppercase; letter-spacing: -0.03em; font-size: clamp(32px, 4vw, 56px); line-height: 0.9; }
.picker-bio { margin: 0 0 22px; font-size: 15px; line-height: 1.45; color: var(--paper); max-width: 42ch; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.picker-bio i { color: var(--paper); }
.picker-outfit, .picker-specials, .picker-wheel { display: grid; grid-template-columns: 92px 1fr; column-gap: 8px; margin: 0 0 14px; font: 500 11px/1.9 var(--mono); letter-spacing: 0.06em; text-transform: uppercase; color: rgba(242, 239, 232, 0.7); }
.picker-outfit:empty, .picker-specials:empty { display: none; }
.picker-outfit b, .picker-specials b, .picker-wheel b { font-weight: 500; color: var(--paper); }
.picker-specials b { display: block; }
.picker-outfit i { font-style: normal; margin-left: 12px; }
.picker-left > .picker-list { flex: 0 1 auto; }
.picker-list { margin-top: 14px; padding-left: 26px; display: flex; flex-direction: column; gap: 1px; min-height: 0; overflow-y: auto; scrollbar-width: none; }
.picker-list::-webkit-scrollbar { display: none; }
.picker-item { all: unset; position: relative; cursor: pointer; width: fit-content; padding: 1px 0; font-family: var(--display); font-weight: 800; font-stretch: 125%; text-transform: uppercase; letter-spacing: -0.02em; font-size: clamp(15px, 1.35vw, 19px); line-height: 1.05; color: var(--paper-2); white-space: nowrap; }
.picker-item::before { content: ''; position: absolute; left: -22px; top: 50%; width: 10px; height: 0.72em; transform: translateY(-50%); }
.picker-item.sel { color: var(--accent); }
.picker-item.sel::before { background: var(--accent); }
.picker-item.locked { color: var(--paper-3); }
.picker-more { margin: 4px 0 2px; font: 500 11px/1.4 var(--mono); letter-spacing: 0.06em; text-transform: uppercase; color: var(--paper-2); }
.picker-item small { font: 500 10px/1 var(--mono); letter-spacing: 0.06em; color: var(--paper-3); margin-left: 10px; }
.picker.locked .picker-name { color: var(--paper-3); }
.picker-lock { display: block; margin: 0 0 8px; font: 500 11px/1.4 var(--mono); letter-spacing: 0.06em; text-transform: uppercase; color: var(--accent); }
.picker-hint { margin-top: auto; padding-top: 18px; font: 500 11px/1.8 var(--mono); letter-spacing: 0.06em; text-transform: uppercase; color: var(--paper-2); }
.picker-hint kbd { color: var(--paper); margin: 0 6px 0 0; }
.picker-hint span { margin-right: 18px; white-space: nowrap; }
.picker-paint { display: none; margin-top: 10px; }
.picker.paint .picker-paint { display: block; }
.picker.paint .picker-list, .picker.paint .picker-specials, .picker.paint .picker-bio, .picker.paint .picker-outfit { display: none; }
.picker-slot { position: relative; margin: 2px 0 2px 26px; font-family: var(--display); font-weight: 800; font-stretch: 125%; text-transform: uppercase; font-size: 18px; color: var(--paper-2); }
.picker-slot::before { content: ''; position: absolute; left: -22px; top: 50%; width: 10px; height: 0.72em; transform: translateY(-50%); }
.picker-slot.sel { color: var(--accent); }
.picker-slot.sel::before { background: var(--accent); }
.picker-slot b { font: 500 11px/1 var(--mono); letter-spacing: 0.06em; color: var(--paper); margin-left: 12px; }
.picker-swatches { display: flex; flex-wrap: wrap; gap: 4px; margin: 8px 0 14px 26px; max-width: 400px; }
.picker-swatches i { width: 20px; height: 20px; display: inline-block; }
.picker-swatches i.sel { box-shadow: 0 4px 0 -1px var(--paper); }
.picker-swatches i.orig { background: var(--paper-3); }
.picker-board { display: none; }
.picker.board .picker-board { display: flex; flex-direction: column; min-height: 0; }
.picker.board .picker-list:not(.picker-decks), .picker.board .picker-specials, .picker.board .picker-bio, .picker.board .picker-outfit { display: none; }
.picker-decks .picker-item { font-size: 16px; }
.picker-wheel i { display: inline-block; width: 9px; height: 9px; border-radius: 50%; vertical-align: 0; margin-left: 4px; }
.picker-sec { font: 500 11px/1 var(--mono); letter-spacing: 0.06em; text-transform: uppercase; color: var(--paper-2); margin: 10px 0 4px; }
.picker-sec:first-child { margin-top: 0; }
.picker-item.picker-cas { color: var(--paper); margin-top: 10px; }
.picker-item.picker-cas.sel { color: var(--accent); }
.picker-arrows { position: absolute; left: 62%; bottom: 12vh; transform: translateX(-50%); display: flex; gap: 36px; }
.picker-arrows button { all: unset; cursor: pointer; font: 500 14px/1 var(--mono); color: var(--paper); padding: 10px 14px; text-shadow: var(--shadow); }
.picker-arrows button:hover { color: var(--accent); }
@media (max-aspect-ratio: 4/5) { .picker-left { top: 9vh; bottom: 22vh; } .picker-arrows { left: 50%; bottom: 6vh; } .picker-bio, .picker-specials { display: none; } }
`

export class Picker {
  isOpen = false
  private el: HTMLElement
  private root: HTMLElement
  private nameEl: HTMLElement
  private bioEl: HTMLElement
  private outfitEl: HTMLElement
  private specialsEl: HTMLElement
  private signatures: Record<string, Record<string, string>>
  private list: HTMLElement
  private sel = 0
  openedAt = 0
  onClose: () => void = () => {}
  /** Create-a-Skater wanted (N, or its entry under the roster): the created skater picked now, else null. */
  onCreate: (id: string | null) => void = () => {}

  private skater: SkaterView
  private shop: BoardShop
  /** Secret skaters (unlocks.ts): locked ones show as silhouettes with their hint and cannot be skated. */
  private lock: { locked(id: string): boolean; hint(id: string): string }
  /** Decks and outfits the story gives (rewards.ts): null when free or earned, else what earns it. */
  gear: { deck(graphic: string): string | null; outfit(character: string, outfit: string): string | null } = { deck: () => null, outfit: () => null }
  private lastOpen = ''   // the last unlocked pick, to go back to when leaving on a locked one
  /** The board shop is open (a third axis: the deck and wheels under the current character). */
  boardMode = false
  /** The colours panel is open (C or the pad's square): the current character's slots and the palette. */
  paintMode = false
  private paints: Paints
  private slotSel = 0
  private paintEl!: HTMLElement
  private deckSel = 0
  private wheelSel = 0
  private boardEl!: HTMLElement
  private deckList!: HTMLElement
  private wheelEl!: HTMLElement
  private hintEl!: HTMLElement

  constructor(root: HTMLElement, skater: SkaterView, signatures: Record<string, Record<string, string>> = {}, shop: BoardShop = { decks: [], wheels: [] }, paints: Paints = { palette: [], slots: {} }, lock: { locked(id: string): boolean; hint(id: string): string } = { locked: () => false, hint: () => '' }) {
    this.shop = shop
    this.lock = lock
    this.paints = paints
    this.signatures = signatures
    this.skater = skater
    this.root = root
    const style = document.createElement('style')
    style.textContent = CSS
    document.head.appendChild(style)
    this.el = document.createElement('div')
    this.el.className = 'picker'
    this.el.innerHTML = `<div class="picker-left"><div class="picker-title">Skater</div><div class="picker-name"></div><div class="picker-bio"></div><div class="picker-outfit"></div><div class="picker-specials"></div><div class="picker-list"></div>
      <div class="picker-board"><div class="picker-wheel"></div><div class="picker-list picker-decks"></div></div>
      <div class="picker-paint"></div>
      <div class="picker-hint"></div></div>
      <div class="picker-arrows"><button data-d="-1">&larr;</button><button data-d="1">&rarr;</button></div>`
    root.appendChild(this.el)
    this.nameEl = this.el.querySelector('.picker-name')!
    this.bioEl = this.el.querySelector('.picker-bio')!
    this.outfitEl = this.el.querySelector('.picker-outfit')!
    this.specialsEl = this.el.querySelector('.picker-specials')!
    this.list = this.el.querySelector('.picker-list')!
    this.boardEl = this.el.querySelector('.picker-board')!
    this.paintEl = this.el.querySelector('.picker-paint')!
    this.deckList = this.el.querySelector('.picker-decks')!
    this.wheelEl = this.el.querySelector('.picker-wheel')!
    this.hintEl = this.el.querySelector('.picker-hint')!
    for (const b of this.el.querySelectorAll<HTMLButtonElement>('.picker-arrows button')) b.onclick = () => (this.boardMode ? this.stepBoard(0, Number(b.dataset.d)) : this.paintMode ? this.stepPaint(0, Number(b.dataset.d)) : this.stepOutfit(Number(b.dataset.d)))   // the arrows by the turntable flip outfits (wheels in the board shop)
    window.addEventListener('keydown', (e) => this.key(e), true)
    // The remembered pick (or the data default the view already shows).
    let saved: string | null = null
    try { saved = localStorage.getItem(KEY) } catch { /* storage blocked: keep the default */ }
    if (saved && !lock.locked(saved)) skater.setCharacter(saved, this.savedOutfit(saved))
    else skater.setCharacter(skater.characterId, this.savedOutfit(skater.characterId))
    this.lastOpen = skater.characterId
    // Every character's remembered board (built when worn).
    for (const c of skater.cast) { const b = this.savedBoard(c.id); if (b) skater.setBoard(c.id, b) }
    // And every character's remembered colours (painted when worn).
    for (const c of skater.cast) { const t = this.tintFrom(c.id, this.savedPaint(c.id)); if (t) skater.setTint(c.id, t) }
    this.sel = Math.max(0, skater.cast.findIndex((c) => c.id === skater.characterId))
    this.draw()
  }

  open(now = performance.now()) { this.isOpen = true; this.openedAt = now; this.sel = Math.max(0, this.skater.cast.findIndex((c) => c.id === this.skater.characterId)); this.draw(); this.el.classList.add('on'); this.root.classList.add('in-picker') }
  close() {
    // Left on a locked skater: back to the last one you can skate.
    if (this.lock.locked(this.skater.characterId)) { this.skater.setSilhouette(false); this.skater.setCharacter(this.lastOpen, this.savedOutfit(this.lastOpen)) }
    this.isOpen = false; this.setBoardMode(false); this.setPaintMode(false); this.el.classList.remove('on'); this.root.classList.remove('in-picker'); this.onClose()
  }
  /** After an unlock: redraw (the silhouette and the hint go). */
  refresh() { if (this.isOpen) { this.skater.setSilhouette(this.lock.locked(this.skater.characterId)); this.draw() } }

  /** Open or close the board shop (D, or the pad's triangle). */
  setBoardMode(on: boolean) {
    this.boardMode = on
    this.el.classList.toggle('board', on)
    if (on) {
      const d = this.skater.boardDesign(this.skater.characterId), saved = this.savedBoard(this.skater.characterId)
      this.deckSel = Math.max(0, saved?.graphic ? this.shop.decks.findIndex((x) => x.graphic === d.graphic) : 0)
      this.wheelSel = Math.max(0, saved?.wheel ? this.shop.wheels.findIndex((x) => x.color.toLowerCase() === d.wheel.toLowerCase()) : 0)
    }
    this.draw()
  }

  /** Step the deck or the wheel colour; applied at once and remembered for this character. */
  stepBoard(deck: number, wheel: number) {
    const D = this.shop.decks, Wh = this.shop.wheels
    if (!D.length || !Wh.length) return
    this.deckSel = (this.deckSel + deck + D.length) % D.length
    // Decks a story gives are skipped until it is done (the list shows them with a lock and what earns them).
    for (let k = 0; k < D.length && deck && this.gear.deck(D[this.deckSel].graphic); k++) this.deckSel = (this.deckSel + Math.sign(deck) + D.length) % D.length
    if (this.gear.deck(D[this.deckSel].graphic)) this.deckSel = 0
    this.wheelSel = (this.wheelSel + wheel + Wh.length) % Wh.length
    const pick = { graphic: D[this.deckSel].graphic, wheel: Wh[this.wheelSel].color }
    this.skater.setBoard(this.skater.characterId, pick)
    try {
      if (!pick.graphic && !pick.wheel) localStorage.removeItem(`${KEY}.board.${this.skater.characterId}`)
      else localStorage.setItem(`${KEY}.board.${this.skater.characterId}`, JSON.stringify(pick))
    } catch { /* not remembered, still ridden */ }
    this.draw()
  }

  /** Open or close the colours panel (C, or the pad's square). */
  setPaintMode(on: boolean) {
    this.paintMode = on && (this.paints.slots[this.skater.characterId]?.length ?? 0) > 0
    this.el.classList.toggle('paint', this.paintMode)
    this.slotSel = 0
    this.draw()
  }

  /** Step the slot (up/down) or that slot's colour (left/right); painted at once and remembered for this character. */
  stepPaint(slot: number, colour: number) {
    const id = this.skater.characterId, slots = this.paints.slots[id] ?? [], P = this.paints.palette
    if (!slots.length || !P.length) return
    this.slotSel = (this.slotSel + slot + slots.length) % slots.length
    if (colour) {
      const picks = this.savedPaint(id)
      const cur = Math.max(0, P.findIndex((p) => p.color === (picks[slots[this.slotSel].name] ?? '')))
      const next = P[(cur + colour + P.length) % P.length].color
      if (next) picks[slots[this.slotSel].name] = next; else delete picks[slots[this.slotSel].name]
      try { if (Object.keys(picks).length) localStorage.setItem(`${KEY}.colors.${id}`, JSON.stringify(picks)); else localStorage.removeItem(`${KEY}.colors.${id}`) } catch { /* not remembered, still painted */ }
      this.skater.setTint(id, this.tintFrom(id, picks))
    }
    this.draw()
  }

  /** A character's slot picks as colour keys (each key the pick shifted by its lightness offset); null for none. */
  private tintFrom(id: string, picks: Record<string, string>): Record<string, string> | null {
    const out: Record<string, string> = {}
    for (const s of this.paints.slots[id] ?? []) {
      const c = picks[s.name]
      if (!c) continue
      for (const [k, dl] of Object.entries(s.keys)) out[k] = '#' + new THREE.Color(c).offsetHSL(0, 0, dl).getHexString()
    }
    return Object.keys(out).length ? out : null
  }

  private savedPaint(id: string): Record<string, string> {
    try { const s = localStorage.getItem(`${KEY}.colors.${id}`); return s ? JSON.parse(s) as Record<string, string> : {} } catch { return {} }
  }

  private savedBoard(id: string): { graphic?: string; wheel?: string } | null {
    try { const s = localStorage.getItem(`${KEY}.board.${id}`); return s ? JSON.parse(s) as { graphic?: string; wheel?: string } : null } catch { return null }
  }

  /** Next or previous character (also the in-play key). Returns the new name. */
  step(d: number): string {
    const n = this.skater.cast.length
    this.sel = (this.sel + d + n) % n
    // Locked ones are skipped, open or in play: the list shows them only as a count.
    for (let k = 0; k < n && this.lock.locked(this.skater.cast[this.sel].id); k++) this.sel = (this.sel + d + n) % n
    this.pick(this.sel)
    return this.skater.characterName
  }

  /** The current character's next or previous outfit, remembered per character. */
  stepOutfit(d: number) {
    const outs = this.skater.outfits, ch = this.skater.characterId
    let i = Math.max(0, outs.findIndex((o) => o.id === this.skater.outfitId))
    // Outfits a story gives are skipped until it is done.
    for (let k = 0; k < outs.length; k++) { i = (i + d + outs.length) % outs.length; if (!this.gear.outfit(ch, outs[i].id)) break }
    const next = outs[i].id
    this.skater.setOutfit(next)
    try { localStorage.setItem(`${KEY}.outfit.${this.skater.characterId}`, next) } catch { /* not remembered, still worn */ }
    this.draw()
  }

  private savedOutfit(id: string): string | undefined {
    try { return localStorage.getItem(`${KEY}.outfit.${id}`) ?? undefined } catch { return undefined }
  }

  private pick(i: number) {
    const id = this.skater.cast[i].id, locked = this.lock.locked(id)
    this.skater.setSilhouette(false)
    this.skater.setCharacter(id, locked ? undefined : this.savedOutfit(id))
    // A locked skater is only a silhouette on the turntable: not remembered, not skated.
    if (locked) this.skater.setSilhouette(true)
    else { this.lastOpen = id; try { localStorage.setItem(KEY, id) } catch { /* not remembered, still picked */ } }
    this.draw()
  }

  private draw() {
    const locked = this.lock.locked(this.skater.characterId)
    this.el.classList.toggle('locked', locked)
    this.nameEl.textContent = locked ? '???' : this.skater.characterName
    const spec = this.skater.cast.find((c) => c.id === this.skater.characterId)
    this.bioEl.innerHTML = locked ? `<div class="picker-lock">Locked: ${esc(this.lock.hint(this.skater.characterId))}</div>A secret skater.` : esc((spec?.bio ?? [])[0] ?? '')
    const outs = this.skater.outfits, oi = Math.max(0, outs.findIndex((o) => o.id === this.skater.outfitId))
    this.outfitEl.innerHTML = outs.length > 1 && !locked ? `<span>Outfit</span><span><b>${esc(outs[oi].name)}</b><i>${oi + 1} of ${outs.length}</i></span>` : ''
    const sig = this.signatures[this.skater.characterId] ?? {}
    const names = ['kickflipsuperman', 'christair', '540flip'].map((k) => sig[k]).filter(Boolean)
    this.specialsEl.innerHTML = names.length && !locked ? `<span>Specials</span><span>${names.map((n) => `<b>${esc(n)}</b>`).join('')}</span>` : ''
    // The board shop: the deck list and the wheel colour.
    const D = this.shop.decks, Wh = this.shop.wheels, own = this.skater.boardDesign(this.skater.characterId)
    if (D.length && Wh.length) {
      const wheel = Wh[this.wheelSel], wc = wheel.color || own.wheel
      this.wheelEl.innerHTML = `<span>Wheels</span><span><b>${esc(wheel.name)}</b><i style="background:${esc(wc)}"></i></span>`
      this.deckList.innerHTML = ''
      D.forEach((x, i) => {
        const it = document.createElement('button')
        const shut = this.gear.deck(x.graphic)
        it.className = `picker-item${i === this.deckSel ? ' sel' : ''}${shut ? ' locked' : ''}`
        it.textContent = x.name
        if (shut) { it.title = shut; const sm = document.createElement('small'); sm.textContent = ` ${shut}`; it.appendChild(sm) }
        it.onclick = () => { if (!shut) this.stepBoard(i - this.deckSel, 0) }
        this.deckList.appendChild(it)
      })
    }
    // The colours panel: the character's slots, each with its colour, and the palette under the selected one.
    const slots = this.paints.slots[this.skater.characterId] ?? [], picks = this.savedPaint(this.skater.characterId), P = this.paints.palette
    this.paintEl.innerHTML = slots.map((s, i) => {
      const cur = picks[s.name] ?? '', name = P.find((p) => p.color === cur)?.name ?? 'Original'
      const sw = i === this.slotSel ? `<div class="picker-swatches">${P.map((p) => `<i class="${p.color ? '' : 'orig'}${p.color === cur ? ' sel' : ''}" title="${esc(p.name)}" style="${p.color ? `background:${esc(p.color)}` : ''}"></i>`).join('')}</div>` : ''
      return `<div class="picker-slot${i === this.slotSel ? ' sel' : ''}">${esc(s.name)}<b>${esc(name)}</b></div>${sw}`
    }).join('')
    this.el.querySelector('.picker-title')!.textContent = this.boardMode ? 'Board' : this.paintMode ? 'Colours' : 'Skater'
    const canPaint = slots.length > 0 && P.length > 0
    this.hintEl.innerHTML = this.boardMode
      ? '<span><kbd>&uarr;&darr;</kbd>deck</span><span><kbd>&larr;&rarr;</kbd>wheels</span><span><kbd>D</kbd>back</span>'
      : this.paintMode
        ? '<span><kbd>&uarr;&darr;</kbd>part</span><span><kbd>&larr;&rarr;</kbd>colour</span><span><kbd>C</kbd>back</span>'
        : locked
          ? '<span><kbd>&uarr;&darr;</kbd>skater</span><span><kbd>Esc</kbd>back</span>'
          : `<span><kbd>&uarr;&darr;</kbd>skater</span><span><kbd>&larr;&rarr;</kbd>outfit</span>${D.length ? '<span><kbd>D</kbd>board</span>' : ''}${canPaint ? '<span><kbd>C</kbd>colours</span>' : ''}<span><kbd>N</kbd>create</span><span><kbd>Enter</kbd>skate</span>`
    this.list.innerHTML = ''
    // Two groups (no list past about seven rows): the crew (the first seven in data/characters.json), then the city's characters.
    // Secret skaters still locked are not rows: one quiet line under the city says how many more unlock.
    const sec = (t: string) => { const h = document.createElement('div'); h.className = 'picker-sec'; h.textContent = t; this.list.appendChild(h) }
    const shut = this.skater.cast.filter((c) => this.lock.locked(c.id))
    this.skater.cast.forEach((c, i) => {
      if (i === 0) sec('Crew')
      if (i === 7) sec('The city')
      if (this.lock.locked(c.id) && i !== this.sel) return
      const it = document.createElement('button')
      const lk = this.lock.locked(c.id)
      it.className = `picker-item${i === this.sel ? ' sel' : ''}${lk ? ' locked' : ''}`
      it.textContent = lk ? '???' : c.name
      it.onclick = () => { this.sel = i; this.pick(i) }
      this.list.appendChild(it)
      if (i === this.sel) requestAnimationFrame(() => it.scrollIntoView({ block: 'nearest' }))   // the list scrolls on short screens
    })
    if (shut.length) {
      const m = document.createElement('div')
      m.className = 'picker-more'
      m.textContent = shut.length === 1 ? '1 more skater unlocks as you play' : `${shut.length} more skaters unlock as you play`
      m.title = shut.map((c) => this.lock.hint(c.id)).join('\n')
      this.list.appendChild(m)
    }
    const cas = document.createElement('button')
    cas.className = 'picker-item picker-cas'
    cas.textContent = 'Create-a-Skater'
    cas.onclick = () => this.create()
    this.list.appendChild(cas)
  }

  /** Pick a character by id (a created skater coming back from Create-a-Skater), remembered. */
  select(id: string) { const i = this.skater.cast.findIndex((c) => c.id === id); if (i >= 0) { this.sel = i; this.pick(i) } }

  /** Into Create-a-Skater: editing the created skater picked now, else a new one. */
  private create() { const id = this.skater.characterId; this.onCreate(/^cas\d+$/.test(id) ? id : null) }

  private key(e: KeyboardEvent) {
    if (!this.isOpen) return
    const c = e.code
    if (this.boardMode) {
      // The board shop: up/down the deck, left/right the wheels, D (or Enter, Esc) back to the skater.
      if (c === 'ArrowUp' || c === 'KeyW') this.stepBoard(-1, 0)
      else if (c === 'ArrowDown' || c === 'KeyS') this.stepBoard(1, 0)
      else if (c === 'ArrowLeft' || c === 'KeyA') this.stepBoard(0, -1)
      else if (c === 'ArrowRight') this.stepBoard(0, 1)
      else if (c === 'KeyD' || c === 'Enter' || c === 'Space' || c === 'KeyK' || c === 'Escape') this.setBoardMode(false)
      else return
      e.preventDefault()
      e.stopImmediatePropagation()
      return
    }
    if (this.paintMode) {
      // The colours panel: up/down the part, left/right its colour, C (or Enter, Esc) back to the skater.
      if (c === 'ArrowUp' || c === 'KeyW') this.stepPaint(-1, 0)
      else if (c === 'ArrowDown' || c === 'KeyS') this.stepPaint(1, 0)
      else if (c === 'ArrowLeft' || c === 'KeyA') this.stepPaint(0, -1)
      else if (c === 'ArrowRight' || c === 'KeyD') this.stepPaint(0, 1)
      else if (c === 'KeyC' || c === 'Enter' || c === 'Space' || c === 'KeyK' || c === 'Escape') this.setPaintMode(false)
      else return
      e.preventDefault()
      e.stopImmediatePropagation()
      return
    }
    // Up/down (and Tab) pick the character, left/right its outfit, D the board shop, C the colours.
    if (c === 'ArrowUp' || c === 'KeyW') this.step(-1)
    else if (c === 'ArrowDown' || c === 'KeyS' || c === 'Tab') this.step(1)
    else if ((c === 'ArrowLeft' || c === 'KeyA' || c === 'ArrowRight' || c === 'KeyD' || c === 'KeyC') && this.lock.locked(this.skater.characterId)) { /* locked: nothing to dress */ }
    else if (c === 'ArrowLeft' || c === 'KeyA') this.stepOutfit(-1)
    else if (c === 'ArrowRight') this.stepOutfit(1)
    else if (c === 'KeyD' && this.shop.decks.length) this.setBoardMode(true)
    else if (c === 'KeyC' && this.paints.palette.length) this.setPaintMode(true)
    else if (c === 'KeyN') this.create()
    else if (c === 'Enter' || c === 'Space' || c === 'KeyK' || c === 'Escape') this.close()
    else return
    e.preventDefault()
    e.stopImmediatePropagation()
  }

  /** Turntable: the camera circles the skater, a little above eye level, the figure right of centre. */
  camera(now: number, at: { x: number; y: number; z: number }, showcase?: { x: number; y: number; z: number }): CamPose {
    if (this.boardMode && showcase) {
      // The board shop: close on the display deck, the skater beside it, a slow sway.
      // From in front of the deck with the skater behind it to one side; the deck right of centre
      // (the shop's list covers the left of the screen).
      const a = Math.atan2(showcase.y - at.y, showcase.x - at.x) + 0.75 + Math.sin((now - this.openedAt) / 1000 * 0.35) * 0.2
      const pos = { x: showcase.x + Math.cos(a) * 2.1, y: showcase.y + Math.sin(a) * 2.1, z: showcase.z + 0.2 }
      const vx = showcase.x - pos.x, vy = showcase.y - pos.y, vl = Math.hypot(vx, vy) || 1
      return { pos, look: { x: showcase.x - (vy / vl) * 0.55, y: showcase.y + (vx / vl) * 0.55, z: showcase.z - 0.05 }, fov: 44 }
    }
    const a = (now - this.openedAt) / 1000 * 0.55 + 1.2
    const h = this.skater.characterHeight                  // framed to the character's height
    const d = 1.4 + h
    return { pos: { x: at.x + Math.cos(a) * d, y: at.y + Math.sin(a) * d, z: at.z + 0.55 * h + 0.1 }, look: { x: at.x + Math.sin(a) * 0.7, y: at.y - Math.cos(a) * 0.7, z: at.z + 0.42 * h }, fov: 42 }
  }
}
