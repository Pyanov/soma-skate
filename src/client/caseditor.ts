import type { CamPose } from './camera.ts'
import { casId, defaultChoices, randomChoices, randomName, rng, ROWS, saveSkaters, type CasChoices, type CasData, type CasItem, type CasLocks, type CasRow, type CasSkater } from './cas.ts'

// The Create-a-Skater editor (Esc > Character > Create-a-Skater): a panel in the picker's look over the
// 3D skater on a turntable, which stands and fidgets and now and then pops a kickflip (main.ts plays the
// loop). Up and down pick a row, left and right change it (locked pieces show their hint and are not
// worn), Enter types the name or runs an action, R randomizes, Esc saves and goes back. Every row and
// arrow can be clicked or tapped; the pad drives it through the menu keys (input.ts). Up to `slots`
// skaters are kept (cas.ts); leaving saves them all.

const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!)

const CSS = `
#ui.in-cas > :not(.cas):not(.hud-radio):not(.hud-toast) { opacity: 0 !important; }
.cas { inset: 0; display: none; pointer-events: auto; background: rgba(11, 11, 12, 0.5); }
.cas.on { display: block; }
.cas.shot { background: none; }
.cas.shot .cas-left, .cas.shot .cas-arrows { display: none; }
.cas-left { position: absolute; left: var(--gutter); top: 10vh; bottom: 6vh; width: min(460px, 88vw); display: flex; flex-direction: column; text-shadow: var(--shadow); }
.cas-left > * { flex: none; }
.cas-title { font: 500 11px/1 var(--mono); letter-spacing: 0.06em; text-transform: uppercase; color: var(--paper-2); }
.cas-name { margin: 12px 0 14px; font-family: var(--display); font-weight: 900; font-stretch: 125%; text-transform: uppercase; letter-spacing: -0.03em; font-size: clamp(28px, 3.4vw, 44px); line-height: 0.95; max-width: 100%; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.cas-name input { all: unset; width: 13ch; font: inherit; color: var(--paper); caret-color: var(--accent); }
.cas-rows { flex: 1 1 auto; min-height: 0; overflow-y: auto; scrollbar-width: none; padding: 2px 0 24px 24px; }
.cas-rows::-webkit-scrollbar { display: none; }
.cas-sec { margin: 16px 0 6px; font: 500 11px/1 var(--mono); letter-spacing: 0.06em; text-transform: uppercase; color: var(--paper-2); }
.cas-row { all: unset; position: relative; display: flex; align-items: baseline; gap: 12px; cursor: pointer; width: 100%; box-sizing: border-box; padding: 3px 0; font-size: 15px; color: var(--paper-2); }
.cas-row::before { content: ''; position: absolute; left: -22px; top: 50%; width: 10px; height: 12px; transform: translateY(-50%); }
.cas-row.sel { color: var(--paper); }
.cas-row.sel::before { background: var(--accent); }
.cas-row .k { flex: 0 0 128px; }
.cas-row .v { flex: 1; font-weight: 500; display: flex; align-items: center; gap: 8px; min-width: 0; }
.cas-row.sel .v { color: var(--accent); }
.cas-row .v span { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.cas-row .a { all: unset; cursor: pointer; padding: 0 6px; font: 500 12px/1 var(--mono); color: var(--paper-2); }
.cas-row i.sw { flex: 0 0 auto; width: 12px; height: 12px; display: inline-block; }
.cas-row.locked .v span { color: var(--paper-3); }
.cas-row .lock { font: 500 10px/1 var(--mono); letter-spacing: 0.06em; text-transform: uppercase; color: var(--accent); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cas-row.act { font-family: var(--display); font-weight: 800; font-stretch: 125%; text-transform: uppercase; font-size: 17px; letter-spacing: -0.01em; }
.cas-row.act.sel { color: var(--accent); }
.cas-row.act .k { flex: 1; }
.cas-swatches { display: flex; flex-wrap: wrap; gap: 4px; margin: 6px 0 10px 140px; }
.cas-swatches i { width: 18px; height: 18px; display: inline-block; cursor: pointer; }
.cas-swatches i.sel { box-shadow: 0 4px 0 -1px var(--paper); }
.cas-hint { margin: 12px 0 0; font: 500 11px/1.8 var(--mono); letter-spacing: 0.06em; text-transform: uppercase; color: var(--paper-2); }
.cas-hint kbd { color: var(--paper); margin: 0 6px 0 0; }
.cas-status { margin: 6px 0 0; font: 500 11px/1.4 var(--mono); letter-spacing: 0.06em; text-transform: uppercase; color: var(--accent); min-height: 16px; }
.cas-arrows { position: absolute; left: 64%; bottom: 10vh; transform: translateX(-50%); display: flex; gap: 32px; }
.cas-arrows button { all: unset; cursor: pointer; font: 500 13px/1 var(--mono); letter-spacing: 0.06em; text-transform: uppercase; color: var(--paper); padding: 10px 12px; text-shadow: var(--shadow); }
.cas-arrows button:hover { color: var(--accent); }
.cas-arrows button.word { font-size: 12px; }
`

