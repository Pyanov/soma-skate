import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { brotliCompressSync, constants, gzipSync } from 'node:zlib'
import { rel } from './io.ts'

// skate build [--out dist]: the game as a static site any free host can serve (docs/deploy.md).
// Vite bundles the client (relative paths, so it works from a subfolder too); the runtime files the
// game fetches (data/*.json, assets/, the attract mode's scenarios) are copied beside it; the big
// binaries ship gzipped (name.bin.gz: static hosts rarely compress application/octet-stream, and the
// loader inflates them: src/client/fetchbin.ts); build.json lists every file with its size and
// revision; sw.js keeps it all for offline play. Prints the transfer sizes.

/** Shipped gzipped: the binary geometry, which static hosts serve as it is (the sky HDR stays plain: three loads it itself). */
const BIG = /\.bin$/
/** The app shell the service worker caches as it installs (the rest as it is fetched, then warmed). */
const SHELL_FILES = ['index.html', 'manifest.webmanifest', 'build.json']

const HEADERS = `/app/*
  Cache-Control: public, max-age=31536000, immutable
/sw.js
  Cache-Control: no-cache
/build.json
  Cache-Control: no-cache
`

const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]))
const mb = (n: number) => `${(n / 1048576).toFixed(1)} MB`

export async function buildCmd(a: Record<string, unknown>) {
  const out = typeof a.out === 'string' ? a.out : rel('dist')
  const t0 = performance.now()
  // The pre-built BVH files ship only for the triangles they were built from (src/data/bvhfile.ts): a missing or stale one is rebuilt first.
  const { bvhFresh, bvhWorlds, writeBvh } = await import('./bvh.ts')
  for (const w of bvhWorlds()) if (!bvhFresh(w)) console.log(`rebuilt ${writeBvh(w)}`)
  const { build } = await import('vite')
  await build({ configFile: rel('vite.config.ts'), root: rel(''), base: './', logLevel: 'warn', build: { outDir: out, emptyOutDir: true, assetsDir: 'app', sourcemap: false, chunkSizeWarningLimit: 4096 } })
  // The files the game fetches at run time.
  mkdirSync(join(out, 'data'), { recursive: true })
  for (const f of readdirSync(rel('data'))) if (f.endsWith('.json')) cpSync(rel('data', f), join(out, 'data', f))
  cpSync(rel('assets'), join(out, 'assets'), { recursive: true, filter: (src) => !/\/assets\/(ui|cars)\/src(\/|$)/.test(src) && !src.endsWith('.last-export.json') })   // the source art and models stay home
  const attract = JSON.parse(readFileSync(rel('data/attract.json'), 'utf8')) as { runs: { scenario: string }[] }
  mkdirSync(join(out, 'scenarios'), { recursive: true })
  for (const r of attract.runs) cpSync(rel('scenarios', `${r.scenario}.skate`), join(out, 'scenarios', `${r.scenario}.skate`))
  // The big binaries, gzipped (brotli measured for the report: browsers cannot inflate it in a page).
  const report: { file: string; raw: number; gz: number; br: number }[] = []
  for (const f of walk(join(out, 'assets'))) {
    if (!BIG.test(f)) continue
    const raw = readFileSync(f)
    const gz = gzipSync(raw, { level: 9 })
    const br = brotliCompressSync(raw, { params: { [constants.BROTLI_PARAM_QUALITY]: 9, [constants.BROTLI_PARAM_SIZE_HINT]: raw.length } })
    writeFileSync(`${f}.gz`, gz)
    unlinkSync(f)
    report.push({ file: relative(out, f), raw: raw.length, gz: gz.length, br: br.length })
  }
  // build.json: every file, its size and revision, and a .gz file's inflated size (the service worker and
  // the loading bar read it).
  const files = walk(out).filter((f) => !/\/(sw\.js|build\.json|_headers|\.nojekyll)$/.test(f)).map((f) => {
    const buf = readFileSync(f)
    const url = relative(out, f).split('\\').join('/')
    const raw = report.find((r) => `${r.file}.gz` === url)?.raw
    return { url, bytes: buf.length, rev: createHash('sha1').update(buf).digest('hex').slice(0, 10), ...(raw ? { raw } : {}) }
  }).sort((x, y) => x.url.localeCompare(y.url))
  const version = createHash('sha1').update(JSON.stringify(files)).digest('hex').slice(0, 10)
  writeFileSync(join(out, 'build.json'), JSON.stringify({ version, files }))
  const shell = [...SHELL_FILES, ...files.filter((f) => f.url.startsWith('app/')).map((f) => f.url)]
  const sw = readFileSync(rel('src/harness/sw-template.js'), 'utf8').replace('__VERSION__', version).replace('__SHELL__', JSON.stringify(shell))
  writeFileSync(join(out, 'sw.js'), sw)
  // Host hints (not in build.json): Netlify and Cloudflare Pages read _headers (the hashed bundle is
  // immutable, the worker always revalidated); .nojekyll serves the folder as it is on GitHub Pages.
  writeFileSync(join(out, '_headers'), HEADERS)
  writeFileSync(join(out, '.nojekyll'), '')
  // What a visit downloads: the text files as hosts serve them (gzip), the binaries as shipped.
  const total = files.reduce((n, f) => n + f.bytes, 0)
  const text = files.filter((f) => /\.(js|css|html|json|skate|webmanifest)$/.test(f.url))
  const textRaw = text.reduce((n, f) => n + f.bytes, 0), textGz = text.reduce((n, f) => n + gzipSync(readFileSync(join(out, f.url))).length, 0)
  console.log(`built ${relative(rel(''), out) || '.'}/  ${files.length} files, ${mb(total)} on disk, version ${version}  ${((performance.now() - t0) / 1000).toFixed(1)}s`)
  console.log('  big binaries (shipped .gz; brotli for reference):')
  for (const r of report.sort((x, y) => y.raw - x.raw)) console.log(`    ${r.file.padEnd(34)} ${mb(r.raw).padStart(9)} -> gzip ${mb(r.gz).padStart(9)}  (brotli ${mb(r.br)})`)
  const rawBig = report.reduce((n, r) => n + r.raw, 0), gzBig = report.reduce((n, r) => n + r.gz, 0), brBig = report.reduce((n, r) => n + r.br, 0)
  console.log(`    ${'all'.padEnd(34)} ${mb(rawBig).padStart(9)} -> gzip ${mb(gzBig).padStart(9)}  (brotli ${mb(brBig)})`)
  console.log(`  text (js, css, html, json, scenarios): ${mb(textRaw)} -> ${mb(textGz)} served gzipped`)
  console.log(`  a first visit downloads about ${mb(total - textRaw + textGz)}; later visits load from the service worker's cache`)
  if (!existsSync(join(out, 'manifest.webmanifest'))) console.warn('  no manifest.webmanifest (public/)')
}
