import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { chromium, type Page } from 'playwright-core'
import { applyCommand, parseCommand } from '../sim/commands.ts'
import { HASH_EVERY, runReplay, type Replay } from '../sim/replay.ts'
import { createSim, worldHash } from '../sim/sim.ts'
import { saveSnapshot, type Snapshot } from '../sim/snapshot.ts'
import { step } from '../sim/step.ts'
import { loadData, loadPark, readJson, rel } from './io.ts'
import { loadScenario, runScenario } from './scenario.ts'
import { parkRepoDir, requireParkRepo } from './paths.ts'

// Headless Chromium for shots and cross-runtime checks. No visible windows:
// headless shell, muted, software GL (SwiftShader, so pixels repeat), its own
// temporary profile, always closed.

/** Playwright's browser cache: PLAYWRIGHT_BROWSERS_PATH, else its per-platform default. */
const browsersDir = () => process.env.PLAYWRIGHT_BROWSERS_PATH && process.env.PLAYWRIGHT_BROWSERS_PATH !== '0' ? process.env.PLAYWRIGHT_BROWSERS_PATH
  : process.platform === 'darwin' ? join(homedir(), 'Library/Caches/ms-playwright')
  : process.platform === 'win32' ? join(process.env.LOCALAPPDATA ?? homedir(), 'ms-playwright')
  : join(process.env.XDG_CACHE_HOME ?? join(homedir(), '.cache'), 'ms-playwright')

/** The headless shell: SKATE_CHROMIUM if set, else the newest one Playwright installed. */
export function headlessShell(): string {
  if (process.env.SKATE_CHROMIUM) return process.env.SKATE_CHROMIUM
  const base = browsersDir()
  const dirs = existsSync(base) ? readdirSync(base).filter((d) => d.startsWith('chromium_headless_shell-')).sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1])) : []
  const builds = ['chrome-headless-shell-mac-arm64', 'chrome-headless-shell-mac-x64', 'chrome-headless-shell-linux64', 'chrome-headless-shell-linux-arm64', 'chrome-headless-shell-win64']
  for (const d of dirs) for (const b of builds) {
    const p = join(base, d, b, process.platform === 'win32' ? 'chrome-headless-shell.exe' : 'chrome-headless-shell')
    if (existsSync(p)) return p
  }
  throw new Error(`no headless Chromium found in ${base} (npx playwright-core install chromium-headless-shell, or set SKATE_CHROMIUM)`)
}

