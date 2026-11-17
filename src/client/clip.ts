import type { Spectators, Landed } from './spectators.ts'
import type { NpcViews } from './npcs.ts'
import type { Fx } from './fx.ts'
import { simPeds, type Crowd, type SimPedestrian } from './crowd.ts'
import type { Dogs } from './dogs.ts'
import { runReplay, type Replay } from '../sim/replay.ts'
import type { Park } from '../sim/park/park.ts'
import type { ParkSource } from '../sim/park/source.ts'
import type { GameData } from '../sim/data.ts'
import { player2, session, skater, type Sim, type SimEvent } from '../sim/sim.ts'
import { SkaterView } from './skater/view.ts'
import { chain, decodeLine, VoiceLines, type VoicesData } from './voicelines.ts'
import type { Vignettes } from './vignettes.ts'
import { isOver2p, playerOf, Results2p, TagPaint, TWO_PLAYER_DEFAULTS, twoPlayerPanel, twoPlayerPops } from './twoplayer.ts'
import * as THREE from 'three'
import type { Hud } from './ui.ts'
import { LofiStation } from './lofi.ts'
import { camSubject, DEFAULT_POP, npcPopTags, racerTags, type NpcCombo } from './tags.ts'
import { PunkStation } from './punk.ts'
import { HyphyStation } from './hyphy.ts'
import type { Thing } from '../sim/thing.ts'
import { drivenBy } from '../sim/game/vehicles.ts'
import { Cam, carBoxes, type CamMode, type CamPose } from './camera.ts'
import { LAYERS, type Layer, type Renderer, type Style } from './render.ts'
import { Sound } from './sound.ts'
import type { Pigeons } from './life.ts'
import { carPoses, type CarPose, type Traffic } from './traffic.ts'
import { BestCombo, besideCard, introPath, loopIndex, timedRunOver, type PresentData } from './present.ts'
import { keyRows, School, SchoolAsk, SchoolCard, type SchoolData } from './school.ts'
import { inHalf, SPLIT_DEFAULTS, SplitScreen, type SplitData } from './split.ts'
import { Director, stretchTimes, type MomentsData, type SlowmoLevel } from './director.ts'

// Headless clip API for `./skate clip`: re-run a replay, then render any tick's frame
// and the whole stretch's sound offline (the game's own Sound, on an
// OfflineAudioContext). Node pipes the frames and the WAV through ffmpeg.

type Loaded = { vans: (Thing | null)[]; things: Thing[]; sessions: Thing[]; ticks: number[]; cams: CamPose[]; events: { i: number; e: SimEvent }[]; data: GameData; hud: boolean; cars: CarPose[][]; modeCars: Thing[][]; npcs: Thing[][]; peds: SimPedestrian[][]; orbit: number[] | null
  // The trick director's time scale per frame (1: none) and its sound mapping (director.ts).
  speeds: number[]; director: Director | null
  // The vignettes' lines said over the replay (frame, line id), their loops' levels as they change and the tip jar's
  // coins, from a dry run of the vignettes when it loads.
  vigLines: { i: number; id: string }[]; vigLoops: { i: number; id: string; kind: string; level: number }[]; vigTips: { i: number; dist: number }[]
  // --intro: the Tour level intro before the run (at its levelStart frame); --results: the results card with the best combo looping.
  intro: { i: number; path: (u: number) => CamPose; card: { name: string; goals: string[]; skip: string } } | null
  loop: { i: number[]; cams: CamPose[]; name: string; points: number; over: SimEvent } | null
  shown: { intro: boolean; results: boolean }
  // --school: Karl's card per frame (the lesson, its hint, its done line), where the lessons were done and where it graduated.
  school: { states: ({ i: number; hint: boolean; done: boolean } | null)[]; marks: number[]; gradAt: number } | null
  // --split npc: player 2's half (a park NPC standing in): its camera, its Thing and its HUD's events per frame.
  split: { cams: (CamPose | null)[]; things: (Thing | null)[]; events: { i: number; e: SimEvent }[]; sessions: (Thing | null)[]; real: boolean } | null
  // --campath: the harness passes a keyframed camera for every frame; the city's sun shadows follow where it looks.
  camPath: boolean }
/** Skate School for clips: its data and the default keys (a clip has no player rebinds). */
export type ClipSchool = { d: SchoolData; keysFor: (action: string) => string[]; padFor: (action: string) => number[] }

