import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { homedir, userInfo } from 'node:os'
import { join, resolve } from 'node:path'
import { rel } from './io.ts'
import { stripImage } from './imagemeta.ts'

// The derived world files (the city and the park's photo paint) are made by the world generator and
// kept out of git. `skate world pack` bundles them as one tarball named by the city's and the paint's hashes and
// records it in assets/park/world.json (tracked); `skate world fetch` downloads that bundle from the
// GitHub release of the same name over plain HTTPS (no login), or with the gh CLI (--gh, for a private fork),
// or unpacks a local copy (--file), so a fresh clone can run the game.

const FILES = ['assets/park/sf.city.json', 'assets/park/sf.city.bin', 'assets/park/sf.city.look.bin', 'assets/park/sf.city.data.bin', 'assets/park/sf.city.bvh.bin', 'assets/park/soma.park.paint.bin', 'assets/park/paint']
const LOCK = 'assets/park/world.json'
const STAMP = 'assets/park/.world-tag'   // the bundle unpacked here last (untracked)
const DEFAULT_REPO = 'Pyanov/soma-skate'
const DOC = 'The derived world bundle this commit expects. ./skate world fetch downloads it from the GitHub release of this tag in repo (or --file <tarball>); ./skate world pack makes it.'

type Lock = { tag: string; file: string; cityHash: string; repo?: string; sha256?: string }

/** The bundle's tag: the city's hash and the park paint's, so a paint-only change is a new bundle too. */
const tagOf = () => {
  const city = (JSON.parse(readFileSync(rel('assets/park/sf.city.json'), 'utf8')) as { hash: string }).hash
  const paint = createHash('sha1').update(readFileSync(rel('assets/park/soma.park.paint.bin'))).digest('hex').slice(0, 8)
  return { city, tag: `world-${city}-${paint}` }
}

const run = (cmd: string, args: string[], cwd = rel('')) => {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  if (r.error) throw new Error(`${cmd}: ${r.error.message}`)
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')}: ${r.stderr || r.stdout}`)
  return r.stdout
}

const sha256 = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex')

/** Every file under the bundle's paths. */
const bundleFiles = () => FILES.flatMap((f) => statSync(rel(f)).isDirectory() ? readdirSync(rel(f)).sort().map((n) => `${f}/${n}`) : [f])

/**
 * Release hygiene, before a bundle is packed: strip image metadata (EXIF, XMP, comments; lossless) and
 * refuse to pack if any file names a home directory or this machine's user.
 */
function scrubBundle() {
  const user = userInfo().username
  const needles = [...['Users', 'home'].map((d) => `/${d}/`), `C:\\${'Users'}\\`, homedir(), ...(user.length >= 3 ? [user] : [])]
  const hits: string[] = []
  for (const f of bundleFiles()) {
    if (/\.(jpe?g|png)$/i.test(f)) {
      const before = readFileSync(rel(f)), after = stripImage(before)
      if (after.length !== before.length) { writeFileSync(rel(f), after); console.log(`stripped image metadata: ${f} (${before.length - after.length} bytes)`) }
    }
    const text = readFileSync(rel(f)).toString('latin1')
    for (const n of needles) if (text.includes(n)) hits.push(`${f}: ${JSON.stringify(n)}`)
  }
  if (hits.length) throw new Error(`the bundle names a local path or user; fix the generator's output first:\n  ${hits.join('\n  ')}`)
}

