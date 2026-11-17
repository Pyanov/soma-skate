import type { CityGoal, TourGoal } from '../data.ts'
import { dot, sub } from '../math.ts'
import type { Sim, SimEvent } from '../sim.ts'
import { Kind, State, type Thing } from '../thing.ts'
import { carFrame } from './traffic.ts'
import { carTop, dimsOf } from '../skater/cars.ts'

// City goals (THPS 2 style; data/goals.json, docs/mechanics/goals.md). Always on, in free skate
// and every game: each completes once per session (goalComplete) and the client keeps the list
// across sessions. Also the trackers they read: the car the skater is clearing in this air, where
// the open combo started.

const inBox = (b: [number, number, number, number], x: number, y: number) => x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3]

/** Each tick in the air: is the skater over a car, its feet above the roof or hood? Remember it for the landing. */
export function trackCarHop(sim: Sim, s: Thing, sk: Thing) {
  const onCar = sk.carRide >= 0 || (sk.state === State.grind && (sk.grind?.car ?? -1) >= 0)
  if (onCar) s.hopCar = -2   // riding or grinding a car this air: leaving it is not clearing it
  s.onCar = onCar
  if (sk.state !== State.air || s.hopCar === -2) return
  const T = sim.data.traffic, r = sim.data.physics.skater.radius
  for (const c of sim.world.things) {
    if (c.kind !== Kind.car || !c.alive || !c.car) continue
    if (c.car.drive && sim.data.vehicles.types[c.car.drive.type]?.scooter) continue   // a rental scooter is no car to clear (ditching one is not a car hop)
    const D = dimsOf(sim.data, c), reach = c.car.tram ? D.collideRange : 4
    if (Math.abs(c.pos.x - sk.pos.x) > reach || Math.abs(c.pos.y - sk.pos.y) > reach) continue
    const { f, l, u } = carFrame(c), d = sub(sk.pos, c.pos)
    const x = dot(d, f), y = dot(d, l), top = carTop(D, x, y)
    if (top !== null && dot(d, u) - r > top) { s.hopCar = c.id; s.hopRobo = c.car.robo; return }
  }
}

/** Where the open combo started: the skater's spot when its first trick went in. */
export function trackComboStart(s: Thing, sk: Thing) {
  if (sk.combo.length === 0) { s.comboOpen = false; return }
  if (!s.comboOpen) { s.comboOpen = true; s.comboFrom = [sk.pos.x, sk.pos.y] }
}

function done(sim: Sim, s: Thing, g: CityGoal, events: SimEvent[]) {
  s.cityGoals.push(g.id)
  events.push({ t: 'goalComplete', tick: sim.world.tick, id: g.id, name: g.name, area: g.area })
}

/** After the session's own step: every goal not yet done this session, against this tick's state and events. */
export function checkCityGoals(sim: Sim, s: Thing, sk: Thing, events: SimEvent[]) {
  const G = sim.data.goals
  if (!G.parks.includes(sim.park.name)) return
  for (const g of G.goals) if (!s.cityGoals.includes(g.id) && goalMet(sim, s, sk, g, events)) done(sim, s, g, events)
}

/** A city or Tour goal, against this tick's state and events (the Tour's grind goal reads s.grindRun). */
export function goalMet(sim: Sim, s: Thing, sk: Thing, g: CityGoal | TourGoal, events: SimEvent[]): boolean {
  switch (g.kind) {
    case 'gap': return events.some((e) => e.t === 'gap' && g.gaps.includes(e.id))
    case 'skitch': {
      const k = sk.skitch
      if (!k || k.meters < g.meters) return false
      const car = sim.world.things.find((c) => c.id === k.car && c.car)
      return !g.robo || !!car?.car?.robo
    }
    case 'speed': {
      const v = Math.hypot(sk.vel.x, sk.vel.y, sk.vel.z) * 3.6
      return sk.state !== State.bail && sk.drive === undefined && v >= g.kmh && inBox(g.box, sk.pos.x, sk.pos.y) && (!g.z || (sk.pos.z >= g.z[0] && sk.pos.z <= g.z[1]))   // skating: a vehicle's speed counts for nothing
    }
    case 'combo': {
      const tricks = 'tricks' in g ? g.tricks : undefined, every = 'every' in g && g.every
      const holds = (e: { entries: { id: string }[] }, id: string) => e.entries.some((x) => x.id === `gap-${id}`)
      return events.some((e) => e.t === 'comboLanded' && e.points >= g.points && (!g.gaps || (every ? g.gaps.every((id) => holds(e, id)) : g.gaps.some((id) => holds(e, id)))) && (!tricks || e.entries.some((x) => tricks.includes(x.id)))) && (!g.box || inBox(g.box, s.comboFrom[0], s.comboFrom[1]))
    }
    case 'air': return events.some((e) => e.t === 'land' && e.airTicks >= g.seconds * sim.data.physics.tickHz) && inBox(g.box, sk.takeoffXY[0], sk.takeoffXY[1])
    case 'dash': {
      const from = s.levelMarks?.[g.id]
      return from !== undefined && sk.drive === undefined && inBox(g.to, sk.pos.x, sk.pos.y) && sim.world.tick - from <= g.seconds * sim.data.physics.tickHz
    }
    case 'grind': return (s.grindRun ?? 0) >= g.meters && (!g.box || inBox(g.box, sk.pos.x, sk.pos.y)) && (!('feature' in g && g.feature) || (sk.grind !== null && sk.grind.car < 0 && sim.park.grind[sk.grind.line]?.feature === g.feature))
    case 'collect': return s.burritos.length >= g.burritos
    case 'courier': return s.game === 'courier' && s.courierDone >= g.deliveries
    case 'bomb': return events.some((e) => e.t === 'bombFinish' && e.route === (g.route ?? sim.data.run.bomb.id) && (g.maxSeconds === undefined || e.total <= g.maxSeconds) && (!g.noBrakes || !e.braked) && (!g.noFalls || e.falls === 0) && (!g.win || e.place === 1))
  }
}
