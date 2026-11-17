import type { Page } from 'playwright-core'
import { readJson, rel } from './io.ts'

// The first-hour playtest in the real client (`skate playtest`, check --full on the
// park): a fresh profile boots into free roam, the first key brings chapter 1, a line is read and the rest
// skipped (Esc), the offer accepted; the pause menu's Missions > Abandon gives back free roam; the talk key by Karl
// and by the Pigeon starts their stories, Not now and Skip mission end them; the map sets a waypoint and
// takes Muni to a visited spot; the journal opens and closes; Rosa's conversation starts on arrival.
// Then phase 3 in a fresh profile (phase3 below): call-outs, rewards, the finale's credits.
// Every wait has a deadline: a step that does not come is reported as where it got stuck.

type State = { mission: string | null; mode: string; dlg: boolean; dlgText: string; offer: boolean; menu: boolean; obj: boolean; prompt: string; map: boolean; journal: boolean; travel: boolean; paused: boolean; spot: string; waypoint: boolean }

export async function playtest(open: (park: string, query?: string) => Promise<Page>, o: { park: string }) {
  const page = await open(o.park, 'play')
  const errors: string[] = [], done: string[] = []
  page.on('pageerror', (e) => errors.push((e.stack ?? String(e)).split('\n').slice(0, 3).join(' ')))
  page.on('console', (msg) => { if (msg.type() === 'error' && !/Failed to load resource/.test(msg.text())) errors.push(msg.text().slice(0, 200)) })
  const state = (): Promise<State> => page.evaluate(() => {
    const g = (window as unknown as { __skateGame: { sim: { world: { things: { kind: string; player?: number; mission?: { id: string; step: number }; mode: string; spot: string }[] } }; story: { save: { waypoint: unknown } }; stateLine(): string } }).__skateGame
    const s = g.sim.world.things.find((t) => t.kind === 'session' && t.player !== 2)!, sk = g.sim.world.things.find((t) => t.kind === 'skater' && t.player !== 2)!
    const on = (sel: string) => !!document.querySelector(`${sel}.on`)
    return { mission: s.mission ? `${s.mission.id}:${s.mission.step}` : null, mode: s.mode, dlg: on('.dlg'), dlgText: document.querySelector('.dlg-text')?.textContent ?? '', offer: on('.dlg.offer'), menu: on('.menu'), obj: on('.story-obj'),
      prompt: document.querySelector('.story-prompt.on')?.textContent ?? '', map: on('.citymap'), journal: on('.journal'), travel: on('.muni-travel'), paused: g.stateLine().includes('(paused)'), spot: sk.spot, waypoint: !!g.story.save.waypoint }
  })
  const until = async (what: string, ok: (s: State) => boolean, ms = 12000) => {
    const t0 = Date.now()
    let s = await state()
    while (!ok(s)) {
      if (Date.now() - t0 > ms) throw new Error(`stuck: ${what} (after ${done.length} steps; state ${JSON.stringify(s)})`)
      await page.waitForTimeout(100); s = await state()
    }
    done.push(what)
    return s
  }
  const key = async (code: string, wait = 150) => { await page.keyboard.press(code); await page.waitForTimeout(wait) }
  const cmd = (text: string) => page.evaluate((t) => (window as unknown as { __skateGame: { queue(t: string): Promise<{ ok: boolean; text: string }> } }).__skateGame.queue(t), text)
  // An entry of the list with the cursor (the pause menu's parent column, dimmed, is skipped); path: the entries to open first ('Missions').
  const menuItem = async (label: string, ...path: string[]) => {
    for (const l of [...path, label]) {
      const ok = await page.evaluate((x) => { const b = [...document.querySelectorAll<HTMLElement>('.menu-col.current .menu-item')].find((e) => e.querySelector('.mi-label')?.textContent === x); b?.click(); return !!b }, l)
      if (!ok) return false
      await page.waitForTimeout(120)
    }
    return true
  }
  const freeRoam = (s: State) => s.mission === null && s.mode === 'free' && !s.dlg && !s.obj && !s.menu && !s.paused
  try {
    await until('boots into free roam (no menu, the sim running)', (s) => !s.menu && !s.paused)
    await page.keyboard.down('KeyW'); await page.waitForTimeout(200); await page.keyboard.up('KeyW')   // the first key: the intro comes after it
    await until('chapter 1 starts by itself: Karl\'s first line', (s) => s.dlg && s.mission === 'ch1:0' && /Karl/.test(s.dlgText), 20000)
    await key('Space'); await until('Space: his next line', (s) => s.dlg && /fifty-eight/.test(s.dlgText))
    await key('Escape'); await until('Esc skips the rest: the offer under his last line', (s) => s.offer && /Rosa/.test(s.dlgText))
    await key('Enter'); await until('Accept: the next step, the objective up', (s) => s.mission === 'ch1:1' && !s.dlg && s.obj)
    await key('Escape'); await until('Esc: the pause menu', (s) => s.menu && s.paused)
    if (!(await menuItem('Abandon mission', 'Missions'))) throw new Error('stuck: no Abandon mission in the pause menu')
    await until('Abandon gives back free roam', freeRoam)
    await cmd('teleport big3_runway'); await page.waitForTimeout(600)
    await until('by Karl: the talk prompt', (s) => /Talk to Karl/.test(s.prompt))
    await key('KeyF'); await until('the talk key: his offer again', (s) => s.dlg && s.mission === 'ch1:0')
    await key('Escape'); await until('Esc: the offer', (s) => s.offer)
    await key('Escape'); await until('Esc on the offer is Not now: free roam', freeRoam)
    await cmd('teleport 16.5 11 1 200'); await page.waitForTimeout(800)
    await until('by the Pigeon: the talk prompt', (s) => /Talk to The Pigeon/.test(s.prompt))
    await key('KeyF'); await until('his offer', (s) => s.dlg && s.mission === 'pigeons:0')
    await key('Escape'); await until('Esc: his offer', (s) => s.offer)   // a slow frame takes both keys at once otherwise
    await key('Enter'); await until('accepted: the crumbs and their clock', (s) => s.mission === 'pigeons:1' && s.obj)
    await key('Escape'); await until('the pause menu', (s) => s.menu)
    if (!(await menuItem('Skip mission', 'Missions'))) throw new Error('stuck: no Skip mission in the pause menu')
    await until('Skip gives back free roam', freeRoam)
    await key('KeyM', 400); await until('M: the city map', (s) => s.map && s.paused)
    await page.keyboard.down('KeyD'); await page.waitForTimeout(400); await page.keyboard.up('KeyD')   // pan off a little
    await key('Enter'); await until('Enter: a waypoint', (s) => s.waypoint)
    await key('Escape'); await until('Esc closes the map, back to skating', (s) => !s.map && !s.paused)
    // The map's list of places: down twice and Enter goes to the second one, never visited before.
    await key('KeyM', 400); await until('M: the map again', (s) => s.map && s.paused)
    // Travel is instant since the places list (no Muni card in between): wait for the arrival itself. The list holds
    // the places this world has (the city's twenty, only the park gate on the park), so the step needs two of them.
    const second = await page.evaluate(() => (window as unknown as { __skateGame: { story: { map: { places: { spot: string }[] } } } }).__skateGame.story.map.places[1]?.spot ?? null)
    if (second) {
      await key('ArrowDown'); await key('ArrowDown'); await key('Enter')
      await until(`the places list: Enter goes to ${second}`, (s) => !s.map && !s.paused && s.spot === second, 15000)
    } else { await key('Escape'); await until('one place on this map: Esc closes it', (s) => !s.map && !s.paused) }
    const from = (await state()).spot
    await key('KeyM', 400)
    // Point at a spot that is not where we are, and go there with T.
    const target = await page.evaluate((here) => {
      const st = (window as unknown as { __skateGame: { story: { mapIcons(): { kind: string; x: number; y: number; visited?: boolean; spot?: string }[]; map: { view: { cx: number; cy: number; zoom: number } } } } }).__skateGame.story
      const i = st.mapIcons().find((x) => x.kind === 'spot' && x.visited && x.spot !== here)
      if (i) { st.map.view.cx = i.x; st.map.view.cy = i.y; st.map.view.zoom = 0.6 }
      return i?.spot ?? null
    }, from)
    if (!target) throw new Error('stuck: no spot to go to')
    await page.mouse.move(-10, -10); await page.waitForTimeout(200)
    await key('KeyT')
    await until(`T: arrived at ${target}`, (s) => !s.map && !s.paused && s.spot === target, 15000)
    await key('Escape'); await until('the pause menu', (s) => s.menu)
    if (!(await menuItem('Journal', 'Missions'))) throw new Error('stuck: no Journal in the pause menu')
    await until('the journal', (s) => s.journal)
    await key('Escape'); await until('Esc: back to the pause menu', (s) => !s.journal && s.menu)
    await key('Escape'); await key('Escape'); await until('Esc: back a list, then back to skating', (s) => !s.menu && !s.paused)
    await cmd('teleport big3_runway'); await page.waitForTimeout(600)
    await key('KeyF'); await until('Karl again (from the spawn: the talk key reaches him)', (s) => s.dlg && s.mission === 'ch1:0')
    await key('Escape'); await until('Esc: his offer again', (s) => s.offer)
    await key('Enter'); await until('chapter 1 accepted', (s) => s.mission === 'ch1:1')
    await cmd('teleport 44 28.5 0'); await until('by Rosa: her line starts by itself', (s) => s.dlg && /kickflip/.test(s.dlgText))
    await key('Space'); await until('her line done: the kickflip step', (s) => s.mission === 'ch1:2' && !s.dlg)
    await key('Escape'); await until('the pause menu', (s) => s.menu)
    await menuItem('Abandon mission', 'Missions'); await until('Abandon: free roam', freeRoam)
  } catch (e) { errors.push((e as Error).message) }
  // The first page closes first: its frame loop, still running, would slow the next page's load on a busy machine.
  if (!errors.length) { await page.close(); await phase3(await open(o.park, 'nostory=1'), done, errors, o.park) }
  return { steps: done, errors: [...new Set(errors)] }
}

