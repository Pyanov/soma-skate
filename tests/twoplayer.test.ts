import { describe, expect, it } from 'vitest'
import { loadData, loadPark } from '../src/harness/io.ts'
import { applyCommand, parseCommand } from '../src/sim/commands.ts'
import { Btn } from '../src/sim/input.ts'
import { advance, Recorder, runReplay } from '../src/sim/replay.ts'
import { createSim, player2, session, skater, worldHash, type Sim } from '../src/sim/sim.ts'

// Local two-player, the sim side (game/twoplayer.ts). Without player 2 every world and replay is
// what it was before it existed; with it, player 1 still skates exactly as alone (player 2 has its
// own input, b2, and its own random stream), and replays carry both players (soma-replay/2).

const keys = (t: number) => (t % 600 < 400 ? Btn.up : 0) | (t % 200 >= 150 && t % 200 < 170 ? Btn.ollie : 0) | (t % 300 < 60 ? Btn.left : t % 300 >= 150 && t % 300 < 200 ? Btn.right : 0) | (t % 200 === 175 ? Btn.flip | Btn.left : 0)
const keys2 = (t: number) => (t % 500 < 300 ? Btn.up : 0) | (t % 160 >= 120 && t % 160 < 140 ? Btn.ollie : 0) | (t % 240 < 50 ? Btn.right : 0) | (t % 160 === 146 ? Btn.grab | Btn.up : 0)
const run = (sim: Sim, n: number, two: boolean, cmds: string[] = []) => { for (let t = 0; t < n; t++) advance(sim, two ? { b: keys(t), b2: keys2(t) } : { b: keys(t) }, t === 0 ? cmds : []) }

describe('one player: as before two players', () => {
  // Pinned without the two-player code (phase 21), and again when the physics data moved them:
  // phase 24's wider clean landing (land.cleanDeg 20), checked against the previous code with that data;
  // phase 25's free-roam streetcars (sf: seven of them with the traffic).
  it('hashes as main without the two-player code (soma with NPC skaters, sf with traffic and pedestrians, lab)', () => {
    const data = loadData()
    // sf re-pinned for city phase 11, the last time a city phase should need to: the export works on a
    // fixed grid (an area added elsewhere leaves this one exactly as it was, tests/city-areas.test.ts),
    // lists triangles, grind lines and streets nearest the park first, and cars respawn from the streets
    // near the skater, so only a change round the park's own streets moves this hash.
    // Physics phase 29 parked the crew van in sf (game/vehicles.ts): the world is hashed without the
    // vehicles here, which leave every other Thing exactly as it was (the run's own van stays parked).
    // Physics phase 30 re-exported the park with F33's toe flush (soma's NPC skaters and sf both ride it).
    // City phase 13 added interiors and street spots round the park's streets (sf only).
    // Physics phase 31: a placement (a teleport, an NPC skater's respawn) starts its next air there, so an
    // NPC respawned in the park picks its grind's near side from where it now is (soma only).
    // Feel pass (2026-11-09): a fresh push after a bail stands the skater up early (bail.getUpTicks; lab only).
    // Feel pass round 2: the park-speed carve (board.park: quicker turning below 12 m/s) moves all three;
    // the get-up playing the bail's end fast (bail.getUpFrom, getUpRate) moves lab again.
    // Physics phase 32 (WIP): city copings kept, and grind lines whose points sit on a seam between two surfaces kept (5 more in the park, 122 in sf).
    // Both together (feel pass round 3 with physics phase 32): soma and sf re-pinned; lab is the feel pass's.
    // Feel pass round 3: the NPC skaters plan corners with the park carve's numbers (game/follow.ts): soma.
    // Tricks pass (2026-11-16): a trick in the air keeps the direction it was picked by (TrickRun.dir, the
    // diagonal's late key), and the flip table follows THPS 1+2: all three (the runs flip).
    // The squeeze (docs/squeeze.md section 4): the sf world is the squeezed city: sf re-pinned (again for city
    // builds d565e2edfd8dd956 and 6d47b38c38bca28b).
    const pins: [string, string[], string][] = [['soma', ['npc spawn'], '5aa0d97d2f9b155e'], ['sf', ['ped spawn'], 'f8183e1d5818009e'], ['lab', [], 'a94aa14f9bd5510e']]
    for (const [park, cmds, hash] of pins) {
      const sim = createSim(loadPark(park, data), data, { seed: 5 })
      run(sim, 1500, false, cmds)
      expect(worldHash({ ...sim.world, things: sim.world.things.filter((t) => !t.car?.drive) }), park).toBe(hash)
    }
  })

  it('ignores player 2 buttons while nobody plays player 2', () => {
    const data = loadData(), park = loadPark('lab', data)
    const a = createSim(park, data), b = createSim(park, data)
    run(a, 900, false)
    run(b, 900, true)
    expect(worldHash(b.world)).toBe(worldHash(a.world))
  })

  it('records soma-replay/1 with the same fields as before (no input2)', () => {
    const data = loadData(), sim = createSim(loadPark('lab', data), data), rec = new Recorder()
    for (let t = 0; t < 300; t++) rec.tick(sim, { b: keys(t) })
    const rp = rec.replay()
    expect(rp.format).toBe('soma-replay/1')
    expect(Object.keys(rp)).toEqual(['format', 'start', 'ticks', 'input', 'commands', 'hashes', 'states', 'note', 'meta'])
  })
})

