// The city map (M; docs/open-world.md): the whole city at a large scale, from the game's own data (the
// traffic network's streets, major ones wider; the parks' lawns and paths; the bay; the park's obstacles),
// with the neighbourhoods, landmarks and major streets named (names that would overlap are left out), a legend, the characters with a story to give (dots), each
// neighbourhood's challenges, the named spots (filled once visited), your objective, the waypoint and
// you. Drag or keys or the pad's left stick pan; the wheel, Q/E or L1/R1 zoom. Enter (cross, a click)
// sets the waypoint (on the icon under the cursor, else the point); T (square) goes to whatever is under
// the cursor (the named spot nearest it), with nothing to unlock; Backspace clears the waypoint; C
// (triangle) centres on you; Esc or M (circle) closes. The city's main places are a list on the left
// (data/story.json travel.places): up and down pick one (the map centres on it), Enter or a click goes there.

export type MapIcon = { key: string; kind: 'story' | 'side' | 'challenge' | 'spot' | 'objective' | 'interior' | 'job'; x: number; y: number; label: string; sub?: string; face?: string; visited?: boolean; spot?: string }
export type MapWorld = {
  streets: { pts: number[][]; box: number[]; major: boolean }[]
  park: HTMLCanvasElement | null; parkBox: number[]
  parks: number[]; water: number[]                       // triangles in plan, x y per corner
  names: { name: string; x: number; y: number; a: number }[]; namesFrom: number   // street names (a: the street's direction), shown from that zoom
  places: { name: string; at: [number, number]; big: boolean }[]
}
const tris = (xy: number[]) => { const p = new Path2D(); for (let i = 0; i + 5 < xy.length; i += 6) { p.moveTo(xy[i], xy[i + 1]); p.lineTo(xy[i + 2], xy[i + 3]); p.lineTo(xy[i + 4], xy[i + 5]); p.closePath() } return p }
const lines = (ss: MapWorld['streets']) => { const p = new Path2D(); for (const st of ss) st.pts.forEach((q, i) => (i ? p.lineTo(q[0], q[1]) : p.moveTo(q[0], q[1]))); return p }
type View = { cx: number; cy: number; zoom: number }

export class MapScreen {
  readonly el: HTMLElement
  private canvas: HTMLCanvasElement
  private infoEl: HTMLElement
  private footEl: HTMLElement
  private world: MapWorld | null = null
  private icons: MapIcon[] = []
  private you = { x: 0, y: 0, heading: 0 }
  private waypoint: [number, number] | null = null
  private view: View = { cx: 0, cy: 0, zoom: 0.3 }
  private zoomRange: [number, number] = [0.04, 3]
  private pan = 0.9
  private held = new Set<string>()
  private drag: { x: number; y: number; moved: boolean; cx: number; cy: number } | null = null
  private cursor: { x: number; y: number } | null = null   // the mouse, in canvas pixels (null: the middle)
  private last = 0
  private raf = 0
  private padWas: boolean[] = []
  /** The main places (the list on the left): a spot id, the name shown, where it is. */
  places: { spot: string; name: string; x: number; y: number }[] = []
  private placesEl: HTMLElement
  private sel = -1   // the place picked in the list (-1: none; Enter then sets a waypoint)
  /** The waypoint set (null: cleared). */
  onWaypoint: (p: [number, number] | null) => void = () => {}
  /** Go to this spot (a spot id). */
  onTravel: (spot: string, label: string) => void = () => {}
  /** Closed (Esc, M, the pad's circle). */
  onClose: () => void = () => {}
  /** Where T goes for an icon or a point (a spot id and its name), or why not. */
  travelFor: (icon: MapIcon) => { spot: string; label: string } | { why: string } = () => ({ why: '' })

