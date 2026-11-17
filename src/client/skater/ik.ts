import * as THREE from 'three'

// Inverse kinematics helpers. Pure math on three.js vectors, no scene access.

const _m = new THREE.Matrix4(), _m0 = new THREE.Matrix4()
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3()

/** Orthonormal frame from a primary axis d and a secondary hint h (made perpendicular to d). */
function frame(d: THREE.Vector3, h: THREE.Vector3, out: THREE.Matrix4) {
  _a.copy(d).normalize()
  _b.copy(h).addScaledVector(_a, -h.dot(_a))
  if (_b.lengthSq() < 1e-10) _b.set(Math.abs(_a.y) < 0.9 ? 0 : 1, Math.abs(_a.y) < 0.9 ? 1 : 0, 0).addScaledVector(_a, -(Math.abs(_a.y) < 0.9 ? _a.y : _a.x))
  _b.normalize()
  _c.crossVectors(_a, _b)
  return out.makeBasis(_a, _b, _c)
}

/** Rotation taking frame (d0, h0) onto frame (d, h): R * d0 = d, and h0 lands in the (d, h) plane. */
export function frameRotation(d: THREE.Vector3, h: THREE.Vector3, d0: THREE.Vector3, h0: THREE.Vector3, out = new THREE.Quaternion()) {
  frame(d, h, _m)
  frame(d0, h0, _m0)
  _m.multiply(_m0.transpose())
  return out.setFromRotationMatrix(_m)
}

export type TwoBone = { mid: THREE.Vector3; end: THREE.Vector3; hinge: THREE.Vector3; reach: number; bend: THREE.Vector3 }

/**
 * Two-bone IK: root joint at a, bone lengths l1 and l2, target t, pole p (the direction the
 * middle joint should point, e.g. the knee forward). Returns the middle and end joint
 * positions and the hinge axis (dir x bend). Out-of-reach targets straighten the limb.
 */
export function twoBone(a: THREE.Vector3, l1: number, l2: number, t: THREE.Vector3, p: THREE.Vector3, prev?: THREE.Vector3, maxTurn = 0.5): TwoBone {
  const dir = new THREE.Vector3().subVectors(t, a)
  const raw = dir.length()
  const d = THREE.MathUtils.clamp(raw, Math.abs(l1 - l2) + 1e-4, l1 + l2 - 1e-4)
  if (raw < 1e-6) dir.set(0, -1, 0)
  dir.normalize()
  const bend = p.clone().addScaledVector(dir, -p.dot(dir))
  if (bend.lengthSq() < 1e-8) bend.set(0, 0, 1).addScaledVector(dir, -dir.z)
  bend.normalize()
  // Continuity (prev: the bend the last tick used): the side a joint bends to flips when the pole passes
  // along the reach, or through nothing as two poses' poles cross in a blend; the elbow or knee then jumped
  // across in one tick. From the last tick's side it turns toward the new one at most maxTurn radians.
  if (prev && prev.lengthSq() > 1e-8) {
    const pr = prev.clone().addScaledVector(dir, -prev.dot(dir))
    if (pr.lengthSq() > 1e-8) {
      pr.normalize()
      const ang = Math.atan2(new THREE.Vector3().crossVectors(pr, bend).dot(dir), pr.dot(bend))
      if (Math.abs(ang) > maxTurn) bend.copy(pr.applyAxisAngle(dir, Math.sign(ang) * maxTurn))
    }
  }
  const along = (l1 * l1 - l2 * l2 + d * d) / (2 * d)
  const h = Math.sqrt(Math.max(0, l1 * l1 - along * along))
  const mid = a.clone().addScaledVector(dir, along).addScaledVector(bend, h)
  const end = a.clone().addScaledVector(dir, d)
  const hinge = new THREE.Vector3().crossVectors(dir, bend).normalize()
  return { mid, end, hinge, reach: raw / (l1 + l2), bend }
}

/** Quaternion from yaw (about up, +Y model), pitch (about +X), lean (about -Z), degrees, applied yaw * pitch * lean. */
export function bodyRot(yaw: number, pitch: number, lean: number, out = new THREE.Quaternion()) {
  const D = Math.PI / 180
  const qy = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw * D)
  const qp = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), pitch * D)
  const ql = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -lean * D)
  return out.copy(qy).multiply(qp).multiply(ql)
}
