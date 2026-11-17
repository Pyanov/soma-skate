import * as THREE from 'three'
import { raycast, type Park } from '../sim/park/park.ts'
import type { Thing } from '../sim/thing.ts'

// Name tags over the hill bomb rivals (and your ghost), and the floating combos over park NPCs:
// screen positions for the HUD, shared by the game and clips. On screen, in front, within 70 m and
// not behind a building or a parked car.

export type Tag = { id: number; name: string; x: number; y: number; scale: number }
const v = new THREE.Vector3()

/** A tag at a world point (feet), or null when it should not show. */
export function tagAt(id: number, name: string, p: { x: number; y: number; z: number }, camera: THREE.PerspectiveCamera, park: Park, w: number, h: number, occlude = true): Tag | null {
  const c = camera.position, d = c.distanceTo(v.set(p.x, p.y, p.z))
  if (d > 70 || d < 1.5) return null
  if (occlude) {
    const vx = p.x - c.x, vy = p.y - c.y, vz = p.z + 1 - c.z, L = Math.hypot(vx, vy, vz)
    const hit = raycast(park, { x: c.x, y: c.y, z: c.z }, { x: vx / L, y: vy / L, z: vz / L }, L)
    if (hit && hit.t < L - 1.2) return null
  }
  v.z += 1.5; v.project(camera)
  if (v.z > 1 || Math.abs(v.x) > 1.05 || Math.abs(v.y) > 1.05) return null
  return { id, name, x: (v.x + 1) / 2 * w, y: (1 - v.y) / 2 * h, scale: Math.max(0.6, Math.min(1, 12 / d)) }
}

/** Tags for every hill bomb rival and S.K.A.T.E. local among these things. */
export function racerTags(things: readonly Thing[], camera: THREE.PerspectiveCamera, park: Park, w: number, h: number): Tag[] {
  const out: Tag[] = []
  for (const t of things) {
    const name = t.kind === 'npc' && t.alive ? t.npc?.racer?.name ?? t.npc?.skate?.name : undefined
    if (!name) continue
    const tag = tagAt(t.id, name, t.pos, camera, park, w, h)
    if (tag) out.push(tag)
  }
  return out
}

/** characters.json npcs.pop: the floating combo over a park NPC that lands one. */
export type PopData = { seconds: number; rise: number; range: number; fadeIn: number; fadeOut: number; maxName: number }
export const DEFAULT_POP: PopData = { seconds: 2.2, rise: 44, range: 50, fadeIn: 0.12, fadeOut: 0.5, maxName: 32 }
/** A combo a park NPC landed (the sim's npcCombo). */
export type NpcCombo = { id: number; tick: number; name: string; points: number; multiplier: number }
/** One floating combo on screen: where (over the NPC, risen with age), how big and how opaque. */
export type PopTag = { key: string; name: string; points: number; multiplier: number; x: number; y: number; scale: number; opacity: number }

/**
 * The floating combos over the park NPCs that landed one in the last pop.seconds (they follow the
 * NPC as it rides on), placed like the name tags: on screen, in front, within range, not hidden.
 */
export function npcPopTags(combos: readonly NpcCombo[], things: readonly Thing[], tick: number, hz: number, d: PopData, camera: THREE.PerspectiveCamera, park: Park, w: number, h: number): PopTag[] {
  const out: PopTag[] = [], seen = new Set<number>()
  for (let i = combos.length - 1; i >= 0; i--) {
    const c = combos[i], age = (tick - c.tick) / hz
    if (age < 0 || age >= d.seconds || seen.has(c.id)) continue   // only the newest per NPC
    seen.add(c.id)
    const t = things.find((x) => x.id === c.id && x.alive)
    if (!t || camera.position.distanceTo(v.set(t.pos.x, t.pos.y, t.pos.z)) > d.range) continue
    const tag = tagAt(c.id, c.name, { x: t.pos.x, y: t.pos.y, z: t.pos.z + 0.55 }, camera, park, w, h)
    if (!tag) continue
    const name = c.name.length > d.maxName ? `${c.name.slice(0, d.maxName - 1).trimEnd()}…` : c.name
    const opacity = Math.min(1, age / Math.max(0.01, d.fadeIn), (d.seconds - age) / Math.max(0.01, d.fadeOut))
    out.push({ key: `${c.id}:${c.tick}`, name, points: c.points, multiplier: c.multiplier, x: tag.x, y: tag.y - d.rise * tag.scale * Math.sqrt(age / d.seconds), scale: tag.scale, opacity })
  }
  return out
}

/** Who the camera follows: you, except during a S.K.A.T.E. local's try, when it watches them ride. */
export function camSubject(things: readonly Thing[], me: Thing, session: Thing): Thing {
  if (session.mode !== 'skate' || session.skateTurn !== 'local' || session.skateLocal === undefined) return me
  const local = things.find((t) => t.id === session.skateLocal && t.alive)
  return local?.npc?.skate?.go ? local : me
}
