// ./skate photos [id,id,...] [--out dir] [--sheet [file.png]]: renders the loading screen's and the Play menu's
// photographs (assets/ui/photo/<id>.jpg, 1600x900) from the game itself: data/photos.json stages each one (a
// skater from a scenario at a tick, or stood somewhere; more of the cast placed about; the camera), the dev
// client draws it in headless Chromium (GPU, muted, its own profile, closed after) and src/client/photo.ts
// lights it with a flash and develops it in the house treatment (docs/art-direction.md). No image model and no
// real people. Re-run after a character or the city changes. --out: write somewhere else (a preview); --sheet:
// all of them on one contact sheet too (default out/photos/sheet.png); --data: another staging file (trying
// cameras without touching data/photos.json). Exits non-zero unless every picture asked for was written.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import type { PhotoFigure, PhotoJob, Develop } from '../src/client/photo.ts'
import { withPages } from '../src/harness/browser.ts'
import { loadData, loadPark, rel } from '../src/harness/io.ts'
import { loadScenario, runScenario } from '../src/harness/scenario.ts'
import { applyCommand, parseCommand } from '../src/sim/commands.ts'
import type { GameData } from '../src/sim/data.ts'
import { raycast, type Park } from '../src/sim/park/park.ts'
import { createSim } from '../src/sim/sim.ts'
import { saveSnapshot, type Snapshot } from '../src/sim/snapshot.ts'
import { step } from '../src/sim/step.ts'
import type { Thing } from '../src/sim/thing.ts'

type V3 = [number, number, number]
/** Where a figure stands: x y in the world, or [right, ahead] of the skater (its facing: the way the board's nose points, or where it walks). */
type FigureSpec = Omit<PhotoFigure, 'pos' | 'fwd' | 'react' | 'pose'> & {
  /** A pose of its own: a name in photos.json poses (sit: on its board on the ground), or the fields themselves. */
  pose?: string | Record<string, unknown> | null
  at?: [number, number] | V3; near?: [number, number]
  /** Which way it faces: compass-free degrees (0 = +x, 90 = +y), or 'camera', or 'skater'. For a figure on its board this is where the rider faces (the toe side). */
  face?: number | 'camera' | 'skater'
  /** Lift above the ground it stands on (sat on a ledge: the ledge is the ground; a little more for a seat). */
  lift?: number
  /** cheer / point / wait (0..1) at the skater. */
  react?: { cheer?: number; point?: number; wait?: number }
}
type PhotoSpec = {
  id: string; note?: string
  world: string; weather?: string
  skater: {
    /** From a scenario (run on this world) at a tick, its state checked (a physics change must not leave a rolling skater in a "mid-trick" photo). */
    scenario?: string; tick?: number; state?: string
    /** Or stood at x y (z from the ground) facing heading (degrees, the board's nose; 0 = +x): settled a few ticks. */
    at?: [number, number] | V3; heading?: number
    character?: string
    /** Out of the picture (a picture of the others): the camera still frames where it would be. */
    hidden?: boolean
  }
  /** orbit: az (degrees from behind the board's tail toward its left), el (degrees up), dist (m), lookUp (m over the contact), ahead (m along the nose); or pos and look in the world. shift: the look point moved (world metres) after. roll: degrees. fov: the lens (horizontal degrees). */
  camera: { orbit?: number[]; pos?: V3; look?: V3; shift?: V3; roll?: number; fov?: number }
  figures?: FigureSpec[]
  flash?: Partial<PhotoJob['flash']>
  develop?: Partial<Develop>
}
type PhotosData = { size: [number, number]; render: number; poses?: Record<string, Record<string, unknown>>; flash: PhotoJob['flash']; develop: Omit<Develop, 'width' | 'height' | 'seed' | 'inFov'>; photos: PhotoSpec[] }

const D2R = Math.PI / 180
const seedOf = (s: string) => { let h = 7; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return h }

/** The ground under x y (the highest up-facing surface below z + 3). */
function groundZ(park: Park, x: number, y: number, z = 80): number {
  const h = raycast(park, { x, y, z: z + 3 }, { x: 0, y: 0, z: -1 }, z + 200)
  if (!h) throw new Error(`photos: no ground at ${x.toFixed(1)} ${y.toFixed(1)}`)
  return h.point.z
}