/** A row the cursor can be on: the slot, the name, a choice, or an action. */
type Line = { kind: 'slot' } | { kind: 'name' } | { kind: 'row'; row: CasRow } | { kind: 'act'; id: 'random' | 'postcard' | 'delete' | 'done'; label: string }

export class CasEditor {
  isOpen = false
  openedAt = 0
  /** Reduce motion: the turntable turns a third as fast and the skater only stands (no kickflip loop). */
  calm = false
  /** The skaters as kept (null: an empty slot); edited in place while open. */
  skaters: (CasSkater | null)[]
  slot = 0
  /** The skater changed: show it (main.ts rebuilds the preview). */
  onPreview: (k: CasSkater) => void = () => {}
  /** Closed: everything saved; the skater last edited (to ride). */
  onClose: (k: CasSkater | null) => void = () => {}
  /** Postcard wanted (main.ts shoots the turntable and frames it). */
  onPostcard: (k: CasSkater) => void = () => {}
  /** A slot was emptied (main.ts takes its skater out of the roster). */
  onDelete: (id: string) => void = () => {}

  private d: CasData
  private locks: CasLocks
  private root: HTMLElement
  private el: HTMLElement
  private nameEl: HTMLElement
  private rowsEl: HTMLElement
  private statusEl: HTMLElement
  private hintEl: HTMLElement
  private lines: Line[] = []
  private sel = 0
  private peek: Partial<Record<keyof CasChoices, string>> = {}   // a locked piece being looked at (shown, not worn)
  private editing = false
  private seed = (Date.now() & 0xffff) + 1

  constructor(root: HTMLElement, d: CasData, locks: CasLocks, skaters: (CasSkater | null)[]) {
    this.root = root; this.d = d; this.locks = locks; this.skaters = skaters
    const style = document.createElement('style'); style.textContent = CSS; document.head.appendChild(style)
    this.el = document.createElement('div')
    this.el.className = 'cas'
    this.el.innerHTML = `<div class="cas-left"><div class="cas-title">Create-a-Skater</div><div class="cas-name"></div><div class="cas-rows"></div><div class="cas-status"></div><div class="cas-hint"></div></div>
      <div class="cas-arrows"><button data-d="-1">&lsaquo;</button><button class="word" data-act="random">Randomize</button><button data-d="1">&rsaquo;</button></div>`
    root.appendChild(this.el)
    this.nameEl = this.el.querySelector('.cas-name')!
    this.rowsEl = this.el.querySelector('.cas-rows')!
    this.statusEl = this.el.querySelector('.cas-status')!
    this.hintEl = this.el.querySelector('.cas-hint')!
    for (const b of this.el.querySelectorAll<HTMLButtonElement>('.cas-arrows button')) b.onclick = () => (b.dataset.act ? this.randomize() : this.change(Number(b.dataset.d)))
    this.nameEl.onclick = () => this.editName()
    this.lines = [{ kind: 'slot' }, { kind: 'name' }, ...ROWS.map((row) => ({ kind: 'row' as const, row })),
      { kind: 'act', id: 'random', label: 'Randomize' }, { kind: 'act', id: 'postcard', label: 'Postcard' }, { kind: 'act', id: 'delete', label: 'Delete this skater' }, { kind: 'act', id: 'done', label: 'Save and ride' }]
    window.addEventListener('keydown', (e) => this.key(e), true)
  }

