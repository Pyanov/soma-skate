import * as THREE from 'three'
import { frameRotation, twoBone } from './ik.ts'

// A skater figure driven bone by bone: any rig with the standard bone names (Hips, Spine,
// Chest, UpperChest, Neck, Head, Left/Right Shoulder, Arm, ForeArm, Hand, fingers, UpLeg, Leg,
// Foot, Toes) in a T-pose with palms down. The characters are built in code from
// data/characters.json (characters.ts, on the kit in kit.ts). No animation clips: the pose
// solver sets the hips and spine, then two-bone IK places the feet and hands.
//
// Model space: +X = the character's left, +Y = up, +Z = facing, soles on y = 0. For a
// regular-stance rider the left side is the nose, so model space is also the stance space
// the poses are written in.

const CHAIN = ['Hips', 'Spine', 'Chest', 'UpperChest', 'Neck', 'Head'] as const
/** Finger bones the grip curl bends (those the rig has). */
const CURL = ['Index1', 'Index2', 'Index3', 'Middle1', 'Middle2', 'Middle3', 'Ring1', 'Ring2', 'Ring3', 'Pinky1', 'Pinky2', 'Pinky3', 'Thumb1', 'Thumb2']
type Side = 'Left' | 'Right'

type Rest = { lq: THREE.Quaternion; lp: THREE.Vector3; mq: THREE.Quaternion; mp: THREE.Vector3 }

export class Character {
  readonly root: THREE.Group             // model space; parent it under the stance root
  readonly bones = new Map<string, THREE.Bone>()
  private rest = new Map<string, Rest>()
  private order: THREE.Bone[] = []       // parents before children
  private mq = new Map<string, THREE.Quaternion>()
  private mp = new Map<string, THREE.Vector3>()
  private set = new Set<string>()        // bones posed explicitly this frame
  /** Rig measurements (metres, model space), from the rest skeleton. */
  readonly dims: { ankleH: number; soleFwd: number; hipsY: number; thigh: number; shin: number; leg: number; hipJoint: number; hipX: number; shoulderX: number; shoulderY: number; upperArm: number; foreArm: number; arm: number; handLen: number }

  constructor(scene: THREE.Object3D) {
    this.root = new THREE.Group()
    this.root.name = 'character'
    this.root.add(scene)
    scene.traverse((o) => { if ((o as THREE.Bone).isBone) this.bones.set(o.name, o as THREE.Bone) })
    // Rest pose in model space.
    const hips = this.bones.get('Hips')!
    const walk = (b: THREE.Bone, pq: THREE.Quaternion, pp: THREE.Vector3) => {
      const lq = b.quaternion.clone(), lp = b.position.clone()
      const mq = pq.clone().multiply(lq)
      const mp = pp.clone().add(lp.clone().applyQuaternion(pq))
      this.rest.set(b.name, { lq, lp, mq, mp })
      this.order.push(b)
      for (const c of b.children) if ((c as THREE.Bone).isBone) walk(c as THREE.Bone, mq, mp)
    }
    walk(hips, new THREE.Quaternion(), new THREE.Vector3())
    const R = (n: string) => this.rest.get(n)!
    const len = (n: string) => R(n).lp.length()
    this.dims = {
      ankleH: R('LeftFoot').mp.y,
      soleFwd: (R('LeftToes').mp.z - R('LeftFoot').mp.z) * 0.62,
      hipsY: R('Hips').mp.y,
      thigh: len('LeftLeg'), shin: len('LeftFoot'),
      leg: len('LeftLeg') + len('LeftFoot'),
      hipJoint: R('LeftUpLeg').mp.y - R('Hips').mp.y,
      hipX: R('LeftUpLeg').mp.x,
      shoulderX: R('LeftArm').mp.x,
      shoulderY: R('LeftArm').mp.y,
      upperArm: len('LeftForeArm'), foreArm: len('LeftHand'),
      arm: len('LeftForeArm') + len('LeftHand'),
      handLen: R('LeftHandIndex1').mp.distanceTo(R('LeftHand').mp) + 0.03,
    }
  }

  restPos(name: string) { return this.rest.get(name)!.mp.clone() }

  // ---- posing (model space); call begin(), the setters, then commit() ----

  begin() { this.set.clear(); this.stretched.clear() }
  /** The last tick's elbow and knee sides (ik.ts twoBone keeps them continuous); cleared when the view's time jumps. */
  private bends = new Map<string, THREE.Vector3>()
  forgetBends() { this.bends.clear() }