function stage(p: PhotoSpec, data: GameData, parks: Map<string, Park>, flash: PhotoJob['flash'], poses: PhotosData['poses'] = {}): { snap: Snapshot; job: Omit<PhotoJob, 'develop' | 'flash'>; camPose: { pos: number[]; look: number[]; fov: number; up: number[] } } {
  const park = parks.get(p.world) ?? loadPark(p.world, data)
  parks.set(p.world, park)
  const radius = data.physics.skater.radius
  let snap: Snapshot
  const S = p.skater
  if (S.scenario) {
    const sc = loadScenario(rel('scenarios', `${S.scenario}.skate`))
    sc.park = p.world
    snap = saveSnapshot(runScenario({ ...sc, ticks: S.tick ?? sc.ticks }, data, { lite: true }).sim)
  } else {
    if (!S.at) throw new Error(`photos ${p.id}: skater needs a scenario or at`)
    const sim = createSim(park, data, {})
    const z = S.at[2] ?? groundZ(park, S.at[0], S.at[1])
    applyCommand(sim, parseCommand(`teleport ${S.at[0]} ${S.at[1]} ${z + radius + 0.05} ${S.heading ?? 0}`))
    for (let i = 0; i < 60; i++) step(sim, { b: 0 })
    snap = saveSnapshot(sim)
  }
  const sk = snap.world.things.find((t) => t.kind === 'skater')!
  if (S.state && sk.state !== S.state) throw new Error(`photos ${p.id}: the skater is ${sk.state} at tick ${snap.world.tick}, the photo wants ${S.state} (re-stage it in data/photos.json)`)
  const contact: V3 = [sk.pos.x - sk.up.x * radius, sk.pos.y - sk.up.y * radius, sk.pos.z - sk.up.z * radius]
  const nose = Math.atan2(sk.fwd.y, sk.fwd.x)
  // The camera.
  const C = p.camera
  let pos: V3, look: V3
  if (C.orbit) {
    const [az, el, dist, lookUp = 0.8, ahead = 0] = C.orbit
    look = [contact[0] + Math.cos(nose) * ahead, contact[1] + Math.sin(nose) * ahead, contact[2] + lookUp]
    const f = nose + Math.PI + az * D2R, e = el * D2R
    pos = [look[0] + Math.cos(f) * Math.cos(e) * dist, look[1] + Math.sin(f) * Math.cos(e) * dist, look[2] + Math.sin(e) * dist]
  } else {
    if (!C.pos || !C.look) throw new Error(`photos ${p.id}: camera needs orbit, or pos and look`)
    pos = C.pos; look = C.look
  }
  if (C.shift) look = [look[0] + C.shift[0], look[1] + C.shift[1], look[2] + C.shift[2]]
  // Roll: the up vector turned about the view direction.
  const d = [look[0] - pos[0], look[1] - pos[1], look[2] - pos[2]], dl = Math.hypot(d[0], d[1], d[2])
  const fwd = d.map((v) => v / dl), right0 = [fwd[1], -fwd[0], 0], rl = Math.hypot(right0[0], right0[1]) || 1
  const right = right0.map((v) => v / rl), up0 = [right[1] * fwd[2] - right[2] * fwd[1], right[2] * fwd[0] - right[0] * fwd[2], right[0] * fwd[1] - right[1] * fwd[0]]
  const rr = (C.roll ?? 0) * D2R
  const up = up0.map((v, i) => v * Math.cos(rr) + right[i] * Math.sin(rr))
  // Figures, placed on the ground and turned.
  const rider = data.rider.stance === 'goofy' ? -1 : 1
  const figures: PhotoFigure[] = (p.figures ?? []).map((f) => {
    let x: number, y: number
    if (f.near) { x = contact[0] + Math.cos(nose) * f.near[1] + Math.sin(nose) * f.near[0]; y = contact[1] + Math.sin(nose) * f.near[1] - Math.cos(nose) * f.near[0] }
    else if (f.at) { x = f.at[0]; y = f.at[1] }
    else throw new Error(`photos ${p.id}: figure ${f.model} needs at or near`)
    const z = (f.at?.[2] ?? groundZ(park, x, y, contact[2] + 2)) + (f.lift ?? 0)
    const faceA = f.face === 'camera' ? Math.atan2(pos[1] - y, pos[0] - x) : f.face === 'skater' ? Math.atan2(contact[1] - y, contact[0] - x) : (f.face ?? 0) * D2R
    // On foot the sim's forward is where it faces; on the board the nose is a quarter turn from where the rider faces.
    const a = f.state === 'ground' ? faceA + (Math.PI / 2) * rider : faceA
    const R = f.react ? { cheer: f.react.cheer ?? 0, point: f.react.point ?? 0, wait: f.react.wait ?? 0, at: { x: contact[0], y: contact[1], z: contact[2] + 1 } } : null
    const { at: _a, near: _n, face: _f, lift: _l, react: _r, pose: _p, ...rest } = f
    const pose = typeof f.pose === 'string' ? poses[f.pose] : f.pose
    if (typeof f.pose === 'string' && !pose) throw new Error(`photos ${p.id}: no pose ${f.pose} in photos.json poses`)
    return { ...rest, pose: pose ?? null, pos: [x, y, z + radius] as V3, fwd: [Math.cos(a), Math.sin(a)] as [number, number], react: R }
  })
  if (S.hidden) { sk.pos = { x: sk.pos.x, y: sk.pos.y, z: sk.pos.z - 60 } }
  const flashAt: V3 = [pos[0] + right[0] * flash.side, pos[1] + right[1] * flash.side, pos[2] + flash.up]
  return { snap, job: { figures, flashAt }, camPose: { pos, look, fov: C.fov ?? 0, up } }
}

