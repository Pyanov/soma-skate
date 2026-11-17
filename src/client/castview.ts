import * as THREE from 'three'
import type { CastMember, GameData } from '../sim/data.ts'
import { DEG } from '../sim/math.ts'
import { makeThing, type Thing } from '../sim/thing.ts'
import { applyMaterials, toonify } from './look.ts'
import { buildCharacter } from './skater/characters.ts'
import type { SkaterView } from './skater/view.ts'

// The story's cast standing in the world (data/cast.json), drawn with the characters' rig like the
// player: where they stand now (home, or where the mission on puts them) or, for a follow step's
// character, the sim's actor Thing riding its path. Each is built when you first come near and kept;
// within turn metres they turn to face you. Until a character has its own model, the
// stand-ins wear existing looks (cast.json model).

type Slot = { view: SkaterView; thing: Thing; style: string; facing: number }

const HIDE_BEYOND = 140   // metres: not drawn or posed further away
const TURN = 9            // metres: they turn to face you

export class CastViews {
  readonly group = new THREE.Group()
  private slots = new Map<string, Slot>()
  private player: SkaterView
  private gradient: THREE.Texture | null
  style = 'real'
  /** Cast members another view draws (castpeople.ts: the cast people with their own models); not built or drawn here. */
  skip: (id: string) => boolean = () => false

  constructor(player: SkaterView, gradient: THREE.Texture | null) {
    this.player = player
    this.gradient = gradient
    this.group.name = 'cast'
  }

  private build(c: CastMember, data: GameData): Slot | null {
    const spec = this.player.data.characters.find((x) => x.id === c.model.id) ?? this.player.data.people?.find((x) => x.id === c.model.id)   // (people: castpeople.ts's, if one rides)
    if (!spec) return null
    const built = buildCharacter(spec, c.model.outfit ?? null)
    if (this.gradient) toonify(built.character.root, this.gradient)
    built.character.root.traverse((o) => { const l = o.userData.looks; if (l && l.grey.transparent) (l.cute as THREE.Material).depthWrite = false })
    const view = this.player.twin(built, true)
    view.root.name = `cast:${c.id}`
    view.ground = this.player.ground
    const thing = makeThing(-1, 'npc')
    thing.state = 'walk'
    thing.pos = { x: c.home[0], y: c.home[1], z: c.home[2] }
    const h = c.heading * DEG
    thing.fwd = { x: Math.sin(h), y: Math.cos(h), z: 0 }
    view.tick = 0
    view.update(thing, data, 1)
    this.group.add(view.root)
    return { view, thing, style: '', facing: h }
  }

  /**
   * This frame: where each character stands (at: x y z heading in degrees, or an actor Thing that moves),
   * you (to face), the tick and the data. Characters not listed (or too far) are hidden.
   */
  update(list: { c: CastMember; at?: [number, number, number, number]; actor?: Thing }[], you: { x: number; y: number }, tick: number, data: GameData, dt: number) {
    const seen = new Set<string>()
    for (const { c, at, actor } of list) {
      if (this.skip(c.id) && !actor) continue   // drawn by castpeople.ts (a ride, an actor Thing, stays here)
      const x = actor ? actor.pos.x : at ? at[0] : c.home[0], y = actor ? actor.pos.y : at ? at[1] : c.home[1]
      const d = Math.hypot(x - you.x, y - you.y)
      if (d > HIDE_BEYOND) continue
      let s = this.slots.get(c.id)
      if (!s) { const b = this.build(c, data); if (!b) continue; s = b; this.slots.set(c.id, s) }
      seen.add(c.id)
      s.view.root.visible = true
      if (s.style !== this.style) { applyMaterials(s.view.root, this.style as 'cute' | 'real' | 'grey'); s.style = this.style }
      if (actor) {
        // Riding its path: the sim's Thing as it is (state, speed, facing).
        s.view.tick = tick
        s.view.update(actor, data, 1)
        continue
      }
      const t = s.thing
      t.state = 'walk'
      t.vel = { x: 0, y: 0, z: 0 }
      t.pos = { x, y, z: at ? at[2] : c.home[2] }
      // Facing: home's heading, turning to you when you are close (a smooth turn, not a snap).
      const want = d < TURN ? Math.atan2(you.x - x, you.y - y) : (at ? at[3] : c.heading) * DEG
      let diff = want - s.facing
      diff = Math.atan2(Math.sin(diff), Math.cos(diff))
      s.facing += diff * Math.min(1, dt * 4)
      t.fwd = { x: Math.sin(s.facing), y: Math.cos(s.facing), z: 0 }
      t.stateTicks = tick
      s.view.tick = tick
      s.view.update(t, data, 1)
    }
    for (const [id, s] of this.slots) if (!seen.has(id)) s.view.root.visible = false
  }
}
