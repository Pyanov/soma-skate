import { createServer } from 'node:http'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'
import { rel } from './io.ts'

// skate serve [dir] [--port 5480] [--encode]: a built site served the way a plain static host serves
// it: the files as they are, no compression, no special headers. --encode plays a host that marks
// .gz files Content-Encoding: gzip itself (the browser then inflates them before the game sees them).
// Logs nothing per request; `serve` is for trying the build locally (offline and cache checks).

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ogg': 'audio/ogg', '.gz': 'application/gzip', '.skate': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8', '.bin': 'application/octet-stream', '.hdr': 'application/octet-stream',
}

export async function serveCmd(a: Record<string, unknown>) {
  const root = typeof a._ === 'object' && (a._ as string[])[0] ? (a._ as string[])[0] : rel('dist')
  const port = Number(a.port ?? 5480)
  if (!existsSync(join(root, 'index.html'))) throw new Error(`serve: no index.html in ${root} (./skate build first)`)
  const server = createServer((req, res) => {
    const path = decodeURIComponent((req.url ?? '/').split('?')[0])
    let file = normalize(join(root, path))
    if (!file.startsWith(normalize(root))) { res.writeHead(403); res.end(); return }
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html')
    if (!existsSync(file)) { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('not found'); return }
    const body = readFileSync(file), ext = extname(file)
    const headers: Record<string, string | number> = { 'content-type': TYPES[ext] ?? 'application/octet-stream', 'content-length': body.length, 'cache-control': 'no-cache' }
    if (a.encode && ext === '.gz') { headers['content-encoding'] = 'gzip'; headers['content-type'] = 'application/octet-stream' }
    res.writeHead(200, headers)
    res.end(req.method === 'HEAD' ? undefined : body)
  })
  await new Promise<void>((r) => server.listen(port, '127.0.0.1', r))
  console.log(`serving ${root} on http://127.0.0.1:${port}/ (Ctrl-C stops)${a.encode ? ' (.gz with Content-Encoding)' : ''}`)
}
