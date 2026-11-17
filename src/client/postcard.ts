// Photo mode's postcard frame (F in photo mode): the shot on a paper card with "Greetings from" and the
// neighbourhood you are in, in the game's type (docs/art-direction.md: Archivo Expanded, Plex Mono, ink on
// paper), and a stamp that is type too: the wordmark on the accent with the date. Composed on a 2D canvas at
// save time; a CSS frame previews it while you line up the shot.

export type PostcardText = { place: string; line: string }

const PAPER = '#f2efe8', INK = '#0b0b0c', ACCENT = '#ff4f1f'
type Ctx = CanvasRenderingContext2D & { fontStretch?: string; letterSpacing?: string }
const display = (g: Ctx, px: number) => { g.font = `900 ${Math.round(px)}px Archivo, sans-serif`; g.fontStretch = 'expanded'; g.letterSpacing = `${(-0.03 * px).toFixed(1)}px` }
const mono = (g: Ctx, px: number) => { g.font = `500 ${Math.round(px)}px "Plex Mono", monospace`; g.fontStretch = 'normal'; g.letterSpacing = `${(0.06 * px).toFixed(1)}px` }
const text = (g: Ctx, px: number, weight = 400) => { g.font = `${weight} ${Math.round(px)}px Inter, sans-serif`; g.fontStretch = 'normal'; g.letterSpacing = '0px' }
const stampDate = () => { const d = new Date(); return `${d.toLocaleDateString('en-US', { month: 'short' }).toUpperCase()} ${d.getDate()} ${d.getFullYear()}` }

/** The stamp: an accent square with the wordmark in paper and the date in mono. */
function stamp(g: Ctx, x: number, y: number, s: number) {
  g.fillStyle = ACCENT; g.fillRect(x, y, s, s)
  g.fillStyle = PAPER; g.textBaseline = 'alphabetic'; g.textAlign = 'left'
  display(g, s * 0.2); g.fillText('SOMA', x + s * 0.1, y + s * 0.34); g.fillText('SKATE', x + s * 0.1, y + s * 0.52)
  mono(g, s * 0.085); g.fillText(stampDate(), x + s * 0.1, y + s * 0.88)
}

/** The saved image: the game canvas framed as a postcard (PNG data URL). */
export function postcard(src: HTMLCanvasElement, t: PostcardText): string {
  // The part of the frame the preview shows (inside its paper border and caption band).
  const k = src.width / innerWidth, vmin = Math.min(innerWidth, innerHeight) / 100, vh = innerHeight / 100
  const cx = Math.round(3.5 * vmin * k), cy = cx, cw = src.width - cx * 2, ch = src.height - cy - Math.round((3.5 * vmin + 16 * vh) * k)
  const w = cw, h = ch, m = Math.round(Math.min(w, h) * 0.035), band = Math.round(h * 0.2)
  const c = document.createElement('canvas')
  c.width = w + m * 2; c.height = h + m * 2 + band
  const g = c.getContext('2d')! as Ctx
  g.fillStyle = PAPER; g.fillRect(0, 0, c.width, c.height)
  g.drawImage(src, cx, cy, cw, ch, m, m, w, h)
  // Caption band: "Greetings from" in mono over the place in display type.
  const base = m + h + band * 0.5, fs = band * 0.4
  g.fillStyle = INK; g.textBaseline = 'alphabetic'; g.textAlign = 'left'
  mono(g, fs * 0.26); g.fillText('GREETINGS FROM', m, base - fs * 0.62)
  display(g, fs); g.fillText(t.place.toUpperCase(), m, base + fs * 0.42)
  g.textAlign = 'right'; g.fillStyle = 'rgba(11,11,12,0.6)'
  text(g, fs * 0.3); g.fillText(t.line, c.width - m, base - fs * 0.55)
  mono(g, fs * 0.24); g.fillText('SOMA SKATE, SAN FRANCISCO', c.width - m, base + fs * 0.4)
  g.textAlign = 'left'
  const s = Math.round(h * 0.16)
  stamp(g, m + w - s - m * 0.8, m + m * 0.8, s)
  return c.toDataURL('image/png')
}

/**
 * A created skater's card (Create-a-Skater's Postcard): the turntable shot (centred, the panel hidden)
 * cropped to a portrait on the same paper card, "Introducing" over the skater's name, two lines of who
 * they are, and the stamp. PNG data URL.
 */
export function skaterCard(src: HTMLCanvasElement, name: string, lines: string[]): string {
  const ch = src.height, cw = Math.min(src.width, Math.round(ch * 0.8)), cx = Math.round((src.width - cw) / 2)
  const m = Math.round(ch * 0.04), band = Math.round(ch * 0.26)
  const c = document.createElement('canvas')
  c.width = cw + m * 2; c.height = ch + m * 2 + band
  const g = c.getContext('2d')! as Ctx
  g.fillStyle = PAPER; g.fillRect(0, 0, c.width, c.height)
  g.drawImage(src, cx, 0, cw, ch, m, m, cw, ch)
  const fs = band * 0.3, x = m
  g.fillStyle = INK; g.textBaseline = 'alphabetic'; g.textAlign = 'left'
  mono(g, fs * 0.3); g.fillText('INTRODUCING', x, m + ch + band * 0.24)
  // The name: as big as fits the card's width, in display type.
  let size = fs
  display(g, size)
  while (g.measureText(name.toUpperCase()).width > cw - m && size > fs * 0.4) { size *= 0.92; display(g, size) }
  g.fillText(name.toUpperCase(), x, m + ch + band * 0.56)
  g.fillStyle = 'rgba(11,11,12,0.7)'; text(g, fs * 0.34)
  lines.slice(0, 2).forEach((l, i) => g.fillText(l, x, m + ch + band * (0.76 + i * 0.13)))
  g.textAlign = 'right'; mono(g, fs * 0.26); g.fillText('SOMA SKATE', c.width - m, m + ch + band * 0.89); g.textAlign = 'left'
  const s = Math.round(ch * 0.18)
  stamp(g, m + cw - s - m * 0.6, m + m * 0.6, s)
  return c.toDataURL('image/png')
}
