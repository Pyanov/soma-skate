import { existsSync, readFileSync, renameSync, writeFileSync, mkdirSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Plugin, ViteDevServer } from 'vite'
import { clipsDir, parkRepoDir, shownPath } from './paths.ts'

// Dev-server plugin: the bridge between the running game page and the outside
// (CLI, scripts, the tuning panel). Endpoints under /__skate/.

type Res = { statusCode: number; setHeader: (k: string, v: string) => void; end: (s?: string) => void; write: (s: string) => void; on: (e: string, f: () => void) => void }
type Req = { method?: string; url?: string; on: (e: string, f: (c?: Buffer) => void) => void }

const body = (req: Req) => new Promise<unknown>((resolve, reject) => {
  const chunks: Buffer[] = []
  req.on('data', (c) => chunks.push(c!))
  req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')) } catch (e) { reject(e) } })
})
const json = (res: Res, code: number, value: unknown) => { res.statusCode = code; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(value)) }
const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)

// Park comments go into the park model's own queue, in its viewer's format (data/comments.json in the
// world generator's checkout, SOMA_SKATEPARK_DIR; screenshots in notes/comments/<id>.jpg). Without that
// checkout they go to out/park-comments/ in this repo, in the same layout.
const PARK_REPO = existsSync(parkRepoDir()) ? parkRepoDir() : join(dirname(fileURLToPath(import.meta.url)), '../../out/park-comments')
const COMMENTS = join(PARK_REPO, 'data', 'comments.json')
type ParkComment = { id: string; n: number; [k: string]: unknown }
const readComments = (): ParkComment[] => (existsSync(COMMENTS) ? JSON.parse(readFileSync(COMMENTS, 'utf8')) : [])
const r3 = (v: number[]) => v.map((x) => Math.round(x * 1000) / 1000)
function localId() {
  const d = new Date(), z = (n: number) => String(n).padStart(2, '0')
  const rnd = Array.from({ length: 4 }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)]).join('')
  return `c${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}-${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}-${rnd}`
}

