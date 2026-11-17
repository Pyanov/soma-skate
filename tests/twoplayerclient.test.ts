import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { playerOf, TagPaint, TWO_PLAYER_DEFAULTS, twoPlayerPanel, twoPlayerPops, type TwoPlayerData } from '../src/client/twoplayer.ts'
import { asPlayer } from '../src/client/split.ts'
import { loadData, loadPark, rel } from '../src/harness/io.ts'
import { loadScenario, runScenario } from '../src/harness/scenario.ts'
import { player2, session, skater, type SimEvent } from '../src/sim/sim.ts'

// The two-player games in the client (twoplayer.ts): each half's panel from the sim's state, the
// games' moments as pops in the right half, Graffiti's tags painted on the obstacles, and player 2's
// HUD reading player 2's own Thing and session.

const data = loadData()
const TP = { ...TWO_PLAYER_DEFAULTS, ...(JSON.parse(readFileSync(rel('data/split.json'), 'utf8')).twoPlayer as TwoPlayerData) }
const ev = (o: Record<string, unknown>) => o as unknown as SimEvent

describe('two players in the client', () => {
  it("Graffiti: each half's panel counts both players' tags, its own as You; the tags are painted in the owners' colours", { timeout: 60000 }, () => {
    const res = runScenario(loadScenario(rel('scenarios/two-player-graffiti.skate')), data)
    const sim = res.sim, s = session(sim), p2 = player2(sim)!
    expect(s.owned).toBe(3); expect(p2.s.owned).toBe(2)
    const one = twoPlayerPanel(sim, 1)!, two = twoPlayerPanel(sim, 2)!
    expect(one.html).toMatch(/GRAFFITI/)
    expect(one.html).toMatch(/p1 lead"><i>You<\/i><b>3<\/b>/)
    expect(two.html).toMatch(/p2"><i>You<\/i><b>2<\/b>/)
    expect(one.timer).toBe("TIME'S UP")
    const paint = new TagPaint(sim.park, data.gaps.gaps, TP)
    paint.update(s.tags as Record<string, { player: 1 | 2 }>)
    expect(paint.count).toBe(5)
    // An owner change repaints that one; the game's end leaves none when the tags go.
    paint.update({ ...(s.tags as Record<string, { player: 1 | 2 }>), 'gap:big3': { player: 2 } })
    expect(paint.count).toBe(5)
    paint.update(undefined)
    expect(paint.count).toBe(0)
    // Player 2's HUD reads player 2 as its own player, with its own session.
    const view = asPlayer(p2.sk, p2.s, data, sim.park, true)
    expect(skater(view).score).toBe(p2.sk.score)
    expect(session(view).owned).toBe(2)
  })

  it('HORSE: both rows of letters, whose turn it is told from each side', { timeout: 60000 }, () => {
    const res = runScenario(loadScenario(rel('scenarios/two-player-horse.skate')), data)
    const one = twoPlayerPanel(res.sim, 1)!, two = twoPlayerPanel(res.sim, 2)!
    expect(one.html).toMatch(/SOMA/)
    expect((two.html.match(/class="got"/g) ?? []).length).toBe(4)   // player 2 spelled S-O-M-A
    expect(one.timer).toBe('GAME')
  })

  it('a one-player world has no two-player panel; events say whose they are; moments pop in the right half', () => {
    const sim = runScenario(loadScenario(rel('scenarios/lab-2p-join.skate')), data).sim
    expect(twoPlayerPanel(sim, 1)).toBeNull()   // player 2 has left by the end
    expect(playerOf(ev({ t: 'comboLanded', player: 2 }))).toBe(2)
    expect(playerOf(ev({ t: 'comboLanded', player: 1 }))).toBe(1)
    expect(playerOf(ev({ t: 'comboLanded' }))).toBe(1)
    expect(twoPlayerPops(ev({ t: 'tagged', player: 2, obstacle: 'gap:big3', points: 700, from: 1 }))).toEqual([{ player: 2, title: 'STOLEN', sub: '+1 · 700', kind: 'goal' }])
    expect(twoPlayerPops(ev({ t: 'horseLetter', who: 1, letters: 'HO' }))[0]).toMatchObject({ player: 1, title: 'LETTER O' })
    expect(twoPlayerPops(ev({ t: 'horseSet', by: 2, name: 'Kickflip' }))[0]).toMatchObject({ player: 0, title: 'SET' })
    expect(twoPlayerPops(ev({ t: 'horseMatch', by: 2, ok: false }))).toEqual([])
  })

  it("every tagged obstacle in the games' scenarios can be painted (park grind lines and gaps)", { timeout: 60000 }, () => {
    for (const name of ['two-player-graffiti', 'soma-2p-graffiti-gaps', 'lab-2p-graffiti']) {
      const sc = loadScenario(rel(`scenarios/${name}.skate`)), res = runScenario(sc, data)
      const tags = session(res.sim).tags as Record<string, { player: 1 | 2 }> | undefined
      const paint = new TagPaint(loadPark(sc.park, data), data.gaps.gaps, TP)
      paint.update(tags)
      expect(paint.count, name).toBe(Object.keys(tags ?? {}).length)
    }
  })
})
