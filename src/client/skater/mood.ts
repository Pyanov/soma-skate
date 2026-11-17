import type { GameData } from '../../sim/data.ts'
import { Btn } from '../../sim/input.ts'
import type { Thing } from '../../sim/thing.ts'
import type { Style } from './characters.ts'
import type { Expression, MouthShape } from './face.ts'
import { lerpPose, type Pose, type PoseData, type V3 } from './poses.ts'

// Moods, expressions and steez: what the face shows and how the body styles a pose, as pure
// functions of the Thing and the world tick (so a shot of a snapshot shows what play shows).
// Celebrations come from the sim's last-landing record (Thing.lastLand: quality, points,
// multiplier, when the combo banked); scared comes from its bail forecast (Thing.danger).

export type Mood = 'neutral' | 'focused' | 'happy' | 'ecstatic' | 'scared' | 'dizzy' | 'hurt'

export type MoodState = {
  mood: Mood
  landed: number        // ticks since a landing worth celebrating, -1 when not celebrating
  size: number          // celebration size 0..3
  idle: number          // 0..1, standing still for a while
  blink: number         // 0..1
  look: [number, number]
  ticks: number         // state ticks + alpha
  pickup: number        // ticks since picking something up (a burrito), -1 = none
  emote: number         // ticks since the emote (taunt) key, -1 = none
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x)
const smooth = (a: number, b: number, x: number) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t) }

/**
 * For a snapshot with no event stream (headless shots): when the skater picked up a burrito, judged
 * from the collected burritos (the session Thing) and how far the skater has rolled past one since.
 * Play and clips use the actual 'burrito' event instead.
 */
export function pickupFromSession(sk: Thing, sess: Thing | null, data: GameData, tick: number): number {
  const B = data.run?.burritos
  if (!sess || !B) return -1
  let best = -1
  const v = Math.max(1, Math.hypot(sk.vel.x, sk.vel.y))
  for (const i of sess.burritos ?? []) {
    const p = B[i]?.pos
    if (!p) continue
    const d = Math.hypot(p[0] - sk.pos.x, p[1] - sk.pos.y, p[2] - sk.pos.z) - data.run.burritoRadius
    const ago = (Math.max(0, d) / v) * data.physics.tickHz
    if (ago < 60) best = Math.max(best, tick - ago)
  }
  return best
}

