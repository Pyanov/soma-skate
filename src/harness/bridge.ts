// Talk to the running dev game (npm run dev, open in a browser) through the dev server.

const BASE = 'http://127.0.0.1:5410/__skate'

export async function send(text: string) {
  let r: Response
  try {
    r = await fetch(`${BASE}/cmd`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) })
  } catch {
    throw new Error('dev server not running (start it with: npm run dev)')
  }
  const res = (await r.json()) as { ok: boolean; text: string }
  console.log(`${res.ok ? 'ok' : 'error'}: ${res.text}`)
  if (!res.ok) process.exitCode = 1
}

export async function watch(seconds: number) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), seconds * 1000)
  try {
    const r = await fetch(`${BASE}/watch`, { signal: ctrl.signal })
    const reader = r.body!.getReader()
    const dec = new TextDecoder()
    let buf = ''
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })
      const parts = buf.split('\n\n')
      buf = parts.pop() ?? ''
      for (const p of parts) if (p.startsWith('data: ')) console.log(p.slice(6))
    }
  } catch (e) {
    if ((e as Error).name !== 'AbortError') throw new Error('dev server not running (start it with: npm run dev)')
  } finally { clearTimeout(timer) }
}
