import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'

// Render-cost rules learned the hard way. A transmissive material anywhere on screen makes three
// draw every opaque object a second time each frame (an NPC blob cost ~6 ms at 3200x1800).
const files = (dir: string): string[] => readdirSync(new URL(dir, import.meta.url), { withFileTypes: true }).flatMap((e) => e.isDirectory() ? files(`${dir}${e.name}/`) : e.name.endsWith('.ts') ? [`${dir}${e.name}`] : [])

describe('render rules', () => {
  it('no material uses transmission', () => {
    for (const f of files('../src/client/')) {
      const src = readFileSync(new URL(f, import.meta.url), 'utf8')
      expect(src, f).not.toMatch(/transmission:\s*(0?\.\d*[1-9]|[1-9])/)
    }
  })
})
