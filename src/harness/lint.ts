import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve, dirname } from 'node:path'
import { rel, ROOT } from './io.ts'

// The sim boundary and determinism rules, checked as text. The sim tsconfig
// (no DOM lib) catches DOM use; this catches the rest.

const BANNED: [RegExp, string][] = [
  [/\bMath\.random\b/, 'Math.random (use world.rng)'],
  [/\bDate\b/, 'Date (no clocks in the sim)'],
  [/\bperformance\b/, 'performance (no clocks in the sim)'],
  [/\b(setTimeout|setInterval|requestAnimationFrame|queueMicrotask)\b/, 'timers'],
  [/\b(async|await|Promise)\b/, 'async code'],
  [/\b(process|globalThis|window|document)\b/, 'host globals'],
]
// libm-backed functions round differently in Node and Chromium; src/sim/math.ts has our own.
const LIBM: [RegExp, string] = [/\bMath\.(sin|cos|tan|asin|acos|atan|atan2|sinh|cosh|tanh|exp|expm1|log|log1p|log2|log10|cbrt)\b/, 'Math trig/exp/log (Node and Chromium differ in the last bit: use src/sim/math.ts)']

const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') ? [p] : []
  })

export function lintSim(): string[] {
  const simDir = rel('src/sim')
  const problems: string[] = []
  for (const file of files(simDir)) {
    const lines = readFileSync(file, 'utf8').split('\n')
    lines.forEach((line, i) => {
      const trimmed = line.trim()
      if (trimmed.startsWith('*') || trimmed.startsWith('/*') || trimmed.startsWith('//')) return
      const code = line.replace(/\/\/.*$/, '')
      const bare = code.replace(/'[^']*'|"[^"]*"|`[^`]*`/g, "''")
      const where = `${relative(ROOT, file)}:${i + 1}`
      for (const [re, why] of BANNED) if (re.test(bare)) problems.push(`${where}: ${why}`)
      if (!file.endsWith('/math.ts') && LIBM[0].test(bare)) problems.push(`${where}: ${LIBM[1]}`)
      const m = /\bfrom\s+['"]([^'"]+)['"]/.exec(code) ?? /\bimport\s*\(\s*['"]([^'"]+)['"]/.exec(code)
      if (m) {
        const spec = m[1]
        if (!spec.startsWith('.')) problems.push(`${where}: imports package "${spec}" (the sim imports nothing outside src/sim)`)
        else if (!resolve(dirname(file), spec).startsWith(simDir)) problems.push(`${where}: imports "${spec}" from outside src/sim`)
      }
    })
  }
  return problems
}