export function moodOf(t: Thing, data: GameData, alpha: number, tick = -1): MoodState {
  const ticks = t.stateTicks + alpha
  const speed = Math.hypot(t.vel.x, t.vel.y, t.vel.z)
  let mood: Mood = 'neutral', landed = -1, size = 0, idle = 0
  let look: [number, number] = [0, 0]
  if (t.state === 'bail') {
    mood = ticks < 22 ? 'scared' : ticks < 95 ? 'dizzy' : 'hurt'
  } else if (t.state === 'air') {
    const falling = t.vel.z < -7 && !t.trick
    mood = falling ? 'scared' : t.trick || t.vertAir || ticks > 25 ? 'focused' : 'neutral'
    if (t.trick?.kind === 'flip') look = [0, -0.8]
  } else if (t.state === 'grind' || t.state === 'lip' || t.state === 'wall' || t.manual || t.skitch) {
    const bal = Math.abs((t.grind ?? t.lip ?? t.manual ?? t.skitch)?.balance ?? 0)
    mood = bal > 0.72 ? 'scared' : 'focused'
    look = [0, -0.5]
  } else if (t.state === 'ground') {
    const L = t.lastLand
    if (tick >= 0 && L && L.tick >= 0) {
      // The landing this ground state began with (a bail recovery or a step back on starts a
      // ground state of its own, so the state is younger than the landing): celebrate when the
      // combo banks, sized by its points; a stumble winces instead.
      const sinceLand = tick + alpha - L.tick
      if (sinceLand >= 0 && Math.abs(ticks - sinceLand) < 1.5) {
        if (L.quality === 'stumble') { if (sinceLand < 50) mood = 'hurt' }
        else if (L.bankTick >= 0 && L.points > 0) {
          const since = tick + alpha - L.bankTick
          if (since >= 0 && since < 120) {
            landed = since
            size = L.points >= 4000 ? 3 : L.points >= 1000 ? 2 : L.points >= 300 ? 1 : 0
            if (L.quality === 'sketchy') size = Math.min(size, 1)
            mood = size >= 3 ? 'ecstatic' : 'happy'
          }
        } else if (L.bankTick < 0 && t.combo.length && sinceLand < 30) mood = 'happy'
      }
      // A combo that banked on the ground later in this ground state (a manual, a powerslide, letting
      // go of a skitch): the same celebration, sized by its points.
      if (landed < 0 && L.bankTick >= 0 && L.points > 0) {
        const since = tick + alpha - L.bankTick
        if (since >= 0 && since < 120 && L.bankTick > tick - ticks + 2) {
          landed = since
          size = L.points >= 4000 ? 3 : L.points >= 1000 ? 2 : L.points >= 300 ? 1 : 0
          mood = size >= 3 ? 'ecstatic' : 'happy'
        }
      }
    } else {
      // No world tick (tests): read a celebration from the last air and speed that pushing from
      // a standstill could not explain (which tells a landing from a bail recovery).
      const fromRest = (data.physics.ground.pushAccel * ticks) / data.physics.tickHz + 0.8
      if (t.airTicks > 40 && ticks < 120 && speed > fromRest) {
        landed = ticks
        size = t.airTicks > 130 ? 3 : t.airTicks > 85 ? 2 : 1
        if (t.combo.length) size = Math.max(size, Math.min(3, t.combo.length))
        mood = size >= 3 ? 'ecstatic' : 'happy'
      }
    }
    if (speed < 0.15 && !t.crouch) idle = smooth(90, 160, ticks)
  }
  // On a car roof: uh-oh first, then loving it.
  if (t.state === 'ground' && (t.carRide ?? -1) >= 0 && landed < 0) mood = ticks < 35 ? 'scared' : 'happy'
  // The sim's forecast (t.danger, src/sim/skater/signals.ts): a bail is coming, so look scared before the slam.
  if (t.state !== 'bail' && (t.danger ?? 0) >= 0.5) mood = 'scared'
  // Blink every few seconds (lids shut for 7 ticks).
  const blinkPhase = (t.stateTicks + (t.id * 97)) % 380
  const blink = mood === 'scared' ? 0 : blinkPhase < 7 ? 1 - Math.abs(blinkPhase - 3.5) / 3.5 : 0
  if (idle > 0.5) look = [Math.sin(ticks * 0.013) * 0.6, -0.1]
  return { mood, landed, size, idle, blink, look, ticks, pickup: -1, emote: -1 }
}

const EXPR: Record<Mood, Omit<Expression, 'look' | 'mouth'> & { mouth: MouthShape | null }> = {
  neutral: { mouth: null, lid: 0.18, browY: 0, browTilt: 0, pupil: 1, jaw: 0.05 },
  focused: { mouth: 'focus', lid: 0.45, browY: -0.5, browTilt: 0.7, pupil: 0.9, jaw: 0 },
  happy: { mouth: 'grin', lid: 0.3, browY: 0.45, browTilt: -0.1, pupil: 1.1, jaw: 0.35 },
  ecstatic: { mouth: 'ecstatic', lid: 0.0, browY: 0.9, browTilt: -0.2, pupil: 1.25, jaw: 0.8 },
  scared: { mouth: 'scared', lid: 0.0, browY: 0.95, browTilt: -0.8, pupil: 0.55, jaw: 0.6 },
  dizzy: { mouth: 'dizzy', lid: 0.55, browY: 0.1, browTilt: -0.4, pupil: 0.8, jaw: 0.25 },
  hurt: { mouth: 'hurt', lid: 0.6, browY: -0.2, browTilt: -0.6, pupil: 0.9, jaw: 0.1 },
}

