import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import type { Replay } from '../sim/replay.ts'
import { withPages } from './browser.ts'
import { loadData, readJson, rel } from './io.ts'
import { loadScenario, runScenario } from './scenario.ts'
import { stretchFrames } from '../client/director.ts'
import { camPathAt, readCamPath } from './campath.ts'

// skate clip <replay.json | scenario> [--from s --to s --fps 30 --size 1280x720 --style real
//   --cam chase --orbit az,el,dist[,lookUp] --char <id> --cas skaters.json --weather karl|golden --no-hud --soft --intro --results s --school --split npc --campath path.json -o out.mp4]: the run as a video with the game's own sound
// (--intro: a Tour level's intro flyover first, from its start; --results s: then s seconds of the results card with the best combo looping)
// (--orbit: a close camera riding along with the skater, as skate shot --orbit)
// (--school: Skate School's cards over the run, from a School watching it: scenarios/school-run)
// (--split npc: split screen, player 2 a park NPC standing in: its own chase camera and HUD; a replay
//  with the sim's player 2 is always split, --char2 picks its skater)
// (--slowmo off|big|every, --no-trickcams: the trick director as Settings > Camera has it; big moments and trick
//  cameras by default, as the game: slow motion stretches the clip, its frames repeated, its sound pitched with it)
// (rendered offline in the page), muxed by ffmpeg. GPU (Metal) by default for speed;
// --soft renders with SwiftShader like the goldens (slow, pixel-repeatable).
// (--campath file.json: a keyframed camera for the whole clip instead of the chase camera (src/harness/campath.ts):
//  the run plays under it from --from for the path's length, the sun's shadows where it looks; the trick director is off)

type ClipApi = {
  load: (r: Replay, o: unknown) => { introSeconds: number; introAt: number; results: boolean; ticks: number; events: number; eventsList: { i: number; t: string; name: string; points: number }[]; speeds: number[]; moments: { kind: string; at: number; a0: number; b1: number; shot: string | null }[] }
  frame: (i: number, sub: number | null, camera: { pos: { x: number; y: number; z: number }; look: { x: number; y: number; z: number }; fov: number } | null) => number
  introFrame: (t: number) => void
  resultsFrame: (t: number) => void
  audio: (from: number, to: number, sampleRate?: number, music?: { kind: 'lofi' | 'punk' | 'hyphy'; level: number }) => Promise<string>
}

