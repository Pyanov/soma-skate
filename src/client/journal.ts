// The journal (pause menu, docs/open-world.md): the story's chapters, the side stories by neighbourhood
// and each neighbourhood's open challenges, with what is done, skipped, on now or still to do. The pause
// menu's list idiom: up and down pick a page, Enter (cross) goes into it; inside, up and down pick an
// entry, Enter sets the waypoint to it, X (square) skips a story you have not played (the story moves on),
// Esc (circle) or left comes back out to the pages; Esc on the pages closes.

export type JournalEntry = {
  id: string; title: string; sub: string; blurb: string; face: string
  status: 'on' | 'open' | 'done' | 'skipped' | 'later'
  at: [number, number] | null    // where its waypoint goes
  skip?: boolean                 // can be skipped unplayed
  value?: string                 // a number in place of the status (the 100% page)
}
export type JournalPage = { id: string; title: string; entries: JournalEntry[] }

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;')
const STATUS: Record<JournalEntry['status'], string> = { on: 'ON NOW', open: 'TO DO', done: 'DONE', skipped: 'SKIPPED', later: 'LATER' }

export class Journal {
  readonly el: HTMLElement
  private pages: JournalPage[] = []
  private page = 0
  private sel = 0
  /** In a page's entries (true) or picking a page (false). */
  private inside = false
  /** Enter: the waypoint to this entry. */
  onWaypoint: (e: JournalEntry) => void = () => {}
  /** X: skip this unplayed story. */
  onSkip: (e: JournalEntry) => void = () => {}
  onClose: () => void = () => {}

  constructor(root: HTMLElement) {
    this.el = document.createElement('div')
    this.el.className = 'journal'
    root.appendChild(this.el)
    window.addEventListener('keydown', (e) => this.key(e), true)
  }

  get isOpen() { return this.el.classList.contains('on') }

  open(pages: JournalPage[], page?: string) {
    this.pages = pages
    if (page) this.page = Math.max(0, pages.findIndex((p) => p.id === page))
    this.page = Math.min(this.page, pages.length - 1)
    this.sel = 0
    this.inside = !!page && !!pages[this.page]?.entries.length
    this.el.classList.add('on')
    this.draw()
  }
  /** The pages again (after a skip or a waypoint), keeping the place. */
  refresh(pages: JournalPage[]) {
    this.pages = pages; this.page = Math.min(this.page, pages.length - 1)
    const n = pages[this.page]?.entries.length ?? 0
    this.sel = Math.min(this.sel, Math.max(0, n - 1)); if (!n) this.inside = false
    this.draw()
  }
  close() { this.el.classList.remove('on') }

  private draw() {
    const P = this.pages[this.page]
    if (!P) return
    const tabs = this.pages.map((p, i) => `<button class="jr-tab${i === this.page ? ' sel' : ''}" data-tab="${i}">${esc(p.title)} <small>${p.entries.filter((e) => e.status === 'done').length}/${p.entries.length}</small></button>`).join('')
    // Picking a page, its entries show to the right as a preview: no cursor, no blurb.
    const pick = (i: number) => this.inside && i === this.sel
    const rows = P.entries.map((e, i) => `<div class="jr-row ${e.status}${pick(i) ? ' sel' : ''}" data-row="${i}">
        ${e.face ? `<img src="assets/ui/portrait/${e.face}.jpg" alt="" onerror="this.style.visibility='hidden'">` : ''}<div class="jr-text"><b>${esc(e.title)}</b><span>${esc(e.sub)}</span>${pick(i) ? `<p>${esc(e.blurb)}</p>` : ''}</div>
        <i${e.value ? ' class="num"' : ''}>${esc(e.value ?? STATUS[e.status])}</i></div>`).join('')
    const cur = P.entries[this.sel]
    const foot = this.inside
      ? `<kbd>↑↓</kbd> pick${cur?.at ? ' <kbd>Enter</kbd> waypoint' : ''}${cur?.skip ? ' <kbd>X</kbd> skip it' : ''} <kbd>Esc</kbd> back`
      : `<kbd>↑↓</kbd> pick${P.entries.length ? ' <kbd>Enter</kbd> open' : ''} <kbd>Esc</kbd> close`
    this.el.innerHTML = `<div class="jr-card${this.inside ? ' in' : ''}"><div class="jr-head">JOURNAL</div><div class="jr-tabs">${tabs}</div><div class="jr-list">${rows || '<div class="jr-empty">Nothing here yet.</div>'}</div><div class="jr-foot">${foot}</div></div>`
    this.el.querySelectorAll<HTMLElement>('.jr-tab').forEach((b) => {
      b.onclick = () => { const i = Number(b.dataset.tab); if (i === this.page && !this.inside) this.enter(); else { this.page = i; this.sel = 0; this.inside = false; this.draw() } }
    })
    this.el.querySelectorAll<HTMLElement>('.jr-row').forEach((r) => {
      r.onclick = () => { const i = Number(r.dataset.row); if (this.inside && i === this.sel) this.go(); else { this.sel = i; this.inside = true; this.draw() } }
    })
    if (this.inside) this.el.querySelector('.jr-row.sel')?.scrollIntoView({ block: 'nearest' })
    else this.el.querySelector('.jr-list')?.scrollTo({ top: 0 })
  }

  private enter() { if (this.pages[this.page]?.entries.length) { this.inside = true; this.sel = 0; this.draw() } }
  private turn(d: number) { const k = this.pages.length; this.page = (this.page + d + k) % k; this.sel = 0; this.draw() }

  private go() { const e = this.pages[this.page]?.entries[this.sel]; if (e?.at) this.onWaypoint(e) }

  private key(e: KeyboardEvent) {
    if (!this.isOpen) return
    const P = this.pages[this.page], n = P?.entries.length ?? 0
    const handled = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyS', 'KeyA', 'KeyD', 'Enter', 'NumpadEnter', 'Space', 'KeyK', 'KeyX', 'KeyJ', 'Escape', 'Backspace', 'Tab'].includes(e.code)
    if (!handled) return
    e.preventDefault(); e.stopImmediatePropagation()
    if (!this.inside) {
      switch (e.code) {
        case 'ArrowUp': case 'KeyW': this.turn(-1); break
        case 'ArrowDown': case 'KeyS': case 'Tab': this.turn(1); break
        case 'Enter': case 'NumpadEnter': case 'Space': case 'KeyK': case 'ArrowRight': case 'KeyD': this.enter(); break
        case 'Escape': case 'Backspace': this.onClose(); break
      }
      return
    }
    switch (e.code) {
      case 'ArrowUp': case 'KeyW': if (n) { this.sel = (this.sel - 1 + n) % n; this.draw() } break
      case 'ArrowDown': case 'KeyS': if (n) { this.sel = (this.sel + 1) % n; this.draw() } break
      case 'Tab': this.turn(1); if (!this.pages[this.page]?.entries.length) { this.inside = false; this.draw() } break
      case 'Enter': case 'NumpadEnter': case 'Space': case 'KeyK': this.go(); break
      case 'KeyX': case 'KeyJ': { const x = P?.entries[this.sel]; if (x?.skip) this.onSkip(x); break }
      case 'Escape': case 'Backspace': case 'ArrowLeft': case 'KeyA': this.inside = false; this.draw(); break
    }
  }
}
