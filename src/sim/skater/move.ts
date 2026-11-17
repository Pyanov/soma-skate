import type { Physics } from '../data.ts'
import { ceil, dot, len, madd, max, v3, type Vec3 } from '../math.ts'
import { raycast, sphereContacts, Surface, type Contact, type Park } from '../park/park.ts'

// Move a sphere through the park with substeps and push-out, sliding along what
// it touches. Returns the contact normals it met, with their surface classes.

export type Touch = { n: Vec3; cls: number; tri: number; depth: number }

const contacts: Contact[] = []

/**
 * With `ride` (the surface normal being ridden), contacts within rideCos of it are the
 * ground curving under the wheels: the sphere is pushed out but keeps its speed, so
 * concave transitions do not bleed speed. Everything else (walls, edges) slides.
 */
export function moveSphere(park: Park, pos: Vec3, vel: Vec3, dt: number, r: number, c: Physics['collision'], touches: Touch[], ride?: Vec3, rideCos = 0.866) {
  touches.length = 0
  const steps = max(1, ceil((len(vel) * dt) / c.maxSubstepMove))
  const h = dt / steps
  for (let s = 0; s < steps; s++) {
    pos.x += vel.x * h; pos.y += vel.y * h; pos.z += vel.z * h
    for (let it = 0; it < c.iterations; it++) {
      sphereContacts(park, pos, r, contacts)
      if (contacts.length === 0) break
      let pushed = false
      for (const k of contacts) {
        const dx = pos.x - k.px, dy = pos.y - k.py, dz = pos.z - k.pz
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz)
        if (d >= r) continue
        let n: Vec3
        if (d > 1e-9) n = v3(dx / d, dy / d, dz / d)
        else {
          const o = k.tri * 3
          n = v3(park.tn[o], park.tn[o + 1], park.tn[o + 2])
          if (dot(n, vel) > 0) n = v3(-n.x, -n.y, -n.z)
        }
        const push = r - d
        pos.x += n.x * push; pos.y += n.y * push; pos.z += n.z * push
        const vn = dot(vel, n)
        const ground = ride !== undefined && dot(n, ride) >= rideCos && rideable(park.cls[k.tri])
        if (vn < 0) {
          const sp = ground ? Math.sqrt(dot(vel, vel)) : 0
          vel.x -= n.x * vn; vel.y -= n.y * vn; vel.z -= n.z * vn
          if (ground) { const l = Math.sqrt(dot(vel, vel)); if (l > 1e-9) { vel.x *= sp / l; vel.y *= sp / l; vel.z *= sp / l } }
        }
        touches.push({ n, cls: park.cls[k.tri], tri: k.tri, depth: push })
        pushed = true
      }
      if (!pushed) break
    }
  }
}

export const rideable = (cls: number) => cls === Surface.flat || cls === Surface.bank || cls === Surface.steep || cls === Surface.vert || cls === Surface.stair

/** Look for ground along -up within reach. */
export function probeGround(park: Park, pos: Vec3, up: Vec3, reach: number) {
  const hit = raycast(park, pos, v3(-up.x, -up.y, -up.z), reach)
  if (!hit || !rideable(park.cls[hit.tri])) return null
  return hit
}

export const placeOnHit = (pos: Vec3, point: Vec3, n: Vec3, r: number) => {
  const p = madd(point, n, r)
  pos.x = p.x; pos.y = p.y; pos.z = p.z
}