describe('two players', () => {
  it('player 1 skates exactly as alone with player 2 in (its own buttons and random stream)', () => {
    const data = loadData()
    for (const [park, cmds] of [['soma', ['npc spawn']], ['sf', ['ped spawn']]] as const) {
      const alone = createSim(loadPark(park, data), data, { seed: 5 }), two = createSim(loadPark(park, data), data, { seed: 5 })
      for (let t = 0; t < 1500; t++) {
        advance(alone, { b: keys(t) }, t === 0 ? [...cmds] : [])
        advance(two, { b: keys(t), b2: keys2(t) }, t === 0 ? [...cmds, 'player2 join'] : [])
        if (t % 50 === 0) expect(JSON.stringify(skater(two)), `${park} tick ${t}`).toBe(JSON.stringify(skater(alone)))
      }
      expect(JSON.stringify(skater(two))).toBe(JSON.stringify(skater(alone)))
      expect(player2(two)!.sk.pos).not.toEqual(skater(two).pos)   // and player 2 rode its own way
    }
  })

  it('records soma-replay/2 with both players, and replays it hash for hash', () => {
    const data = loadData(), park = loadPark('soma', data), sim = createSim(park, data, { seed: 2 }), rec = new Recorder()
    for (let t = 0; t < 1200; t++) rec.tick(sim, { b: keys(t), b2: keys2(t) }, t === 10 ? ['player2 join', 'run trickattack2p'] : [])
    const rp = rec.replay()
    expect(rp.format).toBe('soma-replay/2')
    expect(rp.input2!.reduce((n, [k]) => n + k, 0)).toBe(rp.ticks)
    const r = runReplay(rp, park)
    expect(r.divergence).toBeNull()
    expect(r.checked).toBe(40)
    expect(worldHash(r.sim.world)).toBe(worldHash(sim.world))
  })

  it('takes player2 join | leave | teleport | speed, and the two-player games need player 2', () => {
    const data = loadData(), sim = createSim(loadPark('soma', data), data)
    const cmd = (text: string) => applyCommand(sim, parseCommand(text))
    expect(() => cmd('run trickattack2p')).toThrow(/player 2 first/)
    expect(() => cmd('player2 teleport big3')).toThrow(/no player 2/)
    expect(() => cmd('player2 leave')).toThrow(/no player 2/)
    expect(cmd('player2 join big3')).toMatch(/^player 2 at /)
    expect(() => cmd('player2 join')).toThrow(/already in/)
    expect(cmd('player2 teleport hellride')).toMatch(/^player 2 teleported to /)
    expect(cmd('player2 speed 4')).toBe('player 2 speed 4 m/s')
    expect(() => cmd('run horse2p BANANA')).toThrow(/HORSE words/)
    expect(cmd('run horse2p soma')).toBe('SOMA: player 1 sets first')
    expect(session(sim).mode).toBe('horse2p')
    expect(player2(sim)!.s.mode).toBe('horse2p')
    expect(cmd('player2 leave')).toBe('player 2 left')
    expect(player2(sim)).toBeNull()
    expect(session(sim).mode).toBe('free')
    expect(session(sim).horseWord).toBeUndefined()
    expect(sim.world.p2Rng).toBeUndefined()
    const lab = createSim(loadPark('lab', data), data)
    applyCommand(lab, parseCommand('player2 join'))
    expect(() => applyCommand(lab, parseCommand('run horse2p'))).toThrow(/S.K.A.T.E. spot/)
  })

  it('starting a one-player game leaves player 2 skating free and clears the two-player game', () => {
    const data = loadData(), sim = createSim(loadPark('soma', data), data)
    for (const c of ['player2 join', 'run graffiti2p', 'run start']) applyCommand(sim, parseCommand(c))
    expect(session(sim).mode).toBe('run')
    expect(session(sim).tags).toBeUndefined()
    expect(player2(sim)!.s.mode).toBe('free')
    expect(player2(sim)!.s.owned).toBeUndefined()
  })
})
