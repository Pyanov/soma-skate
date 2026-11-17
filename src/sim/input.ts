// One InputFrame per tick: a button bitmask and a quantized stick. The sim never
// sees raw device values.

export const Btn = {
  up: 1, down: 2, left: 4, right: 8,
  ollie: 16, flip: 32, grab: 64, grind: 128,
  spinL: 256, spinR: 512, revert: 1024,
  slide: 2048,   // powerslide on the board; on foot, walk instead of run
  walk: 4096,    // step off the board and carry it / drop it and ride
  use: 8192,     // get in or out of a vehicle: the client presses it for a tick on the interact action (F, the pad's triangle) when no talk prompt is up
  nose: 16384,   // held as K is let go: pop off the nose (Nollie rolling forward, Switch rolling backward; docs/mechanics/air-tricks.md)
} as const
export type BtnName = keyof typeof Btn

/** b: player 1's buttons; b2: player 2's (game/twoplayer.ts), absent when nobody plays player 2. */
export type InputFrame = { b: number; b2?: number }

export const NO_INPUT: InputFrame = { b: 0 }
export const has = (f: InputFrame, b: number) => (f.b & b) !== 0

/** Stick from direction buttons: x right, y up, each -1, 0 or 1. */
export function stick(f: InputFrame) {
  return { x: (has(f, Btn.right) ? 1 : 0) - (has(f, Btn.left) ? 1 : 0), y: (has(f, Btn.up) ? 1 : 0) - (has(f, Btn.down) ? 1 : 0) }
}

export function parseButtons(text: string): number {
  let b = 0
  for (const name of text.split('+')) {
    const v = Btn[name.trim() as BtnName]
    if (v === undefined) throw new Error(`unknown button "${name}" (known: ${Object.keys(Btn).join(', ')})`)
    b |= v
  }
  return b
}

export function buttonNames(b: number): string {
  return (Object.keys(Btn) as BtnName[]).filter((k) => (b & Btn[k]) !== 0).join('+')
}