export async function withPages<T>(fn: (open: (park: string, query?: string) => Promise<Page>) => Promise<T>, size = { width: 1280, height: 720 }, opts: { gpu?: boolean } = {}): Promise<T> {
  const { createServer } = await import('vite')
  const server = await createServer({ configFile: rel('vite.config.ts'), logLevel: 'error', server: { port: 0, strictPort: false } })
  await server.listen()
  const url = server.resolvedUrls?.local[0] ?? 'http://127.0.0.1:5410/'
  // SwiftShader (software GL) repeats pixels exactly for goldens; clips may use the GPU (Metal) for speed.
  const gl = opts.gpu ? ['--use-angle=metal', '--enable-gpu'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']
  const browser = await chromium.launch({ executablePath: headlessShell(), headless: true, args: ['--mute-audio', ...gl, '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] })
  try {
    const pages = new Map<string, Page>()
    // query 'play' opens the real game (menus, input, the frame loop) instead of the headless render API.
    const open = async (park: string, query = 'headless=1') => {
      const key = `${park}?${query}`
      let page = pages.get(key)
      if (page) return page
      page = await browser.newPage({ viewport: size, deviceScaleFactor: 1 })
      await page.goto(`${url}?${query === 'play' ? '' : query + '&'}park=${park}`)
      await page.waitForFunction(() => document.body.dataset.ready === '1' || document.body.classList.contains('ready') || !!document.body.dataset.error, null, { timeout: 300000 })   // 5 min: a page loads in seconds, but agents' runs can load this machine to 18+
      const err = await page.evaluate(() => document.body.dataset.error)
      if (err) throw new Error(`page failed: ${err}`)
      pages.set(key, page)
      return page
    }
    return await fn(open)
  } finally {
    await browser.close()
    await server.close()
  }
}

/** snap.json | replay.json@t | scenario@t | scenario | spot:<id> */
export function resolveTarget(target: string, park = 'soma'): Snapshot {
  const data = loadData()
  if (target.endsWith('.snap.json')) return readJson<Snapshot>(target)
  if (target.startsWith('spot:')) {
    const sim = createSim(loadPark(park, data), data, { spot: target.slice(5) })
    for (let i = 0; i < 12; i++) step(sim, { b: 0 })
    return saveSnapshot(sim)
  }
  const [file, at] = target.split('@')
  const tick = at === undefined ? Infinity : Number(at)
  if (file.endsWith('.json')) {
    const rp = readJson<Replay>(file)
    let snap = rp.start, t = 0
    runReplay(rp, loadPark(rp.start.park.name, data), { onTick: (sim) => { if (++t <= tick) snap = saveSnapshot(sim) } })
    return snap
  }
  const path = existsSync(file) ? file : rel('scenarios', `${file}.skate`)
  const sc = loadScenario(path)
  return saveSnapshot(runScenario({ ...sc, ticks: Number.isFinite(tick) ? tick : sc.ticks }, data).sim)
}

export type ShotOpts = { style?: 'real' | 'cute' | 'grey'; weather?: string; character?: string; life?: boolean; emote?: number; layers?: string[]; cam?: string; crop?: 'skater' | 'full'; width?: number; height?: number; camPose?: { pos: number[]; look: number[]; fov?: number; up?: number[] }; pins?: { n: number; point: number[]; done: boolean }[]; fog?: boolean; far?: number }

type ParkComment = { n: number; text: string; point_site: number[]; done: boolean; view_site: { camera: number[]; look_at: number[] }; skater?: { pos: number[] } }
export const readParkComments = (): ParkComment[] => readJson(join(requireParkRepo('park comment shots (pin)'), 'data/comments.json'))
/** The park comments when the world generator's checkout is there (view shots draw them as pins), else none. */
const parkCommentsIfAny = (): ParkComment[] => { const f = join(parkRepoDir(), 'data/comments.json'); return existsSync(f) ? readJson<ParkComment[]>(f) : [] }

/** --style real|cute|grey; park-shape shots (view, pin, photo) default to grey. */
export const styleOpt = (a: Record<string, unknown>, dflt: 'real' | 'cute' | 'grey' | undefined) => a.style === 'real' || a.style === 'cute' || a.style === 'grey' ? a.style : dflt

async function shoot(open: (park: string) => Promise<Page>, snap: Snapshot, out: string, o: ShotOpts) {
  const page = await open(snap.park.name)
  const res = await page.evaluate(([s, opts]) => (window as unknown as { __skate: { render: (x: unknown) => { crop: { x: number; y: number; width: number; height: number } | null; tick: number } } }).__skate.render({ snapshot: s, ...opts }), [snap, o] as const)
  mkdirSync(dirname(out), { recursive: true })
  await page.screenshot({ path: out, clip: res.crop ?? undefined })
  return res
}

export async function shotCmd(target: string, a: Record<string, unknown>) {
  if (!target) throw new Error('shot: give a target (scenario@tick, replay.json@tick, file.snap.json, spot:<id>)')
  const [w, h] = String(a.size ?? '1280x720').split('x').map(Number)
  if (target.startsWith('pin:')) return pinShots(target.slice(4).split(',').map(Number), a, w, h)
  if (target.startsWith('photo:')) return photoShots(target.slice(6), a)
  if (target.startsWith('view:')) {
    // view:x,y,z@lx,ly,lz — any camera, skater hidden
    const [c, l] = target.slice(5).split('@').map((t) => t.split(',').map(Number))
    const data = loadData()
    const sim = createSim(loadPark(typeof a.park === 'string' ? a.park : 'soma', data), data, {})
    applyCommand(sim, parseCommand(`teleport ${c[0]} ${c[1]} -50`))   // hidden, under the camera: the city draws (and culls) around the skater
    const out = typeof a.o === 'string' ? a.o : rel('out/views', `view-${c.map((v) => v.toFixed(1)).join('_')}.png`)
    const layers = typeof a.layers === 'string' ? a.layers.split(',') : ['park', 'context', 'pins']
    const pins = parkCommentsIfAny().map((x) => ({ n: x.n, point: x.point_site, done: x.done }))
    await withPages((open) => shoot(open, saveSnapshot(sim), out, { style: styleOpt(a, 'grey'), weather: typeof a.weather === 'string' ? a.weather : undefined, layers, camPose: { pos: c, look: l, fov: Number(a.fov ?? 60) }, pins, width: w, height: h, fog: a.fog !== 'off', far: typeof a.far === 'string' ? Number(a.far) : undefined, life: !!a.life }), { width: w, height: h })
    console.log(`wrote ${out.replace(rel(''), '')}`)
    return
  }
  const snap = resolveTarget(target, typeof a.park === 'string' ? a.park : 'soma')
  const out = typeof a.o === 'string' ? a.o : rel('out/shots', `${basename(target).replace(/[^a-z0-9@_.-]+/gi, '_').replace(/\.(snap|replay)\.json/, '')}.png`)
  const o: ShotOpts = { style: styleOpt(a, undefined), weather: typeof a.weather === 'string' ? a.weather : undefined, layers: typeof a.layers === 'string' ? a.layers.split(',') : undefined, cam: typeof a.cam === 'string' ? a.cam : 'chase', crop: a.crop === 'skater' ? 'skater' : 'full', width: w, height: h }
  if (typeof a.orbit === 'string') o.camPose = orbitPose(snap, a.orbit)
  if (typeof a.char === 'string') o.character = a.char
  if (a.life) o.life = true
  if (a.emote !== undefined) o.emote = Number(a.emote)
  const t0 = performance.now()
  const res = await withPages((open) => shoot(open, snap, out, o), { width: w, height: h })
  console.log(`wrote ${out.replace(rel(''), '')}  tick ${res.tick}  cam ${o.cam}  layers ${o.layers?.join(',') ?? 'default'}${res.crop ? `  crop ${res.crop.width}x${res.crop.height}` : `  ${w}x${h}`}  ${((performance.now() - t0) / 1000).toFixed(1)}s`)
}

/**
 * --orbit az,el,dist[,lookUp[,ahead]]: a camera on a sphere around the skater (az degrees from behind
 * the board's nose direction toward its left, el degrees up, dist metres), looking at the point lookUp
 * metres above the skater's contact (and ahead metres along the board). For close looks at the board and the character.
 */
export function orbitPose(snap: Snapshot, spec: string): NonNullable<ShotOpts['camPose']> {
  // az relative to the board (0: behind the tail), or w<deg> fixed in the world (0: from -x looking +x), to see the body turn.
  const world = spec.startsWith('w')
  const [az, el, dist, lookUp = 0.5, ahead = 0] = spec.replace(/^w/, '').split(',').map(Number)
  const t = snap.world.things.find((x) => x.kind === 'skater')!
  const r = loadData().physics.skater.radius
  const c = [t.pos.x - t.up.x * r + t.fwd.x * ahead, t.pos.y - t.up.y * r + t.fwd.y * ahead, t.pos.z - t.up.z * r + lookUp]
  const f = (world ? 0 : Math.atan2(t.fwd.y, t.fwd.x)) + Math.PI + (az * Math.PI) / 180, e = (el * Math.PI) / 180
  return { pos: [c[0] + Math.cos(f) * Math.cos(e) * dist, c[1] + Math.sin(f) * Math.cos(e) * dist, c[2] + Math.sin(e) * dist], look: c, fov: 40 }
}

/** Re-render park comments from their saved camera (and from above with --top), pins visible. */
async function pinShots(ns: number[], a: Record<string, unknown>, w: number, h: number) {
  const all = readParkComments()
  const pins = all.map((c) => ({ n: c.n, point: c.point_site, done: c.done }))
  const data = loadData()
  const park = loadPark('soma', data)
  await withPages(async (open) => {
    for (const n of ns) {
      const c = all.find((x) => x.n === n)
      if (!c) { console.log(`no pin ${n}`); continue }
      const sim = createSim(park, data, {})
      const pos = c.skater?.pos ?? c.point_site
      applyCommand(sim, parseCommand(`teleport ${pos[0]} ${pos[1]} ${pos[2] + 0.3}`))
      const snap = saveSnapshot(sim)
      const p = c.point_site
      const views: [string, { pos: number[]; look: number[]; fov?: number }][] = [['view', { pos: c.view_site.camera, look: c.view_site.look_at }]]
      if (a.top) views.push(['top', { pos: [p[0], p[1] - 0.01, p[2] + 14], look: p, fov: 50 }])
      for (const [label, camPose] of views) {
        const out = rel('out/pins', `pin${n}-${label}.png`)
        await shoot(open, snap, out, { style: styleOpt(a, 'grey'), layers: ['park', 'skater', 'pins', ...(label === 'top' ? [] : ['context'])], camPose, pins, width: w, height: h })
        console.log(`pin ${n} ${label}: out/pins/pin${n}-${label}.png  "${c.text}"`)
      }
    }
  }, { width: w, height: h })
}

type Env<T> = { value: T }
type CameraRec = { id: string; file: string; position_enu: Env<number[]>; basis_camera_to_world: Env<number[][]>; intrinsic_matrix: Env<number[][]>; image_size: Env<number[]> }

/**
 * Render the park from the solved camera of each of the park's reference photos (in the world
 * generator's checkout), then build photo | render | blend sheets (out/photos/) for auditing the model against reality.
 */
async function photoShots(which: string, a: Record<string, unknown>) {
  const repo = requireParkRepo('photo shots')
  const cams = readJson<{ cameras: CameraRec[] }>(join(repo, 'data/cameras.json')).cameras
  const ids = which === 'all' ? cams.map((c) => c.id) : which.split(',')
  const data = loadData()
  const park = loadPark('soma', data)
  const sim = createSim(park, data, {})
  applyCommand(sim, parseCommand('teleport 0 0 -50'))   // skater out of view
  const snap = saveSnapshot(sim)
  const layers = typeof a.layers === 'string' ? a.layers.split(',') : ['park', 'context', 'rails']
  const scale = Number(a.scale ?? 0.5)
  const groups = new Map<string, CameraRec[]>()
  for (const id of ids) {
    const c = cams.find((x) => x.id === id)
    if (!c) { console.log(`no camera ${id}`); continue }
    const [iw, ih] = c.image_size.value
    const key = `${Math.round(iw * scale)}x${Math.round(ih * scale)}`
    groups.set(key, [...(groups.get(key) ?? []), c])
  }
  const made: string[] = []
  for (const [key, list] of groups) {
    const [w, h] = key.split('x').map(Number)
    await withPages(async (open) => {
      for (const c of list) {
        const P = c.position_enu.value, B = c.basis_camera_to_world.value, K = c.intrinsic_matrix.value
        const right = [B[0][0], B[1][0], B[2][0]], up = [B[0][1], B[1][1], B[2][1]], back = [B[0][2], B[1][2], B[2][2]]
        void right
        const look = [P[0] - back[0], P[1] - back[1], P[2] - back[2]]
        const fov = (2 * Math.atan(c.image_size.value[1] / 2 / K[1][1]) * 180) / Math.PI
        const out = rel('out/photos', `${c.id}-render.png`)
        await shoot(open, snap, out, { style: styleOpt(a, 'grey'), layers, camPose: { pos: P, look, fov, up }, width: w, height: h })
        made.push(`${c.id}|${join(repo, c.file)}|${out}`)
      }
    }, { width: w, height: h })
  }
  const py = `
import sys
from PIL import Image
for row in sys.argv[1:]:
    cid, photo, render = row.split('|')
    r = Image.open(render).convert('RGB'); p = Image.open(photo).convert('RGB').resize(r.size)
    sheet = Image.new('RGB', (r.width * 3, r.height), 'white')
    sheet.paste(p, (0, 0)); sheet.paste(r, (r.width, 0)); sheet.paste(Image.blend(p, r, 0.5), (r.width * 2, 0))
    sheet.save(render.replace('-render.png', '-sheet.jpg'), quality=88)
`
  const { spawnSync } = await import('node:child_process')
  const res = spawnSync('python3', ['-c', py, ...made], { encoding: 'utf8' })
  if (res.status !== 0) throw new Error(res.stderr)
  for (const m of made) console.log(`out/photos/${m.split('|')[0]}-sheet.jpg  (photo | render | blend)`)
}

export async function diff(a: string, b: string, out?: string) {
  const { compare } = await import('odiff-bin')
  const diffPath = out || rel('out/diff', `${basename(a, '.png')}-vs-${basename(b, '.png')}.png`)
  mkdirSync(dirname(diffPath), { recursive: true })
  const r = await compare(a, b, diffPath, { threshold: 0.1, antialiasing: true }) as { match: boolean; reason?: string; diffCount?: number; diffPercentage?: number }
  if (r.match) return { similarity: 100, diffCount: 0, diffPath: null as string | null, reason: '' }
  if (r.reason === 'layout-diff') return { similarity: 0, diffCount: -1, diffPath: null, reason: 'images have different sizes' }
  return { similarity: 100 - (r.diffPercentage ?? 100), diffCount: r.diffCount ?? -1, diffPath, reason: r.reason ?? '' }
}

export async function diffCmd(a: string, b: string, out?: string) {
  if (!a || !b) throw new Error('diff: give two png paths')
  const r = await diff(a, b, out)
  console.log(r.reason === 'images have different sizes' ? `different sizes: ${a} vs ${b}` : `similarity ${r.similarity.toFixed(2)}%  ${r.diffCount} px differ${r.diffPath ? `  diff image ${r.diffPath.replace(rel(''), '')}` : ''}`)
}

/** check --full browser part: Node vs Chromium determinism, then golden screenshots. */
export async function browserChecks(): Promise<boolean> {
  const data = loadData()
  let ok = true
  await withPages(async (open) => {
    const t0 = performance.now()
    const lines: string[] = []
    for (const name of ['lab-vert-air', 'lab-wall-slide', 'soma-west-runway', 'sf-dolores-bomb', 'sf-traffic-roll', 'sf-car-roof', 'sf-skitch-hold', 'soma-npcs', 'soma-skate-sketchy', 'sf-ped-step-aside', 'soma-2p-graffiti-gaps', 'sf-muni-streetcar-hit', 'sf-escape-recalc', 'sf-van-lap', 'sf-van-bump', 'sf-teleport-car-top', 'sf-scooter-wheelie-ditch']) {
      const sc = loadScenario(rel('scenarios', `${name}.skate`))
      const rp = runScenario(sc, data).replay
      const nodeHashes: [number, string][] = []
      runReplay(rp, loadPark(sc.park, data), { onTick: (s) => { if (s.world.tick % HASH_EVERY === 0) nodeHashes.push([s.world.tick, worldHash(s.world)]) } })
      const page = await open(sc.park)
      const b = await page.evaluate((r) => (window as unknown as { __skate: { runReplay: (x: unknown) => { hashes: [number, string][] } } }).__skate.runReplay(r), rp)
      const first = nodeHashes.findIndex(([t, h], i) => b.hashes[i]?.[0] !== t || b.hashes[i]?.[1] !== h)
      if (first >= 0 || b.hashes.length !== nodeHashes.length) { ok = false; lines.push(`${name}: node and chromium diverge at tick ${nodeHashes[first]?.[0] ?? '?'}`) }
      else lines.push(`${name} ${nodeHashes.length} hashes`)
    }
    console.log(`${ok ? 'ok  ' : 'FAIL'}  ${'node=chromium'.padEnd(14)} ${((performance.now() - t0) / 1000).toFixed(1)}s  ${lines.join(', ')}`)

    const t1 = performance.now()
    const specs = existsSync(rel('goldens')) ? readdirSync(rel('goldens')).filter((f) => f.endsWith('.json')) : []
    const res: string[] = []
    let gok = true
    for (const f of specs) {
      const spec = readJson<ShotOpts & { target: string; park?: string; threshold?: number }>(rel('goldens', f))
      const name = basename(f, '.json')
      const golden = rel('goldens', `${name}.png`)
      const out = rel('out/goldens', `${name}.png`)
      await shoot(open, resolveTarget(spec.target, spec.park), out, spec)
      if (!existsSync(golden)) { (await import('node:fs')).copyFileSync(out, golden); res.push(`${name} new golden`); continue }
      const d = await diff(golden, out)
      const pass = d.similarity >= (spec.threshold ?? 99.5)
      gok &&= pass
      res.push(`${name} ${d.similarity.toFixed(2)}%${pass ? '' : ` FAIL (diff ${d.diffPath?.replace(rel(''), '')})`}`)
    }
    ok &&= gok
    console.log(`${gok ? 'ok  ' : 'FAIL'}  ${'goldens'.padEnd(14)} ${((performance.now() - t1) / 1000).toFixed(1)}s  ${res.join(', ') || 'none'}`)

    const t3 = performance.now()
    const v = await vehicleKeys(open)
    ok &&= v.ok
    console.log(`${v.ok ? 'ok  ' : 'FAIL'}  ${'vehicle keys'.padEnd(14)} ${((performance.now() - t3) / 1000).toFixed(1)}s  ${v.text}`)

    const t2 = performance.now()
    const m = await monkey(open, { seconds: 10, park: 'lab', seed: 7 })   // the light test park: software GL crawls in the city; skate monkey for sf
    ok &&= m.errors.length === 0
    console.log(`${m.errors.length ? 'FAIL' : 'ok  '}  ${'monkey'.padEnd(14)} ${((performance.now() - t2) / 1000).toFixed(1)}s  ${m.presses} presses in the real client${m.errors.length ? `: ${m.errors.slice(0, 3).join(' | ')}` : ', no errors'}`)

    // The first hour's flow in the real client on the park (story: nothing stuck; skate playtest --park sf for the city).
    // The monkey's page closes first: its frame loop, still running, kept the park's page from loading on a busy machine.
    await (await open('lab', 'play')).close()
    const t4 = performance.now()
    const { playtest } = await import('./playtest.ts')
    const pt = await playtest(open, { park: 'soma' })
    ok &&= pt.errors.length === 0
    console.log(`${pt.errors.length ? 'FAIL' : 'ok  '}  ${'playtest'.padEnd(14)} ${((performance.now() - t4) / 1000).toFixed(1)}s  ${pt.steps.length} steps of the first hour${pt.errors.length ? `: ${pt.errors.slice(0, 3).join(' | ')}` : ', nothing stuck'}`)
  })
  return ok
}

/**
 * The interact key and the vehicles in the real client (drivekey.ts, the lab park, a van spawned
 * beside the skater): the prompt says Get in, F gets in, F gets out beside the door, E there steps off.
 */
async function vehicleKeys(open: (park: string, query?: string) => Promise<Page>): Promise<{ ok: boolean; text: string }> {
  type G = { sim: { world: { things: { kind: string; state: string; player?: number; pos: { x: number; y: number } }[] } }; queue: (c: string) => Promise<{ ok: boolean; text: string }> }
  const page = await open('lab', 'nostory=1')
  const state = () => page.evaluate(() => (window as unknown as { __skateGame: G }).__skateGame.sim.world.things.find((x) => x.kind === 'skater' && x.player !== 2)!.state)
  const prompt = () => page.evaluate(() => { const el = document.querySelector('.vehicle-prompt'); return el?.classList.contains('on') ? el.querySelector('b')?.textContent ?? '' : '' })
  // A held button (E: step off) is read once a frame: on a loaded machine with software GL (about 5 fps, a frame of
  // 200 ms) a 100 ms press can fall between two frames, so the key stays down until the state changes (at most 1 s).
  const press = async (code: string, want?: string) => {
    await page.keyboard.down(code)
    for (let w = 0; w < 20 && (w < 2 || (want !== undefined && (await state()) !== want)); w++) await page.waitForTimeout(50)
    await page.keyboard.up(code); await page.waitForTimeout(400)
  }
  const at = await page.evaluate(() => { const t = (window as unknown as { __skateGame: G }).__skateGame.sim.world.things.find((x) => x.kind === 'skater' && x.player !== 2)!; return [t.pos.x, t.pos.y] })
  const r = await page.evaluate((c) => Promise.race([(window as unknown as { __skateGame: G }).__skateGame.queue(c), new Promise<{ ok: boolean; text: string }>((res) => setTimeout(() => res({ ok: false, text: 'paused' }), 5000))]), `vehicle spawn van ${at[0] + 2.4} ${at[1]} 0 keyvan`)
  if (!r.ok) return { ok: false, text: `vehicle spawn: ${r.text}` }
  await page.waitForTimeout(300)
  const steps: [string, string][] = [['', 'ground'], ['KeyF', 'drive'], ['KeyF', 'ground'], ['KeyE', 'walk']]
  const got: string[] = []
  for (const [key, want] of steps) {
    if (key) await press(key, want)
    for (let w = 0; w < 30 && (await state()) !== want; w++) await page.waitForTimeout(100)   // a loaded machine can take a few frames
    const s = await state(), p = await prompt()
    got.push(`${key || 'start'}: ${s}${p ? ` (${p})` : ''}`)
    if (s !== want) return { ok: false, text: `${got.join(', ')}; wanted ${want}` }
  }
  // Player 2 (split screen): its interact key, the numpad's Enter, gets it in and out of the same van.
  const p2 = () => page.evaluate(() => (window as unknown as { __skateGame: G }).__skateGame.sim.world.things.find((x) => x.kind === 'skater' && x.player === 2)?.state ?? 'none')
  const j = await page.evaluate((c) => Promise.race([(window as unknown as { __skateGame: G }).__skateGame.queue(c), new Promise<{ ok: boolean; text: string }>((res) => setTimeout(() => res({ ok: false, text: 'paused' }), 5000))]), `player2 join ${at[0] + 4.6} ${at[1]} 0.2 270`)   // by the van's right side (player 1 is on foot by its left)
  if (!j.ok) return { ok: false, text: `${got.join(', ')}; player2 join: ${j.text}` }
  await page.waitForTimeout(300)
  // Player 2's own prompt, in its half (#ui2; physics phase 31).
  const prompt2 = () => page.evaluate(() => { const el = document.querySelector('#ui2 .vehicle-prompt'); return el?.classList.contains('on') ? el.querySelector('b')?.textContent ?? '' : '' })
  const p2prompts: string[] = []
  for (const want of ['drive', 'ground']) {
    p2prompts.push(await prompt2())
    await press('NumpadEnter')
    for (let w = 0; w < 30 && (await p2()) !== want; w++) await page.waitForTimeout(100)
    const s = await p2()
    got.push(`P2 NumpadEnter: ${s}${p2prompts.at(-1) ? ` (${p2prompts.at(-1)})` : ''}`)
    if (s !== want) return { ok: false, text: `${got.join(', ')}; wanted ${want}` }
  }
  await page.close()   // its frame loop would slow the monkey down
  return { ok: got[0].includes('Get in') && got[1].includes('Get out') && p2prompts[0] === 'Get in' && p2prompts[1] === 'Get out', text: got.join(', ') }
}

/**
 * The real client (menus, input, frame loop) under random keys: every gameplay, menu and
 * feature key, seeded. Fails on page errors and console errors (external radio streams are
 * ignored: stations refuse headless browsers).
 */
export async function monkey(open: (park: string, query?: string) => Promise<Page>, o: { seconds: number; park: string; seed: number }) {
  const page = await open(o.park, 'play')
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push((e.stack ?? String(e)).split('\n').slice(0, 3).join(' ')))
  page.on('console', (msg) => { if (msg.type() === 'error' && !/Failed to load resource/.test(msg.text())) errors.push(msg.text().slice(0, 200)) })
  let seed = o.seed
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 }
  const holds = ['KeyW', 'KeyA', 'KeyD', 'KeyS', 'ShiftLeft', 'KeyK']
  const taps = ['KeyJ', 'KeyL', 'KeyI', 'KeyU', 'KeyO', 'Semicolon', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyE', 'KeyK']
  // The game boots into free roam (the story's intro dialogue on a fresh profile); F talks, M opens the city map, Enter the pause menu.
  const rare = ['Tab', 'BracketRight', 'KeyG', 'KeyC', 'KeyN', 'KeyR', 'Escape', 'ArrowDown', 'Space', 'Escape', 'KeyH', 'KeyH', 'KeyX', 'KeyX', 'KeyB', 'KeyB', 'KeyP', 'KeyP', 'KeyF', 'KeyM', 'Enter', 'Escape']
  const t0 = Date.now()
  let presses = 0
  while (Date.now() - t0 < o.seconds * 1000) {
    const h = holds[Math.floor(rnd() * holds.length)]
    await page.keyboard.down(h)
    for (let i = 0; i < 3; i++) { await page.keyboard.press(taps[Math.floor(rnd() * taps.length)]); await page.waitForTimeout(40 + rnd() * 120); presses++ }
    await page.keyboard.up(h)
    if (rnd() < 0.15) { await page.keyboard.press(rare[Math.floor(rnd() * rare.length)]); await page.waitForTimeout(150); presses++ }
  }
  return { presses, errors: [...new Set(errors)] }
}
