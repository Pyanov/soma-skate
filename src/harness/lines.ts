import { Btn } from '../sim/input.ts'
import { Recorder } from '../sim/replay.ts'
import { raycast } from '../sim/park/park.ts'
import { createSim, skater, type Sim, type SimEvent } from '../sim/sim.ts'
import type { LineInfo } from '../sim/park/source.ts'
import { loadData, loadPark, loadParkSource, rel, writeJson } from './io.ts'
import { pilotKeys, type PilotState } from './pilot.ts'

export { pilotKeys, type PilotState } from './pilot.ts'

// Rider lines through the real park, ridden by an autopilot that presses the
// same keys a player would: steer toward the next waypoint, push when slow.
// A line passes when the skater reaches its last point without bailing.

export type LineResult = { id: string; pass: boolean; reason: string; seconds: number; reached: number; of: number; maxSpeed: number }

export function rideLines(o: { only?: string[]; speed?: number; park?: string; save?: boolean } = {}): LineResult[] {
  const data = loadData()
  const parkName = o.park ?? 'soma'
  const park = loadPark(parkName, data)
  const lines = (loadParkSource(parkName).lines ?? []).filter((l) => !o.only?.length || o.only.includes(l.id))
  const out: LineResult[] = []
  for (const line of lines) {
    const pts = line.points
    // A street hill (steeper than 4 degrees) is bombed tucked, holding about 16 m/s (wobbles start at
    // 17 in a tuck): gravity does the work, a powerslide scrubs the excess.
    const hill = line.maxSlopeDeg >= 4
    const target = hill ? 16 : o.speed ?? 5
    const sim = createSim(park, data, { seed: 1 })
    const [x0, y0] = pts[0], [x1, y1] = pts[1]
    const heading = (Math.atan2(x1 - x0, y1 - y0) * 180) / Math.PI
    const rec = new Recorder()
    let i = 1, reason = '', maxSpeed = 0, slow = 0, lastUp = -1000
    const st: PilotState = { i, lastUp, maxSpeed }
    const length = pts.slice(1).reduce((s, p, k) => s + Math.hypot(p[0] - pts[k][0], p[1] - pts[k][1]), 0)
    const limit = Math.ceil((length / 2 + 8) * 120)
    let t = 0
    const ground = raycast(park, { x: x0, y: y0, z: park.boundsMax.z + 1 }, { x: 0, y: 0, z: -1 }, park.boundsMax.z - park.boundsMin.z + 2)
    // A line can ask for empty streets (traffic: false): it checks that the route is rideable, and
    // cars merging in front of a bombing autopilot are the traffic scenarios' business.
    const first = [...(line.traffic === false ? ['traffic clear'] : []), `teleport ${x0} ${y0} ${((ground?.point.z ?? 0) + data.physics.skater.radius + 0.02).toFixed(3)} ${heading.toFixed(2)}`]
    for (; t < limit && i < pts.length; t++) {
      const sk = skater(sim)
      const cmds = t === 0 ? first : []
      if (t < 6) { rec.tick(sim, { b: 0 }, cmds); continue }   // place on the surface, settle
      const keys = pilotKeys(sim, line, st, t, target)
      i = st.i; maxSpeed = st.maxSpeed; lastUp = st.lastUp
      if (keys === null) break
      const b = keys
      const speed = Math.hypot(sk.vel.x, sk.vel.y, sk.vel.z)
      const ev: SimEvent[] = rec.tick(sim, { b })
      const bail = ev.find((e) => e.t === 'bail')
      if (bail) { reason = `bailed: ${(bail as { reason: string }).reason}`; break }
      slow = speed < 0.3 && sk.state === 'ground' ? slow + 1 : 0
      if (slow > 240) { reason = 'stuck'; break }
    }
    const pass = i >= pts.length
    if (!pass && !reason) reason = 'out of time'
    if (!pass || o.save) writeJson(rel('out/lines', `${line.id}.replay.json`), rec.replay(Infinity, `line ${line.id}: ${pass ? 'ridden' : reason}`), false)
    const sk = skater(sim)
    out.push({ id: line.id, pass, reason: pass ? '' : `${reason} near (${sk.pos.x.toFixed(1)}, ${sk.pos.y.toFixed(1)}) heading to point ${i}`, seconds: t / 120, reached: i, of: pts.length, maxSpeed })
  }
  return out
}

