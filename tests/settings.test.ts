import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it } from 'vitest'
import { balanceGradients, Settings, type SettingsData } from '../src/client/settings.ts'
import { stickBits, type TouchData } from '../src/client/touch.ts'
import { Cam, type CameraData } from '../src/client/camera.ts'
import { Btn } from '../src/sim/input.ts'
import { loadData, loadPark, rel } from '../src/harness/io.ts'
import { createSim, skater } from '../src/sim/sim.ts'

// Settings (settings.ts, data/settings.json): every option cycles through its values from its default
// and is remembered; the first save's names carry over; each palette has every colour and the
// colour-blind one does not lean on red and green. The touch stick's directions (touch.ts), and
// Reduce motion on the camera.

const D = JSON.parse(readFileSync(rel('data/settings.json'), 'utf8')) as SettingsData
const T = JSON.parse(readFileSync(rel('data/touch.json'), 'utf8')) as TouchData
const store = new Map<string, string>()
beforeEach(() => {
  store.clear()
  ;(globalThis as unknown as { localStorage: Storage }).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v) }, removeItem: (k: string) => { store.delete(k) } } as Storage
})

describe('settings', () => {
  it('every option starts at its default (one of its values), cycles through them all and back, and is saved', () => {
    const s = new Settings(D)
    for (const o of s.all) {
      expect(o.values.some(([v]) => v === o.default), o.id).toBe(true)
      expect(s.get(o.id)).toBe(o.default)
      const seen = new Set<unknown>()
      for (let i = 0; i < o.values.length; i++) { seen.add(s.get(o.id)); s.cycle(o.id) }
      expect(seen.size, o.id).toBe(o.values.length)
      expect(s.get(o.id)).toBe(o.default)
    }
    s.set('units', 'mph'); s.set('hudScale', 1.2)
    const again = new Settings(D)
    expect(again.get('units')).toBe('mph'); expect(again.label('hudScale')).toBe('120%')
    again.reset()
    expect(new Settings(D).get('units')).toBe('kmh')
  })

  it("the first save's sound, radio and camera become master, music and camera distance; unknown values are dropped", () => {
    store.set('soma-skate:settings', JSON.stringify({ sound: 0.5, radio: 0.25, camera: 1.25, minimap: false, quality: 'low', units: 'furlongs' }))
    const s = new Settings(D)
    expect(s.get('master')).toBe(0.5); expect(s.get('music')).toBe(0.25); expect(s.get('cameraDistance')).toBe(1.25)
    expect(s.get('minimap')).toBe(false); expect(s.get('quality')).toBe('low'); expect(s.get('units')).toBe('kmh')
  })

  it('palettes: every colour, and the colour-blind one keeps green out and stripes the meter ends', () => {
    for (const [id, p] of Object.entries(D.palettes)) for (const k of ['p1', 'p2', 'safe', 'mid', 'danger', 'landed', 'bailed', 'goal'] as const) expect(p[k], `${id}.${k}`).toMatch(/^#[0-9a-f]{6}$/)
    const cb = D.palettes.cb
    expect(cb.hatch).toBe(true)
    const hue = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255), mx = Math.max(r, g, b), mn = Math.min(r, g, b)
      if (mx === mn) return 0
      const h = mx === r ? (g - b) / (mx - mn) : mx === g ? 2 + (b - r) / (mx - mn) : 4 + (r - g) / (mx - mn)
      return (h * 60 + 360) % 360
    }
    for (const k of ['safe', 'landed', 'goal'] as const) expect(hue(cb[k]), k).toBeGreaterThan(170)   // blue, not green
    expect(balanceGradients(cb).across).toContain(cb.danger)
  })
})

describe('touch stick', () => {
  it('reads nothing in the dead zone, one direction along an axis, two on a diagonal', () => {
    const r = T.stick.radius
    expect(stickBits(r * 0.1, 0, T.stick)).toBe(0)
    expect(stickBits(0, -r, T.stick)).toBe(Btn.up)
    expect(stickBits(-r, 0, T.stick)).toBe(Btn.left)
    expect(stickBits(r * 0.7, r * 0.7, T.stick)).toBe(Btn.down | Btn.right)
    expect(stickBits(-r * 0.95, -r * 0.2, T.stick)).toBe(Btn.left)
    expect(T.buttons.map((b) => `${b.key}:${b.id}`).sort()).toEqual(['I:grind', 'J:flip', 'K:ollie', 'L:grab'])
  })
})

describe('reduce motion', () => {
  it('no landing shake or goal punch-in, and only fovScale of the speed field-of-view change', () => {
    const C = JSON.parse(readFileSync(rel('data/camera.json'), 'utf8')) as CameraData
    Cam.setData(C)
    const data = loadData(), sim = createSim(loadPark('soma', data), data, { spot: 'big3' })
    const sk = { ...skater(sim), vel: { x: 0, y: 12, z: 0 }, state: 'ground' as const }
    const fov = (calm: boolean) => { Cam.calm = calm; const c = new Cam(); for (let i = 0; i < 240; i++) c.step(sk, i === 0); return c.pose!.fov }
    const wide = fov(false), calm = fov(true)
    expect(wide).toBeGreaterThan(C.chase.fov)
    expect(calm - C.chase.fov).toBeCloseTo((wide - C.chase.fov) * D.reduceMotion.fovScale, 1)
    Cam.calm = true
    const c = new Cam(); c.step(sk, true); c.kick('land', 2); c.punch()
    expect((c as unknown as { shake: number }).shake).toBe(0)
    expect((c as unknown as { punchT: number }).punchT).toBe(-1)
    Cam.calm = false
  })
})