export function expression(m: MoodState, neutral: MouthShape): Expression {
  const e = EXPR[m.mood]
  let look = m.look
  if (m.mood === 'dizzy') look = [Math.cos(m.ticks * 0.25) * 0.8, Math.sin(m.ticks * 0.25) * 0.8]   // eyes rolling round
  const jawChatter = m.landed >= 0 ? Math.max(0, Math.sin(m.landed * 0.9)) * 0.6 * Math.exp(-m.landed / 50) : 0
  return { mouth: e.mouth ?? neutral, lid: Math.max(e.lid, m.blink), browY: e.browY, browTilt: e.browTilt, pupil: e.pupil, look, jaw: Math.min(1, e.jaw + jawChatter) }
}

// ---------------------------------------------------------------- steez

/** How long an emote plays, ticks. */
export const EMOTE_TICKS = 180

const CELEB: Record<string, string> = { hop: 'celHop', fist: 'celFist', armsUp: 'celArmsUp', spinCan: 'celArmsUp', jiggle: 'celNod', bounce: 'celHop', nod: 'celNod', flail: 'celFlail', point: 'celPoint', dance: 'celDance', capeFlare: 'celFlare', chatter: 'celNod', awkwardFist: 'celAwkward' }
const IDLE: Record<string, string> = {
  wobble: 'idleWobble', breathe: 'idleBreathe', bounce: 'idleBounce', headScratch: 'idleScratch', capeWrap: 'idleCross', rattle: 'idleRattle', phone: 'idlePhone',
  canOpen: 'idleCanOpen', jiggleTall: 'idleBreathe', jiggleWide: 'idleBreathe', wave: 'idleWave', giggle: 'idleGiggle', dance: 'celDance', sunCheck: 'idleSun', armOff: 'idleArmOff', selfie: 'idleSelfie',
  drift: 'idleBreathe', coolCross: 'idleCross', shakaWave: 'idleWave', peck: 'idleBreathe', crossWings: 'idleCross', bask: 'idleSun', noseBall: 'idleBreathe',
}

/** The idle playing after `ticks` standing still: the first from the start, then a cycle of the rest. */
export function idleNow(ticks: number, idles: string[]): { name: string; prev: string; t: number; blend: number } {
  const first = 960, each = 720
  if (idles.length < 2 || ticks < first) return { name: idles[0], prev: idles[0], t: ticks, blend: 1 }
  const k = Math.floor((ticks - first) / each)
  const name = idles[(k + 1) % idles.length], prev = idles[k % idles.length]
  const t = ticks - first - k * each
  return { name, prev: k === 0 ? idles[0] : prev, t, blend: smooth(0, 40, t) }
}

const addV = (a: V3, b: V3, k: number): V3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k]

/**
 * Style a pose for a character: stiffness, arm carriage, arm swing while rolling, air flair,
 * landing celebrations scaled to the landing, bail flailing and idle fidgets.
 */
