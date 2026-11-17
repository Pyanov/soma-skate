import * as THREE from 'three'
import { clamp01, fbm, hash2, img, mix, normalFromHeight, rgb, roughMap, smooth, textCoverage, texture } from './tex.ts'

// Deck bottom graphics, one per character (data/characters.json style.board.graphic), drawn into
// typed arrays like every texture here. The wear (bare maple at the tips, slide scrapes mid-board)
// is the same for every deck, so its normal and roughness maps are drawn once and shared; only
// the colours differ. Painters draw in px along the board in deck widths (nose +) and py across,
// as if looking at the bottom with the nose to the right.

type RGB = [number, number, number]
type Painter = (px: number, py: number, x: number, y: number) => RGB

const W = 1024, H = 256
const ASPECT = 0.81 / 0.21   // BOARD.length / BOARD.width (board.ts imports this module, so not imported back)
const lerp3 = (a: RGB, b: RGB, t: number): RGB => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)]
const c = (hex: number) => rgb(hex) as RGB

/** Text centred at (cx, cy), cap height h (deck widths); coverage 0..1. */
function text(s: string, px: number, py: number, cx: number, cy: number, h: number): number {
  const cw = h * 6 / 7
  const x0 = cx - (s.length * cw) / 2, y0 = cy - h / 2
  return textCoverage(s, (px - x0) / cw, (py - y0) / h)
}

