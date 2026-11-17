import * as THREE from 'three'
import type { Thing } from '../sim/thing.ts'

// The session marker (docs/mechanics/marker.md): a small flat chevron on the ground where the skater
// dropped it, pointing the way it sends you back, in the accent colour (docs/art-direction.md: one
// accent, International Orange #FF4F1F; flat, lit like paint with a faint accent glow for the night, no DOM). Drawn from Thing.marker alone, in play
// (headless shots leave it out).

const ACCENT = 0xff4f1f

/** A chevron flat on the ground pointing along +y: two bars meeting at the tip, 1.1 m wide. */
function chevron() {
  const w = 0.55, h = 0.5, t = 0.17   // half width, depth of the V, bar thickness (1.1 m across: it reads flat on the ground from the chase camera)
  const s = new THREE.Shape()
  s.moveTo(0, h / 2)
  s.lineTo(w, -h / 2)
  s.lineTo(w - t, -h / 2)
  s.lineTo(0, h / 2 - t * 1.4)
  s.lineTo(-w + t, -h / 2)
  s.lineTo(-w, -h / 2)
  s.closePath()
  return new THREE.ShapeGeometry(s)
}

export class SessionMarker {
  readonly group = new THREE.Group()
  private r: number

  /** r: the skater's radius (data physics.skater.radius): the marker's point is the wheels' centre, r up. */
  constructor(r: number) {
    this.r = r
    this.group.name = 'session-marker'
    // Lit like paint on the ground (it takes the sun, the shade and the lamps), with a faint accent glow so it can be found at night.
    const mark = new THREE.Mesh(chevron(), new THREE.MeshStandardMaterial({ color: ACCENT, roughness: 0.62, metalness: 0, emissive: ACCENT, emissiveIntensity: 0.1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }))
    mark.receiveShadow = true
    mark.renderOrder = 4
    this.group.add(mark)
    this.group.visible = false
  }

  /** Each frame: player 1's marker, on the ground at its spot, turned to its heading; hidden without one. */
  update(sk: Thing | undefined) {
    const m = sk?.marker
    this.group.visible = !!m
    if (!m) return
    this.group.position.set(m.x, m.y, m.z - this.r + 0.03)   // a hair above the ground
    this.group.rotation.set(0, 0, -m.heading)   // heading: clockwise from north (+y); three.js turns counterclockwise
  }
}