  constructor(root: HTMLElement) {
    this.el = document.createElement('div')
    this.el.className = 'citymap'
    this.el.innerHTML = `<canvas></canvas><div class="citymap-title">SAN FRANCISCO</div><div class="citymap-info"></div><div class="citymap-places"></div><div class="citymap-foot"></div>
      <div class="citymap-legend"><span><i class="lg-story"></i>Story</span><span><i class="lg-side"></i>Side story</span><span><i class="lg-ch"></i>Challenge</span><span><i class="lg-job"></i>Gig board</span><span><i class="lg-you"></i>You</span></div>`
    root.appendChild(this.el)
    this.canvas = this.el.querySelector('canvas')!
    this.infoEl = this.el.querySelector('.citymap-info')!
    this.footEl = this.el.querySelector('.citymap-foot')!
    this.placesEl = this.el.querySelector('.citymap-places')!
    this.placesEl.addEventListener('click', (e) => { const b = (e.target as HTMLElement).closest('button'); if (b) this.go(Number(b.dataset.i)) })
    this.footEl.innerHTML = '<kbd>↑↓</kbd>places<kbd>Enter</kbd>go there<kbd>T</kbd>go to the pointer<kbd>WASD</kbd>move<kbd>Q E</kbd>zoom<kbd>Esc</kbd>close'
    const c = this.canvas
    c.addEventListener('pointerdown', (e) => { c.setPointerCapture(e.pointerId); this.drag = { x: e.clientX, y: e.clientY, moved: false, cx: this.view.cx, cy: this.view.cy } })
    c.addEventListener('pointermove', (e) => {
      const r = c.getBoundingClientRect()
      this.cursor = { x: e.clientX - r.left, y: e.clientY - r.top }
      this.select(-1)
      const d = this.drag
      if (!d) return
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4) d.moved = true
      if (d.moved) { this.view.cx = d.cx - (e.clientX - d.x) / this.view.zoom; this.view.cy = d.cy + (e.clientY - d.y) / this.view.zoom }
    })
    c.addEventListener('pointerup', () => { const d = this.drag; this.drag = null; if (d && !d.moved) this.pick() })
    c.addEventListener('pointerleave', () => { if (!this.drag) this.cursor = null })
    c.addEventListener('wheel', (e) => { e.preventDefault(); this.zoomAt(Math.exp(-e.deltaY * 0.0015), this.cursor) }, { passive: false })
    window.addEventListener('keydown', (e) => this.key(e, true), true)
    window.addEventListener('keyup', (e) => this.key(e, false), true)
  }

  get isOpen() { return this.el.classList.contains('on') }

  private paths: { parks: Path2D; water: Path2D; minor: Path2D; major: Path2D } | null = null
  open(world: MapWorld, icons: MapIcon[], you: { x: number; y: number; heading: number }, waypoint: [number, number] | null, zoom: [number, number, number], pan: number) {
    if (world !== this.world) this.paths = { parks: tris(world.parks), water: tris(world.water), minor: lines(world.streets.filter((x) => !x.major)), major: lines(world.streets.filter((x) => x.major)) }
    this.world = world; this.icons = icons; this.you = you; this.waypoint = waypoint
    this.el.querySelector('.citymap-legend .lg-in')?.parentElement?.classList.toggle('off', !icons.some((i) => i.kind === 'interior'))
    this.el.querySelector('.citymap-legend .lg-job')?.parentElement?.classList.toggle('off', !icons.some((i) => i.kind === 'job'))
    this.zoomRange = [zoom[0], zoom[1]]; this.pan = pan
    if (!this.isOpen) this.view = { cx: you.x, cy: you.y, zoom: zoom[2] }
    this.placesEl.innerHTML = this.places.map((p, i) => `<button data-i="${i}">${p.name}</button>`).join('')
    this.sel = -1
    this.el.classList.add('on')
    this.held.clear(); this.cursor = null; this.padWas = []
    this.last = performance.now()
    cancelAnimationFrame(this.raf)
    const loop = (now: number) => { if (!this.isOpen) return; this.frame(now); this.raf = requestAnimationFrame(loop) }
    this.raf = requestAnimationFrame(loop)
  }

  /** New icons or waypoint while open (the waypoint just set). */
  refresh(icons: MapIcon[], waypoint: [number, number] | null) { this.icons = icons; this.waypoint = waypoint }

  close() { this.el.classList.remove('on'); cancelAnimationFrame(this.raf); this.held.clear() }

  private key(e: KeyboardEvent, down: boolean) {
    if (!this.isOpen || e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
    e.preventDefault(); e.stopImmediatePropagation()
    if (!down) { this.held.delete(e.code); return }
    this.held.add(e.code)
    if (e.repeat) return
    switch (e.code) {
      case 'Escape': case 'KeyM': this.onClose(); break
      case 'ArrowUp': case 'ArrowDown': if (this.places.length) this.select((this.sel + (e.code === 'ArrowDown' ? 1 : this.sel < 0 ? 0 : -1) + this.places.length) % this.places.length); break
      case 'KeyW': case 'KeyA': case 'KeyS': case 'KeyD': case 'ArrowLeft': case 'ArrowRight': this.select(-1); break
      case 'Enter': case 'NumpadEnter': case 'Space': case 'KeyK': if (this.sel >= 0) this.go(this.sel); else this.pick(); break
      case 'KeyT': case 'KeyJ': this.travel(); break
      case 'Backspace': case 'Delete': this.onWaypoint(null); break
      case 'KeyC': case 'KeyI': this.view.cx = this.you.x; this.view.cy = this.you.y; break
    }
  }

  // ---- view ----

  private size() { return { w: this.canvas.clientWidth, h: this.canvas.clientHeight } }
  /** World x, y to canvas pixels (north up). */
  private px(x: number, y: number) { const { w, h } = this.size(); return { x: w / 2 + (x - this.view.cx) * this.view.zoom, y: h / 2 - (y - this.view.cy) * this.view.zoom } }
  private worldAt(p: { x: number; y: number }) { const { w, h } = this.size(); return { x: this.view.cx + (p.x - w / 2) / this.view.zoom, y: this.view.cy - (p.y - h / 2) / this.view.zoom } }
  private zoomAt(k: number, at: { x: number; y: number } | null) {
    const { w, h } = this.size(), p = at ?? { x: w / 2, y: h / 2 }, before = this.worldAt(p)
    this.view.zoom = Math.min(this.zoomRange[1], Math.max(this.zoomRange[0], this.view.zoom * k))
    const after = this.worldAt(p)
    this.view.cx += before.x - after.x; this.view.cy += before.y - after.y
  }

  /** The icon under the cursor (or the crosshair), within 18 px. */
  private hovered(): MapIcon | null {
    const { w, h } = this.size(), c = this.cursor ?? { x: w / 2, y: h / 2 }
    let best: MapIcon | null = null, bd = 18
    for (const i of this.icons) { const p = this.px(i.x, i.y), d = Math.hypot(p.x - c.x, p.y - c.y) + (i.kind === 'spot' ? 6 : 0); if (d < bd) { bd = d; best = i } }   // a face or a marker before a spot under it
    return best
  }

  private pick() {
    const i = this.hovered()
    if (i) { this.onWaypoint([i.x, i.y]); return }
    const { w, h } = this.size(), p = this.worldAt(this.cursor ?? { x: w / 2, y: h / 2 })
    this.onWaypoint([p.x, p.y])
  }

  /** A place in the list picked (the map centres on it) or let go (-1). */
  private select(i: number) {
    if (i === this.sel) return
    this.sel = i
    this.placesEl.querySelectorAll('button').forEach((b, k) => b.classList.toggle('sel', k === i))
    const p = this.places[i]
    if (p) { this.view.cx = p.x - Math.min(160, this.size().w * 0.15) / this.view.zoom; this.view.cy = p.y; this.cursor = null; this.placesEl.querySelector('.sel')?.scrollIntoView({ block: 'nearest' }) }
  }
  private go(i: number) { const p = this.places[i]; if (p) this.onTravel(p.spot, p.name) }

  private travel() {
    const { w, h } = this.size(), at = this.worldAt(this.cursor ?? { x: w / 2, y: h / 2 })
    const i = this.hovered() ?? { key: 'point', kind: 'objective' as const, x: at.x, y: at.y, label: '' }
    const t = this.travelFor(i)
    if ('why' in t) { this.say(t.why); return }
    this.onTravel(t.spot, t.label)
  }

  private sayUntil = 0
  private said = ''
  private say(t: string) { this.said = t; this.sayUntil = performance.now() + 2500 }

  // ---- each frame ----

  private frame(now: number) {
    const dt = Math.min(0.1, (now - this.last) / 1000)
    this.last = now
    // Keys and the pad move the view.
    const { w, h } = this.size(), step = this.pan * Math.min(w, h) * dt / this.view.zoom
    const k = (a: string, b: string) => this.held.has(a) || this.held.has(b)
    if (this.held.has('KeyW')) this.view.cy += step
    if (this.held.has('KeyS')) this.view.cy -= step
    if (k('KeyA', 'ArrowLeft')) this.view.cx -= step
    if (k('KeyD', 'ArrowRight')) this.view.cx += step
    if (k('KeyE', 'Equal')) this.zoomAt(Math.exp(dt * 1.6), this.cursor)
    if (k('KeyQ', 'Minus')) this.zoomAt(Math.exp(-dt * 1.6), this.cursor)
    const pad = typeof navigator.getGamepads === 'function' ? [...navigator.getGamepads()].find((g) => g?.connected) ?? null : null
    if (pad) {
      const ax = pad.axes[0] ?? 0, ay = pad.axes[1] ?? 0, dz = 0.2
      if (Math.abs(ax) > dz) this.view.cx += ax * step
      if (Math.abs(ay) > dz) this.view.cy -= ay * step
      if (pad.buttons[5]?.pressed) this.zoomAt(Math.exp(dt * 1.6), null)
      if (pad.buttons[4]?.pressed) this.zoomAt(Math.exp(-dt * 1.6), null)
      const edge = (i: number) => { const on = !!pad.buttons[i]?.pressed, was = this.padWas[i]; this.padWas[i] = on; return on && !was }
      if (edge(2)) this.travel()
      if (edge(13) && this.places.length) this.select((this.sel + 1) % this.places.length)
      if (edge(12) && this.places.length) this.select((Math.max(this.sel, 0) - 1 + this.places.length) % this.places.length)
      if (edge(3)) { this.view.cx = this.you.x; this.view.cy = this.you.y }
      edge(0); edge(1)   // cross and circle reach us as Space and Esc (Keyboard.poll), kept here only to track their edges
    }
    this.draw()
    const i = this.hovered()
    const html = now < this.sayUntil ? `<b>${this.said}</b>` : this.sel >= 0 ? `<b>${this.places[this.sel].name}</b><span>Enter goes there</span>` : i ? `<b>${i.label}</b>${i.sub ? `<span>${i.sub}</span>` : ''}` : '<span>Pick a place in the list to go there. Click the map for a waypoint.</span>'
    if (this.infoEl.innerHTML !== html) this.infoEl.innerHTML = html
  }

  private draw() {
    const W = this.world, c = this.canvas, pr = Math.min(2, window.devicePixelRatio || 1)
    const { w, h } = this.size()
    if (c.width !== Math.round(w * pr) || c.height !== Math.round(h * pr)) { c.width = Math.round(w * pr); c.height = Math.round(h * pr) }
    const g = c.getContext('2d')!
    g.setTransform(pr, 0, 0, pr, 0, 0)
    g.fillStyle = '#0b0b0c'; g.fillRect(0, 0, w, h)
    if (!W) return
    const z = this.view.zoom
    const x0 = this.view.cx - w / 2 / z, x1 = this.view.cx + w / 2 / z, y0 = this.view.cy - h / 2 / z, y1 = this.view.cy + h / 2 / z
    // The base: the bay, the parks' green, the streets (major ones wider, cream on slate), the park's obstacles.
    const P = this.paths
    g.save()
    g.translate(w / 2, h / 2); g.scale(z, -z); g.translate(-this.view.cx, -this.view.cy)
    if (P) {
      // Ink to paper only (docs/art-direction.md): the bay and the parks a shade up from the ground, the streets in paper.
      g.fillStyle = 'rgba(242, 239, 232, 0.05)'; g.fill(P.water)
      g.fillStyle = 'rgba(242, 239, 232, 0.1)'; g.fill(P.parks)
      g.lineCap = 'round'; g.lineJoin = 'round'
      g.strokeStyle = 'rgba(242, 239, 232, 0.18)'; g.lineWidth = Math.max(1.3 / z, 7); g.stroke(P.minor)
      g.strokeStyle = 'rgba(242, 239, 232, 0.38)'; g.lineWidth = Math.max(2.4 / z, 12); g.stroke(P.major)
    }
    void x0; void x1; void y0; void y1
    if (W.park) { const [a, b, cc, d] = W.parkBox; g.save(); g.globalAlpha = 0.6; g.translate(a, d); g.scale(1, -1); g.drawImage(W.park, 0, 0, cc - a, d - b); g.restore() }
    g.restore()
    // Street names along their streets, once zoomed in enough to read them.
    if (z >= W.namesFrom) {
      g.font = `500 ${Math.round(Math.min(12, 8 + z * 5))}px "Plex Mono", monospace`; g.textAlign = 'center'; g.textBaseline = 'middle'
      for (const n of W.names) {
        const q = this.px(n.x, n.y)
        if (q.x < -80 || q.x > w + 80 || q.y < -20 || q.y > h + 20) continue
        let a = -n.a; if (a > Math.PI / 2) a -= Math.PI; if (a < -Math.PI / 2) a += Math.PI   // never upside down
        g.save(); g.translate(q.x, q.y); g.rotate(a)
        g.lineWidth = 3; g.strokeStyle = 'rgba(11, 11, 12, 0.85)'; g.strokeText(n.name.toUpperCase(), 0, 0)
        g.fillStyle = 'rgba(242, 239, 232, 0.6)'; g.fillText(n.name.toUpperCase(), 0, 0); g.restore()
      }
    }
    // Neighbourhood names and landmarks (once zoomed in): small, in mono at 55% paper, as a map's labels are; each placed
    // clear of the marks (tried on its point, then a line below, then a line above) and of the names already set, else left out.
    g.textAlign = 'center'; g.textBaseline = 'middle'
    const marks: [number, number, number, number][] = []
    for (const i of this.icons) {
      if (i.kind === 'spot' && z < 0.12) continue
      const q = this.px(i.x, i.y), r = i.kind === 'spot' ? 4 : 8
      marks.push([q.x - r, q.y - r, q.x + r, q.y + r])
    }
    { const me = this.px(this.you.x, this.you.y); marks.push([me.x - 12, me.y - 12, me.x + 12, me.y + 12]) }
    // The title and its line, the key, the keys' line along the foot: no label under them.
    const taken: [number, number, number, number][] = [[0, 0, 480, 140], [w - 170, h - 150, w, h], [0, h - 48, 640, h], [0, 140, 250, 150 + this.places.length * 23]]
    const hits = (x0: number, y0: number, x1: number, y1: number) => [...taken, ...marks].some((r) => x0 < r[2] && x1 > r[0] && y0 < r[3] && y1 > r[1])
    for (const p of [...W.places].sort((a, b) => Number(b.big) - Number(a.big))) {
      if (!p.big && z < 0.35) continue
      const q = this.px(p.at[0], p.at[1])
      if (q.x < -100 || q.x > w + 100 || q.y < -20 || q.y > h + 20) continue
      ;(g as CanvasRenderingContext2D & { letterSpacing: string; fontStretch: string }).fontStretch = 'normal'
      g.font = p.big ? '500 11px "Plex Mono", monospace' : '400 11px Inter, sans-serif'
      ;(g as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = p.big ? '0.7px' : '0px'
      const text = p.big ? p.name.toUpperCase() : p.name
      const tw = g.measureText(text).width / 2 + 4, th = 8
      const spots: [number, number][] = [[0, 0], [0, 16], [0, -16], [0, 28], [0, -28], [tw + 10, 0], [-tw - 10, 0], [tw + 10, 16], [-tw - 10, -16]]
      const at = spots.find(([dx, dy]) => !hits(q.x + dx - tw, q.y + dy - th, q.x + dx + tw, q.y + dy + th))
      if (!at) continue
      const x = q.x + at[0], y = q.y + at[1]
      taken.push([x - tw, y - th, x + tw, y + th])
      g.lineWidth = 3; g.strokeStyle = 'rgba(11, 11, 12, 0.85)'; g.strokeText(text, x, y)
      g.fillStyle = p.big ? 'rgba(242, 239, 232, 0.55)' : 'rgba(242, 239, 232, 0.45)'
      g.fillText(text, x, y)
    }
    ;(g as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = '0px'
    // Marks: spots (small dots), challenges (diamonds), rooms (squares), stories (dots: the accent for the main story), the objective (a ring).
    const hov = this.hovered()
    for (const i of [...this.icons].sort((a, b) => rank(a) - rank(b))) {
      const q = this.px(i.x, i.y)
      if (q.x < -30 || q.x > w + 30 || q.y < -30 || q.y > h + 30) continue
      const big = i === hov
      if (i.kind === 'spot') {
        if (z < 0.12 && !big) continue
        g.fillStyle = i.visited ? '#f2efe8' : 'rgba(242, 239, 232, 0.35)'
        g.beginPath(); g.arc(q.x, q.y, big ? 5 : 3.5, 0, Math.PI * 2); g.fill()
      } else if (i.kind === 'challenge') {
        const s = big ? 9 : 7
        g.save(); g.translate(q.x, q.y); g.rotate(Math.PI / 4); g.fillStyle = '#f2efe8'; g.fillRect(-s * 0.7, -s * 0.7, s * 1.4, s * 1.4); g.restore()
      } else if (i.kind === 'interior') {
        const k = big ? 9 : 7
        g.fillStyle = 'rgba(242, 239, 232, 0.6)'; g.fillRect(q.x - k * 0.6, q.y - k * 0.6, k * 1.2, k * 1.2)
      } else if (i.kind === 'job') {
        // A gig board: a plain paper square low and right of its host's mark, and its tag in mono.
        const k = big ? 6 : 5, x = q.x + 12, y = q.y + 10
        g.fillStyle = '#f2efe8'; g.fillRect(x - k, y - k, k * 2, k * 2)
        g.font = '500 10px "Plex Mono", monospace'; g.textAlign = 'left'; g.textBaseline = 'middle'
        g.lineWidth = 3; g.strokeStyle = 'rgba(11, 11, 12, 0.85)'; g.strokeText('GIGS', x + k + 5, y + 1)
        g.fillStyle = 'rgba(242, 239, 232, 0.8)'; g.fillText('GIGS', x + k + 5, y + 1)
      } else if (i.kind === 'objective') {
        g.strokeStyle = '#ff4f1f'; g.lineWidth = 2; g.beginPath(); g.arc(q.x, q.y, 10, 0, Math.PI * 2); g.stroke()
      } else {
        g.fillStyle = i.kind === 'story' ? '#ff4f1f' : '#f2efe8'; g.beginPath(); g.arc(q.x, q.y, big ? 8 : 6, 0, Math.PI * 2); g.fill()
      }
    }
    // The route's waypoint.
    if (this.waypoint) {
      const q = this.px(this.waypoint[0], this.waypoint[1])
      g.fillStyle = '#ff4f1f'; g.fillRect(q.x - 6, q.y - 6, 12, 12)
    }
    // You: the accent arrow, pointing where you face.
    const me = this.px(this.you.x, this.you.y)
    g.save(); g.translate(me.x, me.y); g.rotate(this.you.heading)   // heading: 0 north, clockwise (the sim's)
    g.fillStyle = '#ff4f1f'
    g.beginPath(); g.moveTo(0, -12); g.lineTo(8, 8); g.lineTo(0, 3); g.lineTo(-8, 8); g.closePath(); g.fill(); g.restore()
    // The list's side fades to ink, so the places read over the streets and marks under them.
    if (this.places.length) {
      const f = g.createLinearGradient(0, 0, 360, 0)
      f.addColorStop(0, 'rgba(11, 11, 12, 0.95)'); f.addColorStop(0.65, 'rgba(11, 11, 12, 0.82)'); f.addColorStop(1, 'rgba(11, 11, 12, 0)')
      g.fillStyle = f; g.fillRect(0, 0, 360, h)
    }
    // The crosshair (keys and pad point with it).
    if (!this.cursor) { g.strokeStyle = 'rgba(242, 239, 232, 0.7)'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(w / 2 - 10, h / 2); g.lineTo(w / 2 + 10, h / 2); g.moveTo(w / 2, h / 2 - 10); g.lineTo(w / 2, h / 2 + 10); g.stroke() }
    g.fillStyle = 'rgba(242, 239, 232, 0.4)'; g.font = '500 9px "Plex Mono", monospace'; g.textAlign = 'right'; g.fillText('© OPENSTREETMAP', w - 12, h - 10)
  }
}

const rank = (i: MapIcon) => ({ spot: 0, interior: 1, challenge: 2, side: 3, story: 4, job: 5, objective: 6 })[i.kind]   // a gig board's badge over its host's face