  /** The skater in the slot being edited (made the first time a slot is opened). */
  get current(): CasSkater {
    let k = this.skaters[this.slot]
    if (!k) { const r = rng(this.seed++); k = { id: casId(this.slot), name: randomName(this.d, r), choices: this.slot === 0 && !this.skaters.some(Boolean) ? defaultChoices(this.d) : randomChoices(this.d, r, (it) => !this.locks.locked(it)) }; this.skaters[this.slot] = k }
    return k
  }

  /** Open on a slot (a created skater's, or the first empty one). */
  open(slot?: number, now = performance.now()) {
    this.slot = slot ?? Math.max(0, this.skaters.findIndex((s) => !s))
    this.isOpen = true; this.openedAt = now; this.sel = 2; this.peek = {}; this.status('')
    this.el.classList.add('on'); this.root.classList.add('in-cas')
    this.onPreview(this.current)
    this.draw()
  }
  close() {
    if (this.editing) this.commitName()
    saveSkaters(this.skaters, this.d)
    this.isOpen = false; this.el.classList.remove('on'); this.root.classList.remove('in-cas')
    this.onClose(this.skaters[this.slot])
  }
  /** Hide the panel for a clean shot of the skater (the postcard) and bring it back. */
  shooting(on: boolean) { this.el.classList.toggle('shot', on) }

  /** Turntable: the camera circles the skater; the figure right of centre, clear of the panel. */
  camera(now: number, at: { x: number; y: number; z: number }, h: number, centred = false): CamPose {
    const a = (now - this.openedAt) / 1000 * (this.calm ? 0.14 : 0.42) + 1.2
    const d = centred ? 1.0 + h * 0.9 : 1.5 + h
    const side = centred ? 0 : 0.75
    return { pos: { x: at.x + Math.cos(a) * d, y: at.y + Math.sin(a) * d, z: at.z + 0.55 * h + 0.1 }, look: { x: at.x + Math.sin(a) * side, y: at.y - Math.cos(a) * side, z: at.z + 0.45 * h }, fov: 42 }
  }

  /**
   * The preview's loop (seconds since open): standing and fidgeting, then a kickflip and its landing.
   * kind 'idle' (t: seconds standing), 'air' (q: 0..1 through the flip), 'land' (t: seconds since landing).
   */
  loop(now: number): { kind: 'idle' | 'air' | 'land'; t: number; q: number } {
    const T = (now - this.openedAt) / 1000, cyc = T % 5.2
    if (cyc < 3.4 || this.calm) return { kind: 'idle', t: T, q: 0 }
    if (cyc < 4.25) return { kind: 'air', t: cyc - 3.4, q: (cyc - 3.4) / 0.85 }
    return { kind: 'land', t: cyc - 4.25, q: 1 }
  }

  /** Randomize the whole skater (R, the pad's triangle): any open pieces, a funny name. */
  randomize() {
    const r = rng(this.seed++), k = this.current
    k.choices = randomChoices(this.d, r, (it) => !this.locks.locked(it))
    k.name = randomName(this.d, r)
    this.peek = {}
    this.onPreview(k); this.draw(); this.status('Randomized. Again? R')
  }

  private status(s: string) { this.statusEl.textContent = s }