export async function clipCmd(target: string, a: Record<string, unknown>) {
  if (!target) throw new Error('clip: give a replay.json or a scenario name')
  let replay: Replay
  if (target.endsWith('.json')) replay = readJson<Replay>(target)
  else {
    const path = existsSync(target) ? target : rel('scenarios', `${target}.skate`)
    replay = runScenario(loadScenario(path), loadData()).replay
  }
  const [w, h] = String(a.size ?? '1280x720').split('x').map(Number)
  const fps = Number(a.fps ?? 30)
  const tickHz = loadData().physics.tickHz
  const out = typeof a.o === 'string' ? a.o : rel('out/clips', `${basename(target).replace(/\.(replay\.)?json$|\.skate$/, '')}.mp4`)
  mkdirSync(dirname(out), { recursive: true })
  const style = typeof a.style === 'string' ? a.style : undefined
  const path = typeof a.campath === 'string' ? readCamPath(a.campath) : null
  if (path && (a.intro || a.results !== undefined || a.split || a.orbit || a.school)) throw new Error('clip: --campath is the whole clip\'s camera: not with --intro, --results, --split, --orbit or --school')
  const t0 = performance.now()
  await withPages(async (open) => {
    const page = await open(replay.start.park.name)
    // A two-player replay: player 2's skater view first (split screen follows player 2).
    if (replay.format === 'soma-replay/2' || a.split === 'p2') await page.evaluate(() => (window as unknown as { __skate: { clip: { prepare2p: () => Promise<void> } } }).__skate.clip.prepare2p())
    // --cas file.json: created skaters ({ id, name, choices }, Create-a-Skater's save shape) to ride (--char cas1).
    if (typeof a.cas === 'string') { const list = JSON.parse(readFileSync(a.cas, 'utf8')); await page.evaluate((l) => (window as unknown as { __skate: { cas: (x: unknown) => void } }).__skate.cas(l), list) }
    const info = await page.evaluate(([rp, o]) => (window as unknown as { __skate: { clip: ClipApi } }).__skate.clip.load(rp, o), [replay, { style, cam: a.cam, character: typeof a.char === 'string' ? a.char : undefined, hud: !a['no-hud'], weather: typeof a.weather === 'string' ? a.weather : undefined, orbit: typeof a.orbit === 'string' ? a.orbit.split(',').map(Number) : undefined, intro: !!a.intro, results: a.results !== undefined, school: !!a.school, split: a.split === 'npc' ? 'npc' as const : undefined, character2: typeof a.char2 === 'string' ? a.char2 : undefined, slowmo: path ? 'off' : a.slowmo === 'off' || a.slowmo === 'every' ? a.slowmo : 'big', trickCams: !path && !a['no-trickcams'], camPath: !!path }] as const)
    const introN = a.intro && info.introSeconds > 0 ? Math.round(info.introSeconds * fps) : 0
    const resultsN = a.results !== undefined && info.results ? Math.round(Number(a.results === true ? 4 : a.results) * fps) : 0
    if (a.intro && !introN) console.log('  (no level intro: the replay has no levelStart)')
    if (a.results !== undefined && !resultsN) console.log('  (no results replay: no timed run ends in it, or no combo)')
    const from = Math.max(0, introN ? info.introAt : Math.round(Number(a.from ?? 0) * tickHz))
    const to = path ? from + Math.round(path.seconds * tickHz) : Math.min(info.ticks, a.to !== undefined ? Math.round(Number(a.to) * tickHz) : info.ticks)
    if (path && to > info.ticks) throw new Error(`clip: the camera path is ${path.seconds.toFixed(1)} s, the run has ${((info.ticks - from) / tickHz).toFixed(1)} s from --from: run the scenario longer`)
    const wav = join(tmpdir(), `skate-clip-${process.pid}.wav`)
    const music = a.music === 'punk' || a.music === 'lofi' || a.music === 'hyphy' ? { kind: a.music, level: Number(a['music-level'] ?? 0.6) } as const : undefined
    writeFileSync(wav, Buffer.from(await page.evaluate(([f, t, m]) => (window as unknown as { __skate: { clip: ClipApi } }).__skate.clip.audio(f, t, 48000, m), [from, to, music] as const), 'base64'))
    const delay = Math.round((introN / fps) * 1000)
    const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-i', '-', '-i', wav,
      ...(introN || resultsN ? ['-af', `adelay=${delay}:all=1,apad`] : []),
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-preset', 'medium', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', out], { stdio: ['pipe', 'inherit', 'inherit'] })
    const done = new Promise<void>((res, rej) => ff.on('close', (c) => (c === 0 ? res() : rej(new Error(`ffmpeg exited ${c}`)))))
    // The frames: tickHz / fps ticks apart, fewer through the slow motion (a frame repeats where it is slowest).
    const plan = path ? [...Array(Math.round(path.seconds * fps))].map((_, k) => from + Math.round((k * tickHz) / fps)) : stretchFrames(info.speeds, from, to, tickHz, fps), frames = plan.length
    for (let k = 0; k < introN; k++) {
      await page.evaluate((t) => (window as unknown as { __skate: { clip: ClipApi } }).__skate.clip.introFrame(t), k / fps)
      const img = await page.screenshot({ type: 'jpeg', quality: 92 })
      if (!ff.stdin.write(img)) await new Promise((r) => ff.stdin.once('drain', r))
    }
    for (let k = 0; k < frames; k++) {
      const i = plan[k], cam = path ? camPathAt(path, k / fps) : null
      await page.evaluate(([i, c]) => (window as unknown as { __skate: { clip: ClipApi } }).__skate.clip.frame(i, null, c), [i, cam] as const)
      const img = await page.screenshot({ type: 'jpeg', quality: 92 })
      if (!ff.stdin.write(img)) await new Promise((r) => ff.stdin.once('drain', r))
    }
    for (let k = 0; k < resultsN; k++) {
      await page.evaluate((t) => (window as unknown as { __skate: { clip: ClipApi } }).__skate.clip.resultsFrame(t), k / fps)
      const img = await page.screenshot({ type: 'jpeg', quality: 92 })
      if (!ff.stdin.write(img)) await new Promise((r) => ff.stdin.once('drain', r))
    }
    ff.stdin.end()
    await done
    const tricks = info.eventsList.filter((e) => e.i >= from && e.i < to && (e.t === 'comboLanded' || e.t === 'bail')).map((e) => `${((e.i - from) / tickHz).toFixed(1)}s ${e.t === 'bail' ? 'bail' : `${e.name} ${e.points}`}`)
    const slow = info.moments.filter((m) => m.at >= from && m.at < to).map((m) => `${((m.at - from) / tickHz).toFixed(1)}s ${m.kind}${m.b1 > m.a0 ? ' slow' : ''}${m.shot ? ` ${m.shot}` : ''}`)
    console.log(`wrote ${out.replace(rel(''), '')}  ${frames} frames at ${fps} fps, ${(frames / fps).toFixed(1)} s (${((to - from) / tickHz).toFixed(1)} s of play), ${w}x${h}  ${((performance.now() - t0) / 1000).toFixed(1)}s${tricks.length ? `\n  ${tricks.join('\n  ')}` : ''}${slow.length ? `\n  moments: ${slow.join(', ')}` : ''}`)
  }, { width: w, height: h }, { gpu: !a.soft })
}
