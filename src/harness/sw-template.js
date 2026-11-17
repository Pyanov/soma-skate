// The built site's service worker (written to dist/sw.js by ./skate build, which fills in the version
// and the app shell). The shell is cached when it installs; every file the game fetches is kept as it
// arrives (cache first), and once the game is up the page asks for the rest of build.json's files
// ('warm'), so a second visit loads from the cache and the game plays offline. A new version copies
// over the files whose revision did not change and drops the old cache.
const VERSION = '__VERSION__'
const CACHE = `soma-skate-${VERSION}`
const SHELL = __SHELL__
const scope = self.registration.scope
const abs = (u) => new URL(u, scope).href

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE)
    const manifest = await (await fetch(abs('build.json'), { cache: 'reload' })).json()
    await cache.put(abs('build.json'), new Response(JSON.stringify(manifest), { headers: { 'content-type': 'application/json' } }))
    // Unchanged files come over from the versions before this one.
    for (const key of await caches.keys()) {
      if (key === CACHE || !key.startsWith('soma-skate-')) continue
      const old = await caches.open(key)
      const oldManifest = await old.match(abs('build.json'))
      if (!oldManifest) continue
      const revs = new Map((await oldManifest.json()).files.map((f) => [f.url, f.rev]))
      for (const f of manifest.files) {
        if (revs.get(f.url) !== f.rev) continue
        const r = await old.match(abs(f.url))
        if (r) await cache.put(abs(f.url), r)
      }
    }
    await Promise.all(SHELL.map(async (u) => { if (!(await cache.match(abs(u)))) await cache.add(new Request(abs(u), { cache: 'reload' })) }))
    await self.skipWaiting()
  })())
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith('soma-skate-') && key !== CACHE) await caches.delete(key)
    await self.clients.claim()
  })())
})

/** Cache first; what comes from the network is kept (same origin, complete responses only). */
async function cached(request) {
  const cache = await caches.open(CACHE)
  const url = new URL(request.url)
  const key = request.mode === 'navigate' ? abs('index.html') : url.origin + url.pathname
  const hit = await cache.match(key)
  if (hit) return hit
  const r = await fetch(request.mode === 'navigate' ? abs('index.html') : new Request(key, { cache: 'no-store' }))
  if (r.ok && r.status === 200) await cache.put(key, r.clone())
  return r
}

self.addEventListener('fetch', (event) => {
  const req = event.request
  const url = new URL(req.url)
  if (req.method !== 'GET' || url.origin !== self.location.origin || !req.url.startsWith(scope)) return
  if (url.pathname.endsWith('/sw.js')) return
  event.respondWith(cached(req).catch(() => caches.match(abs('index.html')).then((r) => r ?? Response.error())))
})

/** 'warm': fetch every file in build.json not cached yet (a few at a time), for offline play. */
self.addEventListener('message', (event) => {
  if (event.data !== 'warm') return
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE)
    const m = await cache.match(abs('build.json'))
    if (!m) return
    const todo = []
    for (const f of (await m.json()).files) if (!(await cache.match(abs(f.url)))) todo.push(abs(f.url))
    const next = async () => { for (let u = todo.shift(); u; u = todo.shift()) { try { const r = await fetch(u, { cache: 'no-store' }); if (r.ok) await cache.put(u, r) } catch { /* offline again: later */ } } }
    await Promise.all([next(), next(), next(), next()])
  })())
})