  private listOf(row: CasRow): CasItem[] { return row.list ? this.d[row.list] : [] }

  /** Change the selected line by d (left -1, right +1). */
  change(d: number) {
    const L = this.lines[this.sel]
    if (!L) return
    if (L.kind === 'slot') { this.slot = (this.slot + d + this.d.slots) % this.d.slots; this.peek = {}; this.onPreview(this.current); this.draw(); return }
    if (L.kind === 'name') { this.current.name = randomName(this.d, rng(this.seed++)); this.onPreview(this.current); this.draw(); return }
    if (L.kind === 'act') return
    const row = L.row, k = this.current
    if (row.palette) {
      const P = this.d.palettes[row.palette], i = Math.max(0, P.findIndex((p) => p.color === k.choices[row.key]))
      k.choices[row.key] = P[(i + d + P.length) % P.length].color
      this.onPreview(k); this.draw(); return
    }
    const list = this.listOf(row)
    const from = this.peek[row.key] ?? k.choices[row.key]
    const i = Math.max(0, list.findIndex((x) => x.id === from)), next = list[(i + d + list.length) % list.length]
    if (this.locks.locked(next)) { this.peek[row.key] = next.id; this.draw(); return }   // shown with its hint, not worn
    delete this.peek[row.key]
    k.choices[row.key] = next.id
    this.onPreview(k); this.draw()
  }

  private activate() {
    const L = this.lines[this.sel]
    if (!L) return
    if (L.kind === 'name') { this.editName(); return }
    if (L.kind === 'row' || L.kind === 'slot') { this.change(1); return }
    if (L.id === 'random') this.randomize()
    else if (L.id === 'postcard') this.onPostcard(this.current)
    else if (L.id === 'delete') {
      const id = casId(this.slot)
      this.skaters[this.slot] = null
      saveSkaters(this.skaters, this.d)
      this.onDelete(id)
      this.status('Deleted. A new skater waits in this slot.')
      this.onPreview(this.current); this.draw()
    } else this.close()
  }

  private editName() {
    if (this.editing) return
    this.editing = true
    const k = this.current
    this.nameEl.innerHTML = `<input maxlength="${this.d.nameMax}" value="${esc(k.name)}" aria-label="Skater name">`
    const inp = this.nameEl.querySelector('input')!
    inp.focus(); inp.select()
    inp.onkeydown = (e) => {
      e.stopPropagation()
      if (e.code === 'Enter' || e.code === 'NumpadEnter') { e.preventDefault(); this.commitName() }
      if (e.code === 'Escape') { e.preventDefault(); this.editing = false; this.draw() }
    }
    inp.onblur = () => { if (this.editing) this.commitName() }
  }
  private commitName() {
    const inp = this.nameEl.querySelector('input')
    this.editing = false
    const v = (inp?.value ?? '').replace(/\s+/g, ' ').trim().slice(0, this.d.nameMax)
    if (v) this.current.name = v
    this.onPreview(this.current); this.draw()
  }

