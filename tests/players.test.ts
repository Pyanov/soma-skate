import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import { controlsSchema, type Controls } from '../src/data/schema.ts'
import { Btn } from '../src/sim/input.ts'
import { keyName } from '../src/client/school.ts'

// Two players' input (input.ts, data/controls.json player2): player 2 on the arrows and numpad (or the
// second pad), its own rebinds; while two play, player 1 gives way on player 2's keys.

const controls = controlsSchema.parse(JSON.parse(readFileSync(new URL('../data/controls.json', import.meta.url), 'utf8'))) as Controls
type Fn = (e: unknown) => void
const listeners: { type: string; fn: Fn }[] = []
let Keyboard: typeof import('../src/client/input.ts').Keyboard

beforeAll(async () => {
  const g = globalThis as unknown as Record<string, unknown>
  g.window = { addEventListener: (type: string, fn: Fn) => listeners.push({ type, fn }) }
  g.HTMLInputElement = class {}; g.HTMLTextAreaElement = class {}
  ;({ Keyboard } = await import('../src/client/input.ts'))
})
const key = (type: 'keydown' | 'keyup', code: string) => { for (const l of listeners) if (l.type === type) l.fn({ code, target: {}, preventDefault() {}, stopImmediatePropagation() {}, metaKey: false, ctrlKey: false, repeat: false }) }

describe('two players on one keyboard', () => {
  it('player 2 rides the arrows and the numpad; player 1 gives way on them only while two play', () => {
    const p1 = new Keyboard(controls), p2 = new Keyboard(controls, 2)
    key('keydown', 'ArrowUp'); key('keydown', 'Numpad5')
    expect(p2.frame().b).toBe(Btn.up | Btn.ollie)
    expect(p1.frame().b).toBe(Btn.up)                  // one player: the arrows are player 1's too
    p1.giveWay(p2)
    expect(p1.frame().b).toBe(0)
    key('keydown', 'KeyW'); key('keydown', 'KeyK')
    expect(p1.frame().b).toBe(Btn.up | Btn.ollie)
    expect(p2.frame().b).toBe(Btn.up | Btn.ollie)      // W and K are not player 2's
    p1.giveWay(null)
    key('keyup', 'KeyW'); key('keyup', 'KeyK')
    expect(p1.frame().b).toBe(Btn.up)
    for (const c of ['ArrowUp', 'Numpad5']) key('keyup', c)
  })

  it('rebinds are per player, and player 2 has no dev keys', () => {
    const p1 = new Keyboard(controls), p2 = new Keyboard(controls, 2)
    p2.rebind('flip', 'Numpad1')
    expect(p2.keysFor('flip')).toEqual(['Numpad1'])
    expect(p1.keysFor('flip')).toEqual(['KeyJ'])
    expect(p2.rebinds.flip).toBe('Numpad1')
    let dev = ''
    p2.onDev = (a) => { dev = a }
    key('keydown', 'KeyR'); key('keyup', 'KeyR')
    expect(dev).toBe('')
    expect(keyName('Numpad5')).toBe('Num 5')
    expect(keyName('NumpadAdd')).toBe('Num +')
  })
})
