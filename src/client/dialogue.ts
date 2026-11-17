// The dialogue, a lower third (docs/story.md, docs/art-direction.md): the speaker's portrait, their name, the line, and
// for an offer the choices (Accept / Not now). Space, Enter or the talk key go on, Esc skips the rest
// (or says Not now); arrows pick a choice; a tap on the card goes on. The pad drives it through the
// keys the Keyboard sends while a menu is open (cross: Space, circle: Esc, d-pad: arrows).

export type DialogueLine = { face: string; name: string; text: string; n: number; of: number }

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;')

export class Dialogue {
  readonly el: HTMLElement
  private face: HTMLImageElement
  private nameEl: HTMLElement
  private textEl: HTMLElement
  private choicesEl: HTMLElement
  private footEl: HTMLElement
  private choices: string[] = []
  private sel = 0
  private line: DialogueLine | null = null
  /** The next line (Space, Enter, the talk key, a tap). */
  onNext: () => void = () => {}
  /** The rest of the conversation skipped (Esc). */
  onSkip: () => void = () => {}
  /** A choice picked (its index). */
  onChoose: (i: number) => void = () => {}
  /** Is this key the talk key (the player's binding)? */
  isTalkKey: (code: string) => boolean = () => false
  /** While this says so (the pause menu is open over it) its keys go elsewhere. */
  blocked: () => boolean = () => false
  /** The keys' names for the foot line (touch: none). */
  foot: () => string = () => '<span><kbd>Space</kbd>next</span><span><kbd>Esc</kbd>skip</span>'

  constructor(root: HTMLElement) {
    this.el = document.createElement('div')
    this.el.className = 'dlg'
    this.el.innerHTML = `<div class="dlg-card"><img class="dlg-face" alt=""><div class="dlg-body"><div class="dlg-name"></div><div class="dlg-text"></div><div class="dlg-choices"></div><div class="dlg-foot"></div></div></div>`
    root.appendChild(this.el)
    this.face = this.el.querySelector('.dlg-face')!
    this.nameEl = this.el.querySelector('.dlg-name')!
    this.textEl = this.el.querySelector('.dlg-text')!
    this.choicesEl = this.el.querySelector('.dlg-choices')!
    this.footEl = this.el.querySelector('.dlg-foot')!
    this.el.querySelector('.dlg-card')!.addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).closest('.dlg-choice')) return
      e.preventDefault()
      if (this.choices.length) this.onChoose(this.sel); else this.onNext()
    })
    // Capture phase: while it is open its keys reach nothing else (the pause menu's Esc, the skater's Space).
    window.addEventListener('keydown', (e) => this.key(e), true)
  }

  get isOpen() { return this.el.classList.contains('on') }
  /** Who is speaking now (the line's face: a cast id), or null. */
  get speaker(): string | null { return this.isOpen ? this.line?.face ?? null : null }
  /** Is this line's text the one showing? */
  showing(text: string) { return this.line?.text === text }

  /** A line, n of of in the conversation. */
  show(l: DialogueLine) {
    this.line = l
    this.choices = []
    // The speaker's portrait (tools/portraits.ts renders them from the 3D models); none: the line stands alone.
    this.face.classList.remove('none')
    this.face.onerror = () => this.face.classList.add('none')
    this.face.src = `assets/ui/portrait/${l.face}.jpg`
    this.nameEl.textContent = l.name
    this.textEl.innerHTML = esc(l.text)
    this.choicesEl.innerHTML = ''
    this.footEl.innerHTML = `${this.foot()}${l.of > 1 ? `<span class="dlg-n">${l.n + 1} / ${l.of}</span>` : ''}`
    this.el.classList.add('on')
    this.el.classList.remove('offer', 'list')
    // A new card slaps in (restart the animation).
    const card = this.el.querySelector<HTMLElement>('.dlg-card')!
    card.classList.remove('slap'); void card.offsetWidth; card.classList.add('slap')
  }

  /** The offer: the last line stays, with its choices under it (the first picked); list: one under another (a gig board's). */
  offer(choices: string[], line?: DialogueLine, list = false) {
    if (line) this.show(line)
    this.choices = choices
    this.sel = 0
    this.el.classList.add('on', 'offer')
    this.el.classList.toggle('list', list)
    this.drawChoices()
    this.footEl.innerHTML = this.foot().replace('next', 'pick').replace('skip', choices[choices.length - 1].toLowerCase())
  }

  hide() { this.el.classList.remove('on', 'offer', 'list'); this.choices = []; this.line = null }

  private drawChoices() {
    this.choicesEl.innerHTML = ''
    this.choices.forEach((c, i) => {
      const b = document.createElement('button')
      b.className = `dlg-choice${i === this.sel ? ' sel' : ''}`
      b.textContent = c
      b.onpointerenter = () => { if (this.sel !== i) { this.sel = i; this.drawChoices() } }
      b.onpointerdown = (e) => { e.preventDefault(); e.stopPropagation(); this.onChoose(i) }
      this.choicesEl.appendChild(b)
    })
  }

  private key(e: KeyboardEvent) {
    if (!this.isOpen || this.blocked() || e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
    const go = e.code === 'Space' || e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'KeyK' || this.isTalkKey(e.code)
    const move = e.code === 'ArrowLeft' || e.code === 'ArrowRight' || e.code === 'ArrowUp' || e.code === 'ArrowDown' || e.code === 'KeyA' || e.code === 'KeyD' || e.code === 'KeyW' || e.code === 'KeyS'
    if (!go && !move && e.code !== 'Escape') return
    e.preventDefault(); e.stopImmediatePropagation()
    if (e.repeat) return
    if (this.choices.length) {
      if (move) { const d = e.code === 'ArrowLeft' || e.code === 'ArrowUp' || e.code === 'KeyA' || e.code === 'KeyW' ? -1 : 1; this.sel = (this.sel + d + this.choices.length) % this.choices.length; this.drawChoices() }
      else if (e.code === 'Escape') this.onChoose(this.choices.length - 1)
      else this.onChoose(this.sel)
      return
    }
    if (e.code === 'Escape') this.onSkip()
    else if (go) this.onNext()
  }
}