/** tar without this machine's user and group names (and, on macOS, without extended attributes). */
function tarCreate(out: string) {
  const bsd = /bsdtar/.test(run('tar', ['--version']))
  const owner = bsd ? ['--uid', '0', '--gid', '0', '--uname', '', '--gname', '', '--no-xattrs', '--no-mac-metadata'] : ['--owner=0', '--group=0', '--numeric-owner', '--sort=name']
  const env = { ...process.env, COPYFILE_DISABLE: '1' }
  const r = spawnSync('tar', ['-czf', out, ...owner, ...FILES], { cwd: rel(''), env, encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`tar: ${r.stderr}`)
}

/** Bundle the derived files and record the bundle in world.json; --release uploads it as a GitHub release. */
export function worldPack(release: boolean, repo?: string) {
  const missing = FILES.filter((f) => !existsSync(rel(f)))
  if (missing.length) throw new Error(`missing (run ./skate city, ./skate park, ./skate bvh): ${missing.join(', ')}`)
  scrubBundle()
  const { city: hash, tag } = tagOf(), name = `${tag}.tar.gz`
  mkdirSync(rel('out'), { recursive: true })
  tarCreate(join('out', name))
  const lock: Lock = { tag, file: name, cityHash: hash, repo: readLock()?.repo ?? DEFAULT_REPO, sha256: sha256(rel('out', name)) }
  writeFileSync(rel(LOCK), JSON.stringify({ _doc: DOC, ...lock }, null, 2) + '\n')
  writeFileSync(rel(STAMP), tag + '\n')
  console.log(`packed out/${name} (${(statSync(rel('out', name)).size / 1e6).toFixed(1)} MB, sha256 ${lock.sha256!.slice(0, 12)}), ${LOCK} updated`)
  if (release) {
    // Upload only where asked: --repo, else gh's own default (this checkout's remote). world.json's repo is where
    // fetch looks; it is not an upload target, so a pack in a private fork never publishes to it by accident.
    const r = repo ? ['-R', repo] : []
    const exists = spawnSync('gh', ['release', 'view', tag, ...r], { cwd: rel(''), stdio: 'ignore' }).status === 0
    if (exists) run('gh', ['release', 'upload', tag, join('out', name), '--clobber', ...r])
    else run('gh', ['release', 'create', tag, join('out', name), '--title', `World ${hash}`, '--notes', 'The derived city and park paint for this city export (./skate world fetch).', ...r])
    console.log(`uploaded to release ${tag}${repo ? ` on ${repo}` : ''}`)
  }
}

const readLock = (): Lock | null => existsSync(rel(LOCK)) ? JSON.parse(readFileSync(rel(LOCK), 'utf8')) as Lock : null

/** Only the bundle's own paths, nothing absolute and no way up. */
function checkEntries(tarball: string) {
  const bad = run('tar', ['-tzf', tarball]).split('\n').filter(Boolean).filter((e) => !e.startsWith('assets/park/') || e.split('/').includes('..'))
  if (bad.length) throw new Error(`${tarball}: unexpected entries in the bundle: ${bad.slice(0, 5).join(', ')}`)
}

export type FetchOptions = { repo?: string; file?: string; gh?: boolean; force?: boolean }

/** Download (or take from --file) and unpack the bundle world.json names (skips if that bundle is the one unpacked here last). */
export function worldFetch(o: FetchOptions = {}) {
  const lock = readLock()
  if (!lock) throw new Error(`${LOCK} is missing`)
  const have = existsSync(rel(STAMP)) ? readFileSync(rel(STAMP), 'utf8').trim() : ''
  if (!o.force && !o.file && have === lock.tag && FILES.every((f) => existsSync(rel(f)))) { console.log(`world ${lock.tag} already here`); return }
  mkdirSync(rel('out'), { recursive: true })
  let tarball: string
  if (o.file) tarball = resolve(o.file)
  else {
    tarball = rel('out', lock.file)
    const repo = o.repo ?? lock.repo ?? DEFAULT_REPO
    if (o.gh) run('gh', ['release', 'download', lock.tag, '--pattern', lock.file, '--dir', 'out', '--clobber', '-R', repo])
    else {
      const url = `https://github.com/${repo}/releases/download/${lock.tag}/${lock.file}`
      console.log(`downloading ${url}`)
      const r = spawnSync('curl', ['-fL', '--retry', '3', '--progress-bar', '-o', tarball, url], { stdio: ['ignore', 'inherit', 'inherit'] })
      if (r.status !== 0) throw new Error(`download failed (${url}); a private fork: ./skate world fetch --gh --repo owner/name; a local copy: --file <tarball>`)
    }
  }
  if (!existsSync(tarball)) throw new Error(`no such file: ${tarball}`)
  if (lock.sha256) {
    const got = sha256(tarball)
    if (got !== lock.sha256) throw new Error(`${tarball}: sha256 ${got.slice(0, 12)}, world.json expects ${lock.sha256.slice(0, 12)} (a different bundle)`)
  }
  checkEntries(tarball)
  run('tar', ['-xzf', tarball, '-m', '--no-same-owner'])
  writeFileSync(rel(STAMP), lock.tag + '\n')
  console.log(`world ${lock.tag} unpacked into assets/park`)
}
