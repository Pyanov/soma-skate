import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { Page } from 'playwright-core'
import { saveSnapshot, type Snapshot } from '../sim/snapshot.ts'
import { orbitPose, resolveTarget, withPages, type ShotOpts } from './browser.ts'
import { loadData, rel } from './io.ts'
import { loadScenario, runScenario } from './scenario.ts'

// Contact sheets: N frames of a scenario, cropped to the skater at one size per strip,
// side by side with tick and pose labels, so one image shows a whole trick.
//   skate strip <scenario> --ticks a:b:n [--cam side] [--label text] [--size 1920x1080] [--height px] [-o file]
//   skate strip --sheet scenarios/review.strips [--title text] [-o out/strips/review-sheet.png] [--each] [--gpu]
// A .strips file has one strip per line: label | scenario | a:b:n | cam

/**
 * cam: a camera mode, or orbit:az,el,dist[,lookUp] (see skate shot --orbit); char: a character id;
 * style: real|cute|grey, +life to draw the cars, +emote@T to play the emote from world tick T. scenario may also be a list of moments, scen@tick, scen@tick, ... (ticks '-'),
 * so one row can show one character across several moves.
 */
export type StripSpec = { label: string; scenario: string; ticks: number[]; cam: string; char?: string; style?: string }

export function parseTicks(spec: string): number[] {
  const m = /^(\d+):(\d+)(?::(\d+))?$/.exec(spec)
  if (!m) throw new Error(`--ticks a:b:n (got "${spec}")`)
  const a = Number(m[1]), b = Number(m[2]), n = Math.max(1, Number(m[3] ?? 8))
  if (n === 1) return [a]
  return Array.from({ length: n }, (_, i) => Math.round(a + ((b - a) * i) / (n - 1)))
}

/**
 * A moment may carry its own orbit camera after a colon, slashes for commas: scen@tick:az/el/dist[/lookUp[/ahead]]
 * (one row can show one pose from several sides: along the rail, from the near side, from the far side).
 */
const momentCam = (m: string): string | null => { const c = /@\d+:(.+)$/.exec(m.trim()); return c ? `orbit:${c[1].replace(/\//g, ',')}` : null }

function snapshots(scenario: string, ticks: number[]): Snapshot[] {
  if (scenario.includes('@')) return scenario.split(',').map((x) => resolveTarget(x.trim().replace(/(@\d+):.*$/, '$1')))
  if (scenario.endsWith('.json')) return ticks.map((t) => resolveTarget(`${scenario}@${t}`))
  const data = loadData()
  const sc = loadScenario(rel('scenarios', `${scenario.replace(/\.skate$/, '')}.skate`))
  return ticks.map((t) => saveSnapshot(runScenario({ ...sc, ticks: t }, data).sim))
}

/** +emote@T in a strip's style: the emote pressed at world tick T, as ticks ago at this frame (none before T). */
function emoteAt(style: string | undefined, tick: number): number | undefined {
  const m = /\+emote@(\d+)/.exec(style || '')
  return m && tick >= Number(m[1]) ? tick - Number(m[1]) : undefined
}

type Frame = { png: string; crop: { x: number; y: number; width: number; height: number }; tick: number; pose: string; state: string }

async function renderStrip(open: (park: string) => Promise<Page>, s: StripSpec): Promise<Frame[]> {
  const snaps = snapshots(s.scenario, s.ticks)
  const cams = s.scenario.includes('@') ? s.scenario.split(',').map(momentCam) : []
  const frames: Frame[] = []
  for (let i = 0; i < snaps.length; i++) {
    const snap = snaps[i]
    const page = await open(snap.park.name)
    const cam = cams[i] ?? s.cam
    const o: Partial<ShotOpts> & { snapshot: Snapshot; crop: 'skater' } = { snapshot: snap, crop: 'skater', cam: cam.startsWith('orbit:') ? 'chase' : cam, character: s.char || undefined, style: ((s.style || '').split('+')[0] || undefined) as ShotOpts['style'], life: (s.style || '').includes('+life'), emote: emoteAt(s.style, snap.world.tick) }
    if (cam.startsWith('orbit:')) o.camPose = orbitPose(snap, cam.slice(6))
    const res = await page.evaluate((x) => (window as unknown as { __skate: { render: (x: unknown) => { crop: Frame['crop']; pose: string } } }).__skate.render(x), o)
    const png = (await page.screenshot({ type: 'png' })).toString('base64')
    const sk = snap.world.things.find((t) => t.kind === 'skater')
    frames.push({ png, crop: res.crop, tick: s.ticks[i] ?? snap.world.tick, pose: res.pose, state: sk?.state ?? '' })
  }
  return frames
}