export function skateDevPlugin(root: string): Plugin {
  const waiting = new Map<string, (r: unknown) => void>()
  const watchers = new Set<Res>()
  let seq = 0
  return {
    name: 'skate-dev',
    configureServer(server: ViteDevServer) {
      server.ws.on('skate:result', (data: { id: string }) => { waiting.get(data.id)?.(data); waiting.delete(data.id) })
      server.ws.on('skate:state', (data: { line: string }) => { for (const w of watchers) w.write(`data: ${data.line}\n\n`) })
      server.watcher.on('change', (file) => {
        if (!file.startsWith(join(root, 'data')) || !file.endsWith('.json')) return
        try { server.ws.send({ type: 'custom', event: 'skate:data', data: { file: basename(file, '.json'), json: JSON.parse(readFileSync(file, 'utf8')) } }) } catch { /* half-written file; the next change event carries it */ }
      })
      server.middlewares.use(async (req: Req, res: Res, next: () => void) => {
        const url = req.url ?? ''
        if (!url.startsWith('/__skate/')) return next()
        try {
          if (url === '/__skate/cmd' && req.method === 'POST') {
            const { text } = (await body(req)) as { text: string }
            const id = String(++seq)
            const result = await new Promise((resolve) => {
              waiting.set(id, resolve)
              server.ws.send({ type: 'custom', event: 'skate:cmd', data: { id, text } })
              setTimeout(() => { if (waiting.delete(id)) resolve({ ok: false, text: 'no game page answered (is the game open at http://127.0.0.1:5410 ?)' }) }, 4000)
            })
            return json(res, 200, result)
          }
          if (url.startsWith('/__skate/watch')) {
            res.setHeader('content-type', 'text/event-stream'); res.setHeader('cache-control', 'no-cache')
            res.write(': watching\n\n')
            watchers.add(res)
            server.ws.send({ type: 'custom', event: 'skate:watch', data: { on: true } })
            req.on('close', () => { watchers.delete(res); if (!watchers.size) server.ws.send({ type: 'custom', event: 'skate:watch', data: { on: false } }) })
            return
          }
          if (url === '/__skate/clip' && req.method === 'POST') {
            const { replay, screenshot } = (await body(req)) as { replay: { note?: string }; screenshot?: string }
            const name = `${stamp()}${replay.note ? '-' + slug(replay.note) : ''}`
            mkdirSync(join(root, 'inbox'), { recursive: true })
            writeFileSync(join(root, 'inbox', `${name}.replay.json`), JSON.stringify(replay))
            if (screenshot?.startsWith('data:image/png;base64,')) writeFileSync(join(root, 'inbox', `${name}.png`), Buffer.from(screenshot.slice(22), 'base64'))
            return json(res, 200, { path: `inbox/${name}.replay.json` })
          }
          if (url === '/__skate/photo' && req.method === 'POST') {
            // Photo mode (B): a PNG of the frame, in the clips folder (out/clips, or SOMA_SKATE_CLIPS_DIR).
            const { png } = (await body(req)) as { png?: string }
            if (!png?.startsWith('data:image/png;base64,')) return json(res, 400, { error: 'need a PNG data URL' })
            const dir = clipsDir(root)
            mkdirSync(dir, { recursive: true })
            const name = `soma-skate-photo-${stamp()}.png`
            writeFileSync(join(dir, name), Buffer.from(png.slice(22), 'base64'))
            return json(res, 200, { path: shownPath(root, join(dir, name)) })
          }
          if (url === '/__skate/share' && req.method === 'POST') {
            // V in play: the last seconds as an MP4 with the game's sound, in the clips folder.
            const { replay, style, character, music, musicLevel } = (await body(req)) as { replay: unknown; style?: string; character?: string; music?: string; musicLevel?: number }
            const name = `soma-skate-${stamp()}`
            mkdirSync(join(root, 'out/share'), { recursive: true })
            const file = join(root, 'out/share', `${name}.replay.json`)
            writeFileSync(file, JSON.stringify(replay))
            const dir = clipsDir(root)
            mkdirSync(dir, { recursive: true })
            const out = join(dir, `${name}.mp4`)
            const { spawn } = await import('node:child_process')
            const args = ['clip', file, '-o', out, ...(style ? ['--style', style] : []), ...(character ? ['--char', character] : []), ...(music === 'punk' || music === 'lofi' || music === 'hyphy' ? ['--music', music, '--music-level', String(Math.max(0, Math.min(1.5, Number(musicLevel ?? 0.6))))] : [])]
            const code = await new Promise<number>((done) => spawn(join(root, 'skate'), args, { cwd: root, stdio: 'ignore' }).on('close', (c) => done(c ?? 1)))
            return json(res, code === 0 ? 200 : 500, code === 0 ? { path: shownPath(root, out) } : { error: `skate clip exited ${code}` })
          }
          if (url === '/__skate/snapshot' && req.method === 'POST') {
            const { name, snapshot } = (await body(req)) as { name: string; snapshot: unknown }
            mkdirSync(join(root, 'out'), { recursive: true })
            const path = `out/${slug(name) || 'quicksave'}.snap.json`
            writeFileSync(join(root, path), JSON.stringify(snapshot))
            return json(res, 200, { path })
          }
          if (url === '/__skate/park-comments' && req.method === 'GET') return json(res, 200, readComments())
          if (url === '/__skate/park-comment' && req.method === 'POST') {
            const c = (await body(req)) as { text: string; point: number[]; normal: number[]; element: string; elementName: string; collection: string; camera: number[]; lookAt: number[]; skater: { pos: number[]; spot: string }; screenshot?: string }
            if (!c.text?.trim() || c.point?.length !== 3) return json(res, 400, { error: 'need text and point' })
            const all = readComments()
            const id = localId()
            const n = all.reduce((m, x) => Math.max(m, Number(x.n) || 0), 0) + 1
            if (c.screenshot?.startsWith('data:image/jpeg;base64,')) {
              mkdirSync(join(PARK_REPO, 'notes', 'comments'), { recursive: true })
              writeFileSync(join(PARK_REPO, 'notes', 'comments', `${id}.jpg`), Buffer.from(c.screenshot.split(',')[1], 'base64'))
            }
            const [cx, cy, cz] = c.camera, [lx, ly, lz] = c.lookAt
            all.push({
              id, n, text: c.text.trim(), done: false,
              element: c.element, element_name: c.elementName, part: c.element, collection: c.collection,
              point_site: r3(c.point), normal_site: r3(c.normal),
              view: { position: [cx, cz, -cy], target: [lx, lz, -ly] },          // the viewer's y-up frame
              view_site: { camera: r3(c.camera), look_at: r3(c.lookAt) },
              screenshot: `notes/comments/${id}.jpg`, created: new Date().toISOString(),
              source: 'game', skater: { pos: r3(c.skater.pos), spot: c.skater.spot },
            })
            mkdirSync(dirname(COMMENTS), { recursive: true })
            writeFileSync(COMMENTS + '.tmp', JSON.stringify(all, null, 1))
            renameSync(COMMENTS + '.tmp', COMMENTS)
            return json(res, 200, { id, n })
          }
          if (url === '/__skate/data' && req.method === 'POST') {
            const { file, path, value } = (await body(req)) as { file: string; path: string; value: unknown }
            if (!/^[a-z]+$/.test(file)) return json(res, 400, { error: 'bad file' })
            const fp = join(root, 'data', `${file}.json`)
            const doc = JSON.parse(readFileSync(fp, 'utf8'))
            const keys = path.split('.')
            let o = doc
            for (const k of keys.slice(0, -1)) o = o?.[k]
            if (!o || !(keys[keys.length - 1] in o)) return json(res, 400, { error: `no ${path} in ${file}.json` })
            o[keys[keys.length - 1]] = value
            writeFileSync(fp, JSON.stringify(doc, null, 2) + '\n')
            return json(res, 200, { ok: true })
          }
          json(res, 404, { error: 'unknown endpoint' })
        } catch (e) { json(res, 500, { error: String((e as Error).message) }) }
      })
    },
  }
}
