// Share clips in the hosted build: the last seconds replay on screen while the browser records the
// game canvas and the replay's own sound (MediaRecorder), with the wordmark and each landed combo drawn
// on, then the file downloads. The dev server renders clips frame by frame instead (`skate clip`).

const TYPES = ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
const pickType = () => (typeof MediaRecorder === 'undefined' ? '' : TYPES.find((t) => MediaRecorder.isTypeSupported(t)) ?? '')

export class ClipRecorder {
  readonly canvas = document.createElement('canvas')
  readonly type: string
  private g: CanvasRenderingContext2D
  private rec: MediaRecorder
  private chunks: Blob[] = []
  private pop: { title: string; line: string; at: number } | null = null

  static supported() { return !!pickType() && typeof HTMLCanvasElement.prototype.captureStream === 'function' }

  constructor(w: number, h: number, audio: MediaStream | null, fps = 30) {
    this.canvas.width = w; this.canvas.height = h
    this.g = this.canvas.getContext('2d')!
    this.type = pickType()
    const video = this.canvas.captureStream(fps)
    const stream = new MediaStream([...video.getVideoTracks(), ...(audio?.getAudioTracks() ?? [])])
    this.rec = new MediaRecorder(stream, { mimeType: this.type, videoBitsPerSecond: 10_000_000, audioBitsPerSecond: 160_000 })
    this.rec.ondataavailable = (e) => { if (e.data.size) this.chunks.push(e.data) }
    this.rec.start(1000)
  }

  /** A landed combo: its name and points over the picture for two seconds. */
  combo(title: string, line: string, now: number) { this.pop = { title, line, at: now } }

  /** Draw this frame: the game canvas (right after it rendered), the wordmark, the combo (docs/art-direction.md type). */
  frame(src: HTMLCanvasElement, now: number) {
    const g = this.g, w = this.canvas.width, h = this.canvas.height, u = h / 100
    g.drawImage(src, 0, 0, w, h)
    const G = g as CanvasRenderingContext2D & { fontStretch?: string; letterSpacing?: string }
    G.save(); G.font = `900 ${Math.round(3 * u)}px Archivo, sans-serif`; G.fontStretch = 'expanded'; G.letterSpacing = `${(-0.09 * u).toFixed(1)}px`
    G.textBaseline = 'alphabetic'; G.shadowColor = 'rgba(11,11,12,0.9)'; G.shadowOffsetY = Math.max(1, 0.15 * u)
    G.fillStyle = '#f2efe8'; G.fillText('SOMA SKATE', 3 * u, h - 3 * u); G.restore()
    const p = this.pop, age = p ? (now - p.at) / 1000 : 99
    if (p && age < 2.2) {
      const a = Math.min(1, age / 0.12, (2.2 - age) / 0.3)
      g.save(); g.globalAlpha = a; g.textAlign = 'center'; g.textBaseline = 'alphabetic'
      g.shadowColor = 'rgba(11,11,12,0.9)'; g.shadowOffsetY = Math.max(1, 0.15 * u)
      g.font = `500 ${Math.round(3 * u)}px Inter, sans-serif`
      g.fillStyle = '#f2efe8'; g.fillText(p.title, w / 2, 76 * u, w * 0.9)
      g.font = `800 ${Math.round(5.2 * u)}px Archivo, sans-serif`; (g as CanvasRenderingContext2D & { fontStretch?: string }).fontStretch = 'expanded'
      g.fillStyle = '#ff4f1f'; g.fillText(p.line, w / 2, 83 * u)
      g.restore()
    }
  }

  /** Stop and hand back the file. */
  stop(): Promise<Blob> {
    return new Promise((done) => {
      this.rec.onstop = () => done(new Blob(this.chunks, { type: this.type.split(';')[0] }))
      this.rec.stop()
    })
  }

  /** Stop and throw the recording away. */
  cancel() { this.rec.onstop = null; if (this.rec.state !== 'inactive') this.rec.stop(); this.chunks = [] }

  get ext() { return this.type.startsWith('video/mp4') ? 'mp4' : 'webm' }
}