/** Compose strips (rows of frames) into one PNG in the page's 2D canvas. */
async function compose(page: Page, rows: { label: string; frames: Frame[] }[], rowHeight: number, title = ''): Promise<Buffer> {
  const url = await page.evaluate(async ({ rows, rowHeight, title }) => {
    const load = (b64: string) => new Promise<HTMLImageElement>((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = `data:image/png;base64,${b64}` })
    const pad = 6, labelH = 26, capH = 30
    const laid = await Promise.all(rows.map(async (r) => {
      // One crop size per strip: the largest skater box, centred on each frame's box.
      const w = Math.max(...r.frames.map((f) => f.crop.width)), h = Math.max(...r.frames.map((f) => f.crop.height))
      const k = rowHeight / h
      const imgs = await Promise.all(r.frames.map((f) => load(f.png)))
      return { r, w, h, k, imgs, width: pad + r.frames.length * (Math.round(w * k) + pad) }
    }))
    const titleH = title ? 40 : 0
    const W = Math.max(...laid.map((l) => l.width))
    const H = laid.reduce((s, l) => s + labelH + rowHeight + capH + pad, pad + titleH)
    const c = document.createElement('canvas')
    c.width = W; c.height = H
    const g = c.getContext('2d')!
    g.fillStyle = '#f4f3ef'; g.fillRect(0, 0, W, H)
    let y = pad
    if (title) {
      g.fillStyle = '#16181b'; g.font = 'bold 24px ui-monospace, Menlo, monospace'; g.textBaseline = 'top'
      g.fillText(title, pad + 2, y + 4)
      y += titleH
    }
    for (const l of laid) {
      g.fillStyle = '#16181b'; g.font = 'bold 18px ui-monospace, Menlo, monospace'; g.textBaseline = 'top'
      g.fillText(l.r.label, pad + 2, y + 4)
      y += labelH
      l.r.frames.forEach((f, i) => {
        const cw = Math.round(l.w * l.k), x = pad + i * (cw + pad)
        const cx = f.crop.x + f.crop.width / 2, cy = f.crop.y + f.crop.height / 2
        g.drawImage(l.imgs[i], cx - l.w / 2, cy - l.h / 2, l.w, l.h, x, y, cw, rowHeight)
        g.strokeStyle = 'rgba(0,0,0,0.15)'; g.strokeRect(x + 0.5, y + 0.5, cw - 1, rowHeight - 1)
        g.fillStyle = '#16181b'; g.font = '12px ui-monospace, Menlo, monospace'
        g.fillText(`t${f.tick} ${f.state}`, x + 2, y + rowHeight + 3)
        g.fillStyle = '#5a5d63'
        g.fillText(f.pose.slice(0, Math.max(8, Math.floor(cw / 7.4))), x + 2, y + rowHeight + 16)
      })
      y += rowHeight + capH + pad
    }
    return c.toDataURL('image/png')
  }, { rows, rowHeight, title })
  return Buffer.from(url.slice('data:image/png;base64,'.length), 'base64')
}

export function readStrips(file: string): StripSpec[] {
  return readFileSync(file, 'utf8').split('\n').map((l) => l.replace(/#.*/, '').trim()).filter(Boolean).map((l) => {
    const [label, scenario, ticks, cam, char, style] = l.split('|').map((x) => x.trim())
    return { label, scenario, ticks: scenario.includes('@') ? [] : parseTicks(ticks), cam: cam || 'side', char, style }
  })
}

export async function stripCmd(target: string | undefined, a: Record<string, unknown>) {
  const specs: StripSpec[] = typeof a.sheet === 'string'
    ? readStrips(a.sheet)
    : [{ label: typeof a.label === 'string' ? a.label : String(target), scenario: String(target), ticks: parseTicks(String(a.ticks ?? '0:120:8')), cam: typeof a.cam === 'string' ? a.cam : 'side' }]
  // --char and --style apply to every strip that does not name its own.
  for (const s of specs) { if (!s.char && typeof a.char === 'string') s.char = a.char; if (!s.style && typeof a.style === 'string') s.style = a.style }
  if (!target && !a.sheet) throw new Error('strip: give a scenario (and --ticks a:b:n), or --sheet file.strips')
  const name = typeof a.sheet === 'string' ? 'review-sheet' : `${String(target).replace(/[^a-z0-9_.-]+/gi, '_')}`
  const out = typeof a.o === 'string' ? a.o : rel('out/strips', `${name}.png`)
  const rowHeight = Number(a.height ?? (specs.length > 1 ? 260 : 340))
  const [w, h] = String(a.size ?? '1920x1080').split('x').map(Number)
  const t0 = performance.now()
  await withPages(async (open) => {
    const rows: { label: string; frames: Frame[] }[] = []
    for (const s of specs) rows.push({ label: s.label, frames: await renderStrip(open, s) })
    const page = await open('lab')
    if (a.each) for (const r of rows) {
      // Each strip on its own as well (out/strips/each/<label>.png), for looking at one move.
      const f = rel('out/strips/each', `${r.label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}.png`)
      mkdirSync(dirname(f), { recursive: true })
      writeFileSync(f, await compose(page, [r], Number(a['each-height'] ?? 380)))
    }
    const png = await compose(page, rows, rowHeight, typeof a.title === 'string' ? a.title : '')
    mkdirSync(dirname(out), { recursive: true })
    writeFileSync(out, png)
  }, { width: w, height: h }, { gpu: !!a.gpu })   // --gpu: Metal instead of SwiftShader (review sheets: fast, pixels not repeatable)
  console.log(`wrote ${out.replace(rel(''), '')}  ${specs.length} strip${specs.length > 1 ? 's' : ''}, ${specs.reduce((n, s) => n + (s.ticks.length || s.scenario.split(",").length), 0)} frames  ${((performance.now() - t0) / 1000).toFixed(1)}s`)
}