  /** Cartoon limbs may stretch up to this factor to reach a foot or hand target (1 = rigid). */
  stretch = 1
  private stretched = new Map<string, number>()   // bone -> length factor this frame
  private lp(name: string) { const r = this.rest.get(name)!.lp, k = this.stretched.get(name); return k ? r.clone().multiplyScalar(k) : r }
  /** Reach scale for a two-bone limb toward a target at distance d. */
  private reach(a: THREE.Vector3, target: THREE.Vector3, l: number) { return Math.min(this.stretch, Math.max(1, a.distanceTo(target) / (l * 0.985))) }

  private q(name: string) { let v = this.mq.get(name); if (!v) { v = new THREE.Quaternion(); this.mq.set(name, v) } return v }
  private p(name: string) { let v = this.mp.get(name); if (!v) { v = new THREE.Vector3(); this.mp.set(name, v) } return v }
  private parentName(name: string) { return (this.bones.get(name)!.parent as THREE.Bone).name }

  /** Follow the parent rigidly (rest local rotation) unless already posed. */
  private fk(name: string) {
    if (this.set.has(name)) return
    const r = this.rest.get(name)!
    const pn = this.parentName(name)
    this.q(name).copy(this.q(pn)).multiply(r.lq)
    this.p(name).copy(this.lp(name)).applyQuaternion(this.q(pn)).add(this.p(pn))
    this.set.add(name)
  }

  /** Model-space joint position (posed this frame, else following its parents). */
  joint(name: string): THREE.Vector3 {
    if (!this.set.has(name)) { if (name !== 'Hips') this.joint(this.parentName(name)); this.fk(name) }
    return this.p(name)
  }

  /**
   * Hips position, then the spine chain. rots: one delta per chain bone (Hips, Spine, Chest,
   * UpperChest, Neck, Head), each in the frame already turned by the bones above it.
   */
  setBody(hips: THREE.Vector3, rots: THREE.Quaternion[]) {
    const D = new THREE.Quaternion()
    CHAIN.forEach((n, i) => {
      D.multiply(rots[i] ?? new THREE.Quaternion())
      const r = this.rest.get(n)!
      this.q(n).copy(D).multiply(r.mq)
      if (i === 0) this.p(n).copy(hips)
      else this.p(n).copy(r.lp).applyQuaternion(this.q(CHAIN[i - 1])).add(this.p(CHAIN[i - 1]))
      this.set.add(n)
    })
  }