export function steez(pose: Pose, t: Thing, m: MoodState, st: Style, P: PoseData): Pose {
  let p = pose
  const T = m.ticks
  const pick = (name: string) => P.poses[name] ?? null
  // Stiffness: the pitch and lean of hips and spine scale; yaw (where the body faces) stays. A tuck
  // at speed, a powerslide or a wobble bends anyone.
  const speed = Math.hypot(t.vel.x, t.vel.y, t.vel.z)
  // Balancing (a grind, a slide, a manual) reads the same on every body: the lean stays and the arms
  // go out, however stiff or tucked-in the character's own carriage.
  // (coming in over a grind's lock-on, 8 ticks: switched on at once, the carriage jumped the forearms 50 to 95 degrees)
  const balancing = t.state === 'grind' ? smooth(0, 8, t.stateTicks) : t.manual ? 1 : t.state === 'air' && t.left ? 1 - smooth(0, 8, t.stateTicks) : 0   // and out of it off the rail
  const forced = Math.max(t.crouch && speed > 5 ? 1 : 0, t.powerslide ? 1 : 0, Math.min(1, (t.wobble ?? 0) * 2), balancing * 0.85)
  const bend = st.bend + (Math.max(st.bend, 0.9) - st.bend) * forced
  for (const k of ['hipsRot', 'spine'] as const) p[k] = [p[k][0], p[k][1] * bend, p[k][2] * bend]
  // Arm carriage: hands closer to or farther from the body.
  const arms = st.arms + (Math.max(st.arms, 0.95) - st.arms) * balancing
  for (const h of [p.lead, p.rear]) if (h.board < 0.5) h.pos = [h.pos[0] * arms, h.pos[1] * (0.6 + 0.4 * arms), h.pos[2]]
  const pushing = t.state === 'ground' && !t.crouch && (t.prevB & Btn.up) !== 0
  if (t.state === 'ground' && !pushing && m.landed < 0) {
    // Rolling: a slow loose sway of the arms.
    const sw = st.swing * 0.06
    p.lead.pos = addV(p.lead.pos, [Math.sin(T * 0.045) * sw, Math.cos(T * 0.03) * sw * 0.5, Math.sin(T * 0.06) * sw * 0.6], 1)
    p.rear.pos = addV(p.rear.pos, [Math.sin(T * 0.05 + 2) * sw, Math.cos(T * 0.035 + 1) * sw * 0.5, Math.sin(T * 0.055 + 1) * sw * 0.6], 1)
  }
  if (t.state === 'air' && !t.trick) {
    // Air flair: arms float up and out, a little flap for loose characters.
    const k = smooth(4, 20, T) * st.swing
    const flap = Math.sin(T * 0.3) * 0.04 * st.swing
    p.lead.pos = addV(p.lead.pos, [0.06, 0.02, 0.12 + flap], k)
    p.rear.pos = addV(p.rear.pos, [-0.06, 0.02, 0.1 - flap], k)
  }
  if (st.wings && t.state !== 'bail') {
    // Flippers held out wide like wings for balance (the sea lion): the free hands only, a slow sway;
    // celebrations, idles and the emote below still take the arms over.
    const sway = Math.sin(T * 0.05) * 0.03
    p.lead.pos = p.lead.board < 0.5 ? lerpPose(p.lead.pos, [0.5, 0.06, -0.02 + sway] as V3, st.wings) : p.lead.pos
    p.rear.pos = p.rear.board < 0.5 ? lerpPose(p.rear.pos, [-0.5, 0.06, -0.02 - sway] as V3, st.wings) : p.rear.pos
  }
  if (m.landed >= 0) {
    const name = CELEB[st.celebrate[Math.min(st.celebrate.length - 1, m.size)]] ?? 'celNod'
    const target = pick(name)
    if (target) {
      const w = smooth(6, 18, m.landed) * (1 - smooth(80, 118, m.landed))
      const c = lerpPose(p, mergeUpper(p, target), w)
      // Pumps and nods repeat a couple of times.
      const beat = Math.sin(m.landed * 0.32) * w
      c.head = addV(c.head, [0, 10, 0], name === 'celNod' ? beat : 0)
      if (name === 'celFist' || name === 'celAwkward') c.lead.pos = addV(c.lead.pos, [0, 0, 0.08], beat)
      if (name === 'celDance') c.hipsRot = addV(c.hipsRot, [12, 0, 6], beat)
      if (name === 'celFlail') { c.lead.pos = addV(c.lead.pos, [0, 0.1, 0.12], beat); c.rear.pos = addV(c.rear.pos, [0, -0.1, 0.12], -beat) }
      p = c
    }
  }
  if (t.state === 'bail' && T < 40) {
    // Arms windmill as the fall starts.
    const k = 1 - smooth(20, 40, T)
    p.lead.pos = addV(p.lead.pos, [Math.sin(T * 0.6) * 0.15, 0.1, Math.cos(T * 0.6) * 0.2], k)
    p.rear.pos = addV(p.rear.pos, [Math.sin(T * 0.6 + 2) * 0.15, 0.1, Math.cos(T * 0.6 + 2) * 0.2], k)
  }
  if (m.idle > 0) {
    // Standing still: the first idle, then after a while the character cycles its others.
    const cyc = idleNow(T, st.idles?.length ? st.idles : [st.idle])
    const styled = (name: string) => {
      const target = pick(IDLE[name] ?? 'idleBreathe')
      if (!target) return null
      const c = mergeUpper(p, target)
      const osc = Math.sin(T * 0.05)
      if (name === 'wobble') c.hipsRot = addV(c.hipsRot, [0, 0, 8], osc)
      if (name === 'rattle') c.spine = addV(c.spine, [4, 0, 3], Math.sin(T * 0.9))
      if (name === 'breathe' || name === 'bounce' || name.startsWith('jiggle')) c.hips = addV(c.hips, [0, 0, 0.015], osc)
      if (name === 'headScratch') c.lead.pos = addV(c.lead.pos, [0.02, 0, 0.02], Math.sin(T * 0.4))
      if (name === 'wave') { c.lead.pos = addV(c.lead.pos, [Math.sin(T * 0.3) * 0.18, 0, Math.abs(Math.cos(T * 0.3)) * 0.06], 1); c.hipsRot = addV(c.hipsRot, [0, 0, Math.sin(T * 0.3) * 5], 1) }
      if (name === 'giggle') { c.spine = addV(c.spine, [Math.sin(T * 0.45) * 35, 10 + Math.sin(T * 0.9) * 8, 0], 1); c.head = addV(c.head, [0, Math.sin(T * 1.2) * 16, Math.sin(T * 0.7) * 10], 1) }
      if (name === 'dance') c.hipsRot = addV(c.hipsRot, [Math.sin(T * 0.3) * 14, 0, Math.sin(T * 0.3) * 6], 1)
      if (name === 'drift') { c.hips = addV(c.hips, [0, 0, 0.035], Math.sin(T * 0.03)); c.hipsRot = addV(c.hipsRot, [0, 0, 4], Math.sin(T * 0.021)) }
      if (name === 'coolCross') c.head = addV(c.head, [0, 12, 0], Math.pow(Math.max(0, Math.sin(T * 0.04)), 3))
      if (name === 'shakaWave') c.lead.pos = addV(c.lead.pos, [Math.sin(T * 0.22) * 0.08, 0, 0], 1)
      if (name === 'peck') c.spine = addV(c.spine, [0, 22, 0], Math.pow(Math.max(0, Math.sin(T * 0.1)), 6))
      // The sea lion basks, nose up and eyes to the sky; balancing the beach ball (the hook), head back, flippers out.
      if (name === 'bask') { c.head = addV(c.head, [0, -28, 0], 0.7 + 0.3 * Math.sin(T * 0.02)); c.hips = addV(c.hips, [0, 0, 0.01], osc) }
      if (name === 'noseBall') { c.head = addV(c.head, [Math.sin(T * 0.09) * 6, -38, 0], 1); c.lead.pos = addV(c.lead.pos, [0.12, 0, 0.06], 1); c.rear.pos = addV(c.rear.pos, [-0.12, 0, 0.06], 1) }
      if (name === 'sunCheck') { c.head = addV(c.head, [Math.sin(T * 0.025) * 45, 0, 0], 1); c.spine = addV(c.spine, [Math.sin(T * 0.025) * 15, 0, 0], 1) }
      return c
    }
    const now = styled(cyc.name), before = styled(cyc.prev)
    const target = now && before ? lerpPose(before, now, cyc.blend) : now
    if (target) p = lerpPose(p, target, m.idle)
  }
  if (m.emote >= 0 && m.emote < EMOTE_TICKS && st.emote) {
    // The emote (taunt): a short funny bit per character; its props (foam, wings, bones) are in the hooks.
    const e = smooth(0, 10, m.emote) * (1 - smooth(EMOTE_TICKS - 30, EMOTE_TICKS, m.emote)), E = m.emote
    const k = st.emote.kind
    const target = pick(k === 'dab' ? 'emoteDab' : k === 'hiss' ? 'emoteHiss' : k === 'hiring' ? 'emoteHiring' : k === 'foam' ? 'celFist' : k === 'coolnod' ? 'emoteCool' : k === 'shaka' ? 'emoteShaka' : k === 'strut' ? 'emoteStrut' : k === 'arrive' ? 'celPoint' : k === 'bell' ? 'celFist' : k === 'clap' ? 'emoteShaka' : 'celArmsUp')
    if (target) p = lerpPose(p, mergeUpper(p, target), e)
    if (k === 'foam') p.hipsRot = addV(p.hipsRot, [Math.sin(E * 1.9) * 8, Math.sin(E * 2.3) * 5, Math.sin(E * 2.7) * 9], e)
    if (k === 'giggle') { p.spine = addV(p.spine, [Math.sin(E * 0.45) * 50, 12, Math.sin(E * 1.3) * 12], e); p.head = addV(p.head, [Math.sin(E * 1.1) * 18, Math.sin(E * 1.7) * 16, 0], e) }
    if (k === 'rattle') { p.spine = addV(p.spine, [Math.sin(E * 1.6) * 10, 0, Math.sin(E * 2.1) * 8], e); p.head = addV(p.head, [Math.sin(E * 0.9) * 20, 0, Math.sin(E * 1.4) * 12], e) }
    if (k === 'hiring') p.hips = addV(p.hips, [0, 0, 0.03], Math.max(0, Math.sin(E * 0.25)) * e)
    if (k === 'jiggle') p.hips = addV(p.hips, [0, 0, 0.05], Math.abs(Math.sin(E * 0.3)) * e)
    if (k === 'coolnod') p.head = addV(p.head, [0, 16, 0], Math.pow(Math.max(0, Math.sin(E * 0.07)), 2) * e)
    if (k === 'shaka') { p.hips = addV(p.hips, [0, 0, 0.03], Math.abs(Math.sin(E * 0.2)) * e); p.lead.pos = addV(p.lead.pos, [Math.sin(E * 0.3) * 0.05, 0, 0], e) }
    if (k === 'strut') p.hipsRot = addV(p.hipsRot, [Math.sin(E * 0.14) * 14, 0, Math.sin(E * 0.14) * 7], e)
    // "Arriving now.": a polite little settle, pointing at you (your ride is here).
    if (k === 'arrive') p.hips = addV(p.hips, [0, 0, -0.03], Math.max(0, Math.sin(E * 0.12)) * e)
    // The sea lion claps its flippers in front of its chest, head back, barking (Ork ork!).
    if (k === 'clap') {
      const c = Math.abs(Math.sin(E * 0.32))
      p.lead.pos = lerpPose(p.lead.pos, [0.04 + 0.15 * c, 0.34, 0.14] as V3, e); p.rear.pos = lerpPose(p.rear.pos, [-0.04 - 0.15 * c, 0.34, 0.14] as V3, e)
      p.lead.curl *= 1 - e; p.rear.curl *= 1 - e
      p.head = addV(p.head, [0, -24, 0], e)
    }
    // Ringing the bell: the lever yanks the cord, ding ding.
    if (k === 'bell') p.lead.pos = addV(p.lead.pos, [0, 0, 0.14], Math.abs(Math.sin(E * 0.45)) * e)
  }
  if (m.pickup >= 0 && m.pickup < 54) {
    // Grabbed a burrito: a quick happy throw of the arms (the character's bigger celebration).
    const name = CELEB[st.celebrate[Math.min(2, st.celebrate.length - 1)]] ?? 'celArmsUp'
    const target = pick(name)
    if (target) p = lerpPose(p, mergeUpper(p, target), smooth(0, 6, m.pickup) * (1 - smooth(34, 54, m.pickup)))
  }
  return p
}

/** A celebration or idle pose applied over the upper body only (feet and board stay). */
function mergeUpper(base: Pose, over: Pose): Pose {
  return { ...base, spine: over.spine, head: over.head, lead: over.lead, rear: over.rear, hipsRot: [base.hipsRot[0], over.hipsRot[1], over.hipsRot[2]] }
}