export async function photosCmd(a: Record<string, unknown> & { _: string[] }) {
  const cfg = JSON.parse(readFileSync(typeof a.data === 'string' ? resolve(a.data) : rel('data/photos.json'), 'utf8')) as PhotosData
  const only = a._[0] ? new Set(a._[0].split(',')) : null
  const photos = cfg.photos.filter((p) => !only || only.has(p.id))
  if (only) for (const id of only) if (!photos.some((p) => p.id === id)) throw new Error(`photos: no photo ${id} in data/photos.json`)
  const out = typeof a.out === 'string' ? resolve(a.out) : rel('assets/ui/photo')
  mkdirSync(out, { recursive: true })
  const data = loadData(), parks = new Map<string, Park>()
  const [W, H] = cfg.size, RW = Math.round(W * cfg.render), RH = Math.round(H * cfg.render)
  const written: string[] = []
  const t0 = performance.now()
  await withPages(async (open) => {
    for (const p of photos) {
      const t1 = performance.now()
      const flash = { ...cfg.flash, ...p.flash }
      const { snap, job, camPose } = stage(p, data, parks, flash, cfg.poses)
      const dev: Develop = { ...cfg.develop, ...p.develop, width: W, height: H, seed: seedOf(p.id), inFov: 0 }
      if (camPose.fov) dev.fov = camPose.fov
      // The render is rectilinear and a little wider than the lens, so the image circle (not the render's edge) makes the
      // corners: it covers the lens out to the middle of the circle's soft edge (three's fov is vertical); photo.ts bends it.
      dev.inFov = Math.min(160, dev.fov * Math.max(1, dev.circle - dev.circleSoft / 2))
      const vfov = (2 * Math.atan(Math.tan((dev.inFov / 2) * D2R) * (RH / RW))) / D2R
      const page = await open(p.world)
      const url = await page.evaluate(([o]) => (window as unknown as { __skate: { photo(o: unknown): Promise<string> } }).__skate.photo(o), [{
        snapshot: snap, style: 'real', weather: p.weather ?? 'clear', character: p.skater.character, picture: { lens: false, ps2: false },
        camPose: { pos: camPose.pos, look: camPose.look, fov: vfov, up: camPose.up },
        job: { ...job, flash, develop: dev },
      }] as const)
      const file = join(out, `${p.id}.jpg`)
      writeFileSync(file, Buffer.from(url.split(',')[1], 'base64'))
      written.push(p.id)
      console.log(`${p.id.padEnd(8)} ${p.world} ${(p.weather ?? 'clear').padEnd(6)} skater ${(snap.world.things.find((t: Thing) => t.kind === 'skater')!.state)} at tick ${snap.world.tick}, ${job.figures.length} more  ${((performance.now() - t1) / 1000).toFixed(1)}s`)
    }
    if (a.sheet) {
      const sheet = typeof a.sheet === 'string' ? resolve(a.sheet.replace(/^~/, homedir())) : rel('out/photos/sheet.png')
      const page = await open(photos[0].world)
      const imgs = written.map((id) => ({ id, url: `data:image/jpeg;base64,${readFileSync(join(out, `${id}.jpg`)).toString('base64')}` }))
      const png = await page.evaluate(async (list) => {
        const cols = 3, w = 800, h = 450, pad = 24, lab = 30
        const rows = Math.ceil(list.length / cols)
        const c = document.createElement('canvas'); c.width = cols * w + (cols + 1) * pad; c.height = rows * (h + lab) + (rows + 1) * pad
        const g = c.getContext('2d')!
        g.fillStyle = '#0B0B0C'; g.fillRect(0, 0, c.width, c.height)
        for (let i = 0; i < list.length; i++) {
          const im = new Image(); im.src = list[i].url; await im.decode()
          const x = pad + (i % cols) * (w + pad), y = pad + Math.floor(i / cols) * (h + lab + pad)
          g.drawImage(im, x, y, w, h)
          g.fillStyle = '#F2EFE8'; g.font = '500 16px monospace'; g.fillText(list[i].id.toUpperCase(), x, y + h + 22)
        }
        return c.toDataURL('image/png')
      }, imgs)
      mkdirSync(dirname(sheet), { recursive: true })
      writeFileSync(sheet, Buffer.from(png.split(',')[1], 'base64'))
      console.log(`sheet ${sheet}`)
    }
  }, { width: RW, height: RH }, { gpu: true })
  console.log(`${written.length} of ${photos.length} photographs in ${out.replace(rel(''), '') || out}  ${((performance.now() - t0) / 1000).toFixed(1)}s`)
  if (written.length !== photos.length) process.exitCode = 1
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  const args: Record<string, unknown> & { _: string[] } = { _: [] }
  const argv = process.argv.slice(2)
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) { const k = argv[i].slice(2); args[k] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true }
    else args._.push(argv[i])
  }
  await photosCmd(args)
}