  /**
   * Leg IK: ankle target, knee pole direction, foot frame (toe direction and sole up).
   * toeBend bends the toes up (+) or down (radians).
   */
  solveLeg(side: Side, ankle: THREE.Vector3, pole: THREE.Vector3, toe: THREE.Vector3, up: THREE.Vector3, toeBend = 0) {
    const U = `${side}UpLeg`, L = `${side}Leg`, F = `${side}Foot`, T = `${side}Toes`
    const a = this.joint(U).clone()
    const ru = this.rest.get(U)!, rl = this.rest.get(L)!, rf = this.rest.get(F)!
    const k = this.reach(a, ankle, rl.lp.length() + rf.lp.length())
    if (k > 1) { this.stretched.set(L, k); this.stretched.set(F, k) }
    const s = twoBone(a, rl.lp.length() * k, rf.lp.length() * k, ankle, pole, this.bends.get(L))
    this.bends.set(L, s.bend)
    // Rest leg: straight down with the knee forward; hinge = dir x bend, as twoBone computes it.
    const restDir = rf.mp.clone().sub(ru.mp).normalize()
    const restHinge = new THREE.Vector3().crossVectors(restDir, new THREE.Vector3(0, 0, 1)).normalize()
    this.q(U).copy(frameRotation(s.mid.clone().sub(a), s.hinge, rl.mp.clone().sub(ru.mp), restHinge)).multiply(ru.mq)
    this.p(U).copy(a)
    this.q(L).copy(frameRotation(s.end.clone().sub(s.mid), s.hinge, rf.mp.clone().sub(rl.mp), restHinge)).multiply(rl.mq)
    this.p(L).copy(s.mid)
    // Foot: rest sole is flat (up = +Y) with the toes forward (+Z).
    this.q(F).copy(frameRotation(toe, up, new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0))).multiply(rf.mq)
    this.p(F).copy(s.end)
    this.set.add(U); this.set.add(L); this.set.add(F)
    const rt = this.rest.get(T)!
    this.q(T).copy(this.q(F)).multiply(rt.lq)
    if (toeBend) {
      // Bend about the foot's own sideways axis (model X carried by the foot rotation).
      const axis = new THREE.Vector3(1, 0, 0).applyQuaternion(this.q(F).clone().multiply(rf.mq.clone().invert()))
      this.q(T).premultiply(new THREE.Quaternion().setFromAxisAngle(axis, -toeBend))
    }
    this.p(T).copy(rt.lp).applyQuaternion(this.q(F)).add(this.p(F))
    this.set.add(T)
    return s
  }

  /**
   * Arm IK: wrist target, elbow pole direction. The hand follows the forearm, or takes the
   * given palm frame (fingers direction, palm normal) when grabbing.
   */
  solveArm(side: Side, wrist: THREE.Vector3, pole: THREE.Vector3, fingers?: THREE.Vector3, palm?: THREE.Vector3, curl = 0) {
    const S = `${side}Shoulder`, A = `${side}Arm`, F = `${side}ForeArm`, H = `${side}Hand`
    this.joint(S)
    const a = this.joint(A).clone()
    const ra = this.rest.get(A)!, rf = this.rest.get(F)!, rh = this.rest.get(H)!
    const k = this.reach(a, wrist, rf.lp.length() + rh.lp.length())
    if (k > 1) { this.stretched.set(F, k); this.stretched.set(H, k) }
    const s = twoBone(a, rf.lp.length() * k, rh.lp.length() * k, wrist, pole, this.bends.get(F))
    this.bends.set(F, s.bend)
    // Rest arms hang out sideways (T/A pose); the elbow bends with the point backwards (-Z).
    const restDir = rh.mp.clone().sub(ra.mp).normalize()
    const restHinge = new THREE.Vector3().crossVectors(restDir, new THREE.Vector3(0, 0, -1)).normalize()
    this.q(A).copy(frameRotation(s.mid.clone().sub(a), s.hinge, rf.mp.clone().sub(ra.mp), restHinge)).multiply(ra.mq)
    this.p(A).copy(a)
    this.q(F).copy(frameRotation(s.end.clone().sub(s.mid), s.hinge, rh.mp.clone().sub(rf.mp), restHinge)).multiply(rf.mq)
    this.p(F).copy(s.mid)
    this.set.add(A); this.set.add(F)
    if (fingers && palm) {
      // Rest hand: fingers along the arm (outward), palm facing down (-Y).
      const restFingers = new THREE.Vector3(side === 'Left' ? 1 : -1, 0, 0)
      this.q(H).copy(frameRotation(fingers, palm, restFingers, new THREE.Vector3(0, -1, 0))).multiply(rh.mq)
      this.p(H).copy(s.end)
      this.set.add(H)
    } else this.fk(H)
    if (curl) {
      for (const n of CURL) {
        const bn = `${side}Hand${n}`
        if (!this.bones.has(bn)) continue
        this.fk(bn)
        const r = this.rest.get(bn)!
        // Curl about the hand's palm-side axis: model -Z for the rest hand, carried by the hand.
        const carry = this.q(this.parentName(bn)).clone().multiply(this.rest.get(this.parentName(bn))!.mq.clone().invert())
        const axis = new THREE.Vector3(0, 0, side === 'Left' ? -1 : 1).applyQuaternion(carry)
        const k = n.startsWith('Thumb') ? 0.4 : 1
        this.q(bn).copy(this.q(this.parentName(bn))).multiply(r.lq).premultiply(new THREE.Quaternion().setFromAxisAngle(axis, curl * k))
      }
    }
    return s
  }

  /** Write the posed model-space transforms into the bones (local space). */
  commit() {
    const inv = new THREE.Quaternion()
    for (const b of this.order) {
      const n = b.name
      if (!this.set.has(n)) { if (n === 'Hips') this.setBody(this.rest.get('Hips')!.mp, []); else this.fk(n) }
      if (n === 'Hips') { b.position.copy(this.p(n)); b.quaternion.copy(this.q(n)); continue }
      const pn = this.parentName(n)
      b.quaternion.copy(inv.copy(this.q(pn)).invert().multiply(this.q(n)))
      b.position.copy(this.lp(n))
    }
  }
}