/**
 * Story phase 3 in a fresh profile (a new page): Karl or the Pigeon calls out once as you arrive (pacing)
 * and nobody again on the way back; a mission with something to give shows its results card; the journal has a
 * Rewards page; the finale rolls the credits (a key ends them), then its results card, then a post-game
 * line as you pass Karl; then (in sf) the taqueria's gig board: its card with today's gigs, one picked and left.
 */
async function phase3(page: Page, done: string[], errors: string[], park: string) {
  page.on('pageerror', (e) => errors.push((e.stack ?? String(e)).split('\n').slice(0, 3).join(' ')))
  type S3 = { calls: string[]; callsAt: { who: string; at: number }[]; results: string; credits: boolean; journal: boolean; pages: string[]; mission: string | null; dlg: boolean; paused: boolean; prompt: string; dlgName: string; choices: string[]; obj: string }
  const state = (): Promise<S3> => page.evaluate(() => {
    const g = (window as unknown as { __skateGame: { sim: { world: { things: { kind: string; player?: number; mission?: { id: string; step: number } }[] } }; story: { callLog: { who: string; at: number }[] }; stateLine(): string } }).__skateGame
    const s = g.sim.world.things.find((t) => t.kind === 'session' && t.player !== 2)!
    return { calls: g.story.callLog.map((c) => c.who), callsAt: g.story.callLog.map((c) => ({ ...c })), results: document.querySelector('.story-results.on')?.textContent ?? '', credits: !!document.querySelector('.story-credits'),
      journal: !!document.querySelector('.journal.on'), pages: [...document.querySelectorAll('.journal .jr-tab, .journal [data-page]')].map((e) => e.textContent ?? ''),
      mission: s.mission ? `${s.mission.id}:${s.mission.step}` : null, dlg: !!document.querySelector('.dlg.on'), paused: g.stateLine().includes('(paused)'),
      prompt: document.querySelector('.story-prompt.on')?.textContent ?? '', dlgName: document.querySelector('.dlg.on .dlg-name')?.textContent ?? '',
      choices: [...document.querySelectorAll('.dlg.on.offer.list .dlg-choice')].map((e) => e.textContent ?? ''), obj: document.querySelector('.story-obj.on')?.textContent ?? '' }
  })
  const until = async (what: string, ok: (s: S3) => boolean, ms = 12000) => {
    const t0 = Date.now()
    let s = await state()
    while (!ok(s)) {
      if (Date.now() - t0 > ms) throw new Error(`stuck: ${what} (after ${done.length} steps; state ${JSON.stringify({ ...s, pages: s.pages.length })})`)
      await page.waitForTimeout(100); s = await state()
    }
    done.push(what)
  }
  const cmd = async (text: string) => { const r = await page.evaluate((t) => (window as unknown as { __skateGame: { queue(t: string): Promise<{ ok: boolean; text: string }> } }).__skateGame.queue(t), text); if (!r.ok) throw new Error(`stuck: ${text}: ${r.text}`) }
  try {
    await page.keyboard.down('KeyW'); await page.waitForTimeout(200); await page.keyboard.up('KeyW')
    await page.waitForTimeout(6500)   // pacing.call.warmup: nobody calls in the first seconds
    // Karl or the Pigeon, whoever is nearer when the warmup ends (the skater may have rolled after the first key).
    await until('at the park, a character with a story (Karl or the Pigeon) calls out once', (s) => s.calls.some((c) => c === 'karl' || c === 'pigeon'), 8000)
    await cmd('teleport 60 20 0'); await page.waitForTimeout(1500)
    await cmd('teleport 14 24 0.2 0'); await page.waitForTimeout(3000)
    // Never nagging, in the page's own time (a busy machine stretches the bot's): 45 s between any two calls,
    // and the same character not again within 5 minutes (data/story.json pacing.call gap, repeat).
    const log = (await state()).callsAt, C = readJson<{ pacing: { call: { gap: number; repeat: number } } }>(rel('data/story.json')).pacing.call
    for (let i = 1; i < log.length; i++) if (log[i].at - log[i - 1].at < C.gap * 1000) throw new Error(`stuck: called out again too soon (nagging): ${log.map((c) => `${c.who}@${Math.round(c.at)}`).join(', ')}`)
    for (const c of log) if (log.some((o) => o !== c && o.who === c.who && Math.abs(o.at - c.at) < C.repeat * 1000)) throw new Error(`stuck: ${c.who} called out twice within 5 minutes`)
    done.push('and nobody nags on the way back (45 s between any two calls, 5 minutes for the same one)')
    await cmd('teleport 44 28.5 0'); await cmd('mission start ch1 5')
    await until("chapter 1's last talk (Rosa)", (s) => s.mission === 'ch1:5' && s.dlg)
    await cmd('mission next all'); await until('done: the results card says what it gave (a deck)', (s) => /NEW DECK/.test(s.results) && /Karl Was Here/.test(s.results))
    await page.evaluate(() => (window as unknown as { __skateGame: { story: { openJournal(f: string): void } } }).__skateGame.story.openJournal('play'))
    await until('the journal has a Rewards page and a 100% page', (s) => s.journal && s.pages.some((t) => /Rewards/.test(t)) && s.pages.some((t) => /^100%/.test(t.trim())))
    await page.keyboard.press('Escape'); await until('the journal closes', (s) => !s.journal && !s.paused)
    await cmd('teleport 9.3 30.5 0.2 0'); await cmd('mission start ch6 3')
    await until('the vote (chapter 6, the crowd at the fence)', (s) => s.mission === 'ch6:3' && s.dlg)
    await cmd('mission next all'); await until('the finale done: the credits roll', (s) => s.credits && s.paused)
    await page.waitForTimeout(800); await page.keyboard.press('Space')
    await until('a key ends the credits; then what the finale gave', (s) => !s.credits && /The Jam/.test(s.results) && /NEW OUTFIT/.test(s.results))
    await cmd('teleport 16 22 0.2 0'); await until('after the finale, Karl says his post-game line as you pass', (s) => s.calls.includes('karl:post'), 60000)
    // The odd jobs (in sf, where the taqueria is): its gig board by the menu (data/jobs.json), today's gigs, one picked and left.
    if (park !== 'sf') return
    await cmd('teleport 167.2 -313.8 -2.13 90'); await until('in the taqueria: the gig board prompt', (s) => /gig board/i.test(s.prompt) && /gigs today/.test(s.prompt))
    await page.keyboard.press('KeyF'); await until("the board's card: Hector's line, today's three gigs and Not now", (s) => /gig board/i.test(s.dlgName) && s.choices.length === 4 && s.choices[3] === 'Not now')
    await page.keyboard.press('Enter'); await until('the first gig starts (a GIG on the HUD)', (s) => !!s.mission?.startsWith('job-taqueria-') && /^gig/i.test(s.obj) && !s.dlg, 20000)
    await cmd('mission abandon'); await until('the gig left: free again', (s) => s.mission === null)
  } catch (e) { errors.push((e as Error).message) }
}