  private draw() {
    const k = this.current
    if (!this.editing) this.nameEl.textContent = k.name
    const html: string[] = []
    this.lines.forEach((L, i) => {
      const sel = i === this.sel ? ' sel' : ''
      if (L.kind === 'slot') html.push(`<button class="cas-row${sel}" data-i="${i}"><span class="k">Skater</span><span class="v"><b class="a" data-d="-1">&lsaquo;</b><span>${this.slot + 1} of ${this.d.slots}${this.skaters[this.slot] ? '' : ' (new)'}</span><b class="a" data-d="1">&rsaquo;</b></span></button>`)
      else if (L.kind === 'name') html.push(`<button class="cas-row${sel}" data-i="${i}"><span class="k">Name</span><span class="v"><b class="a" data-d="-1">&lsaquo;</b><span>${esc(k.name)}</span><b class="a" data-d="1">&rsaquo;</b></span></button>`)
      else if (L.kind === 'act') html.push(`<button class="cas-row act${sel}" data-i="${i}"><span class="k">${esc(L.label)}</span></button>`)
      else {
        const row = L.row
        if (row.section) html.push(`<div class="cas-sec">${row.section}</div>`)
        let val = '', sw = '', locked = ''
        if (row.palette) {
          const P = this.d.palettes[row.palette], cur = k.choices[row.key], p = P.find((x) => x.color === cur)
          val = p?.name ?? cur; sw = `<i class="sw" style="background:${esc(cur)}"></i>`
        } else {
          const id = this.peek[row.key] ?? k.choices[row.key], it = this.listOf(row).find((x) => x.id === id) ?? this.listOf(row)[0]
          val = it.name
          if (this.peek[row.key]) locked = `<span class="lock">Locked: ${esc(this.locks.hint(it))}</span>`
        }
        html.push(`<button class="cas-row${sel}${locked ? ' locked' : ''}" data-i="${i}"><span class="k">${esc(row.label)}</span><span class="v"><b class="a" data-d="-1">&lsaquo;</b>${sw}<span>${esc(val)}</span>${locked}<b class="a" data-d="1">&rsaquo;</b></span></button>`)
        if (sel && row.palette) {
          const P = this.d.palettes[row.palette]
          html.push(`<div class="cas-swatches">${P.map((p, j) => `<i data-sw="${j}" class="${p.color === k.choices[row.key] ? 'sel' : ''}" title="${esc(p.name)}" style="background:${esc(p.color)}"></i>`).join('')}</div>`)
        }
      }
    })
    this.rowsEl.innerHTML = html.join('')
    for (const b of this.rowsEl.querySelectorAll<HTMLElement>('.cas-row')) {
      b.onclick = (e) => {
        const i = Number(b.dataset.i), a = (e.target as HTMLElement).closest<HTMLElement>('.a')
        const was = this.sel === i
        this.sel = i
        if (a) this.change(Number(a.dataset.d))
        else if (was || this.lines[i]?.kind === 'act' || this.lines[i]?.kind === 'name') this.activate()
        else this.draw()
      }
    }
    for (const s of this.rowsEl.querySelectorAll<HTMLElement>('.cas-swatches i')) s.onclick = () => {
      const L = this.lines[this.sel]
      if (L?.kind !== 'row' || !L.row.palette) return
      this.current.choices[L.row.key] = this.d.palettes[L.row.palette][Number(s.dataset.sw)].color
      this.onPreview(this.current); this.draw()
    }
    this.rowsEl.querySelector('.cas-row.sel')?.scrollIntoView({ block: 'nearest' })
    this.hintEl.innerHTML = '<kbd>&uarr;&darr;</kbd>row&emsp;<kbd>&larr;&rarr;</kbd>change&emsp;<kbd>R</kbd>random&emsp;<kbd>Enter</kbd>choose&emsp;<kbd>Esc</kbd>save'
  }

  private move(d: number) {
    const L = this.lines[this.sel]
    if (L?.kind === 'row') delete this.peek[L.row.key]   // leaving a locked piece: back to what is worn
    this.sel = (this.sel + d + this.lines.length) % this.lines.length
    this.draw()
  }

  private key(e: KeyboardEvent) {
    if (!this.isOpen || this.editing) return
    const c = e.code
    if (c === 'ArrowUp' || c === 'KeyW') this.move(-1)
    else if (c === 'ArrowDown' || c === 'KeyS' || c === 'Tab') this.move(1)
    else if (c === 'ArrowLeft' || c === 'KeyA') this.change(-1)
    else if (c === 'ArrowRight' || c === 'KeyD') this.change(1)
    else if (c === 'KeyR') this.randomize()
    else if (c === 'Enter' || c === 'Space' || c === 'KeyK') this.activate()
    else if (c === 'Escape') this.close()
    else return
    e.preventDefault()
    e.stopImmediatePropagation()
  }
}