export function clipApi(r: Renderer, park: Park, src: ParkSource, pigeons?: Pigeons, traffic?: Traffic, ui?: Hud, spectators?: Spectators | null, npcViews?: NpcViews, crowd?: Crowd | null, dogs?: Dogs | null, fx?: Fx | null, pres?: PresentData, school?: ClipSchool, splitData: SplitData = SPLIT_DEFAULTS) {
  let L: Loaded | null = null
  let splitView: SplitScreen | null = null
  // Captions for the spoken lines, as the game shows them (the clip's sound says them too).
  let voices: VoiceLines | null = null, caption: { who: string; text: string; from: number; until: number } | null = null
  let voicesData: VoicesData | null = null
  const vgOf = () => (crowd?.vignettes ?? null) as Vignettes | null   // the vignettes (crowd.ts carries them)
  void fetch('data/voices.json').then((x) => x.json()).then((d: VoicesData) => { voices = VoiceLines.rulesOnly(d); voicesData = d }).catch(() => {})
  // Two players: player 2's skater view (prepare2p builds it), Graffiti's tags, the results card; the frame being drawn.
  let p2view: SkaterView | null = null, tagPaint: TagPaint | null = null, results2p: Results2p | null = null, frameAt = 0
  let schoolCard: SchoolCard | null = null, schoolAsk: SchoolAsk | null = null
  let lastFrame = -1
  let hudAt = -1
  let splitHudAt = -1
  let fxAt = -1   // the frame the effects last advanced to
  let moments: MomentsData | null = null
  void fetch('data/moments.json').then((x) => x.json()).then((d: MomentsData) => { moments = d }).catch(() => {})
  return {
    load(replay: Replay, o: { style?: Style; layers?: Layer[]; cam?: CamMode; character?: string; hud?: boolean; weather?: string; orbit?: number[]; intro?: boolean; results?: boolean; school?: boolean; split?: 'npc'; character2?: string; slowmo?: SlowmoLevel; trickCams?: boolean; camPath?: boolean }) {
      if (o.character) { const [id, outfit] = o.character.split(':'); r.skater.setCharacter(id, outfit) }
      voices?.reset(); caption = null
      const cam = new Cam()
      let camWho = -1
      cam.park = park
      cam.mode = o.cam && o.cam !== 'orbit' ? o.cam : 'chase'
      // --school: a School watching the replay (it never sends commands: the teleports are in the replay).
      let watch: School | null = null, gradAt = -1
      const sStates: NonNullable<Loaded['school']>['states'] = [], sMarks: number[] = []
      // --split npc: player 2's camera follows a park NPC (the replay has to have some riding).
      // Split screen: the sim's player 2 when the replay has one, or (--split npc) a park NPC standing in.
      const makeSplit = () => { if (ui && !splitView) splitView = new SplitScreen(splitData, ui, park); if (splitView) splitView.npc = o.split === 'npc' }
      if (o.split) makeSplit()
      const s2: NonNullable<Loaded['split']> = { cams: [], things: [], events: [], sessions: [], real: false }
      if (splitView) { splitView.standIn = -1; splitView.cam.prev = splitView.cam.pose = null }
      const vans: (Thing | null)[] = []   // the vehicle the skater drives, each tick (the engine's sound)
      const things: Thing[] = [], sessions: Thing[] = [], ticks: number[] = [], cams: CamPose[] = [], events: Loaded['events'] = [], cars: CarPose[][] = [], modeCars: Thing[][] = [], npcs: Thing[][] = [], peds: SimPedestrian[][] = [], speeds: number[] = []
      // The trick director as in the game (Settings > Camera: Slow motion big moments, Trick cameras on), unless asked otherwise.
      let dir: Director | null = null
      const res = runReplay(replay, park, {
        onTick: (sim, ev) => {
          const t = structuredClone(skater(sim))
          for (const e of ev) {
            if (e.t === 'land') cam.kick('land', Math.min(2, Math.max(0, e.peakZ - t.pos.z) / 1.5))
            if (e.t === 'bail') cam.kick('bail')
            if (e.t === 'levelGoal' || e.t === 'goalComplete' || e.t === 'goal') cam.punch()   // a goal: the camera's punch-in, as in the game
          }
          const who = camSubject(sim.world.things, t, session(sim))
          cam.obstacles = carBoxes(sim.world.things, sim.data.traffic, who.pos)
          cam.step(who === t ? t : structuredClone(who), things.length === 0 || who.id !== camWho); camWho = who.id
          if (traffic) cars.push(carPoses(sim.world.things))
          npcs.push(sim.world.things.filter((x) => x.kind === 'npc' && x.alive).map((x) => structuredClone(x)))
          // The cars a game's HUD reads (Muni's streetcar, the robotaxis), so the clip's HUD matches the game's.
          const ms = session(sim)
          modeCars.push(sim.world.things.filter((x) => x.id === ms.muniTram || x.id === ms.escapeTaxi || x.id === ms.escapeBackup).map((x) => structuredClone(x)))
          peds.push(simPeds(sim.world.things, sim.world.tick))
          if (moments && !o.orbit && !dir) dir = new Director(park, moments, sim.data.physics)
          if (dir) {
            dir.level = o.slowmo ?? 'big'; dir.cameras = o.trickCams ?? true
            const follows = cam.mode === 'chase' && who === t
            dir.step(t, ev.filter((e) => playerOf(e) === 1), sim.world.tick, follows ? cam.pose : null, follows ? cam : null, dir.allowed(session(sim).game, !!player2(sim)))
          }
          const cp = dir?.pose ?? cam.pose!
          speeds.push(dir ? dir.speed(sim.world.tick) : 1)
          { const c = drivenBy(sim, skater(sim)); vans.push(c ? structuredClone(c) : null) }
          things.push(t); sessions.push(structuredClone(session(sim))); ticks.push(sim.world.tick); cams.push({ ...cp, pos: { ...cp.pos }, look: { ...cp.look } })
          for (const e of ev) events.push({ i: things.length - 1, e })
          const two = player2(sim)
          if (two && !splitView) makeSplit()
          if (splitView && (o.split || two || s2.real)) {
            // Frames before player 2 joined have no second half yet.
            while (s2.cams.length < things.length - 1) { s2.cams.push(null); s2.things.push(null); s2.sessions.push(null) }
            s2.real ||= !!two
            for (const e of splitView.tick(sim.world.things, ev, sim.data.traffic, null)) s2.events.push({ i: things.length - 1, e })
            for (const e of ev) if (playerOf(e) === 2) s2.events.push({ i: things.length - 1, e })   // the real player 2's own
            s2.sessions.push(two ? structuredClone(two.s) : null)
            const p = splitView.cam.pose
            s2.cams.push(splitView.thing && p ? { ...p, pos: { ...p.pos }, look: { ...p.look } } : null); s2.things.push(splitView.thing)
          }
          if (o.school && school) {
            if (!watch) { watch = new School(school.d, sim.data); watch.start() }
            for (const sg of watch.tick(ev, t)) { if (sg.kind === 'done') sMarks.push(things.length - 1); if (sg.kind === 'graduated' && gradAt < 0) gradAt = things.length - 1 }
            sStates.push(watch.active ? { i: watch.i, hint: watch.hinted, done: watch.celebrating } : null)
          }
        },
      })
      // The vignettes' lines: their reactions played over the frames once (events near them, skating through them).
      const vigLines: Loaded['vigLines'] = [], vigLoops: Loaded['vigLoops'] = [], vigTips: Loaded['vigTips'] = []
      const vg = vgOf()
      if (vg) {
        const { say, loop, tip } = vg
        let at = 0
        const levels = new Map<string, number>()
        vg.say = (id) => vigLines.push({ i: at, id })
        vg.tip = (dist) => vigTips.push({ i: at, dist })
        vg.loop = (id, kind, level) => { if (Math.abs(level - (levels.get(id) ?? 0)) > 0.02 || (level === 0 && (levels.get(id) ?? 0) > 0)) { levels.set(id, level); vigLoops.push({ i: at, id, kind, level }) } }
        vg.update(-1e6, null, new THREE.Vector3())
        let ej = 0
        for (let i = 0; i < things.length; i++) {
          at = i
          const t = things[i]
          for (; ej < events.length && events[ej].i <= i; ej++) if (events[ej].i === i && playerOf(events[ej].e) === 1) vg.event(events[ej].e, t.pos.x, t.pos.y)
          vg.update(ticks[i] / res.sim.data.physics.tickHz, { x: t.pos.x, y: t.pos.y, z: t.pos.z, speed: Math.hypot(t.vel.x, t.vel.y) }, new THREE.Vector3(cams[i].pos.x, cams[i].pos.y, cams[i].pos.z))
        }
        vg.say = say; vg.loop = loop; vg.tip = tip
        vg.update(-1e6, null, new THREE.Vector3())   // the frames start them over
      }
      L = { vans, things, sessions, ticks, cams, events, data: res.sim.data, hud: o.hud !== false && !!ui, cars, modeCars, npcs, peds, orbit: o.orbit ?? null, speeds, director: dir as Director | null, vigLines, vigLoops, vigTips, intro: null, loop: null, shown: { intro: false, results: false }, school: o.school && school ? { states: sStates, marks: sMarks, gradAt } : null, split: splitView && (o.split || s2.real) ? s2 : null, camPath: !!o.camPath }
      // A two-player game: each HUD's game panel, Graffiti's tags, player 2's skater, the results card.
      if (L.split?.real && ui && splitView) {
        const C = L, at = () => ({ world: { things: [C.things[frameAt], C.sessions[frameAt], C.split!.things[frameAt], C.split!.sessions[frameAt]].filter(Boolean) }, data: C.data, park } as unknown as Sim)
        ui.modePanel = () => twoPlayerPanel(at(), 1); splitView.hud.modePanel = () => twoPlayerPanel(at(), 2)
        if (o.character2) p2view?.setCharacter(...(o.character2.split(':') as [string, string?]))
      }
      tagPaint ??= new TagPaint(park, res.sim.data.gaps.gaps, splitData.twoPlayer ?? TWO_PLAYER_DEFAULTS)
      if (!tagPaint.group.parent) r.scene.add(tagPaint.group)
      results2p?.close()
      if (p2view) p2view.root.visible = false
      splitView?.setActive(false)   // each frame says (player 2 may join later)
      if (L.school && ui && !schoolCard) { const root = document.getElementById('ui')!; schoolCard = new SchoolCard(root); schoolAsk = new SchoolAsk(root) }
      schoolCard?.show(null); schoolAsk?.hide()
      if (o.intro && pres) {
        // The level intro: from the frame its level started, the flyover onto that frame's chase camera.
        const st = events.find(({ e }) => e.t === 'levelStart')
        const lv = st && st.e.t === 'levelStart' ? res.sim.data.tour.levels.find((x) => x.id === (st.e as Extract<SimEvent, { t: 'levelStart' }>).level) : undefined
        if (st && lv) {
          const c = new Cam(); c.park = park; c.step(things[st.i], true)
          L.intro = { i: st.i, path: introPath(lv, park, things[st.i], c.pose!, pres.intro), card: { name: lv.name, goals: lv.goals.map((g) => g.name), skip: 'Any key to skip' } }
        }
      }
      if (o.results && pres) {
        // The best combo up to the run's end, its frames and a three-quarter camera over them.
        const best = new BestCombo(), R = pres.replay, hz = res.sim.data.physics.tickHz
        const over = events.find(({ e }) => timedRunOver(e))
        for (const { e } of events) { if (over && e === over.e) break; best.event(e) }
        const b = best.best
        if (b && over) {
          const to = Math.min(b.to + R.tail, ticks[things.length - 1]), from = Math.max(b.from - R.lead, to - Math.round(R.maxSeconds * hz))
          const idx = ticks.map((t, i) => (t >= from - 60 && t <= to ? i : -1)).filter((i) => i >= 0)
          const qc = new Cam(); qc.park = park; qc.mode = 'quarter'
          const keep: number[] = [], qcams: CamPose[] = []
          idx.forEach((i, j) => { qc.obstacles = []; qc.step(things[i], j === 0); if (ticks[i] >= from) { keep.push(i); qcams.push({ ...qc.pose!, pos: { ...qc.pose!.pos }, look: { ...qc.pose!.look } }) } })
          L.loop = { i: keep, cams: qcams, name: b.name, points: b.points, over: over.e }
        }
      }
      lastFrame = -1
      hudAt = -1
      splitHudAt = -1
      if (pigeons) pigeons.group.visible = true
      if (spectators) spectators.group.visible = true
      if (npcViews) npcViews.group.visible = true
      if (crowd) crowd.group.visible = true
      if (dogs) dogs.group.visible = true
      if (fx) { fx.reset(); fxAt = -1 }
      if (traffic) traffic.group.visible = true   // the sim has no cars where there are no streets
      for (const l of LAYERS) r.setLayer(l, o.layers ? o.layers.includes(l) : l !== 'debug' && l !== 'hud' && l !== 'rails')
      // Clips carry the game's HUD (trick string, score, callouts, minimap) unless asked not to.
      document.body.classList.toggle('nohud', !(o.hud !== false && ui))
      document.body.classList.add('clip')
      const style = o.style ?? r.defaultStyle
      r.setWeather(o.weather ?? 'clear', true)
      r.setStyle(style)
      return { introSeconds: L.intro && pres ? pres.intro.seconds : 0, introAt: L.intro?.i ?? -1, results: !!L.loop, ticks: things.length, events: events.length, eventsList: events.map(({ i, e }) => ({ i, t: e.t, name: 'name' in e ? e.name : 'trick' in e ? e.trick : '', points: 'points' in e ? e.points : 0 })), speeds, moments: (L.director?.seen ?? []).map((m) => ({ kind: m.kind, at: ticks.indexOf(m.at), a0: m.a0, b1: m.b1, shot: m.shot })) }
    },

    /** Build player 2's skater view (before loading a two-player replay). */
    async prepare2p() {
      if (p2view) return
      p2view = await SkaterView.load()
      r.addSkater(p2view)
      p2view.root.visible = false
    },

    /**
     * Tick i's frame. A caller may also pass sub (0..1: between tick i and the next, drawn as the game's frame loop
     * draws it: the later tick's state, the positions eased from tick i, so slow motion has no repeated frames) and its
     * own camera; without them the frame is the clip's as it always was.
     */
    frame(i: number, sub: number | null = null, camera: CamPose | null = null) {
      if (!L) throw new Error('clip: load first')
      const k = Math.max(0, Math.min(L.things.length - 1, i))
      const k1 = sub === null ? k : Math.min(L.things.length - 1, k + 1), a = sub ?? 0, tt = k + a
      frameAt = k
      if (camera) r.setCamera(camera)   // before the NPCs and the crowd, which cull and face by it
      if (pigeons) {
        const t = L.things[k]
        const dt = lastFrame < 0 ? 0 : Math.max(0, (tt - lastFrame) / L.data.physics.tickHz)
        pigeons.update(dt, t.pos, Math.hypot(t.vel.x, t.vel.y))
        if (dogs) { dogs.setStyle(r.style); dogs.update(dt, { x: t.pos.x, y: t.pos.y, z: t.pos.z, vx: t.vel.x, vy: t.vel.y }, null) }
        traffic?.update(L.cars[k1] ?? [], sub === null ? 0 : a, L.data.physics.tickHz, dt, camera?.pos ?? L.cams[k]?.pos)
        lastFrame = tt
      }
      if (L.hud && ui) {
        const ms = (k / L.data.physics.tickHz) * 1000
        // A clip cut from the middle of a run (--from) starts clean: earlier events would all pop at once.
        if (hudAt < 0) hudAt = k - 1
        for (const { i: ei, e } of L.events) if (ei > hudAt && ei <= k && playerOf(e) === 1) {
          ui.event(e, ms)
          const hz = L.data.physics.tickHz, c = voices?.captionFor(e, ei / hz)
          if (c) caption = { who: c.who, text: c.text, from: Math.round(c.at * hz), until: Math.round((c.at + c.seconds + 0.6) * hz) }
          // The two-player games' moments, in the halves they are about; the results card at the end.
          for (const q of twoPlayerPops(e)) { if (q.player !== 2) ui.popUp(q.title, q.sub, q.kind); if (q.player !== 1) splitView?.hud.popUp(q.title, q.sub, q.kind) }
          if (isOver2p(e)) { results2p ??= new Results2p(splitData.twoPlayer ?? TWO_PLAYER_DEFAULTS); results2p.show(e, [r.skater.characterName, p2view?.characterName ?? 'Player 2'], L.sessions[k].horseWord ?? 'HORSE') }
        }
        hudAt = k
        if (caption && k > caption.until) caption = null
        // A vignette's line spoken now (about 3.5 s of caption from its frame) over the rules' ones.
        const vl = [...L.vigLines].reverse().find((x) => x.i <= k && k - x.i < 3.5 * L!.data.physics.tickHz)
        const line = vl && voicesData ? (vgOf()?.lineText(vl.id) ?? null) : null
        if (line && voicesData) ui.setCaption(voicesData.voices[line.voice]?.name ?? line.voice, line.text)
        else if (caption && k >= caption.from) ui.setCaption(caption.who, caption.text); else ui.setCaption(null)
        const fake = { world: { things: [L.things[k], L.sessions[k], ...(L.modeCars[k] ?? [])], tick: L.ticks[k] }, data: L.data, park } as unknown as Sim
        const dir = r.camera.getWorldDirection(new THREE.Vector3())
        ui.frame(fake, ms, Math.atan2(dir.y, dir.x))
        if (L.school && school && schoolCard && schoolAsk) {
          // Karl's card at this frame; from graduation, the graduate card.
          const st = L.school.states[k], Ls = st ? school.d.lessons[st.i] : null
          schoolCard.show(st && Ls ? { index: st.i, of: school.d.lessons.length, title: Ls.title, say: Ls.say, keys: keyRows(Ls, school.keysFor, school.padFor), hint: st.hint ? Ls.hint : undefined, done: st.done ? Ls.done : undefined, foot: '<kbd>R</kbd> start over <kbd>Esc</kbd> skip' } : null)
          const g = school.d.graduate
          if (L.school.gradAt >= 0 && k >= L.school.gradAt) { if (!schoolAsk.isOpen) schoolAsk.show({ tag: 'SKATE SCHOOL', title: g.title, line: g.line, art: g.sticker, earned: 'STICKER EARNED: GRADUATE', options: [g.tour, g.modes, g.stay].map((label) => ({ label, onPick: () => {} })) }) }
          else if (schoolAsk.isOpen) schoolAsk.hide()
        }
      }
      r.skater.tick = L.ticks[k1]
      if (npcViews) {
        // The NPC skaters at this frame (and the one before, for nothing to snap): every view built now.
        const now = L.npcs[k1] ?? [], before = new Map((L.npcs[k1 === k ? k - 1 : k] ?? []).map((t) => [t.id, t]))
        npcViews.setStyle(r.style)
        npcViews.you = L.things[k]
        npcViews.sync(now.map((cur) => ({ cur, prev: before.get(cur.id) })), L.ticks[k1], sub === null ? 1 : a, L.data, L.split?.cams[k] ? null : r.camera, true)
      }
      if (spectators) {
        // The last combo landed at or before this frame, from where the skater was then.
        let landed: Landed | null = null
        for (const { i: ei, e } of L.events) if (ei <= k && e.t === 'comboLanded') { const p = L.things[ei].pos; landed = { tick: e.tick, points: e.points, x: p.x, y: p.y, z: p.z } }
        spectators.setStyle(r.style)
        spectators.update(L.ticks[k], L.things[k].pos, landed)
      }
      // The last pickup at or before this frame (the events carry what the snapshot does not).
      r.skater.pickupTick = -1
      for (const { i, e } of L.events) { if (i > k) break; if (e.t === 'burrito') r.skater.pickupTick = L.ticks[i] }
      r.setBurritos(L.data.run.burritoParks.includes(park.name) ? L.data.run.burritos : [], L.sessions[k].burritos ?? [], k / L.data.physics.tickHz)
      if (sub === null) r.setSkater(L.things[k], L.data, 0)
      else {
        const p = L.things[k], c = L.things[k1], lp = (u: { x: number; y: number; z: number }, v: { x: number; y: number; z: number }) => ({ x: u.x + (v.x - u.x) * a, y: u.y + (v.y - u.y) * a, z: u.z + (v.z - u.z) * a })
        r.setSkater({ ...c, pos: lp(p.pos, c.pos), fwd: lp(p.fwd, c.fwd), up: lp(p.up, c.up) }, L.data, a)
      }
      if (camera && L.camPath) r.shadowAt(camera.look)   // the shadowed square where the path looks, not on the skater
      const p2t = L.split?.real ? L.split.things[k] : null
      if (p2view) { p2view.root.visible = !!p2t && r.isVisible('skater'); if (p2t) { p2view.tick = L.ticks[k]; p2view.update(p2t, L.data, 0) } }
      tagPaint?.update(L.sessions[k].game === 'graffiti2p' || L.sessions[k].game === 'graffiti' ? L.sessions[k].tags : undefined)
      // Between ticks (sub): the game's camera eased from tick k's pose to the next, as the frame loop's Cam.at does.
      const gameCam = (): CamPose => { const c0 = L!.cams[k], c1 = L!.cams[k1]; if (sub === null || !c1 || k1 === k) return c0; const lp = (p: { x: number; y: number; z: number }, q: { x: number; y: number; z: number }) => ({ x: p.x + (q.x - p.x) * a, y: p.y + (q.y - p.y) * a, z: p.z + (q.z - p.z) * a }); return { pos: lp(c0.pos, c1.pos), look: lp(c0.look, c1.look), fov: c0.fov + (c1.fov - c0.fov) * a, ...(c0.lens !== undefined || c1.lens !== undefined ? { lens: (c0.lens ?? 0) + ((c1.lens ?? 0) - (c0.lens ?? 0)) * a } : {}) } }
      r.setCamera(camera ?? (L.orbit ? orbitCam(L, k) : gameCam()))
      if (fx) {
        // Sparks, dust and speed lines from the frames in between (a jump back starts them over).
        if (tt < fxAt) { fx.reset(); fxAt = -1 }
        const dt = fxAt < 0 ? 0 : (tt - fxAt) / L.data.physics.tickHz
        fxAt = tt
        fx.camera2 = L.split?.cams[k]?.pos ?? null
        fx.update(dt, [L.things[k], ...(L.npcs[k] ?? [])], r.camera, L.data.physics.skater.radius)
      }
      r.setClock(tt / L.data.physics.tickHz)
      if (L.hud && ui) {
        r.camera.updateMatrixWorld()
        // Split screen: worked out in player 1's half; the stand-in's own combos are in its HUD.
        const C = L, half = C.split?.cams[k] && splitView ? splitView.views(C.cams[k], null, innerWidth, innerHeight)[0].rect : null, standIn = C.split?.things[k]?.id ?? -1
        ui.racerTags(L.sessions[k].mode === 'bomb' || L.sessions[k].mode === 'skate' ? inHalf(r.camera, half, (w, h) => racerTags(C.npcs[k] ?? [], r.camera, park, w, h)) : [])
        // The park NPCs' combos landed by this frame, floating over them.
        const combos: NpcCombo[] = []
        for (const { i: ei, e } of L.events) { if (ei > k) break; if (e.t === 'npcCombo' && e.id !== standIn) combos.push({ id: e.id, tick: e.tick, name: e.name, points: e.points, multiplier: e.multiplier }) }
        ui.npcPops(inHalf(r.camera, half, (w, h) => npcPopTags(combos, C.npcs[k] ?? [], C.ticks[k], C.data.physics.tickHz, r.skater.data.npcs?.pop ?? DEFAULT_POP, r.camera, park, w, h)))
      }
      if (crowd) {
        // The people on the sidewalks, reacting to the skater and to the last combo landed by now.
        let landed: { tick: number; points: number; x: number; y: number } | null = null
        for (const { i: ei, e } of L.events) if (ei <= k && e.t === 'comboLanded') { const p = L.things[ei].pos; landed = { tick: e.tick, points: e.points, x: p.x, y: p.y } }
        const t = L.things[k]
        crowd.setStyle(r.style)
        crowd.update(L.ticks[k], r.camera, { x: t.pos.x, y: t.pos.y, z: t.pos.z, speed: Math.hypot(t.vel.x, t.vel.y) }, landed, false, L.peds[k] ?? [])
      }
      // Two halves while player 2 (or the stand-in) is there to follow; one view before it joins.
      const twoNow = !!L.split && !!L.split.cams[k]
      if (splitView && twoNow !== splitView.active) splitView.setActive(twoNow)
      if (L.split && splitView && twoNow) {
        // Two halves: player 1's chase camera and player 2's, and player 2's HUD.
        const p2 = L.split.cams[k], w = innerWidth, h = innerHeight
        if (L.hud) {
          const ms = (k / L.data.physics.tickHz) * 1000
          for (const { i: ei, e } of L.split.events) if (ei > splitHudAt && ei <= k) splitView.hud.event(e, ms)
          splitHudAt = k
          if (p2) splitView.frameHud(L.split.real ? L.split.sessions[k] ?? L.sessions[k] : L.sessions[k], L.data, park, ms, Math.atan2(p2.look.y - p2.pos.y, p2.look.x - p2.pos.x), L.split.things[k])
        }
        r.renderViews(splitView.views(L.orbit ? orbitCam(L, k) : L.cams[k], p2, w, h))
      } else r.render()
      return k
    },

    /** The level intro at t seconds (load with intro): the flyover with the level card, the run not yet started. */
    introFrame(t: number) {
      if (!L?.intro || !pres) throw new Error('clip: no level intro (load with intro, a replay with a levelStart)')
      const I = L.intro
      this.frame(I.i)
      if (ui && L.hud && !L.shown.intro) { ui.levelIntro(I.card); L.shown.intro = true }
      r.setCamera(I.path(Math.min(1, t / pres.intro.seconds)))
      r.render()
      if (ui && t >= pres.intro.seconds - 0.05) { ui.levelIntro(null); L.shown.intro = false }
    },

    /** The results card with the best combo looping behind it at t seconds into it (load with results). */
    resultsFrame(t: number) {
      if (!L?.loop || !pres) throw new Error('clip: no best combo to replay (load with results, a timed run that ends)')
      const B = L.loop, hz = L.data.physics.tickHz
      if (ui && !L.shown.results) {
        const e = B.over, again = '<kbd>Enter</kbd> again <kbd>Esc</kbd> menu'
        if (e.t === 'runOver') ui.results(e, { data: L.data } as unknown as Sim, again, r.skater.characterName)
        else if (e.t === 'comboOver') ui.modeResults(e, again)
        else if (e.t === 'levelOver') {
          const lv = L.data.tour.levels.find((x) => x.id === e.level)
          const T = L.data.tour, ids = lv ? ['pro', 'sick', 'skate', 'tape', ...lv.goals.map((g) => g.id)] : []
          const name = (id: string) => (T.names as Record<string, string>)[id] ?? lv?.goals.find((g) => g.id === id)?.name ?? id
          ui.levelResults(e, lv?.name ?? e.level, ids.map((id) => ({ name: name(id), now: e.goals.includes(id), before: false })), { total: e.goals.length, max: ids.length }, [], again)
        }
        ui.resultsReplay(B.name, B.points)
        document.body.classList.add('results-replay')
        L.shown.results = true
      }
      const n = B.i.length, i = Math.max(0, loopIndex(t, n, hz, pres.replay))
      const f = (t % (n / (hz * pres.replay.speed) + pres.replay.pause)) * hz * pres.replay.speed, k = Math.min(1, Math.max(0, f - i))
      const a = L.things[B.i[i]], b = L.things[B.i[Math.min(n - 1, i + 1)]], c0 = B.cams[i], c1 = B.cams[Math.min(n - 1, i + 1)]
      const lp = (p: { x: number; y: number; z: number }, q: { x: number; y: number; z: number }) => ({ x: p.x + (q.x - p.x) * k, y: p.y + (q.y - p.y) * k, z: p.z + (q.z - p.z) * k })
      r.skater.tick = L.ticks[B.i[i]]
      r.setSkater({ ...a, pos: lp(a.pos, b.pos), fwd: lp(a.fwd, b.fwd), up: lp(a.up, b.up) }, L.data, k)
      r.setCamera(besideCard({ pos: lp(c0.pos, c1.pos), look: lp(c0.look, c1.look), fov: c0.fov }, pres.replay.shift))
      traffic?.update(L.cars[B.i[i]] ?? [], k, hz, 0, c0.pos)
      r.render()
    },

    /** The sound of ticks [from, to) as a 16-bit stereo WAV, base64. */
    async audio(from: number, to: number, sampleRate = 48000, music?: { kind: 'lofi' | 'punk' | 'hyphy'; level: number }) {
      if (!L) throw new Error('clip: load first')
      const times = stretchTimes(L.speeds, from, Math.min(to, L.things.length), L.data.physics.tickHz)
      const secs = Math.max(0.1, times[times.length - 1])
      const ctx = new OfflineAudioContext(2, Math.ceil(secs * sampleRate), sampleRate)
      const snd = new Sound(park, src)
      snd.character = () => r.skater.characterId
      snd.weather = () => r.weather
      await snd.init(ctx)
      const dt = 1 / L.data.physics.tickHz
      let ei = 0
      while (ei < L.events.length && L.events[ei].i < from) ei++
      for (let i = from; i < to && i < L.things.length; i++) {
        const when = times[i - from]
        if (L.director) { const so = L.director.sound(L.speeds[i] ?? 1); snd.slowmo(so.rate, so.cutoff, when) }
        snd.update(L.things[i], when, dt / Math.max(0.05, L.speeds[i] ?? 1), L.vans[i] ?? null)
        for (; ei < L.events.length && L.events[ei].i === i; ei++) {
          const e = L.events[ei].e
          snd.event(e, L.things[i], when)
          if (npcViews && (e.t === 'npcTrick' || e.t === 'npcGrind' || e.t === 'npcLand' || e.t === 'npcBail' || e.t === 'npcCheer')) {
            // The park NPCs' sounds, from where the camera was.
            const id = e.id, n = L.npcs[i]?.find((x) => x.id === id), c = L.cams[i]?.pos
            if (n && c) snd.npc(e, npcViews.lookOf(n).id, Math.hypot(n.pos.x - c.x, n.pos.y - c.y, n.pos.z - c.z), when, npcViews.cheerTaps(L.data.physics.tickHz))
          }
          if (e.t === 'comboLanded' && spectators) { const p = L.things[i].pos, fans = spectators.fansFor({ tick: e.tick, points: e.points, x: p.x, y: p.y, z: p.z }); if (fans) snd.applause(fans, when) }
        }
      }
      // Skate School: a lesson done (and the graduation) rings the goal sound, as in the game.
      for (const i of [...(L.school?.marks ?? []), ...(L.school && L.school.gradAt >= 0 ? [L.school.gradAt] : [])]) if (i >= from && i < to) snd.event({ t: 'goal' } as SimEvent, L.things[i], times[i - from])
      // A generated radio station under the game's sound (our own music; streams never go in clips).
      if (music) { const st = music.kind === 'punk' ? new PunkStation() : music.kind === 'hyphy' ? new HyphyStation() : new LofiStation(); st.setVolume(music.level); st.renderInto(ctx, secs) }
      // The vignettes' loops (from the level they had at the start) and the tip jar, at their stretched times.
      const start = new Map<string, { kind: string; level: number }>()
      for (const x of L.vigLoops) if (x.i < from) start.set(x.id, x)
      for (const [id, x] of start) snd.vignetteLoop(id, x.kind, x.level, 0)
      for (const x of L.vigLoops) if (x.i >= from && x.i < to) snd.vignetteLoop(x.id, x.kind, x.level, times[x.i - from])
      for (const x of L.vigTips) if (x.i >= from && x.i < to) snd.tipClink(x.dist, times[x.i - from])
      // The vignettes' lines, through their speakers, at their stretched times.
      for (const { i, id } of L.vigLines) {
        if (i < from || i >= to || !voicesData) continue
        const b = await decodeLine(ctx, id), line = vgOf()?.lineText(id)
        const v = line ? voicesData.voices[line.voice] : null
        if (!b || !v) continue
        const src = ctx.createBufferSource(); src.buffer = b
        src.connect(chain(ctx, v.speaker, ctx.destination)); src.start(times[i - from])
      }
      const buf = await ctx.startRendering()
      return wavBase64(buf)
    },
  }
}