const PAINTERS: Record<string, Painter> = {
  // The original: a sunset disc with stripes over a navy-to-dusk fade, a thin cream frame.
  sunset: (px, py) => {
    const navy = c(0x1b2440), dusk = c(0x3a2d5c), sun = c(0xf2633a), sun2 = c(0xffb547), cream = c(0xf3ead6)
    let col = lerp3(navy, dusk, smooth(-1.6, 1.6, px))
    const d = Math.hypot(px - 0.25, py) - 0.36
    const stripe = py > 0.02 && Math.sin((py - 0.02) * 60) > 0.15 - py * 1.6
    col = lerp3(col, lerp3(sun2, sun, clamp01((py + 0.36) / 0.72)), smooth(0.006, -0.006, d) * (stripe ? 0 : 1))
    const frame = Math.min(Math.abs(Math.abs(py) - 0.42), Math.abs(Math.abs(px) - (ASPECT / 2 - 0.11)) + (Math.abs(py) < 0.42 ? 0 : 1))
    return lerp3(col, cream, smooth(0.012, 0.004, frame) * (Math.abs(px) < ASPECT / 2 - 0.1 ? 1 : 0))
  },
  // The can: the Hella Fría label, a made-up Mission lager. Bare aluminium, a
  // deep teal band, the badge by the nose (a half sun going down behind two fog bars, on a horizon line),
  // HELLA along the band, FRIA and LAGER small either side.
  hellafria: (px, py) => {
    const alu = c(0xcfd3d4), teal = c(0x17504c), orange = c(0xec6a2c), cream = c(0xf4ecd9)
    let col = alu
    if (Math.abs(py) < 0.27) col = teal
    if (Math.abs(Math.abs(py) - 0.27) < 0.012) col = cream
    const sx = px - 1.3, sy = py - 0.12
    if (Math.hypot(sx, sy) < 0.25 && sy < 0) col = Math.abs(sy + 0.07) < 0.018 || Math.abs(sy + 0.14) < 0.016 ? teal : orange
    if (Math.abs(sy - 0.012) < 0.012 && Math.abs(sx) < 0.33) col = cream
    col = lerp3(col, cream, text('HELLA', px, py, -0.2, -0.02, 0.32))
    col = lerp3(col, teal, text('FRIA', px, py, -0.2, 0.39, 0.1))
    col = lerp3(col, teal, text('LAGER', px, py, -0.2, -0.39, 0.1))
    return col
  },
  // The blob: slime green, darker drips running in from the toe edge, bubbles, a little blob face.
  slime: (px, py, x) => {
    const slime = c(0x64d86e), dark = c(0x2e9a4c), pale = c(0xb8f5a8)
    let col = lerp3(slime, pale, smooth(0.1, 0.5, py) * 0.3)
    const band = Math.floor(x / 22)
    const len = 0.12 + hash2(band, 3, 7) * 0.45
    const wob = Math.sin(x * 0.29) * 0.02
    const drip = py < -0.5 + len + wob ? 1 : 0
    const tip = Math.hypot(((x % 22) - 11) / 9, (py - (-0.5 + len)) / 0.05)
    if (drip || (tip < 1 && hash2(band, 4, 7) > 0.3)) col = dark
    for (let k = 0; k < 9; k++) {
      const bx = (hash2(k, 1, 11) - 0.5) * ASPECT * 0.9, by = (hash2(k, 2, 11) - 0.3) * 0.7, br = 0.03 + hash2(k, 3, 11) * 0.06
      const d = Math.hypot(px - bx, py - by)
      if (d < br) col = lerp3(col, pale, d > br * 0.7 ? 0.9 : 0.35)
    }
    // A face in the middle: two eyes and a smile.
    for (const ex of [-0.12, 0.12]) { const d = Math.hypot(px - ex, py - 0.0); if (d < 0.075) col = d < 0.035 ? c(0x111111) : c(0xffffff) }
    const sm = Math.abs(Math.hypot(px, py + 0.02) - 0.2)
    if (sm < 0.016 && py > 0.07) col = dark
    return col
  },
  // The Eucalyptus Monster (its id kept for saved picks): Sutro Forest. Eucalyptus leaves drifting over dark
  // green, the monster's big three-toed footprints walking to the nose, SUTRO FOREST small by the tail.
  cookie: (px, py, x, y) => {
    const deep = c(0x1f3a30), deep2 = c(0x2a4a3d), sage = c(0x9cc4ab), sage2 = c(0x6f9a82), pale = c(0xd9dcc2)
    let col = lerp3(deep, deep2, fbm(x / 6, y / 12, W / 6, 3, 5))
    // Leaves: long thin crescents at random angles, a darker midrib.
    for (let k = 0; k < 22; k++) {
      const lx = (hash2(k, 1, 23) - 0.5) * ASPECT * 0.95, ly = (hash2(k, 2, 23) - 0.5) * 0.9, a = hash2(k, 3, 23) * Math.PI, L = 0.14 + hash2(k, 4, 23) * 0.08
      const u = ((px - lx) * Math.cos(a) + (py - ly) * Math.sin(a)) / L, v = (-(px - lx) * Math.sin(a) + (py - ly) * Math.cos(a)) / L
      const bend = v - 0.25 * u * u
      if (Math.abs(u) < 1 && Math.abs(bend) < 0.2 * (1 - u * u)) col = Math.abs(bend) < 0.025 ? sage2 : hash2(k, 5, 23) > 0.5 ? sage : sage2
    }
    // Footprints: a sole and three toes, left and right, toward the nose.
    for (let k = 0; k < 4; k++) {
      const fx = -0.95 + k * 0.62, fy = k % 2 ? 0.16 : -0.16
      if (Math.hypot((px - fx) / 0.15, (py - fy) / 0.1) < 1) col = pale
      for (const t of [-1, 0, 1]) if (Math.hypot(px - (fx + 0.2 - Math.abs(t) * 0.03), py - (fy + t * 0.075)) < 0.04) col = pale
    }
    col = lerp3(col, pale, text('SUTRO FOREST', px, py, -1.1, 0.41, 0.07))
    return col
  },
  // The mascot: a sports team deck, orange with a white band, navy pinstripes, the team name.
  team: (px, py) => {
    const orange = c(0xf08a1c), white = c(0xf7f4ee), navy = c(0x1c2b5a)
    let col = orange
    if (Math.abs(py) < 0.2) col = white
    if (Math.abs(Math.abs(py) - 0.24) < 0.018) col = navy
    col = lerp3(col, navy, text('SOMA FOG', px, py, -0.1, 0, 0.24))
    const ball = Math.hypot(px - 1.35, py)
    if (ball < 0.24) col = Math.abs(px - 1.35) < 0.015 || Math.abs(Math.hypot(px - 1.15, py) - 0.18) < 0.012 ? navy : white
    return col
  },
  // The vampire: a dark wooden coffin lid, a red moon with a bat across it.
  coffin: (px, py, x, y) => {
    const wood = c(0x2a1a14), wood2 = c(0x3d271c), lid = c(0x1a0f0b), moon = c(0xb3142a), cream = c(0xe9dcc6)
    let col = lerp3(wood, wood2, fbm(x / 2.5, y / 20, W / 2.5, 3, 31))
    // The lid: a coffin outline, widest a third of the way from the head (the nose).
    const t = (px + ASPECT / 2) / ASPECT
    const halfW = t < 0.7 ? mix(0.22, 0.44, t / 0.7) : mix(0.44, 0.3, (t - 0.7) / 0.3)
    const edge = Math.abs(Math.abs(py) - halfW)
    if (Math.abs(py) < halfW && Math.abs(px) < ASPECT / 2 - 0.14) col = lerp3(col, lid, 0.35)
    if (edge < 0.014 && Math.abs(px) < ASPECT / 2 - 0.14) col = cream
    const m = Math.hypot(px - 0.35, py)
    if (m < 0.3) col = moon
    // The bat: a body and two scalloped wings.
    const bx = px - 0.35, by = py + 0.02
    const body = Math.hypot(bx / 0.05, by / 0.1) < 1
    const span = Math.abs(bx) < 0.4 && by > -0.1 + Math.abs(bx) * 0.25 - 0.03 && by < 0.06 + Math.abs(bx) * 0.1 - 0.05 * Math.abs(Math.sin(Math.abs(bx) * 24))
    const ears = Math.abs(Math.abs(bx) - 0.03) < 0.015 && by > -0.14 && by < -0.08
    if (body || span || ears) col = c(0x0b0b0d)
    return col
  },
  // The skeleton: an X-ray of a skateboard on dark film, between the trucks, a skull by the nose.
  xray: (px, py) => {
    const film = c(0x0c1420), glow = c(0x9fe6ff), bone = c(0xdff6ff)
    let col = lerp3(film, c(0x18283c), smooth(0.6, 0.0, Math.hypot(px * 0.6, py)))
    // A small board seen through: its outline, two trucks as bones, four wheels as rings.
    const L = 0.62, Wd = 0.2
    const ox = Math.max(Math.abs(px) - (L - Wd), 0), r = Math.hypot(ox, Math.max(Math.abs(py) - 0.02, 0))
    if (Math.abs(r - Wd) < 0.012) col = lerp3(col, glow, 0.85)
    for (const tx of [-0.38, 0.38]) {
      if (Math.abs(px - tx) < 0.022 && Math.abs(py) < 0.27) col = bone
      for (const sgn of [-1, 1]) {
        if (Math.hypot(px - tx, py - sgn * 0.27) < 0.04) col = bone
        if (Math.abs(Math.hypot((px - tx) / 0.07, (py - sgn * 0.33) / 0.045) - 1) < 0.22) col = lerp3(col, glow, 0.85)
      }
    }
    // A skull by the nose.
    const sx = px - 1.42
    if (Math.hypot(sx / 0.16, py / 0.18) < 1 || (Math.abs(sx + 0.13) < 0.07 && Math.abs(py) < 0.09)) col = bone
    for (const ey of [-0.07, 0.07]) if (Math.hypot(sx - 0.02, py - ey) < 0.045) col = film
    if (Math.abs(sx + 0.13) < 0.05 && Math.abs(py) < 0.08 && Math.abs((py * 40) % 1) < 0.3) col = film
    // Film edge ticks and the label by the tail.
    if (Math.abs(Math.abs(py) - 0.44) < 0.02 && ((px * 12) % 1 + 1) % 1 < 0.35) col = lerp3(col, glow, 0.5)
    col = lerp3(col, glow, text('X-RAY', px, py, -1.4, 0, 0.14) * 0.9)
    return col
  },
  // The tech bro: a startup's swag deck, a gradient logo blob and a made-up company name.
  startup: (px, py) => {
    const bg = c(0xf4f4f7), ink = c(0x24223a), a = c(0x7a5cff), b = c(0x2fd6c5)
    let col = bg
    const blob = Math.hypot(px + 1.1, py)
    if (blob < 0.27) col = lerp3(a, b, clamp01((py + 0.27) / 0.54 + (px + 1.1) * 0.6))
    if (blob < 0.11) col = bg
    col = lerp3(col, ink, text('PIVOTLY', px, py, 0.3, -0.04, 0.28))
    col = lerp3(col, a, text('SERIES A', px, py, 0.3, 0.27, 0.08))
    if (Math.abs(py - 0.42) < 0.02) col = lerp3(a, b, clamp01((px + ASPECT / 2) / ASPECT))
    return col
  },
  // Karl the Fog: an orange deck (the sticker's), a Golden Gate tower lying along it, fog rolling over it, his name.
  fog: (px, py, x, y) => {
    const orange = c(0xf0582a), red = c(0xa8331f), fog = c(0xe9ebee), grey = c(0x8b9097)
    let col = lerp3(orange, c(0xe04a1e), smooth(-1.5, 1.8, px))
    // The tower: two legs along the board, cross struts, the top by the nose.
    const inTower = px > 0.1 && px < 1.65
    if (inTower && Math.abs(Math.abs(py) - 0.13) < 0.03) col = red
    for (const sx of [0.45, 0.85, 1.25, 1.6]) if (Math.abs(px - sx) < 0.025 && Math.abs(py) < 0.14) col = red
    // Fog rolling in from the tail over the foot of the tower, a soft lumpy front.
    const front = 0.35 + fbm(x / 36, y / 26, W / 36, 3, 7) * 0.5 + Math.sin(py * 9) * 0.06
    const f = smooth(front + 0.08, front - 0.08, px)
    col = lerp3(col, fog, f * 0.94)
    col = lerp3(col, grey, text('KARL', px, py, -1.0, -0.03, 0.3) * 0.95)
    col = lerp3(col, orange, text('THE FOG', px, py, -1.0, 0.3, 0.09))
    return col
  },
  // The burrito: black, a big foil-wrapped burrito along the middle with the open end by the nose, SUPER in orange.
  foil: (px, py, x, y) => {
    const black = c(0x16161a), foil = c(0xc9ced4), dark = c(0x7d838b), tort = c(0xe8cf95), orange = c(0xf0702a)
    let col = black
    const bx = px - 0.25
    const d = Math.hypot(Math.max(0, Math.abs(bx) - 0.75), py / 1.0) - 0.22
    if (d < 0 && bx < 0.82) {
      // Crinkled facets: each cell a shade of silver.
      const cell = hash2(Math.floor(x / 14 + (y % 28 > 14 ? 0.5 : 0)), Math.floor(y / 14), 9)
      col = lerp3(dark, foil, 0.45 + cell * 0.55)
    }
    if (d < 0 && bx >= 0.82) {
      col = tort
      if (Math.hypot(bx - 0.95, py) < 0.17) {
        const k = hash2(Math.floor(x / 5), Math.floor(y / 5), 4)
        col = k > 0.82 ? c(0x4a2a1a) : k > 0.68 ? c(0xd6402a) : k > 0.58 ? c(0x79b33a) : c(0xf4f1e6)
      }
    }
    col = lerp3(col, orange, text('SUPER', px, py, -1.08, 0.0, 0.22))
    col = lerp3(col, foil, text('MISSION ST', px, py, 0.35, 0.38, 0.08))
    return col
  },
  // The pigeon: black, orange footprints walking the length, bread crumbs, COO by the nose.
  crumbs: (px, py) => {
    const black = c(0x18181c), orange = c(0xf0702a), crumb = c(0xd8b47a), grey = c(0x8e959d)
    let col = black
    for (let k = 0; k < 9; k++) {
      const fx = -1.6 + k * 0.32, fy = k % 2 ? 0.14 : -0.14
      // A three-toed print pointing to the nose, and the back toe.
      for (const a of [-0.55, 0, 0.55]) {
        const along = (px - fx) * Math.cos(a) + (py - fy) * Math.sin(a), across = -(px - fx) * Math.sin(a) + (py - fy) * Math.cos(a)
        if (along > 0 && along < 0.1 && Math.abs(across) < 0.012) col = orange
      }
      if (px < fx && px > fx - 0.05 && Math.abs(py - fy) < 0.012) col = orange
    }
    for (let k = 0; k < 16; k++) {
      const bx = (hash2(k, 1, 19) - 0.5) * ASPECT * 0.9, by = (hash2(k, 2, 19) - 0.5) * 0.85
      if (Math.hypot(px - bx, py - by) < 0.018 + hash2(k, 3, 19) * 0.015) col = crumb
    }
    col = lerp3(col, orange, text('COO', px, py, 1.15, 0, 0.3))
    col = lerp3(col, grey, text('DOLORES PARK', px, py, -0.2, 0.4, 0.07))
    return col
  },

  // The sea lion (its id kept for saved picks): bay-blue with wave lines, three herring swimming for the nose, ORK! at the
  // tail, K-DOCK SEA LIONS (no pier name: that one is a shopping centre's mark).
  pier39: (px, py) => {
    const navy = c(0x173a5c), wave = c(0x2f86c8), cream = c(0xf2ece0), fish = c(0xc9d3da), orange = c(0xf0702a)
    let col = navy
    if (Math.abs(((py * 9 + Math.sin(px * 7) * 0.35) % 1 + 1) % 1 - 0.5) < 0.06) col = wave
    for (let k = 0; k < 3; k++) {
      const fx = 0.35 + k * 0.42, fy = (k - 1) * 0.22
      const u = (px - fx) / 0.16, v = (py - fy) / 0.06
      if (u * u + v * v < 1) col = fish
      if (u < -0.9 && u > -1.5 && Math.abs(v) < (-0.9 - u) * 1.3) col = fish   // the tail
      if (Math.hypot(u - 0.55, v + 0.2) < 0.14) col = navy   // the eye
    }
    col = lerp3(col, orange, text('ORK!', px, py, -1.3, 0, 0.26))
    col = lerp3(col, cream, text('K-DOCK SEA LIONS', px, py, -0.1, 0.4, 0.07))
    return col
  },
  // The Robotaxi: white with orange stripes down the rails, the lidar's dashed scan rings round a
  // sensor by the nose, ARRIVING NOW down the middle, NO DRIVER by the tail.
  robotaxi: (px, py) => {
    const white = c(0xf2f2ee), orange = c(0xe8642c), dark = c(0x26282c), teal = c(0x3d8a8f)
    let col = white
    if (Math.abs(Math.abs(py) - 0.36) < 0.035) col = orange
    const r = Math.hypot(px - 1.2, py), a = Math.atan2(py, px - 1.2)
    if (r < 0.08) col = dark
    else if (r < 0.34 && Math.abs(((r * 28) % 2) - 1) < 0.28 && Math.sin(a * 9) > 0) col = teal
    col = lerp3(col, dark, text('ARRIVING NOW', px, py, -0.3, 0, 0.15))
    col = lerp3(col, orange, text('NO DRIVER', px, py, -1.45, 0, 0.07))
    return col
  },
  // ---- the board shop's SF decks (data/boards.json), for anyone (+py is down, -py is up)
  // The Golden Gate: International Orange towers and cables over a fog bank at sunset.
  goldengate: (px, py, x, y) => {
    const sky0 = c(0x2a3a6a), sky1 = c(0xf2a25a), io = c(0xc0362c), fog = c(0xeceef0), water = c(0x1f3550)
    let col = lerp3(sky0, sky1, smooth(-0.5, 0.15, py))
    if (py > 0.16) col = water
    const fogEdge = 0.05 + fbm(x / 30, y / 18, W / 30, 3, 21) * 0.14
    col = lerp3(col, fog, smooth(fogEdge + 0.05, fogEdge - 0.03, Math.abs(py - 0.1)) * 0.9)
    for (const tx of [-0.95, 0.95]) {
      const inTower = py > -0.44 && py < 0.2 && Math.abs(Math.abs(px - tx) - 0.045) < 0.022
      const bar = Math.abs(px - tx) < 0.07 && [-0.4, -0.22, -0.05].some((b) => Math.abs(py - b) < 0.015)
      if (inTower || bar) col = io
    }
    // Main cable: a sag between the towers, down to the anchors at the ends; the road deck.
    const sag = Math.abs(px) < 0.95 ? -0.42 + 0.34 * (1 - (px / 0.95) ** 2) : -0.42 + (Math.abs(px) - 0.95) * 0.45
    if (Math.abs(py - sag) < 0.012 && py < 0.07) col = io
    if (Math.abs(py - 0.07) < 0.016) col = io
    for (let k = -18; k <= 18; k++) { const hx = k * 0.1; const top = Math.abs(hx) < 0.95 ? -0.42 + 0.34 * (1 - (hx / 0.95) ** 2) : -0.42 + (Math.abs(hx) - 0.95) * 0.45; if (Math.abs(px - hx) < 0.004 && py > top && py < 0.07) col = io }
    col = lerp3(col, fog, text('GOLDEN GATE', px, py, 0, 0.36, 0.09))
    return col
  },
  // A Powell St cable car: red and cream, gold trim, climbing a hill.
  cablecar: (px, py) => {
    const sky = c(0x9fc8e8), hill = c(0x6f7a85), red = c(0xb22a2a), cream = c(0xefe2c0), gold = c(0xd9a83a), dark = c(0x2a2420), glass = c(0x3c5a70)
    const slope = 0.32 - px * 0.08
    let col = py > slope ? hill : sky
    if (Math.abs(py - slope) < 0.012) col = dark
    // The car, tilted with the hill.
    const u = px + (py - 0.0) * 0.08, v = py + px * 0.08
    if (Math.abs(u) < 0.95 && v > -0.3 && v < 0.24) {
      col = v < -0.18 ? cream : v < 0.12 ? red : cream
      if (Math.abs(v + 0.18) < 0.012 || Math.abs(v - 0.12) < 0.012) col = gold
      const wx = ((u + 0.95) % 0.27) / 0.27
      if (v > -0.12 && v < 0.06 && wx > 0.15 && wx < 0.85) col = glass
      if (Math.abs(u) > 0.9) col = dark
    }
    if (Math.abs(u) < 1.0 && v > -0.38 && v < -0.3) col = dark
    for (const wx of [-0.6, 0.6]) if (Math.hypot(u - wx, v - 0.28) < 0.06) col = dark
    col = lerp3(col, cream, text('POWELL ST', px, py, 0.2, 0.43, 0.08))
    return col
  },
  // A burrito cut in half: tortilla rings round rice, beans, salsa and guac, on taqueria yellow.
  burrito: (px, py, x, y) => {
    const yellow = c(0xf2c230), red = c(0xc8372d), tort = c(0xe8cf95), toast = c(0xb0803e), rice = c(0xf4f1e6), bean = c(0x4a2a1a), guac = c(0x79b33a), salsa = c(0xd6402a)
    let col = yellow
    if (Math.abs(py) > 0.38) col = red
    for (const cx of [-1.25, 1.25]) {
      const d = Math.hypot((px - cx) / 1.0, py / 0.95)
      if (d < 0.34) {
        const ring = d > 0.27 ? (Math.floor(d * 120) % 3 === 0 ? toast : tort) : null
        if (ring) col = ring
        else {
          const k = hash2(Math.floor(x / 6), Math.floor(y / 6), 9)
          col = k > 0.84 ? bean : k > 0.72 ? salsa : k > 0.62 ? guac : rice
        }
      }
    }
    col = lerp3(col, red, text('SUPER', px, py, 0, -0.02, 0.24))
    col = lerp3(col, yellow, text('MISSION ST', px, py, 0, 0.44, 0.07))
    return col
  },
  // A Muni map: the rail lines in their colours, stations, the logo.
  muni: (px, py) => {
    const paper = c(0xf4f2ec), ink = c(0x24262a), muni = c(0xd8462c)
    let col = paper
    const lines: [RGB, (x: number) => number][] = [
      [c(0xe2a32e), (x) => -0.3 + x * 0.05],                       // J
      [c(0x5c8fd6), (x) => -0.12 + Math.sin(x * 1.4) * 0.08],      // K
      [c(0x8e3fb0), (x) => 0.02 + x * -0.06],                      // L
      [c(0x2e9e6a), (x) => 0.18 + Math.sin(x * 2 + 1) * 0.06],     // M
      [c(0xd8462c), (x) => 0.32 - x * 0.04],                       // N
    ]
    for (const [lc, f] of lines) {
      const yl = f(px)
      if (Math.abs(py - yl) < 0.018 && Math.abs(px) < 1.6) col = lc
      for (let k = -6; k <= 6; k++) { const sx = k * 0.26; if (Math.hypot(px - sx, py - f(sx)) < 0.028 && Math.abs(sx) < 1.6) col = Math.hypot(px - sx, py - f(sx)) < 0.016 ? paper : ink }
    }
    col = lerp3(col, muni, text('MUNI', px, py, 1.45, -0.42, 0.1))
    col = lerp3(col, ink, text('MARKET ST SUBWAY', px, py, 0.6, 0.43, 0.06))
    return col
  },
  // "KARL WAS HERE": a fog cloud tag on grey concrete.
  karl: (px, py, x, y) => {
    const con = c(0x8a8c90), con2 = c(0x6f7176), white = c(0xf0f1f2), teal = c(0x2aa39a), ink = c(0x1e1f22)
    let col = lerp3(con2, con, fbm(x / 14, y / 14, W / 14, 3, 5))
    // A puffy cloud with shades.
    let cloud = false
    for (const [cx, cy, r] of [[-1.1, -0.02, 0.2], [-0.92, -0.14, 0.16], [-1.28, -0.12, 0.14], [-0.95, 0.12, 0.15], [-1.25, 0.12, 0.14]]) if (Math.hypot(px - cx, py - cy) < r) cloud = true
    if (cloud) col = white
    for (const sx of [-1.18, -1.02]) if (Math.hypot((px - sx) / 1.4, py + 0.02) < 0.045) col = ink
    if (Math.abs(py + 0.02) < 0.008 && px > -1.14 && px < -1.06) col = ink
    const wob = Math.sin(px * 9) * 0.02
    col = lerp3(col, teal, text('KARL WAS', px, py + wob, 0.45, -0.13, 0.22))
    col = lerp3(col, white, text('HERE', px, py - wob, 0.45, 0.18, 0.22))
    return col
  },
  // The Painted Ladies: a row of pastel Victorians, downtown behind, the park in front.
  victorians: (px, py) => {
    const sky = c(0xa8cdea), city = c(0x8a97a8), grass = c(0x5aa04a), white = c(0xf6f2ea), dark = c(0x2a2a2e)
    const pastel = [c(0xf2b8c6), c(0xb8d8c8), c(0xf2dca0), c(0xb8c8f0), c(0xe8c0e8), c(0xf6cfa8), c(0xc0e0f0)]
    let col = sky
    // Downtown skyline far behind.
    const bx = Math.floor((px + 2) / 0.12), bh = -0.12 - hash2(bx, 1, 33) * 0.22
    if (py > bh && py < 0.0) col = city
    if (py > 0.26) col = grass
    // The houses: each 0.42 wide, a gable roof, bay windows, a door.
    const k = Math.floor((px + 1.68) / 0.42), lx = ((px + 1.68) % 0.42 + 0.42) % 0.42 - 0.21
    if (k >= 0 && k < 8) {
      const roof = -0.16 - (0.12 - Math.abs(lx) * 0.6)
      if (py > roof && py < 0.26 && Math.abs(lx) < 0.19) {
        col = pastel[k % pastel.length]
        if (Math.abs(py - roof) < 0.014) col = white
        if (Math.abs(lx) > 0.175) col = white
        for (const wy of [-0.06, 0.08]) if (Math.abs(py - wy) < 0.04 && Math.abs(lx + 0.06) < 0.05) col = Math.abs(py - wy) < 0.03 && Math.abs(lx + 0.06) < 0.04 ? dark : white
        if (lx > 0.04 && lx < 0.12 && py > 0.12) col = dark
      }
    }
    col = lerp3(col, white, text('PAINTED LADIES', px, py, 0, 0.4, 0.07))
    return col
  },
}