/**
 * A close camera riding along with the skater (--orbit az,el,dist[,lookUp]): az degrees round from
 * behind, el up, dist metres out, looking at lookUp over the contact; its heading smoothed over half
 * a second so turns and spins do not whip it round.
 */
function orbitCam(L: Loaded, k: number): CamPose {
  const [az, el, dist, lookUp = 0.5] = L.orbit!
  const r = L.data.physics.skater.radius, t = L.things[k]
  let hx = 0, hy = 0
  for (let j = Math.max(0, k - 60); j <= k; j++) { const f = L.things[j].fwd; hx += f.x; hy += f.y }
  const c = { x: t.pos.x - t.up.x * r, y: t.pos.y - t.up.y * r, z: t.pos.z - t.up.z * r + lookUp }
  const a = Math.atan2(hy, hx) + Math.PI + (az * Math.PI) / 180, e = (el * Math.PI) / 180
  return { pos: { x: c.x + Math.cos(a) * Math.cos(e) * dist, y: c.y + Math.sin(a) * Math.cos(e) * dist, z: c.z + Math.sin(e) * dist }, look: c, fov: 40 }
}

function wavBase64(buf: AudioBuffer): string {
  const ch = buf.numberOfChannels, n = buf.length, sr = buf.sampleRate
  const out = new DataView(new ArrayBuffer(44 + n * ch * 2))
  const w = (o: number, s: string) => { for (let i = 0; i < s.length; i++) out.setUint8(o + i, s.charCodeAt(i)) }
  w(0, 'RIFF'); out.setUint32(4, 36 + n * ch * 2, true); w(8, 'WAVE'); w(12, 'fmt ')
  out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, ch, true); out.setUint32(24, sr, true)
  out.setUint32(28, sr * ch * 2, true); out.setUint16(32, ch * 2, true); out.setUint16(34, 16, true); w(36, 'data'); out.setUint32(40, n * ch * 2, true)
  const data = [...Array(ch)].map((_, c) => buf.getChannelData(c))
  let o = 44
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) { out.setInt16(o, Math.max(-1, Math.min(1, data[c][i])) * 0x7fff, true); o += 2 }
  const bytes = new Uint8Array(out.buffer)
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}