type Wear = { wear: Float32Array; grain: Float32Array; normal: THREE.Texture; rough: THREE.Texture }
let wearCache: Wear | null = null
function wearMaps(): Wear {
  if (wearCache) return wearCache
  const wear = new Float32Array(W * H), grain = new Float32Array(W * H), h = new Float32Array(W * H), r = new Float32Array(W * H)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const u = x / (W - 1), py = y / (H - 1) - 0.5
    // Wear where a deck really wears: the nose and tail scuffed (patchy, worst at the very tips)
    // and a thin worn rim along the edges; the graphic in the middle stays clean.
    const n1 = fbm(x / 18, y / 18, W / 18, 4, 21), n2 = fbm(x / 9, y / 9, W / 9, 3, 33)
    const tipWear = smooth(0.87, 0.985, Math.abs(u - 0.5) * 2 + (n1 - 0.5) * 0.1) * smooth(0.3, 0.55, n2)
    const edgeWear = smooth(0.455, 0.5, Math.abs(py) + (n1 - 0.5) * 0.03) * smooth(0.45, 0.7, n2) * 0.7
    const i = y * W + x
    wear[i] = clamp01(Math.max(tipWear, edgeWear))
    grain[i] = 0.85 + fbm(x / 3, y / 40, W / 3, 3, 13) * 0.25
    h[i] = -wear[i] * 0.5 + n1 * 0.05
    r[i] = mix(0.42, 0.78, wear[i]) + n1 * 0.06
  }
  wearCache = { wear, grain, normal: texture(normalFromHeight(h, W, H, 3), false, false), rough: texture(roughMap(r, W, H), false, false) }
  return wearCache
}

const deckCache = new Map<string, { map: THREE.Texture; normal: THREE.Texture; rough: THREE.Texture }>()

/** The bottom graphic's maps for a design (cached; the wear maps are shared by all decks). */
export function deckMaps(graphic: string) {
  const hit = deckCache.get(graphic)
  if (hit) return hit
  const paint = PAINTERS[graphic] ?? PAINTERS.sunset
  const Wr = wearMaps()
  const maple = c(0xcfa877)
  const a = img(W, H)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const px = (x / (W - 1) - 0.5) * ASPECT, py = y / (H - 1) - 0.5
    const i = y * W + x
    // Mirrored across the long axis: the bottom is seen from below, so this way the text reads right.
    const col = lerp3(paint(px, -py, x, H - 1 - y), [maple[0] * Wr.grain[i], maple[1] * Wr.grain[i], maple[2] * Wr.grain[i]], Wr.wear[i])
    a.d.set([col[0], col[1], col[2], 1], i * 4)
  }
  const out = { map: texture(a, true, false), normal: Wr.normal, rough: Wr.rough }
  deckCache.set(graphic, out)
  return out
}

export const DECK_GRAPHICS = Object.keys(PAINTERS)
