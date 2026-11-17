import * as THREE from 'three'
import { DATA_FILES, lookSchema, validateGameData, type Controls } from '../data/schema.ts'
import { applyCommand, parseCommands } from '../sim/commands.ts'
import { Btn, buttonNames } from '../sim/input.ts'
import { Recorder, runReplay, type Replay } from '../sim/replay.ts'
import { ghostDelta, ghostFrames, type Ghost } from '../sim/ghost.ts'
import { bombRoute } from '../sim/game/modes.ts'
import { createSim, player2, session, skater, worldHash, type Sim, type SimEvent } from '../sim/sim.ts'
import { Sound } from './sound.ts'
import { ClipRecorder } from './recorder.ts'
import { vetCommands } from './commandqueue.ts'
import { Rewards } from './rewards.ts'
import { LofiStation } from './lofi.ts'
import { PunkStation } from './punk.ts'
import { HyphyStation } from './hyphy.ts'
import { clipApi } from './clip.ts'
import { Radio } from './radio.ts'
import { flocksFor, Pigeons, type BirdsData } from './life.ts'
import { parseSeaLions, SeaLions, type SeaLionData } from './sealions.ts'
import { CastPeople, parseCast } from './castpeople.ts'
import { warmStreets } from '../sim/game/escape.ts'
import { Director, type MomentsData } from './director.ts'
import { vignetteLines, Vignettes, type VignetteData } from './vignettes.ts'
import { Spectators, type Landed } from './spectators.ts'
import { NpcViews, type NpcFrame } from './npcs.ts'
import { GhostView } from './ghostview.ts'
import { SessionMarker } from './sessionmarker.ts'
import { Crowd, simPeds, type CrowdData, type SimPedestrian } from './crowd.ts'
import { Dogs, type DogData } from './dogs.ts'
import { Fx, type FxData } from './fx.ts'
import { Unlocks } from './unlocks.ts'
import { BestCombo, besideCard, introPath, loopIndex, timedRunOver, timedRunStart, type Combo, type PresentData } from './present.ts'
import { carPoses, Traffic, type CarPose } from './traffic.ts'
import { Hud, uiSchema, type MenuItem, type Preview } from './ui.ts'
import { Settings, type SettingsData } from './settings.ts'
import { TouchPad, type TouchData } from './touch.ts'
import { binProgress, fetchBin } from './fetchbin.ts'
import { Picker, type BoardShop, type Paints } from './picker.ts'
import { postcard } from './postcard.ts'
import { fetchSF, presetFor } from './liveweather.ts'
import { StickerBook } from './stickers.ts'
import { Daily } from './daily.ts'
import { Career } from './career.ts'
import { keyName, keyRows, School, SchoolAsk, SchoolCard, type SchoolData, type SchoolSignal } from './school.ts'
import { inHalf, SPLIT_DEFAULTS, SplitScreen, type SplitData } from './split.ts'
import { AttractBanner, parseScript, playableIn, runScript, type AttractData } from './attract.ts'
import { isOver2p, Lobby, lobbyCam, playerOf, Results2p, TagPaint, TWO_PLAYER_DEFAULTS, twoPlayerPanel, twoPlayerPops } from './twoplayer.ts'
import type { ParkSource } from '../sim/park/source.ts'
import { loadSnapshot, saveSnapshot, type Snapshot } from '../sim/snapshot.ts'
import type { Thing } from '../sim/thing.ts'
import { comboValue, trickDef } from '../sim/tricks/tricks.ts'
import { Cam, CAM_MODES, carBoxes, type CamMode, type CamPose } from './camera.ts'
import { Keyboard } from './input.ts'
import { loadAll, loading } from './load.ts'
import { release } from './memory.ts'
import { LAYERS, Renderer, type Layer, type Style, isPhone } from './render.ts'
import { SkaterView } from './skater/view.ts'
import { raycast } from '../sim/park/park.ts'
import type { NpcReact } from './skater/react.ts'
import { camSubject, DEFAULT_POP, npcPopTags, racerTags, tagAt, type NpcCombo } from './tags.ts'
import { v3 } from '../sim/math.ts'
import { pickupFromSession } from './skater/mood.ts'
import { CityView } from './city.ts'
import { toonGradient } from './look.ts'
import { StoryClient, type StoryData } from './story.ts'
import { VehicleKey } from './drivekey.ts'
import { drivenBy } from '../sim/game/vehicles.ts'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { CasLocks, casSpec, casSpecialNames, loadSkaters, unlockable, type CasData, type CasSkater } from './cas.ts'
import { CasEditor } from './caseditor.ts'
import { Interiors, type InteriorRoom, type InteriorsData } from './interiors.ts'
import { skaterCard } from './postcard.ts'
import type { PortraitJob } from './portrait.ts'
import type { PhotoJob } from './photo.ts'

// The playable client: fixed-step loop over the sim, renderer, keyboard, and the
// dev tools (F5/F9 snapshots, F8 clips, tuning panel, live bridge, hot data).

const params = new URLSearchParams(location.search)
/** Running on the dev server (npm run dev): clips, photos and videos to out/clips, park comments, tuning. */
const DEV = import.meta.env.DEV
const parkName = params.get('park') ?? 'sf'   // the park with San Francisco around it; ?park=soma for the park alone
const headless = params.has('headless')
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T

type Pending = { text: string; resolve: (r: { ok: boolean; text: string }) => void }
/** The skater as of a tick (a copy: the renderer interpolates between the last two). */
const pose = (t: Thing): Thing => structuredClone(t)

async function boot() {
  // No WebGL 2: say so kindly instead of failing somewhere inside three.js.
  if (!headless && !document.createElement('canvas').getContext('webgl2')) { noWebGL(); return }
  // The built site keeps itself for offline play (service worker: sw.js), registered without waiting:
  // on a first visit the big downloads go into its cache from the page (fetchbin.ts), and once the game
  // is up the worker fetches the rest ('warm'). Waiting for it to take over cost up to 4 s.
  if (import.meta.env.PROD && !headless && 'serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch((e) => console.warn('no offline cache:', e))
  }
  binProgress.onChange = (done, total) => {
    const mb = (n: number) => (n / 1048576).toFixed(1)
    const bar = document.querySelector<HTMLElement>('#loading-bar i'), txt = document.getElementById('loading-bytes')
    if (bar && total > 0) bar.style.width = `${Math.min(100, (done / total) * 100).toFixed(1)}%`
    if (txt && total > 0) txt.textContent = `${mb(Math.min(done, total))} of ${mb(total)} MB`
  }
  const uiData = uiSchema.parse(await (await fetch('data/ui.json', { cache: 'no-store' })).json())
  loading.status = (s) => { $('loading-status').textContent = s }
  const [{ data, controls, look, src, takePark, paint, real, city: cityLook, lights: cityLights, interiors: cityRooms }, skaterView] = await Promise.all([loadAll(parkName, { previewPaint: !headless }), SkaterView.load()])
  performance.mark('boot:loaded')
  // The city map's water (story.ts, mapscreen.ts): the bay's triangles in plan, kept before the built site lets the source go.
  const mapWater: number[] = []
  for (const e of src.elements) if (e.collection === 'city_water') for (let t = e.tris[0]; t < e.tris[0] + e.tris[1]; t++) for (let k = 0; k < 3; k++) { const v = src.indices[t * 3 + k] * 3; mapWater.push(src.positions[v], src.positions[v + 1]) }
  const canvas = $<HTMLCanvasElement>('view')
  const city = cityLook ? await CityView.create(src, cityLook, look, toonGradient(look.toon.bands)) : null
  performance.mark('boot:cityview')
  const r = new Renderer(canvas, src, null, data.physics, skaterView, look, paint, real, city)
  // A lost GL context (a driver reset, a phone evicting the tab's GPU memory): the build freed what it uploaded, so the page asks for a reload (progress is saved).
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); contextLost() })
  performance.mark('boot:renderer')
  r.setLamps(nightLamps(src, cityLights))
  Sound.prepare(src)
  // The built site: every mesh and texture goes to the GPU now and its JS copy with it (memory.ts), and the
  // composed world's triangles are done with (they are in the meshes; the sim's park has its own): about
  // 300 MB let go before the sim's park comes over from the load worker, so the two never add up.
  if (import.meta.env.PROD && !headless) {
    r.uploadAll()
    src.positions = release(src.positions); src.indices = release(src.indices)
    performance.mark('boot:uploaded')
  }
  const park = await takePark()
  r.attachPark(park)
  performance.mark('boot:park')
  // Parts that roll away (the mascot's head) sit on the park.
  r.skater.ground = (x, y, z) => { const h = raycast(park, v3(x, y, z), v3(0, 0, -1), 8); return h ? h.point.z : null }
  let sim: Sim = createSim(park, data, { seed: 1, spot: params.get('spot') ?? undefined })
  warmStreets(park, data.run.escape)   // the street graph while loading, not in the first Escape tick (escape.ts)
  // Street birds (data/birds.json): pigeons round the spawn spots; seagulls on the waterfront in the city.
  let birdsData: BirdsData | null = null
  try { birdsData = await (await fetch('data/birds.json', { cache: 'no-store' })).json() as BirdsData } catch (e) { console.warn('no birds data', e) }
  const pigeons = new Pigeons(park, flocksFor(park, birdsData?.pigeons), 11, birdsData?.pigeons)
  if (birdsData?.gulls && cityLook) pigeons.addGulls(park, birdsData.gulls, cityLights)
  r.scene.add(pigeons.group)
  // The sea lions on Pier 39's K-dock (data/sealions.json; where they lie: the city export's city.sealions).
  let seaLions: SeaLions | null = null
  if (cityLook) {
    try {
      const sd = await (await fetch('data/sealions.json', { cache: 'no-store' })).json() as SeaLionData
      const { list, skipped } = parseSeaLions(cityLook.sealions)   // city.sealions (city phase 12)
      if (skipped) console.warn(`sea lions: ${skipped} entries in the city export are not { x, y, z, heading, pile }`)
      if (list.length) { seaLions = new SeaLions(list, sd); r.scene.add(seaLions.group) }
    } catch (e) { console.warn('no sea lions', e) }
  }
  // Watchers on the ledges; they cheer the last big combo landed near them (comboLanded).
  const spectators = r.skater.spectatorData ? new Spectators(park, r.skater.spectatorData, toonGradient(look.toon.bands)) : null
  if (spectators) r.scene.add(spectators.group)
  // The cast people (castpeople.ts), where data/cast.json stands them; story.ts moves
  // them for missions, and draws the rest of the cast itself (castview.ts).
  let castPeople: CastPeople | null = null
  if (cityLook && r.skater.data.castView) {
    const people = new Set([...(r.skater.data.people ?? []).map((p) => p.id), 'unit7'])
    const parsed = parseCast(data.cast, people), skipped = parsed.skipped
    const list = parsed.list.filter((e) => people.has(e.model))   // the rest (skater characters, stand-ins) are the story's own view's (castview.ts)
    if (skipped) console.warn(`cast: ${skipped} entries are not { id, name, home, model }`)
    const spotAt = (id: string) => {
      const alias = data.spots.aliases.find((a) => a.id === id)?.spot
      const sp = park.spots.find((p) => p.id === (alias ?? id))
      return sp ? { x: sp.pos.x, y: sp.pos.y, z: sp.pos.z, heading: sp.heading } : null
    }
    if (list.length) { castPeople = new CastPeople(list, [...(r.skater.data.people ?? []), ...r.skater.data.characters], spotAt, park, toonGradient(look.toon.bands), r.skater.data.castView); r.scene.add(castPeople.group) }
  }
  let landed: Landed | null = null
  // The NPC skaters (npc spawn) and the hill bomb ghost, drawn with the characters' rig and poses.
  const npcViews = new NpcViews(r.skater, toonGradient(look.toon.bands))
  npcViews.lineId = (i) => park.lines[i]?.id ?? ''   // the EMB and Pier 7 locals wear their own looks
  // People on the city's sidewalks (none where there are no streets: the park alone, the lab).
  let crowd: Crowd | null = null
  // The vignettes (vignettes.ts, data/vignettes.json): small scenes round the city; their people join the crowd.
  let vigData: VignetteData | null = null
  if (park.traffic.paths.length) try { vigData = await (await fetch('data/vignettes.json', { cache: 'no-store' })).json() as VignetteData } catch (e) { console.warn('no vignettes', e) }
  // The interiors' dressing (interiors.ts, data/interiors.json) on the city's rooms; their people join the vignettes.
  let interiors: Interiors | null = null
  if (cityRooms.length) try {
    const idata = await (await fetch('data/interiors.json', { cache: 'no-store' })).json() as InteriorsData
    interiors = new Interiors(cityRooms as InteriorRoom[], idata, park, toonGradient(look.toon.bands))
    r.setLamps(interiors.indoorLamps(nightLamps(src, cityLights)))   // the rooms' own ceiling lights reach less: their dressing lights them
    { const I = interiors; Cam.ceilingAt = (x, y, z) => I.ceilingAt(x, y, z) }   // the chase camera stays under a room's ceiling (not in the collision)
    r.scene.add(interiors.group)
    if (vigData) vigData.vignettes.push(...interiors.vignettes())
  } catch (e) { console.warn('no interiors dressing', e) }
  if (park.traffic.paths.length) try { const cd = await (await fetch('data/pedestrians.json', { cache: 'no-store' })).json() as CrowdData; if (vigData) cd.vignettes = vigData; crowd = new Crowd(park, cd, toonGradient(look.toon.bands)); r.scene.add(crowd.group) } catch (e) { console.warn('no pedestrians', e) }
  let vignettes: Vignettes | null = null
  if (crowd && vigData) { vignettes = new Vignettes(vigData, park, toonGradient(look.toon.bands)); crowd.setVignettes(vignettes) }
  if (crowd && castPeople) crowd.setKeepClear(castPeople.placed)   // nobody walks through the cast
  ;(window as unknown as { __crowd: Crowd | null }).__crowd = crowd   // the fps probe reads its stats
  // Off-leash dogs round the dog owners in the parks; they chase a skater riding by.
  let dogs: Dogs | null = null
  // Juice round the board: sparks, dust, wheel smoke and speed lines (fx.ts, data/effects.json).
  let fx: Fx | null = null
  try { fx = new Fx(await (await fetch('data/effects.json', { cache: 'no-store' })).json() as FxData, park, r.renderer.domElement); r.scene.add(fx.group) } catch (e) { console.warn('no effects', e) }
  ;(window as unknown as { __fx: Fx | null }).__fx = fx   // the fps probe reads its stats
  if (crowd) try { dogs = new Dogs(park, await (await fetch('data/dogs.json', { cache: 'no-store' })).json() as DogData, crowd.dogOwners(), toonGradient(look.toon.bands)); r.scene.add(dogs.group) } catch (e) { console.warn('no dogs', e) }
  r.scene.add(npcViews.group)
  const ghostView = new GhostView(r.skater)
  r.scene.add(ghostView.group)
  const sessionMarker = new SessionMarker(data.physics.skater.radius)
  r.scene.add(sessionMarker.group)
  let npcPrev = new Map<number, Thing>(), npcCur = new Map<number, Thing>()
  const npcFrames = (): NpcFrame[] => [...npcCur.values()].map((cur) => ({ cur, prev: npcPrev.get(cur.id) }))
  // The park NPCs' recent combos, floating over them for a moment (tags.ts npcPopTags, characters.json npcs.pop).
  const npcCombos: NpcCombo[] = [], popData = r.skater.data.npcs?.pop ?? DEFAULT_POP
  ;(window as unknown as { __npcStats: () => unknown; __npcViews: NpcViews }).__npcStats = () => npcViews.stats
  ;(window as unknown as { __npcViews: NpcViews }).__npcViews = npcViews   // the fps probe toggles them
  const traffic = new Traffic()   // draws the sim's cars
  // The car models (assets/cars, tools/cars.ts): near the camera cars are models, far off boxes; boxes until they load (shots wait for them).
  const carsLoaded = Promise.all([fetch('assets/cars/cars.json', { cache: 'no-store' }).then((x) => x.json()), fetchBin('assets/cars/cars.bin')]).then(([layout, bin]) => traffic.setModels(layout, bin)).catch((e) => console.warn('no car models', e))
  r.scene.add(traffic.group)
  void carsLoaded.then(() => { const m = traffic.model('hatchback'); if (m && castPeople) castPeople.useCarModel(m) })   // Unit 7 is the robotaxi's model too
  try { Cam.setData(await (await fetch('data/camera.json', { cache: 'no-store' })).json()) } catch { /* defaults */ }
  const cam = new Cam()
  // The trick director (director.ts, data/moments.json): slow motion and the trick cameras at the big moments.
  const momentsData = await (await fetch('data/moments.json', { cache: 'no-store' })).json() as MomentsData
  const director = new Director(park, momentsData, data.physics)
  /** A director for a replay's frames (the instant replay, the results replay, the share clip): the player's settings. */
  const replayDirector = () => { const d = new Director(park, momentsData, data.physics); d.level = director.level; d.cameras = director.cameras; return d }
  // Presentation (present.ts, data/presentation.json): Tour level intros, the best combo behind the results.
  let pres: PresentData = { intro: { seconds: 3.6, fovFrom: 50, spreadHeight: 0.7, minHeight: 9, maxHeight: 70, clear: 4, ceiling: 1.6, behind: 9, behindHeight: 3.5, swing: 0.35, samples: 90, riseStep: 2, riseTries: 25, wall: 3 }, replay: { speed: 0.4, lead: 30, tail: 50, pause: 0.7, maxSeconds: 8, minPoints: 1, shift: 0.42 } }
  try { pres = await (await fetch('data/presentation.json', { cache: 'no-store' })).json() as PresentData } catch { /* defaults */ }
  // Skate School (school.ts, data/school.json): Karl the Fog's tutorial, in the park.
  let schoolData: SchoolData | null = null
  try { schoolData = await (await fetch('data/school.json', { cache: 'no-store' })).json() as SchoolData } catch { /* no school */ }
  // Split screen (split.ts, data/split.json): two views, two HUDs; ?split=npc puts a park NPC in as player 2.
  let splitData: SplitData = SPLIT_DEFAULTS
  try { splitData = { ...SPLIT_DEFAULTS, ...await (await fetch('data/split.json', { cache: 'no-store' })).json() as SplitData } } catch { /* defaults */ }
  // Settings' pages and values (settings.ts, data/settings.json).
  const settingsData = await (await fetch('data/settings.json', { cache: 'no-store' })).json() as SettingsData
  // The story in the client (story.ts, data/story.json): the cast, markers, the talk key, dialogue, journal, the city map.
  const storyData = await (await fetch('data/story.json', { cache: 'no-store' })).json() as StoryData
  const touchData = await (await fetch('data/touch.json', { cache: 'no-store' })).json() as TouchData
  // The title's attract mode (attract.ts, data/attract.json): demos after a while idle on the title menu.
  let attractData: AttractData | null = null
  try { attractData = await (await fetch('data/attract.json', { cache: 'no-store' })).json() as AttractData } catch { /* no demos */ }
  if (attractData && params.has('attract')) attractData.idleSeconds = Number(params.get('attract'))   // ?attract=s: sooner (shots and tests)
  cam.park = park
  Cam.specials = new Set(((data.tricks as unknown as { specials?: { id: string }[] }).specials ?? []).map((s) => s.id))
  let split: SplitScreen | null = null
  const size = () => { r.resize(window.innerWidth, window.innerHeight); if (split?.active) split.setActive(true) }   // split: the layout follows the screen's shape
  window.addEventListener('resize', size)
  size()

  const ui = new Hud(uiData, $('help').innerHTML)
  $('help').remove()
  ui.character = () => r.skater.characterId
  // Named spots (Go to, minimap).
  // Named spots for Go to and the minimap: data/spots.json labels (city spots without a label stay out of the list).
  const spotNames: Record<string, string> = data.spots.labels ?? {}
  const spotLabel = (id: string) => spotNames[id] ?? data.spots.aliases.find((a) => a.id === id || a.spot === id)?.label ?? id.replace(/_/g, ' ')
  {
    // Minimap: the city's streets, the park's obstacles from above, named spots.
    const tris: number[] = []
    for (let t = 0; t < park.triCount; t++) {
      const c = park.elements[park.elem[t]].collection
      if (c === 'obstacles' || c === 'walls' || c === 'freeway_columns') for (let k = 0; k < 9; k++) tris.push(park.tv[t * 9 + k])
    }
    const named = park.spots.filter((s) => spotNames[s.id]).map((s) => ({ x: s.pos.x, y: s.pos.y, label: spotLabel(s.id) }))
    ui.setMap(park.traffic.paths.map((p) => p.points), new Float64Array(tris), named)
  }
  // Create-a-Skater (cas.ts, data/cas.json): the kept skaters join the roster before the picker restores its pick.
  let casData: CasData | null = null
  try { casData = await (await fetch('data/cas.json', { cache: 'no-store' })).json() as CasData } catch { /* no Create-a-Skater */ }
  const casSkaters = casData ? loadSkaters(casData) : []
  const signatures = (uiData.signatures ??= {})
  const casApply = (k: CasSkater) => { r.skater.setSpec(casSpec(k, casData!)); signatures[k.id] = casSpecialNames(k, casData!) }
  for (const k of casSkaters) if (k) casApply(k)
  if (headless) { await city?.decorate(); await carsLoaded; traffic.setDetail(160); return exposeHeadless(r, cam, () => sim, (s) => { sim = s }, src, pigeons, traffic, ui, spectators, npcViews, ghostView, crowd, dogs, fx, pres, schoolData, controls, splitData, castPeople, casData ? casApply : null, interiors) }
  r.skater.smoothing = true
  // Player 2's half follows the sim's player 2 when it is in (?split=npc: a park NPC stands in, for dev).
  split = new SplitScreen(splitData, ui, park, params.get('split') === 'npc')
  const TP = { ...TWO_PLAYER_DEFAULTS, ...splitData.twoPlayer }
  document.documentElement.style.setProperty('--p1', TP.colors[0]); document.documentElement.style.setProperty('--p2', TP.colors[1])
  // Player 2's skater view (built the first time player 2 joins) and its last two poses.
  let p2view: SkaterView | null = null, p2viewLoading = false, prev2: Thing | null = null, curr2: Thing | null = null
  const P2KEY = 'soma-skate.character2'
  const p2Saved = () => { try { return localStorage.getItem(P2KEY) } catch { return null } }
  const ensureP2View = async () => {
    if (p2view || p2viewLoading) return
    p2viewLoading = true
    const v = await SkaterView.load()
    v.smoothing = true
    const want = p2Saved() ?? v.cast.find((c) => c.id !== r.skater.characterId && !unlocks.locked(c.id))?.id
    if (want && !unlocks.locked(want)) v.setCharacter(want)
    r.addSkater(v)
    p2view = v
  }
  // Graffiti's tags painted on the obstacles, in each owner's colour.
  const tagPaint = new TagPaint(park, data.gaps.gaps, TP)
  r.scene.add(tagPaint.group)
  const results2p = new Results2p(TP)
  let lastGame2p = 'trickattack2p', keysYield: Keyboard | null = null
  const p2cam = new THREE.PerspectiveCamera(62, 1, 0.05, 600)   // player 2's view, for culling
  let splitScaleBefore = 1

  const rec = { current: new Recorder(120 * 150) }   // 150 s: long enough to keep a whole Twin Peaks bomb for its ghost
  const keys = new Keyboard(controls)
  // Player 2 (split screen): the arrows and numpad, or the second pad; its input waits for the sim's second player.
  const keys2 = new Keyboard(controls, 2)
  let p2Input = { b: 0 }
  // While a menu, the dialogue box, the journal or the map is up, the pad drives it (cross: Space, circle: Esc, d-pad: arrows).
  keys.menuOpen = () => ui.menuOpen || picker.isOpen || !!cas?.isOpen || !!story?.talking || !!story?.overlay
  const pending: Pending[] = []
  const events: SimEvent[] = []
  let paused = false, stepBudget = 0, watching = false, quick: Snapshot | null = null
  let pinMode = false, camBeforePin: CamMode = 'chase'
  let photoMode = false, camBeforePhoto: CamMode = 'chase'
  let camWho = -1   // the Thing the camera followed last tick
  // Photo mode's postcard frame (F): "Greetings from" the neighbourhood you are in, the wordmark as the stamp.
  let postcardOn = false
  try { postcardOn = localStorage.getItem('soma-skate:postcard') === '1' } catch { /* private window */ }
  const postcardText = () => {
    const p = skater(sim).pos, at = park.name === 'sf' ? ui.placeAt(p.x, p.y) : null
    return at ? { place: at.name, line: at.line } : { place: 'SoMa West Skatepark', line: 'Under the Central Freeway. Your home park.' }
  }
  const postcardEl = document.createElement('div'); postcardEl.className = 'postcard-preview'; document.body.appendChild(postcardEl)   // outside #ui: photo mode hides the HUD
  const showPostcard = () => {
    postcardEl.classList.toggle('on', photoMode && postcardOn)
    if (!(photoMode && postcardOn)) return
    const t = postcardText()
    postcardEl.innerHTML = `<div class="pc-band"><small>Greetings from</small><b>${t.place}</b><i>${t.line}</i></div>`
  }
  const sound = new Sound(park, src)
  // The vignettes speak (captioned), play their music and take tips through the game's sound.
  if (vignettes && vigData) { vignettes.say = (id) => sound.say(id); vignettes.loop = (id, kind, level) => sound.vignetteLoop(id, kind, level); vignettes.tip = (d) => sound.tipClink(d); sound.addLines(vignetteLines(vigData)) }
  sound.character = () => r.skater.characterId
  sound.weather = () => r.weather
  // The EMB and Pier 7 locals (characters.json npcs.locals): a local within range says a line (spoken,
  // captioned) when it cheers your combo, sets off on your line, or sees you slam; one line per cooldown.
  const LOC = r.skater.data.npcs?.locals
  let localSaidAt = -1e9
  const localSay = (e: SimEvent) => {
    if (!LOC || sim.world.tick - localSaidAt < LOC.cooldown * data.physics.tickHz) return
    const me = skater(sim).pos
    const near = (t: Thing) => t.kind === 'npc' && t.alive && npcViews.isLocal(t) && Math.hypot(t.pos.x - me.x, t.pos.y - me.y) < LOC.range
    const who = e.t === 'bail' ? sim.world.things.find(near) : sim.world.things.find((x) => x.id === (e as { id?: number }).id && near(x))
    const ids = LOC.say[e.t === 'bail' ? 'bail' : e.t === 'npcCheer' ? 'cheer' : 'copy']
    if (!who || !ids?.length) return
    localSaidAt = sim.world.tick
    sound.say(ids[e.tick % ids.length])
  }
  // A flock of gulls taking off cries now and then (birds.json cry), heard from the camera.
  const sk3 = new THREE.Vector3()
  if (seaLions) seaLions.onSound = (kind, at, n) => sound.seaLions(kind, r.camera.position.distanceTo(at), n, seaLions!.d.barkFar)
  pigeons.onScatter = (kind, at) => { const G = birdsData?.gulls; if (kind === 'gull' && G && Math.random() < G.cry) sound.gulls(r.camera.position.distanceTo(at), G.cryFar) }
  // Weather: the presets, then "Live: SF right now" (the real weather, refreshed); remembered.
  let liveOn = false, liveSummary = '', liveTimer = 0
  const WKEY = 'soma-skate:weather'
  const saveWeather = () => { try { localStorage.setItem(WKEY, liveOn ? 'live' : r.weather) } catch { /* private window */ } }
  const weatherLabel = () => liveOn ? `Live${liveSummary ? `, ${r.weathers.find((w) => w.id === r.weather)?.label} (${liveSummary})` : ''}` : r.weathers.find((w) => w.id === r.weather)?.label ?? 'Clear'
  const goLive = async () => {
    const L = look.real.live
    if (!L) return
    const n = await fetchSF(L)
    if (!liveOn) return
    if (!n) { liveSummary = 'offline'; toast('Could not reach the weather service; keeping this weather'); return }
    const p = presetFor(n, L); liveSummary = p.summary
    if (p.preset !== r.weather) r.setWeather(p.preset)
    if (menuOpen) ui.setMenu(menuItems())
  }
  const cycleWeather = () => {
    const ws = r.weathers
    clearInterval(liveTimer)
    if (liveOn) { liveOn = false; r.setWeather(ws[0].id) }
    else {
      const i = ws.findIndex((w) => w.id === r.weather)
      if (i === ws.length - 1 && look.real.live) { liveOn = true; liveSummary = ''; void goLive(); liveTimer = window.setInterval(() => void goLive(), look.real.live.refreshMinutes * 60000) }
      else r.setWeather(ws[(i + 1) % ws.length].id)
    }
    saveWeather()
  }
  try {
    const w = localStorage.getItem(WKEY)
    if (w === 'live' && look.real.live) { liveOn = true; void goLive(); liveTimer = window.setInterval(() => void goLive(), look.real.live.refreshMinutes * 60000) }
    else if (w && r.weathers.some((x) => x.id === w)) r.setWeather(w, true)
  } catch { /* private window */ }
  let radio: Radio | null = null
  // Character select: a menu entry opens the picker (turntable behind it); Tab cycles in play.
  let shop: BoardShop = { decks: [], wheels: [] }
  try { shop = await (await fetch('data/boards.json', { cache: 'no-store' })).json() as BoardShop } catch { /* no board shop */ }
  let paints: Paints = { palette: [], slots: {} }
  try { paints = await (await fetch('data/paints.json', { cache: 'no-store' })).json() as Paints } catch { /* no colours panel */ }
  // Secret skaters (unlocks.ts): locked by the Tour career (or a story mission) until earned; ?unlock=all|none|ids overrides it.
  const career = new Career(data.tour)   // the Tour career (career.ts): goals across runs, in this browser
  let story: StoryClient | null = null   // the story (story.ts), made below; the unlocks read its save
  const unlocks = new Unlocks(r.skater.cast, { get total() { return career.total }, count: (g) => career.count(g), level: (id) => career.level(id), story: (id) => !!story?.isDone(id) }, params.get('unlock'))
  unlocks.fresh(true)
  const picker = new Picker($('ui'), r.skater, uiData.signatures ?? {}, shop, paints, unlocks)
  // Decks and outfits the story gives stay locked in the picker until their mission is done (rewards.ts; made with the story below).
  let rewards: Rewards | null = null
  picker.gear = { deck: (g) => rewards?.deck(g) ?? null, outfit: (c, o) => rewards?.outfit(c, o) ?? null }
  keys.pickerOpen = () => picker.isOpen
  // A created skater's name over the score and on the results cards.
  const showSkaterName = () => ui.setSkaterName(/^cas\d+$/.test(r.skater.characterId) ? r.skater.characterName : '')
  showSkaterName()
  // The NPC skaters' views, built ahead (after the first frame, off the load): a dry run of the spawn the
  // first run will queue gives their looks; a run started sooner builds them as they appear.
  const prebuildNpcs = () => {
    if (park.name !== 'soma' && park.name !== 'sf') return
    try {
      const test = loadSnapshot(saveSnapshot(sim), park)
      for (const c of parseCommands('npc spawn')) applyCommand(test, c)
      npcViews.prebuild(test.world.things.filter((t) => t.kind === 'npc' && !npcViews.has(t.id)), skater(sim), sim.world.tick, sim.data)
    } catch { /* built when they appear */ }
  }
  const openPicker = () => { ui.showMenu(false); picker.open(performance.now()) }
  // The emote (taunt, T): the character's bit, its line on the HUD, its sound. Client only, never recorded.
  let lastB = 0
  const emote = () => {
    const t = skater(sim)
    if (t.state === 'air' || t.state === 'bail' || r.skater.emoteTick >= 0 && sim.world.tick - r.skater.emoteTick < 180) return
    r.skater.emoteTick = sim.world.tick
    const say = r.skater.cast.find((c) => c.id === r.skater.characterId)?.style.emote?.say
    if (say) toast(say)
    sound.emote()
  }
  let toCas = false
  picker.onClose = () => { showSkaterName(); if (menuOpen && !toCas) { ui.setMenu(menuItems()); ui.showMenu(true) } }
  // The editor: from the picker's entry (or N); leaving saves and goes back to the picker on the skater made.
  let cas: CasEditor | null = null, casShot = false
  const casLocks = new CasLocks({ get total() { return career.total }, count: (g) => career.count(g), level: (id) => career.level(id), story: (id) => !!story?.isDone(id) }, (id) => !!stickers?.all.find((x) => x.id === id && x.earned), params.get('unlock'))
  if (casData) {
    cas = new CasEditor($('ui'), casData, casLocks, casSkaters)
    cas.onPreview = (k) => { casApply(k); r.skater.setCharacter(k.id) }
    cas.onDelete = (id) => { r.skater.removeSpec(id); delete signatures[id] }
    cas.onClose = (k) => { if (k) { casApply(k); picker.select(k.id) } showSkaterName(); picker.open(performance.now()) }
    cas.onPostcard = (k) => {
      // The turntable from in front, centred (the panel is HTML, not in the frame), framed as a card and downloaded.
      casShot = true
      const t = skater(sim), h = r.skater.characterHeight
      r.setCamera(cas!.camera(performance.now(), t.pos, h, true)); r.render()
      const sp = casData!.specials.find((x) => x.id === k.choices.special)?.name ?? '', at = casData!.attitudes.find((x) => x.id === k.choices.attitude)?.name ?? ''
      const png = skaterCard(canvas, k.name, [`${at} on a board. Special: ${sp}.`, 'Made in Create-a-Skater'])
      casShot = false
      const a = document.createElement('a'); a.href = png; a.download = `soma-skate-${k.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'skater'}.png`; a.click()
      toast('Postcard saved to your downloads')
    }
  }
  // A piece opened by a mission or a sticker: announced once, like a new skater.
  // (A piece a mission opens is on its results card; quiet here.)
  const casFresh = (mission?: string) => { if (casData) for (const it of casLocks.fresh(casData)) if (!mission || it.unlock?.story !== mission) toast(`New in Create-a-Skater: ${it.name}`) }
  picker.onCreate = (id) => {
    if (!cas) { toast('Create-a-Skater is not in this build'); return }
    toCas = true; picker.close(); toCas = false
    ui.showMenu(false)
    cas.open(id ? Number(id.slice(3)) - 1 : undefined, performance.now())
  }
  keys.casOpen = () => !!cas?.isOpen
  // Today's challenge (data/daily.json): one per SF day; Go takes you to its spot or mode.
  let daily: Daily | null = null
  void Daily.load().then((d) => { daily = d; if (menuOpen) ui.setMenu(menuItems()); if (d) d.onDone = (c, streak) => { ui.dailyDone(c.text, streak); sound.event({ t: 'goal' } as SimEvent, skater(sim), sound.ctx?.currentTime ?? 0) } })
  const goDaily = () => {
    const c = daily?.today
    if (!c) return
    if (c.mode === 'bomb') choose('bomb', c.route ?? bombRouteId)
    else if (c.mode === 'muni') choose('muni', c.route ?? 'j')
    else if (c.mode === 'skate') { if (skateGame()) choose('skate', c.local ?? '') ; else toast('S.K.A.T.E. is played in the park') }
    else if (c.mode) choose(c.mode)
    else { if (!started) choose('free'); if (c.spot) queue(`teleport ${c.spot}`); resume() }
    toast(`Today: ${c.text}`)
  }
  // The Sticker Book (data/stickers.json): milestones earned once, with a slap on screen.
  let stickers: StickerBook | null = null
  void StickerBook.load().then((b) => { stickers = b; if (menuOpen) ui.setMenu(menuItems()); if (b) b.onEarn = (s) => { const ofMission = s.rule.on === 'missionDone' ? (s.rule as { mission?: string }).mission : undefined; casFresh(ofMission); if (ofMission) return; ui.stickerEarned(s); sound.event({ t: 'goal' } as SimEvent, skater(sim), sound.ctx?.currentTime ?? 0) } })   // (a story's sticker is on its results card; the gig stickers slap on)
  const radioVolume = { v: 1 }   // the saved setting, for when the radio arrives
  void Radio.load().then((x) => { radio = x; radio?.setVolume(radioVolume.v); if (radio) { radio.onShow = (title, line) => { ui.radio(title, line); if (ui.menuOpen) { ui.setMenu(menuItems()); if (ui.menuAt === 'radio') ui.sub('radio', 'Radio', radioItems()) } }; radio.onCaption = (who, text, secs) => { if (settings.get('captions')) ui.caption(who, text, secs) } } })
  // Captions for the robotaxi's and Muni's lines (Settings > HUD > Captions), shown as each one starts.
  sound.onSay = (who, text, delay, secs, unvoiced) => { if (unvoiced || settings.get('captions')) window.setTimeout(() => ui.caption(who, text, secs), delay * 1000) }   // a line with no recording yet is shown with captions off too
  // ---- Skate School (school.ts, data/school.json): Karl the Fog teaches the controls, a lesson at a time ----
  let school: School | null = null
  let schoolGust = false   // Karl's gust (a lesson's boost) waits for the lesson's first push
  const schoolCard = new SchoolCard($('ui'))
  const schoolAsk = new SchoolAsk($('ui'))
  const SCHOOL_KEY = 'soma-skate:school'   // 'asked' once the first-launch question is answered, 'done' once graduated
  const schoolSeen = () => { try { return localStorage.getItem(SCHOOL_KEY) } catch { return 'asked' } }
  const schoolMark = (v: 'asked' | 'done') => { try { if (v === 'done' || schoolSeen() !== 'done') localStorage.setItem(SCHOOL_KEY, v) } catch { /* private window */ } }
  const schoolHere = () => !!schoolData?.parks.includes(park.name)
  /** Karl's card for the lesson now: the keys follow the player's rebinds (keysFor) and the pad. */
  const drawSchool = () => {
    const L = school?.lesson
    ui.quiet = !!L   // Karl teaches: the first-time tips wait
    if (!school || !L || !schoolData) { schoolCard.show(null); return }
    schoolCard.show({
      index: school.i, of: schoolData.lessons.length, title: L.title, say: L.say,
      keys: keyRows(L, (a) => keys.keysFor(a), (a) => controls.gamepad.buttons[a] ?? [], touch?.visible ? (a) => touch.glyph(a) : undefined),
      hint: school.hinted ? L.hint : undefined, done: school.celebrating ? L.done : undefined,
      foot: touch?.visible ? 'the menu button skips' : `<kbd>${keyName(controls.dev.respawn)}</kbd> start over <kbd>Esc</kbd> skip`,
    })
  }
  const schoolSignals = (sig: SchoolSignal[]) => {
    for (const s of sig) {
      if (s.kind === 'start' || s.kind === 'redo') { for (const c of s.commands) queue(c); schoolGust = !!s.lesson.boost }
      if (s.kind === 'done') sound.event({ t: 'goal' } as SimEvent, skater(sim), sound.ctx?.currentTime ?? 0)
      if (s.kind === 'graduated') graduate()
    }
    drawSchool()
  }
  const startSchool = () => {
    if (!schoolData || !schoolHere()) { toast('Skate School is in the park'); return }
    choose('free')   // no clock: free skate, the lessons on top
    school = new School(schoolData, data)
    schoolSignals(school.start())
  }
  const endSchool = () => { school = null; schoolGust = false; drawSchool() }
  /** The last lesson's done line has shown: the Graduate sticker, and a card pointing on to the Tour and the game modes. */
  const graduate = () => {
    const d = schoolData!.graduate
    school = null
    const fresh = schoolSeen() !== 'done'
    schoolMark('done')
    stickers?.event({ t: d.event } as unknown as SimEvent)
    paused = true
    schoolAsk.show({
      tag: 'SKATE SCHOOL', title: d.title, line: d.line, art: d.sticker, earned: fresh ? 'Milestone: graduate' : undefined, options: [
        { label: d.tour, onPick: () => { openMenu(); openMissions(); openChallenges() } },
        { label: d.modes, onPick: () => { openMenu(); openPlay() } },
        { label: d.stay, onPick: () => { paused = false; canvas.focus() } },
      ],
    })
  }
  // Free roam from the start (docs/open-world.md): no title menu; Esc opens the pause menu.
  let menuOpen = false, started = true
  paused = false
  type Game = 'start' | 'free' | 'courier' | 'combo' | 'bomb' | 'skate' | 'level' | 'muni' | 'escape' | 'graffiti'
  let lastGame: Game = 'free'
  const choose = (mode: Game, route = bombRouteId) => {
    if (school) endSchool()   // any other game ends the school (startSchool starts it after this)
    if (schoolAsk.isOpen) { schoolAsk.hide(); schoolMark('asked') }
    sound.start()
    radio?.start()
    menuOpen = false; ui.showMenu(false); ui.hideResults(); ui.hideHelp(); paused = false
    // Courier, Hill Bomb, S.K.A.T.E., the Tour and Muni place the skater themselves; the 2-minute run starts
    // at the park's spot (its letters are there); free skate and the other games start where you are.
    if (mode === 'start') queue(`teleport ${params.get('spot') ?? data.spots.default}`)   // ?spot= in the URL picks where runs start
    if (mode === 'bomb') bombRouteId = route
    if (mode === 'skate') skateLocal = route
    if (mode === 'level') tourLevel = route
    if (mode === 'muni') muniLine = route
    queue(mode === 'bomb' ? `run bomb ${route}` : mode === 'skate' ? `run skate ${route}`.trim() : mode === 'level' ? `run level ${route}` : mode === 'muni' ? `run muni ${route}` : `run ${mode}`).then((res) => { if (!res.ok) toast(res.text) })
    lastGame = mode
    started = true
    // Other skaters ride the park and the city (their own random stream: the player's game is the same with them).
    if (!npcsOn && (park.name === 'soma' || park.name === 'sf')) { npcsOn = true; queue('npc spawn'); if (park.name === 'sf') queue('ped spawn') }   // and people to dodge on the sidewalks
    // Hill bomb: race your best run's ghost.
    ghost = null; ghostSplit = 0
    if (mode === 'bomb') {
      bombCmdTick = sim.world.tick
      // A ghost recorded on another build of the city or other gates would wander off the street: drop it.
      try {
        const g = localStorage.getItem(ghostKey(route)), rp = g ? JSON.parse(g) as Replay : null
        if (rp && rp.meta?.parkHash === park.hash && rp.meta?.gates === ghostGates(route)) { ghost = ghostFrames(rp, park); if (ghost.finish === null) ghost = null }
      } catch { ghost = null }
    }
  }
  let npcsOn = false
  // Each route keeps its own ghost (Dolores keeps the key it always had).
  let bombRouteId = data.run.bomb.id
  const ghostKey = (route: string) => route === data.run.bomb.id ? 'soma-skate:bomb-ghost' : `soma-skate:bomb-ghost:${route}`
  const ghostGates = (route: string) => JSON.stringify(bombRoute(sim, route).gates)
  const bombRoutes = () => [data.run.bomb, ...data.run.bomb.routes]
  ui.bombNames = Object.fromEntries(bombRoutes().map((b) => [b.id, b.name]))
  let ghost: Ghost | null = null, ghostSplit = 0, bombCmdTick = 0
  const BOMB_BLURB: Record<string, string> = { dolores: 'Dolores Street from the top of the park to the bottom.', twinpeaks: '1.6 km down Upper Market to the Castro.', hayes: 'Alamo Square down Hayes Street to Octavia.' }
  const cityGame = (k: 'courier' | 'bomb') => ((data.run as unknown as Record<string, { parks?: string[] }>)[k]?.parks ?? ['sf']).includes(park.name)
  const photo = (n: string) => `assets/ui/photo/${n}.jpg`
  /** A mode's preview: its photograph, what it is, its best in this browser. */
  const modePv = (img: string, title: string, text: string, best?: string | null, here = true): Preview => ({ img: photo(img), wide: true, title, text: here ? text : `${text} Played in San Francisco.`, rows: best ? [['Best', best]] : [] })
  const muniLines = () => (data.run as unknown as { muni?: { lines: { id: string; name: string }[] } }).muni?.lines ?? []
  const fmtN = (n: number) => n.toLocaleString('en-US')
  /** Play: free skate and the game modes, then two players, Skate School and the records. */
  /** Play: free skate, the two kinds of game (sessions in one place; races and errands round the city), two players, school, records. */
  const playItems = (): MenuItem[] => [
    { id: 'm-free', label: 'Free skate', value: () => (session(sim).mode === 'free' && !school?.active ? 'now' : ''), preview: () => modePv('park', 'Free skate', 'No clock. The park, the city, the story. Pick a spot to start from.'), onSelect: () => ui.sub('spots', 'Free skate', spotItems()) },
    { id: 'm-sessions', label: 'Sessions', preview: () => modePv('park-2', 'Sessions', 'Short games in one place: the 2-minute run, the combo challenge, graffiti, S.K.A.T.E.'), onSelect: () => ui.sub('sessions', 'Sessions', sessionItems()) },
    { id: 'm-races', label: 'Races', preview: () => modePv('hill', 'Races', 'Across the city against the clock: hill bombs, Muni, courier, the robotaxi.', null, cityGame('bomb')), onSelect: () => ui.sub('races', 'Races', raceItems()) },
    { id: 'two', label: 'Two players', value: () => (player2(sim) ? 'in' : ''), preview: () => modePv('crew-2', 'Two players', 'Split screen on one keyboard or two pads. Trick attack, HORSE, graffiti.'), onSelect: openLobby },
    ...(schoolHere() ? [school?.active
      ? { id: 'school-leave', label: 'Leave school', preview: () => ({ title: 'Skate School', text: `Lesson: ${school?.lesson?.title ?? ''}` }), onSelect: () => { endSchool(); resume() } }
      : { id: 'school', label: 'Skate School', value: () => (schoolSeen() === 'done' ? 'done' : ''), preview: () => ({ title: 'Skate School', text: 'Two minutes with Karl the Fog: the controls, a lesson at a time.' }), onSelect: startSchool }] : []),
    { id: 'records', label: 'Records', preview: () => ({ title: 'Records', text: 'High scores and milestones, kept in this browser.' }), onSelect: () => ui.sub('records', 'Records', recordItems()) },
  ]
  const sessionItems = (): MenuItem[] => [
    { id: 'm-run', label: '2-minute run', preview: () => modePv('park-2', '2-minute run', 'Two minutes in the park. S-K-A-T-E letters, gaps and goals.', ui.scoresBest()), onSelect: () => choose('start') },
    { id: 'm-combo', label: 'Combo challenge', preview: () => modePv('hill-2', 'Combo challenge', 'Sixty seconds. Only your best single combo counts.', ui.modeBest('combo') ? fmtN(ui.modeBest('combo')!) : null), onSelect: () => choose('combo') },
    { id: 'm-graffiti', label: 'Graffiti', preview: () => modePv('board', 'Graffiti', 'Two minutes. Every rail, ledge and gap in a landed combo gets your tag.', ui.modeBest('graffiti') ? `${ui.modeBest('graffiti')} pieces` : null), onSelect: () => choose('graffiti') },
    { id: 'm-skate', label: 'S.K.A.T.E.', off: !skateGame(), preview: () => modePv('crew', 'Game of S.K.A.T.E.', 'Flatground against a local. Miss a trick, take a letter.', ui.modeBest('skateWins') ? `${ui.modeBest('skateWins')} wins` : null, skateGame()), onSelect: () => (skateGame() ? ui.sub('skate', 'S.K.A.T.E.', skateItems()) : toast('S.K.A.T.E. is played in the park')) },
  ]
  const raceItems = (): MenuItem[] => [
    { id: 'm-bomb', label: 'Hill bomb', off: !cityGame('bomb'), preview: () => modePv('hill', 'Hill bomb', 'Race down a hill through the gates against the locals and your own ghost.', null, cityGame('bomb')), onSelect: () => (cityGame('bomb') ? ui.sub('bomb', 'Hill bomb', bombItems()) : toast('The hill bombs are in San Francisco')) },
    { id: 'm-muni', label: 'Muni race', off: !cityGame('bomb'), preview: () => modePv('night-2', 'Muni race', 'Beat the streetcar to its stops.', ui.modeBest('muni') ? `${ui.modeBest('muni')!.toFixed(1)} s` : null, cityGame('bomb')), onSelect: () => (cityGame('bomb') ? ui.sub('muni', 'Muni race', muniItems()) : toast('Muni races are in San Francisco')) },
    { id: 'm-courier', label: 'Courier', off: !cityGame('courier'), preview: () => modePv('hill-2', 'Courier', 'Burritos across the Mission against the clock.', ui.modeBest('courier') ? `${ui.modeBest('courier')} deliveries` : null, cityGame('courier')), onSelect: () => (cityGame('courier') ? choose('courier') : toast('Courier is in San Francisco')) },
    { id: 'm-escape', label: 'Robotaxi escape', off: !cityGame('bomb'), preview: () => modePv('night', 'Robotaxi escape', 'Ninety seconds. It thinks you are a road hazard. Tricks make it recalculate.', ui.modeBest('escape') ? fmtN(ui.modeBest('escape')!) : null, cityGame('bomb')), onSelect: () => (cityGame('bomb') ? choose('escape') : toast('Robotaxi escape is in San Francisco')) },
  ]
  const bombItems = (): MenuItem[] => bombRoutes().map((b) => ({ id: `m-bomb-${b.id}`, label: b.name, value: () => (ui.bombBest(b.id) ? `${ui.bombBest(b.id)!.toFixed(2)} s` : ''), preview: () => modePv('hill', b.name, BOMB_BLURB[b.id] ?? `${b.name}, top to bottom.`, ui.bombBest(b.id) ? `${ui.bombBest(b.id)!.toFixed(2)} s` : null), onSelect: () => choose('bomb', b.id) }))
  const muniItems = (): MenuItem[] => muniLines().map((l) => ({ id: `m-muni-${l.id}`, label: l.name, preview: () => modePv('night-2', l.name, 'Beat the streetcar to its stops.'), onSelect: () => choose('muni', l.id) }))
  const recordItems = (): MenuItem[] => [
    { id: 'scores', label: 'High scores', preview: () => ({ title: 'High scores', rows: ui.scoresRows() }), onSelect: () => ui.showScores() },
    { id: 'stickers', label: 'Milestones', value: () => (stickers ? `${stickers.earnedCount} of ${stickers.all.length}` : ''), preview: () => ({ title: 'Milestones', text: 'Firsts, streaks and places, earned once.' }), onSelect: () => { if (stickers) ui.showStickers(stickers.all) } },
  ]
  // The Tour: levels with goal lists (data/tour.json); the career and unlocks are kept in the browser.
  ui.careerHas = (level, goal) => career.has(level, goal)
  // Places you skate into count as client events for stickers and the daily (never the sim).
  ui.onPlace = (name) => { const e = { t: 'placeVisit', name } as unknown as SimEvent; stickers?.event(e); daily?.event(e) }
  let tourLevel = '', justOpened: string[] = [], tourNext = false, muniLine = 'j'
  const playable = (L: (typeof data.tour.levels)[number]) => L.world === park.name || !!L.worlds?.includes(park.name)
  /** The neighbourhoods' challenges in two areas (no list past about seven rows): the Mission side and the hills, downtown and the bay. */
  const TOUR_AREAS: [string, string, string[]][] = [['south', 'Mission and the hills', ['soma', 'mission', 'castro', 'hills', 'hayes']], ['north', 'Downtown and the bay', ['civic', 'embarcadero', 'chinatown', 'russianhill', 'northbeach', 'wharf']]]
  const levelRow = (L: (typeof data.tour.levels)[number]): MenuItem => ({ id: `tour:${L.id}`, label: L.name, value: () => `${career.doneIn(L.id).length} of ${career.goalIds(L).length}`, preview: () => ({ title: L.name, text: 'Two minutes: S-K-A-T-E, the secret tape, Pro and Sick, and three goals of its own.', rows: [['Goals', `${career.doneIn(L.id).length} of ${career.goalIds(L).length}`]] }), onSelect: () => ui.sub(`level:${L.id}`, L.name, levelItems(L)) })
  const tourItems = (): MenuItem[] => {
    const placed = new Set(TOUR_AREAS.flatMap((x) => x[2]))
    const areas = TOUR_AREAS.map(([id, title, ids]) => ({ id, title, levels: career.levels.filter((L) => ids.includes(L.id)) }))
    const rest = career.levels.filter((L) => !placed.has(L.id))   // a level added later: an area of its own
    if (rest.length) areas.push({ id: 'more', title: 'More', levels: rest })
    return areas.filter((x) => x.levels.length).map((x) => ({ id: `area:${x.id}`, label: x.title, value: () => `${x.levels.reduce((n, L) => n + career.doneIn(L.id).length, 0)} of ${x.levels.reduce((n, L) => n + career.goalIds(L).length, 0)}`, preview: () => ({ title: x.title, text: x.levels.map((L) => L.name).join(', ') + '.' }), onSelect: () => ui.sub(`area:${x.id}`, x.title, x.levels.map(levelRow)) }))
  }
  const levelItems = (L: (typeof data.tour.levels)[number]): MenuItem[] => [
    { id: `lvl-go:${L.id}`, label: 'Start', value: () => '2:00', preview: () => ({ title: L.name, text: playable(L) ? 'From the top of the level.' : `Played in the ${L.world} world.` }), onSelect: () => (playable(L) ? choose('level', L.id) : toast(`${L.name} is played in the ${L.world} world`)) },
    ...(L.starts ?? []).map((st) => ({ id: `lvl-go:${L.id}:${st}`, label: spotLabel(st), value: () => '2:00', preview: () => ({ title: L.name, text: `From ${spotLabel(st)}.` }), onSelect: () => choose('level', `${L.id} ${st}`) })),
    { id: `lvl-goals:${L.id}`, label: 'Goals', value: () => `${career.doneIn(L.id).length} of ${career.goalIds(L).length}`, preview: () => ({ title: 'Goals', text: career.goalIds(L).map((id) => career.goalName(L, id)).join(', ') + '.' }), onSelect: () => ui.sub(`goals:${L.id}`, 'Goals', career.goalIds(L).map((id) => ({ id: `lvl-goal:${id}`, label: career.goalName(L, id), off: !career.has(L.id, id), value: () => (career.has(L.id, id) ? 'done' : ''), preview: () => ({ title: career.goalName(L, id), text: career.goalLine(L, id) }), onSelect: () => toast(career.goalLine(L, id)) }))) },
  ]
  // Game of S.K.A.T.E.: pick the local you play (data run.skate.locals).
  let skateLocal = ''
  const skateData = () => (data.run as unknown as { skate?: { parks: string[]; locals: { id: string; name: string; hood: string; favorites?: string[] }[] } }).skate
  const skateGame = () => !!skateData()?.parks.includes(park.name)
  const skateItems = (): MenuItem[] => (skateData()?.locals ?? []).map((l) => ({ id: `skate:${l.id}`, label: l.name, value: () => l.hood, preview: () => ({ img: portrait(l.id), title: l.name, text: `From ${l.hood}.` }), onSelect: () => choose('skate', l.id) }))
  // ---- 2 Players (twoplayer.ts): the lobby, then a two-player game in split screen ----
  const keyText = (K: Keyboard) => ({ up: keyName(K.keysFor('up')[0] ?? ''), down: keyName(K.keysFor('down')[0] ?? ''), left: keyName(K.keysFor('left')[0] ?? ''), right: keyName(K.keysFor('right')[0] ?? ''), ollie: keyName(K.keysFor('ollie')[0] ?? ''), grab: keyName(K.keysFor('grab')[0] ?? '') })
  const lobby = new Lobby(TP, () => [keyText(keys), keyText(keys2)])
  const openLobby = () => {
    ui.showMenu(false)
    const cast = r.skater.cast.filter((c) => !unlocks.locked(c.id)).map((c) => ({ id: c.id, name: c.name }))
    lobby.open(cast, r.skater.characterId, player2(sim) ? p2view?.characterId ?? p2Saved() ?? cast[0]?.id ?? null : null, p2Saved())
  }
  lobby.onJoin = () => { queue('player2 join'); stepBudget += 12; void ensureP2View() }
  lobby.onLeave = () => { queue('player2 leave'); stepBudget += 1 }
  lobby.onPick = (p, id) => {
    if (p === 1) { r.skater.setCharacter(id); try { localStorage.setItem('soma-skate.character', id) } catch { /* not remembered */ } }
    else { p2view?.setCharacter(id); try { localStorage.setItem(P2KEY, id) } catch { /* not remembered */ } }
  }
  lobby.onBack = () => { lobby.close(); ui.setMenu(menuItems()); ui.showMenu(true) }   // back where it was opened (Play)
  lobby.onStart = (mode) => { lobby.close(); choose2p(mode) }
  /** A two-player game (or free skate for two): both start together, player 2 beside player 1 (HORSE: at the spot). */
  const choose2p = (mode: string) => {
    if (school) endSchool()
    if (schoolAsk.isOpen) { schoolAsk.hide(); schoolMark('asked') }
    sound.start(); radio?.start()
    menuOpen = false; ui.showMenu(false); ui.hideResults(); ui.hideHelp(); results2p.close(); paused = false
    // One command line, so it is tried (and applied) in order: player 2 back in beside player 1, then the game.
    const cmds = [...(mode !== 'horse2p' ? [`teleport ${data.spots.default}`] : []), ...(player2(sim) ? ['player2 leave'] : []), 'player2 join', mode === 'free' ? 'run free' : `run ${mode}`]
    queue(cmds.join('; ')).then((res) => { if (!res.ok) toast(res.text) })
    void ensureP2View()
    lastGame2p = mode; lastGame = 'free'; started = true; ghost = null
    if (!npcsOn && (park.name === 'soma' || park.name === 'sf')) { npcsOn = true; queue('npc spawn'); if (park.name === 'sf') queue('ped spawn') }
  }
  results2p.onAgain = () => choose2p(lastGame2p)
  results2p.onMenu = () => openMenu()
  ui.modePanel = () => twoPlayerPanel(sim, 1)
  split!.hud.modePanel = () => twoPlayerPanel(sim, 2)
  const resume = () => { menuOpen = false; ui.showMenu(false); paused = false; canvas.focus(); drawSchool() }   // the card again, with any keys rebound meanwhile
  // The pause menu (Esc; the pad's options): six entries, the rest one level down (docs/art-direction.md).
  const portrait = (id: string) => `assets/ui/portrait/${id}.jpg`
  const castName = (id: string) => data.cast.cast.find((c) => c.id === id)?.name ?? ''
  const whereNow = () => { const p = skater(sim).pos, at = park.name === 'sf' ? ui.placeAt(p.x, p.y) : null; return at?.name ?? 'SoMa West Skatepark' }
  const gameName: Record<string, string> = { free: 'Free skate', run: '2-minute run', courier: 'Courier', combo: 'Combo challenge', bomb: 'Hill bomb', skate: 'Game of S.K.A.T.E.', level: 'Challenge', muni: 'Muni race', escape: 'Robotaxi escape', graffiti: 'Graffiti' }
  const menuItems = (): MenuItem[] => [
    { id: 'resume', label: 'Resume', preview: () => ({ title: whereNow(), text: session(sim).mode !== 'free' ? gameName[session(sim).game] ?? '' : school?.active ? `Skate School: ${school.lesson?.title ?? ''}` : story?.objective || 'Free skate.', rows: ui.sessionRows() }), onSelect: resume },
    { id: 'missions', label: 'Missions', preview: missionsPreview, onSelect: openMissions },
    { id: 'map', label: 'Map', preview: () => ({ title: whereNow(), text: 'The city. Pick a place in the list and go there.', rows: [['Key', 'M']] }), onSelect: () => story?.openMap('menu') },
    { id: 'character', label: 'Skater', preview: () => ({ img: portrait(r.skater.characterId), title: r.skater.characterName, text: 'Skaters, boards, outfits and Create-a-Skater.', rows: [['Next skater', 'Tab']] }), onSelect: openPicker },
    { id: 'play', label: 'Play', preview: () => ({ title: session(sim).mode !== 'free' ? gameName[session(sim).game] ?? 'Play' : 'Free skate', text: 'Free skate, the game modes, two players, Skate School and your records.' }), onSelect: openPlay },
    { id: 'settings', label: 'Settings', preview: () => ({ title: 'Settings', text: 'Sound and the radio, picture and the weather, camera, HUD, controls, help.', rows: [['Radio', radio?.isOn ? radio.current ?? 'on' : 'off'], ['Weather', weatherLabel()]] }), onSelect: openSettings },
  ]
  /** Missions: the one on, the journal, the neighbourhoods' challenges, today's challenge, the city's goals. */
  const missionsPreview = (): Preview => {
    const m = session(sim).mission, M = m ? data.missions.missions.find((x) => x.id === m.id) : null
    if (M) return { img: portrait(M.giver), title: M.name, text: story?.objective ?? '', rows: [['From', castName(M.giver)]] }
    return { title: 'Missions', text: 'The story, the neighbourhoods’ challenges and today’s challenge.', rows: [['Stories', story ? `${story.save.done.length} of ${data.missions.missions.length}` : ''], ['Challenges', `${career.total} of ${career.max}`]] }
  }
  const missionItems = (): MenuItem[] => [
    ...(story ? story.menuItems(sim).map((it) => ({ ...it, onSelect: () => { it.onSelect(); resume() } })) : []),
    ...(school?.active ? [{ id: 'school-skip', label: 'Skip lesson', preview: () => ({ title: 'Skate School', text: school?.lesson?.title ?? '' }), onSelect: () => { resume(); if (school) schoolSignals(school.skip()) } }] : []),
    { id: 'journal', label: 'Journal', value: () => (story ? `${story.save.done.length} of ${data.missions.missions.length}` : ''), preview: () => ({ title: 'Journal', text: 'Every story, who gives it, what you got.' }), onSelect: () => story?.openJournal('menu') },
    { id: 'tour', label: 'Challenges', value: () => `${career.total} of ${career.max}`, preview: () => ({ title: 'Challenges', text: 'Two-minute levels round the city, every neighbourhood open.' }), onSelect: openChallenges },
    { id: 'daily', label: 'Today', value: () => (daily?.done ? 'done' : daily && daily.need > 1 ? `${daily.progress} of ${daily.need}` : ''), preview: () => (daily ? { title: 'Today', text: daily.today.text, rows: daily.streak > 1 ? [['Streak', `${daily.streak} days`]] : [] } : null), onSelect: () => goDaily() },
    { id: 'goals', label: 'Goals', value: () => { const g = sim.data.goals?.goals ?? []; const d = ui.cityGoalsDone(); return `${g.filter((x) => d.has(x.id)).length} of ${g.length}` }, preview: () => ({ title: 'Goals', text: 'Always on, in free skate and every mode.' }), onSelect: () => ui.showGoals(sim.data.goals.goals) },
  ]
  const openMissions = () => ui.sub('missions', 'Missions', missionItems())
  const openChallenges = () => ui.sub('tour', 'Challenges', tourItems())
  const openPlay = () => ui.sub('play', 'Play', playItems())
  const openSettings = () => ui.sub('settings', 'Settings', settingsItems())
  // Radio: off, then the stations in three: the game's own (their place is a phrase, not a city: radio.json where), San Francisco's, elsewhere.
  type Station = { i: number; name: string; where: string; about: string; on: boolean }
  const RADIO_GROUPS: [string, string, (st: Station) => boolean][] = [['ours', 'SoMa stations', (st) => /^[a-z]/.test(st.where)], ['sf', 'San Francisco', (st) => /^San Francisco/.test(st.where)], ['world', 'Elsewhere', (st) => !/^[a-z]/.test(st.where) && !/^San Francisco/.test(st.where)]]
  const stationRow = (st: Station, gid: string, title: string): MenuItem => ({ id: `radio:${st.i}`, label: st.name, value: () => (st.on ? 'on' : ''), preview: (): Preview => ({ title: st.name, text: st.about, rows: [['From', st.where]] }), onSelect: () => { radio?.pick(st.i); ui.sub(`radio:${gid}`, title, (radio?.stations ?? []).filter(RADIO_GROUPS.find((x) => x[0] === gid)![2]).map((x) => stationRow(x, gid, title))) } })
  const radioItems = (): MenuItem[] => [
    { id: 'radio:off', label: 'Off', value: () => (radio?.isOn ? '' : 'on'), onSelect: () => { if (radio?.isOn) radio.toggle(); ui.sub('radio', 'Radio', radioItems()) } },
    ...RADIO_GROUPS.map(([gid, title, has]) => ({ id: `radio-g:${gid}`, label: title, value: () => ((radio?.stations ?? []).some((st) => st.on && has(st)) ? 'on' : ''), preview: () => ({ title, text: (radio?.stations ?? []).filter(has).map((st) => st.name).join(', ') + '.' }), onSelect: () => ui.sub(`radio:${gid}`, title, (radio?.stations ?? []).filter(has).map((st) => stationRow(st, gid, title))) })),
  ]
  // Settings (settings.ts, data/settings.json): pages of cycled values, remembered in this browser.
  const settings = new Settings(settingsData)
  // The on-screen controls for phones and tablets (touch.ts): their buttons join the keyboard's; the menu button is Esc.
  const touch: TouchPad | null = new TouchPad(touchData, params.has('touch'))
  touch.onBits = (b) => { keys.extra = b }
  touch.onMenu = () => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', key: 'Escape', bubbles: true }))
  touch.onShow = () => drawSchool()   // Karl's card shows the controls in use
  /** The diamond's letters follow player 1's rebinds where the new key is a letter or a digit. */
  const touchLabels = () => touch.setLabels((a) => { const c = keys.keysFor(a)[0] ?? ''; return /^(Key|Digit)/.test(c) ? keyName(c) : null })
  let presetOn = ''
  const applySettings = () => {
    const S = settings, P = S.palette, root = document.documentElement.style
    sound.setVolume(S.get<number>('master')); sound.setVolumes({ sfx: S.get('sfx'), voices: S.get('voices'), ambience: S.get('ambience') })
    radioVolume.v = S.get('music'); radio?.setVolume(S.get('music'))
    Cam.zoom = S.get('cameraDistance'); Cam.lift = S.get('cameraHeight'); Cam.calm = S.get('reduceMotion'); Cam.calmFov = S.d.reduceMotion.fovScale
    director.level = S.get('slowmo'); director.cameras = S.get<boolean>('trickCams') && !S.get<boolean>('reduceMotion')
    if (fx) fx.calm = S.get('reduceMotion')
    if (cas) cas.calm = !!S.get('reduceMotion')
    document.body.classList.toggle('no-minimap', !S.get('minimap'))
    document.body.classList.toggle('hud-off', !S.get('hud'))
    document.body.classList.toggle('hud-contrast', S.get('highContrast'))
    root.setProperty('--hud-scale', String(S.get('hudScale')))
    for (const h of [ui, split?.hud]) if (h) { h.units = S.get('units'); h.mph = S.d.mph; h.hintsOn = S.get('hints') }
    // The palette: the players' graffiti colours (the chrome keeps the three colours), marks on the meter's danger ends when colour-blind safe.
    document.body.classList.toggle('meter-hatch', P.hatch)
    TP.colors[0] = P.p1; TP.colors[1] = P.p2; tagPaint.setColors(TP.colors)
    keys.rumbleOn = keys2.rumbleOn = S.get('rumble')
    // Quality: its preset (data/settings.json presets) when it changes: pixel ratio, passes, shadows,
    // draw distance, NPC detail, birds; auto's render scale then moves within the preset's range.
    const q = S.get<string>('quality'), QP = settingsData.presets?.[q]
    if (QP && q !== presetOn) {
      presetOn = q
      r.setPreset(QP); npcViews.setLod(QP.npcDistance, QP.npcDetail); pigeons.setDensity(QP.birds); seaLions?.setQuality(QP.sealions ?? 1, QP.drawDistance); traffic.setDetail(QP.carDetail ?? 120); if (crowd) crowd.vignetteLow = (QP.vignettes ?? 1) < 1; vignettes?.setScale(QP.vignettes ?? 1); if (castPeople) castPeople.simpleBeyond = QP.castSimple ?? 0
      r.setScale(q === 'auto' ? Math.min(QP.scale[1], Math.max(QP.scale[0], r.renderScale)) : QP.scale[0])
    }
    touch?.setMode(S.get('touch'))
    // Settings > Video: the filmer's lens and the PS2 picture (render.ts setPicture; data/settings.json lens, picture).
    r.setPicture({ lens: S.def('lens') ? S.get<boolean>('lens') : true, ps2: S.get('picture') === 'ps2' })
  }
  let resetArmed = false
  /** One option as a row: choosing it moves it to its next value; its note is the preview. listId/title: the list it redraws. */
  const optionRow = (o: (typeof settings.d.groups)[number]['options'][number], listId: string, title: string, rows: () => MenuItem[]): MenuItem => {
    const val = () => (o.id === 'quality' && settings.get('quality') === 'auto' ? `auto ${Math.round(r.renderScale * 100)}%` : settings.label(o.id))
    return { id: `s-${o.id}`, label: o.label, value: val, preview: () => ({ title: o.label, text: o.note ?? '', rows: [['Now', val()]] }), onSelect: () => { settings.cycle(o.id); applySettings(); ui.sub(listId, title, rows()) } }
  }
  const opts = (gid: string, except: string[] = []) => settings.d.groups.find((g) => g.id === gid)?.options.filter((o) => !except.includes(o.id)) ?? []
  /** Settings in seven (no list past about seven rows): sound with the radio, picture with the weather, camera, HUD, controls, help, reset. */
  const SET_GROUPS: Record<string, string> = { audio: 'sound', video: 'picture', access: 'picture', camera: 'camera', hud: 'hud' }
  const soundItems = (): MenuItem[] => [
    { id: 'radio', label: 'Radio', value: () => (radio?.isOn ? radio.current ?? '' : 'off'), preview: () => ({ title: 'Radio', text: 'The stations of the city. Keys [ and ] change station, \\ turns it off.' }), onSelect: () => { sound.start(); if (radio) ui.sub('radio', 'Radio', radioItems()) } },
    ...opts('audio').map((o) => optionRow(o, 'sound', 'Sound', soundItems)),
  ]
  const pictureItems = (): MenuItem[] => [
    { id: 'weather', label: 'Weather', value: () => weatherLabel(), preview: () => ({ title: 'Weather', text: 'Choose to change it. The last one is the real weather in San Francisco right now.' }), onSelect: () => { cycleWeather(); ui.sub('picture', 'Picture', pictureItems()) } },
    ...[...opts('video', ['rumble', 'touch']), ...opts('access')].map((o) => optionRow(o, 'picture', 'Picture', pictureItems)),
  ]
  const groupList = (gid: string, title: string) => (): MenuItem[] => opts(gid).map((o) => optionRow(o, gid, title, groupList(gid, title)))
  const settingsItems = (): MenuItem[] => [
    { id: 'sg-sound', label: 'Sound', preview: () => ({ title: 'Sound', rows: [['Radio', radio?.isOn ? radio.current ?? 'on' : 'off'], ...opts('audio').slice(0, 3).map((o) => [o.label, settings.label(o.id)] as [string, string])] }), onSelect: () => ui.sub('sound', 'Sound', soundItems()) },
    { id: 'sg-picture', label: 'Picture', preview: () => ({ title: 'Picture', rows: [['Weather', weatherLabel()], ...[...opts('video', ['rumble', 'touch']), ...opts('access')].map((o) => [o.label, settings.label(o.id)] as [string, string])] }), onSelect: () => ui.sub('picture', 'Picture', pictureItems()) },
    { id: 'sg-camera', label: 'Camera', preview: () => ({ title: 'Camera', rows: opts('camera').slice(0, 5).map((o) => [o.label, settings.label(o.id)] as [string, string]) }), onSelect: () => ui.sub('camera', 'Camera', groupList('camera', 'Camera')()) },
    { id: 'sg-hud', label: 'HUD', preview: () => ({ title: 'HUD', rows: opts('hud').slice(0, 5).map((o) => [o.label, settings.label(o.id)] as [string, string]) }), onSelect: () => ui.sub('hud', 'HUD', groupList('hud', 'HUD')()) },
    // A settings page added later (a new group in data/settings.json): its own entry, so nothing is lost.
    ...settings.d.groups.filter((g) => !SET_GROUPS[g.id]).map((g) => ({ id: `sg-${g.id}`, label: g.label, onSelect: () => ui.sub(g.id, g.label, groupList(g.id, g.label)()) })),
    { id: 's-controls', label: 'Controls', preview: () => ({ title: 'Controls', text: 'Rebind any key, for player 1 and player 2. Rumble and the touch controls.' }), onSelect: () => ui.sub('controls', 'Controls', controlsItems()) },
    { id: 's-help', label: 'Help', preview: () => ({ title: 'Help', text: 'How to play, the trick list, the credits.' }), onSelect: () => ui.sub('help', 'Help', helpItems()) },
    { id: 's-resets', label: 'Reset', preview: () => ({ title: 'Reset', text: 'Settings back to their defaults, or your progress wiped.' }), onSelect: () => ui.sub('resets', 'Reset', resetItems()) },
  ]
  const helpItems = (): MenuItem[] => [
    { id: 'help', label: 'How to play', preview: () => ({ title: 'How to play', text: 'Every key, on one page.', rows: [['Key', 'H']] }), onSelect: () => ui.toggleHelp() },
    { id: 'tricks', label: 'Trick list', preview: () => ({ title: 'Trick list', text: 'Every flip, grab, grind, slide and special, with its keys and points. Double taps and Nollie included.' }), onSelect: () => ui.showTricks(sim.data.tricks) },
    { id: 'credits', label: 'Credits', onSelect: () => ui.showCredits() },
  ]
  const resetItems = (): MenuItem[] => [
    { id: 's-defaults', label: 'Settings', preview: () => ({ title: 'Reset settings', text: 'Every option back to its default. Keys, progress and your skater stay.' }), onSelect: () => { settings.reset(); applySettings(); toast('Settings reset'); ui.back() } },
    { id: 's-reset', label: resetArmed ? 'Press again' : 'Progress', preview: () => ({ title: 'Reset progress', text: 'Scores, bests, ghosts, goals, milestones and the challenges. Settings, keys and your skater stay.' }), onSelect: () => {
      if (!resetArmed) { resetArmed = true; ui.sub('resets', 'Reset', resetItems()); window.setTimeout(() => { resetArmed = false; if (menuOpen && ui.menuAt === 'resets') ui.sub('resets', 'Reset', resetItems()) }, 4000); return }
      // Progress only: settings, keys, radio, weather and the character stay.
      try { for (const k of Object.keys(localStorage)) if (/^soma-skate:(scores|bomb-best|bomb-ghost|mode-bests|city-goals|stickers|daily|hints|tour)/.test(k)) localStorage.removeItem(k) } catch { /* private window */ }
      location.reload()
    } },
  ]
  // Controls: rebind the first key of each gameplay action (saved in this browser), the actions in four groups.
  const KKEY = 'soma-skate:keys', KKEY2 = 'soma-skate:keys2'
  const ACTIONS: [string, string, string][] = [['up', 'Push', 'move'], ['down', 'Brake', 'move'], ['left', 'Left', 'move'], ['right', 'Right', 'move'],
    ['ollie', 'Ollie', 'tricks'], ['nose', 'Nollie', 'tricks'], ['flip', 'Flip', 'tricks'], ['grab', 'Grab', 'tricks'], ['spinL', 'Spin left', 'tricks'], ['spinR', 'Spin right', 'tricks'],
    ['grind', 'Grind', 'ground'], ['revert', 'Revert', 'ground'], ['slide', 'Powerslide', 'ground'], ['walk', 'Step off', 'ground'], ['interact', 'Talk', 'more'], ['markerSet', 'Drop marker', 'more'], ['markerGo', 'Back to marker', 'more']]
  const KEY_GROUPS: [string, string][] = [['move', 'Move'], ['tricks', 'Tricks'], ['ground', 'Rails and ground'], ['more', 'More']]
  /** Every keyboard action: the named ones, then any data/controls.json adds later (in More, its id spelled out). */
  const allActions = (p: 1 | 2 = 1): [string, string, string][] => [...ACTIONS, ...Object.keys(controls.keyboard).filter((a) => !ACTIONS.some((x) => x[0] === a)).map((a) => [a, a.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()), 'more'] as [string, string, string])].filter((x) => p === 1 || !x[0].startsWith('marker'))
  const controlsItems = (): MenuItem[] => [
    { id: 'k-p1', label: 'Player 1', preview: () => ({ title: 'Player 1', text: 'The keyboard: WASD, the I J K L diamond, U and O to spin.' }), onSelect: () => ui.sub('keys1', 'Player 1', keyGroupItems(1)) },
    { id: 'k-p2', label: 'Player 2', preview: () => ({ title: 'Player 2', text: 'The arrows and the numpad, or the second pad.' }), onSelect: () => ui.sub('keys2', 'Player 2', keyGroupItems(2)) },
    ...opts('video').filter((o) => o.id === 'rumble' || o.id === 'touch').map((o) => optionRow(o, 'controls', 'Controls', controlsItems)),
  ]
  const keyGroupItems = (p: 1 | 2): MenuItem[] => {
    const K = p === 1 ? keys : keys2, key = p === 1 ? KKEY : KKEY2
    return [
      ...KEY_GROUPS.map(([g, title]) => ({ id: `kg${p}-${g}`, label: title, value: () => allActions(p).filter((x) => x[2] === g).map((x) => K.keysFor(x[0]).map(keyName)[0] ?? '').join(' '), preview: () => ({ title, rows: allActions(p).filter((x) => x[2] === g).map((x) => [x[1], K.keysFor(x[0]).map(keyName).join(' ')] as [string, string]) }), onSelect: () => ui.sub(`kg${p}-${g}`, title, controlItems(p, g, title)) })),
      { id: `k${p}-reset`, label: 'Defaults', preview: () => ({ title: 'Defaults', text: `${p === 2 ? 'Player 2’s' : 'Every'} key back to how it came.` }), onSelect: () => { try { localStorage.removeItem(key) } catch { /* private window */ } location.reload() } },
    ]
  }
  /** One group of one player's keys, rebound one action at a time (kept per player). */
  const controlItems = (p: 1 | 2, g: string, title: string): MenuItem[] => {
    const K = p === 1 ? keys : keys2, key = p === 1 ? KKEY : KKEY2, P = p === 2 ? 'Player 2: ' : '', id = `kg${p}-${g}`
    return allActions(p).filter((x) => x[2] === g).map(([a, label]) => ({ id: `k${p}-${a}`, label, value: () => K.keysFor(a).map(keyName).join(' '), preview: () => ({ title: label, text: 'Choose it, then press the new key. Esc cancels.' }), onSelect: () => {
      toast(`Press a key for ${P}${label}. Esc cancels`)
      K.capture = (code) => {
        if (code) { K.rebind(a, code); try { localStorage.setItem(key, JSON.stringify(K.rebinds)) } catch { /* private window */ } toast(`${P}${label}: ${keyName(code)}`); if (split?.active) keys.giveWay(keys2); touchLabels(); drawSchool() }
        ui.sub(id, title, controlItems(p, g, title))
      }
    } }))
  }
  try { keys.applyRebinds(JSON.parse(localStorage.getItem(KKEY) ?? '{}')) } catch { /* private window */ }
  touchLabels()
  try { keys2.applyRebinds(JSON.parse(localStorage.getItem(KKEY2) ?? '{}')) } catch { /* private window */ }
  applySettings()
  /** Free skate: right here, or one of the park's named spots (it ends any game); the city's places are on the map (its list). */
  const spotItems = (): MenuItem[] => [
    { id: 'spot:here', label: 'Right here', preview: () => ({ title: whereNow(), text: session(sim).mode !== 'free' ? 'Leaves this game. You stay where you are.' : 'Back to skating. For the city, the map takes Muni to anywhere you have been.' }), onSelect: () => { if (session(sim).mode !== 'free' || school?.active) choose('free'); else resume() } },
    ...data.spots.aliases.map((a) => a.id)
      .map((id) => ({ id: `spot:${id}`, label: spotLabel(id), preview: () => ({ title: spotLabel(id), text: 'In the park.' }), onSelect: () => { if (session(sim).mode !== 'free' || school?.active) choose('free'); queue(`teleport ${id}`); resume() } })),
  ]
  ui.setMenu(menuItems())
  ui.showMenu(false)
  // Free roam from the first frame: the park's skaters and the city's people come out, and the sound and
  // the radio start with the first key, click or tap (browsers keep audio off until then).
  const firstGesture = () => { sound.start(); radio?.start(); story?.woke(performance.now()); window.removeEventListener('keydown', firstGesture, true); window.removeEventListener('pointerdown', firstGesture, true) }
  window.addEventListener('keydown', firstGesture, true)
  window.addEventListener('pointerdown', firstGesture, true)
  // ---- attract mode: after idleSeconds in the pause menu, scripted pro runs (scenarios) as demos ----
  const demoBanner = attractData ? new AttractBanner($("ui"), attractData.banner) : null
  let demo: { clip: ReturnType<typeof clipApi>; ticks: number; t0: number } | null = null
  let demoClip: ReturnType<typeof clipApi> | null = null, demoRun = -1, demoLoading = false, lastInput = performance.now()
  const scripts = new Map<string, string>()
  const startDemo = async () => {
    const A = attractData!
    demoLoading = true
    try {
      for (let n = 0; n < A.runs.length; n++) {
        demoRun = (demoRun + 1) % A.runs.length
        const run = A.runs[demoRun]
        if (!scripts.has(run.scenario)) scripts.set(run.scenario, await (await fetch(`scenarios/${run.scenario}.skate`, { cache: 'no-store' })).text())
        if (!demo && (!menuOpen || now() - lastInput < A.idleSeconds * 1000)) return   // woken while it loaded
        const sc = parseScript(scripts.get(run.scenario)!, run.scenario)
        if (!playableIn(sc.park, park.name)) continue
        const replay = runScript(sc, park, data, run.from, run.to, run.label)
        demoClip ??= clipApi(r, park, src, pigeons, traffic, ui, spectators, npcViews, crowd, dogs, fx, pres)
        ui.showMenu(false); ui.demo = true
        const info = demoClip.load(replay, { hud: true, layers: LAYERS.filter((l) => r.isVisible(l)), style: r.style, weather: r.weather })
        demo = { clip: demoClip, ticks: info.ticks, t0: performance.now() }
        demoBanner?.show(run.label)
        return
      }
      stopDemo()
    } catch (e) { console.warn('attract mode off:', e); attractData = null; stopDemo() } finally { demoLoading = false }
  }
  const now = () => performance.now()
  /** Back to the pause menu from a demo (any key, click or pad button). */
  const stopDemo = () => {
    lastInput = performance.now()
    if (!demo) return
    demo = null
    demoBanner?.show(null)
    ui.demo = false
    document.body.classList.remove('clip')
    r.setClock(null); fx?.reset()
    ui.npcPops([]); ui.racerTags([])
    ui.setMenu(menuItems()); ui.showMenu(true)
  }
  const wake = (e: Event) => { lastInput = performance.now(); if (demo) { e.preventDefault(); e.stopImmediatePropagation(); stopDemo() } }
  window.addEventListener('keydown', wake, true)
  window.addEventListener('pointerdown', wake, true)
  window.addEventListener('pointermove', () => { lastInput = performance.now() }, true)
  window.addEventListener('wheel', () => { lastInput = performance.now() }, true)
  // The very first launch: Karl the Fog starts chapter 1 himself (story.ts; ?nostory skips it, for shots
  // and tests). Skate School is in the pause menu.
  const openMenu = () => { menuOpen = true; paused = true; ui.hideResults(); ui.setMenu(menuItems()); ui.home(); if (tourNext) { openMissions(); openChallenges() } tourNext = false; ui.showMenu(true) }   // after a Tour level, Esc lands on the level list
  // ---- the story (story.ts): the cast, markers, the talk key, dialogue, journal and the city map ----
  const travelEl = document.createElement('div'); travelEl.className = 'muni-travel'; document.body.appendChild(travelEl)
  story = new StoryClient(storyData, {
    data, park, ui, sound, scene: r.scene, root: $('ui'), sim: () => sim, queue: (c) => queue(c), skater: r.skater, gradient: toonGradient(look.toon.bands), people: castPeople,
    talkKeys: () => keys.keysFor('interact'), touch: () => !!touch?.visible, spotLabel,
    startChallenge: (id) => choose('level', id),
    places: uiData.places ?? { spots: [], hoods: [] }, mapWater,
    careerProgress: (id) => career.level(id),
    travel: (spot, label) => takeMuni(spot, label),
    credits: uiData.credits ?? [],
    // The 100% page's categories kept outside the story: milestones, the Tour's tapes, decks, outfits, Create-a-Skater pieces.
    completion: () => {
      const st = stickers?.all ?? [], decks = shop.decks.filter((d) => d.graphic), outs = r.skater.cast.flatMap((c) => (c.outfits ?? []).map((o) => [c.id, o.id] as const))
      const pieces = casData ? unlockable(casData).filter((it) => it.unlock) : []
      return [
        { id: 'stickers', name: 'Milestones', n: st.filter((x) => x.earned).length, of: st.length, face: 'sick' },
        { id: 'tapes', name: 'Secret tapes', n: career.count('tape'), of: data.tour.levels.length, face: 'hella', left: 'One in every neighbourhood\'s open challenges.' },
        { id: 'decks', name: 'Decks', n: decks.filter((d) => !rewards?.deck(d.graphic)).length, of: decks.length, face: 'graduate' },
        { id: 'outfits', name: 'Outfits', n: outs.filter(([c, o]) => !rewards?.outfit(c, o)).length, of: outs.length, face: 'skye' },
        ...(pieces.length ? [{ id: 'pieces', name: 'Create-a-Skater pieces', n: pieces.filter((it) => !casLocks.locked(it)).length, of: pieces.length, face: 'tash' }] : []),
      ]
    },
    onOverlay: (open) => { $('ui').classList.toggle('overlay-open', open); if (open) { menuOpen = false; ui.showMenu(false); paused = true } else if (!menuOpen) { paused = false; canvas.focus() } },
  })
  story.onBackToMenu = () => { menuOpen = true; paused = true; ui.showMenu(true) }   // back to the list it was opened from (the journal: Missions)
  // A story finished: a secret skater it unlocks slaps on (once), like the Tour's.
  rewards = new Rewards({ missions: data.missions.missions, decks: shop.decks, characters: r.skater.cast, stickers: () => stickers?.all ?? [], pieces: () => (casData ? unlockable(casData) : []),
    jobs: { decks: data.jobs.decks, boardName: (id) => data.jobs.boards.find((b) => b.id === id)?.name ?? id, count: (board) => story!.gigCount(board) } }, () => story!.doneSet)
  story.rewards = rewards
  // (A story's own sticker and skater are on its results card, story.ts; the Sticker Book's card stays quiet for those.)
  story.onDone = (e) => { casFresh(e.mission); picker.refresh(); for (const c of unlocks.fresh()) { if (e.unlock === c.id) { sound.event({ t: 'goal' } as SimEvent, skater(sim), sound.ctx?.currentTime ?? 0); continue } ui.stickerEarned({ name: `NEW SKATER: ${c.name.toUpperCase()}`, line: `${c.unlock?.hint ?? ''}: done. Pick them with Tab.`, art: c.id }, 'UNLOCKED'); sound.event({ t: 'goal' } as SimEvent, skater(sim), sound.ctx?.currentTime ?? 0); picker.refresh() } }
  unlocks.fresh(true)   // the story's save now read: unlocks earned before stay quiet
  if (casData) casLocks.fresh(casData, true)   // and Create-a-Skater's pieces
  // The interact action: the talk prompt first, else by a vehicle or in one, get in or out (drivekey.ts).
  const vehicleKey: VehicleKey = new VehicleKey($('ui'), () => { if (!menuOpen && !paused) vehicleKey.act(sim, keys) })   // the touch button: get in or out
  // While driving, the action is getting out (nobody is talked to through the windscreen); on foot or board, a talk prompt goes first.
  keys.onAction = (a) => {
    // The session marker (docs/mechanics/marker.md): Z drops it, Backspace goes back; the sim refuses it in a game.
    if ((a === 'markerSet' || a === 'markerGo') && !menuOpen && !paused) { queue(a === 'markerSet' ? 'marker set' : 'marker go'); return }
    if (a === 'interact' && !menuOpen && !paused) { if (!vehicleKey.driving(sim) && (story?.prompting || story?.talking)) story!.interact(); else vehicleKey.act(sim, keys) } }
  keys.canInteract = () => (!!story?.prompting || vehicleKey.can(sim)) && !menuOpen
  // Player 2 (split screen): its interact key (the numpad's Enter) and pad button only get in and out.
  keys2.onAction = (a) => { if (a === 'interact' && !menuOpen && !paused && player2(sim)) vehicleKey.act(sim, keys2, 2) }
  keys2.canInteract = () => !!player2(sim) && vehicleKey.can(sim, 2) && !menuOpen
  const vehicleKey2 = new VehicleKey($('ui2'))   // player 2's prompt, in its half of the split screen (physics phase 31)
  if (!params.has('nostory')) story.boot(performance.now())
  /** Go to a place (the map's list, or T on the map): its name on a card, the teleport halfway, then on. */
  const takeMuni = (spot: string, label: string) => {
    const T = storyData.travel
    travelEl.innerHTML = `<div><b>${label}</b><em></em></div>`
    travelEl.classList.add('on')
    paused = true
    window.setTimeout(() => { queue(`teleport ${spot}`).then((res) => { if (!res.ok) toast(res.text) }); stepBudget += 12 }, (T.seconds * 1000) / 2)
    window.setTimeout(() => { travelEl.classList.remove('on'); if (!menuOpen && !story?.overlay) paused = false; canvas.focus() }, T.seconds * 1000)
  }
  // Tabbing or clicking away pauses into the menu (the clock and the combo wait for you).
  const autoPause = () => { if (shareRec) endBrowserClip(false); if (started && !menuOpen && !photoMode && !ui.resultsOpen && !story?.overlay && clipBox.style.display !== 'block') openMenu() }
  document.addEventListener('visibilitychange', () => { if (document.hidden) autoPause() })
  window.addEventListener('blur', autoPause)
  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement || picker.isOpen || cas?.isOpen) return
    if (e.code === 'Escape' && document.querySelector('.help.on')) { e.preventDefault(); ui.hideHelp(); return }
    if (photoMode && e.code === 'KeyF') {
      e.preventDefault(); postcardOn = !postcardOn
      try { localStorage.setItem('soma-skate:postcard', postcardOn ? '1' : '0') } catch { /* private window */ }
      showPostcard(); toast(postcardOn ? 'Postcard frame on (F)' : 'Postcard frame off (F)'); return
    }
    if (photoMode && (e.code === 'Enter' || e.code === 'Space')) {
      e.preventDefault()
      r.render()
      const png = postcardOn ? postcard(canvas, postcardText()) : canvas.toDataURL('image/png')
      if (DEV) post('/__skate/photo', { png }).then((x) => toast(x.path ? `Saved: ${x.path}` : `Photo failed: ${x.error}`))
      else { const a = document.createElement('a'); a.href = png; a.download = `soma-skate-${Date.now()}.png`; a.click(); toast('Saved to your downloads') }   // hosted build: the browser downloads it
      return
    }
    if (photoMode && e.code === 'Escape') { e.preventDefault(); keys.onDev('photo'); return }
    if (e.code === 'Escape' && shareRec) { e.preventDefault(); endBrowserClip(false); return }
    if (e.code === 'Escape' && !pinMode && clipBox.style.display !== 'block') { e.preventDefault(); if (menuOpen) resume(); else openMenu(); return }
    // Enter (the pad's options) opens the pause menu while skating; in the menu it picks the selected entry (ui.ts).
    if (e.code === 'Enter' && !menuOpen && !ui.resultsOpen && !photoMode && !intro && !story?.talking && !story?.overlay) { e.preventDefault(); openMenu(); return }
    if (!ui.resultsOpen) return
    // A game's results: Enter plays it again, F (or Esc) goes back to free skate where you are.
    if (e.code === 'Enter') { e.preventDefault(); const g = lastGame; choose(g, g === 'skate' ? skateLocal : g === 'level' ? tourLevel : g === 'muni' ? muniLine : bombRouteId) }
    if (e.code === 'KeyF') { e.preventDefault(); choose('free') }
  })
  let prev = pose(skater(sim)), curr = prev
  let orbit: OrbitControls | null = null
  const spotIds = [...data.spots.aliases.map((a) => a.id), ...park.spots.map((s) => s.id)]
  cam.step(skater(sim), true)

  const hud = $('hud'), log = $('log')
  const camDir = new THREE.Vector3()
  const toast = (msg: string) => ui.toast(msg)
  // Layer 4 (hud) hides the whole UI; the dev readouts (state, event log) show with layer 6 (debug).
  const devPanels = () => { for (const id of ['hud', 'log']) $(id).style.display = r.isVisible('hud') && r.isVisible('debug') ? '' : 'none' }
  r.onLayerChange = (layer, on) => { if (layer === 'hud') $('ui').style.display = on ? '' : 'none'; devPanels() }
  devPanels()

  const queue = (text: string) => new Promise<{ ok: boolean; text: string }>((resolve) => {
    try { parseCommands(text) } catch (e) { resolve({ ok: false, text: (e as Error).message }); return }
    pending.push({ text, resolve })
  })
  // Free roam from the first frame: the park's skaters and the city's people come out (their own random streams).
  if (park.name === 'soma' || park.name === 'sf') { npcsOn = true; queue('npc spawn'); if (park.name === 'sf') queue('ped spawn') }

  /** Client-side commands for the bridge (not sim commands, never recorded). */
  const clientCommand = (text: string): string | null => {
    const [name, a, b] = text.trim().split(/\s+/)
    switch (name) {
      case 'pause': paused = true; return 'paused'
      case 'resume': paused = false; return 'resumed'
      case 'step': stepBudget += Number(a ?? 1); return `stepping ${a ?? 1}`
      case 'layer': if (!LAYERS.includes(a as Layer)) return `layers: ${LAYERS.join(', ')}`; r.setLayer(a as Layer, b !== 'off'); return `layer ${a} ${b !== 'off' ? 'on' : 'off'}`
      case 'cam': if (!CAM_MODES.includes(a as CamMode)) return `cams: ${CAM_MODES.join(', ')}`; setCam(a as CamMode); return `cam ${a}`
      case 'state': return stateLine()
      default: return null
    }
  }

  const stateLine = () => {
    const t = skater(sim)
    const sp = Math.hypot(t.vel.x, t.vel.y, t.vel.z)
    return `tick ${sim.world.tick} ${t.state} pos ${t.pos.x.toFixed(2)} ${t.pos.y.toFixed(2)} ${t.pos.z.toFixed(2)} speed ${sp.toFixed(2)} spot ${t.spot}${paused ? ' (paused)' : ''}`
  }

  /** Settings > Camera > Invert look, for the free camera and photo mode (read each time it turns, so a change takes at once). */
  const invertLook = (o: OrbitControls) => {
    const proto = OrbitControls.prototype as unknown as { _rotateUp(a: number): void; _rotateLeft(a: number): void }
    const self = o as unknown as typeof proto
    self._rotateUp = (a) => proto._rotateUp.call(o, settings.get('invertLook') !== 'off' ? -a : a)
    self._rotateLeft = (a) => proto._rotateLeft.call(o, settings.get('invertLook') === 'xy' ? -a : a)
  }
  const setCam = (m: CamMode) => {
    cam.mode = m
    orbit?.dispose(); orbit = null
    if (m === 'orbit') {
      orbit = new OrbitControls(r.camera, canvas)
      invertLook(orbit)
      const t = skater(sim)
      orbit.target.set(t.pos.x, t.pos.y, t.pos.z)
      orbit.update()
    } else cam.step(skater(sim), true)
  }

  const resetRecorder = () => { rec.current = new Recorder(120 * 90) }

  const post = (url: string, body: unknown) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((x) => x.json())

  // ---- tick ----
  const tick = () => {
    const input = keys.frame()
    // In a conversation the skater only coasts to a stop (story.ts).
    if (story) input.b = story.filterInput(input.b, skater(sim))
    // Player 2's buttons ride along on b2 while it is in (the Recorder writes replay v2 then).
    if (player2(sim)) { input.b2 = keys.enabled && !menuOpen ? keys2.frame().b : 0; p2Input = { b: input.b2 } }
    // Karl's gust (a lesson's boost): the lesson's first push sets its speed.
    if (schoolGust && school?.active && !school.celebrating && (input.b & Btn.up) && skater(sim).state === 'ground') { schoolGust = false; queue(`speed ${school.lesson!.boost}`) }
    // Grind (pad triangle) while standing still is the emote too.
    { const t = skater(sim); if ((input.b & Btn.grind) && !(lastB & Btn.grind) && Math.hypot(t.vel.x, t.vel.y) < 0.3 && (t.state === 'ground' || t.state === 'walk') && !menuOpen && !story?.prompting) emote() }   // by a character, triangle talks instead
    lastB = input.b
    const batch = pending.splice(0)
    const ok: string[] = []
    // Dry-run, in order on one copy, so a bad command never reaches the recorded stream (commandqueue.ts).
    const vetted = vetCommands(sim, park, batch.map((p) => p.text))
    batch.forEach((p, i) => { if (vetted[i].ok) ok.push(p.text); p.resolve(vetted[i]) })
    const ev = rec.current.tick(sim, input, ok)
    for (const e of ev) {
      events.push(e)
      // Player 2's own events: its sound, its HUD, its camera and pad; never player 1's HUD, stickers or career.
      if (playerOf(e) === 2) {
        const p = player2(sim)
        if (p) sound.event(e, p.sk, sound.ctx?.currentTime ?? 0)
        if (split?.real) split.hud.event(e, performance.now())
        if (e.t === 'land') { split?.cam.kick('land', Math.min(2, Math.max(0, e.peakZ - (p?.sk.pos.z ?? 0)) / 1.5)); keys2.rumble('land', keys2.landRumble(e.impact)) }
        if (e.t === 'bail') { split?.cam.kick('bail'); keys2.rumble('bail') }
        continue
      }
      // The two-player games: their moments as pops in the halves they are about, the results card at the end.
      for (const q of twoPlayerPops(e)) { if (q.player !== 2) ui.popUp(q.title, q.sub, q.kind); if (q.player !== 1) split?.hud.popUp(q.title, q.sub, q.kind) }
      if (isOver2p(e)) { results2p.show(e, [r.skater.characterName, p2view?.characterName ?? 'Player 2'], session(sim).horseWord ?? 'HORSE'); paused = true }
      sound.event(e, skater(sim), sound.ctx?.currentTime ?? 0)
      ui.event(e, performance.now())
      // The game over inside a mission (a mode step): the mission goes on, no results card (checked before the story reads its events).
      const inMission = !!story?.wrapped
      story?.event(e)
      stickers?.event(e)
      // Graffiti's end as one number for the Sticker Book and the daily: the most pieces anyone owned.
      if (e.t === 'graffitiOver') { const g = { t: 'graffitiOwned', owned: Math.max(...e.counts) } as unknown as SimEvent; stickers?.event(g); daily?.event(g) }
      daily?.event(e)
      if (e.t === 'runOver') showResults(e)
      // The Tour: goals go to the career (a level may open); the run's end shows the level card.
      if (e.t === 'levelGoal') {
        career.add(e.level, e.id)
        // A secret skater unlocked: the card slaps on (once), and the picker drops the silhouette.
        for (const c of unlocks.fresh()) { ui.stickerEarned({ name: `NEW SKATER: ${c.name.toUpperCase()}`, line: `${c.unlock?.hint ?? ''}: done. Pick them with Tab.`, art: c.id }, 'UNLOCKED'); sound.event({ t: 'goal' } as SimEvent, skater(sim), sound.ctx?.currentTime ?? 0); picker.refresh() }
      }
      if (e.t === 'levelStart') { justOpened = []; tourNext = false; startIntro(e.level) }
      // The run's best combo, for the replay behind the results (captured once its tail has played).
      if (timedRunStart(e)) { bestCombo.reset(); bestReplay = null; pendingBest = null }
      if (bestCombo.event(e)) pendingBest = bestCombo.best
      // A goal: the camera punches in a moment (the HUD pop freezes with it); playing on is never held up.
      if (e.t === 'levelGoal' || e.t === 'goalComplete' || e.t === 'goal') cam.punch()
      if (e.t === 'levelOver') {
        const L = data.tour.levels.find((x) => x.id === e.level)
        tourNext = true
        if (L) ui.levelResults(e, L.name, career.goalIds(L).map((id) => ({ name: career.goalName(L, id), now: e.goals.includes(id), before: career.has(L.id, id) && !e.goals.includes(id) })), { total: career.total, max: career.max }, justOpened, '<kbd>Enter</kbd>again&emsp;<kbd>Esc</kbd>challenges')
        paused = true
      }
      if (e.t === 'bombStart') ghostSplit = 0
      if (e.t === 'land') keys.rumble('land', keys.landRumble(e.impact))
      if (e.t === 'bail') keys.rumble('bail')
      if (e.t === 'grindStart') keys.rumble('grind')
      if (e.t === 'carHit') keys.rumble('carHit')
      if ((e.t === 'bombCheckpoint' || e.t === 'bombFinish') && ghost) {
        const d = ghostDelta(ghost, ghostSplit++, e.time)
        if (d !== null) ui.ghostSplit(d)
      }
      if (e.t === 'bombFinish') {
        // A new best: keep this run (from the race command) as the next ghost.
        const best = ui.bombBest(e.route)
        if (best === null || e.total < best) try { localStorage.setItem(ghostKey(e.route), JSON.stringify({ ...rec.current.replay(sim.world.tick - bombCmdTick + 2, 'hill bomb ghost', { park: parkName, parkHash: park.hash, gates: ghostGates(e.route), route: e.route }), hashes: [], states: [] })) } catch { /* storage full */ }
      }
      if (e.t === 'courierOver' || e.t === 'courierFail' || e.t === 'comboOver' || e.t === 'bombFinish' || e.t === 'bombFail' || e.t === 'skateOver' || e.t === 'muniOver' || e.t === 'escapeOver' || (e.t === 'graffitiOver' && e.counts.length === 1)) { if (!inMission) { ui.modeResults(e, '<kbd>Enter</kbd>again&emsp;<kbd>F</kbd>free skate'); paused = true } }
      if (timedRunOver(e)) { if (pendingBest) captureBest(pendingBest); startResultsLoop() }
      if (e.t === 'teleport') cam.step(skater(sim), true)
      if (e.t === 'land') cam.kick('land', Math.min(2, Math.max(0, e.peakZ - skater(sim).pos.z) / 1.5))
      if (e.t === 'bail') cam.kick('bail')
      // Some skaters say something when they bail (the robotaxi: "I'm sorry, I can't do that.").
      if (e.t === 'bail') { const say = r.skater.cast.find((c) => c.id === r.skater.characterId)?.style.bailSay; if (say) toast(say) }
      if (e.t === 'burrito') r.skater.pickupTick = e.tick   // the skater's happy reaction
      if (e.t === 'comboLanded') { const p = skater(sim).pos; landed = { tick: e.tick, points: e.points, x: p.x, y: p.y, z: p.z }; const fans = spectators?.fansFor(landed) ?? 0; if (fans) sound.applause(fans) }
      if (e.t === 'teleport') landed = null
      if (e.t === 'npcTrick' || e.t === 'npcGrind' || e.t === 'npcLand' || e.t === 'npcBail' || e.t === 'npcCheer') {
        const n = sim.world.things.find((x) => x.id === e.id)
        if (n) sound.npc(e, npcViews.characterOf(e.id), r.camera.position.distanceTo(new THREE.Vector3(n.pos.x, n.pos.y, n.pos.z)), undefined, npcViews.cheerTaps(data.physics.tickHz))
      }
      // A park NPC's combo floats over it for a moment (the HUD draws it each frame from here).
      // The EMB and Pier 7 locals talk: cheering your combo, setting off on your line, at your slam.
      if (e.t === 'npcCheer' || e.t === 'npcCopy' || e.t === 'bail') localSay(e)
      // Shouted at the van (game/vehicles.ts reactions): voiced and captioned by data/voices.json (physics phase 31).
      if (e.t === 'npcCombo') { npcCombos.push({ id: e.id, tick: e.tick, name: e.name, points: e.points, multiplier: e.multiplier }); if (npcCombos.length > 24) npcCombos.shift() }
      if (vignettes) { const p = skater(sim).pos; vignettes.event(e, p.x, p.y) }   // a big combo, a trick or a grind near a vignette
    }
    if (school) { const sig = school.tick(ev, skater(sim)); if (sig.length) schoolSignals(sig) }
    split?.tick(sim.world.things, ev, sim.data.traffic, performance.now())
    { const p = player2(sim); prev2 = curr2; curr2 = p ? pose(p.sk) : null; if (p && !p2view) void ensureP2View() }
    while (events.length > 6) events.shift()
    if (pendingBest && sim.world.tick >= pendingBest.to + pres.replay.tail) captureBest(pendingBest)
    prev = curr; curr = pose(skater(sim))
    npcPrev = npcCur; npcCur = new Map(sim.world.things.filter((t) => t.kind === 'npc' && t.alive).map((t) => [t.id, pose(t)]))
    if (cam.mode !== 'orbit') { const who = camSubject(sim.world.things, skater(sim), session(sim)); cam.obstacles = carBoxes(sim.world.things, sim.data.traffic, who.pos); cam.step(who, who.id !== camWho); camWho = who.id }   // a cut, not a swing, when it changes rider
    // The trick director: its moments from the player's events; its shots only over the chase camera following the player.
    { const t = skater(sim), follows = cam.mode === 'chase' && camWho === t.id; director.talkAt = story?.talking ? story.speakerAt(sim) : null; director.step(t, ev.filter((e) => playerOf(e) === 1), sim.world.tick, follows ? cam.pose : null, follows ? cam : null, director.allowed(session(sim).game, !!player2(sim))) }
    if (watching && sim.world.tick % 12 === 0) import.meta.hot?.send('skate:state', { line: `${stateLine()} input ${buttonNames(input.b) || '-'}` })
  }

  // ---- frame ----
  const dtMs = 1000 / data.physics.tickHz
  let acc = 0, last = performance.now(), frames = 0, fpsT = last, fps = 0, lastSoundAt = last, lastDogAt = last, lastFxAt = last, slowFor = 0, fastFor = 0, lowFor = 0, steppedDown = false
  const lerp = (a: number, b: number, k: number) => a + (b - a) * k
  // ---- presentation: the Tour level intro, the best combo behind the results ----
  let intro: { path: (u: number) => CamPose; t0: number; pad: boolean[] } | null = null
  const padNow = () => { const p = navigator.getGamepads?.()[0]; return p ? p.buttons.map((b) => b.pressed) : [] }
  /** A pad button pressed that was up when the intro started (or has been let go since). */
  const padPressed = (was: boolean[]) => { const now = padNow(); let hit = false; now.forEach((d, i) => { if (d && !was[i]) hit = true; if (!d) was[i] = false }); return hit }
  const startIntro = (id: string) => {
    const L = data.tour.levels.find((x) => x.id === id)
    if (!L || pres.intro.seconds <= 0) return
    const c = new Cam(); c.park = park; c.step(skater(sim), true)
    intro = { path: introPath(L, park, skater(sim), c.pose!, pres.intro), t0: performance.now(), pad: padNow() }
    ui.levelIntro({ name: L.name, goals: L.goals.map((g) => g.name), skip: 'Any key to skip' })
    paused = true   // the sim (and the level's clock) waits for the flyover
  }
  const endIntro = () => {
    intro = null
    ui.levelIntro(null)
    if (!menuOpen) paused = false
    acc = 0
    cam.step(skater(sim), true)
  }
  // Any key skips the intro (and is not passed on to the game).
  window.addEventListener('keydown', (e) => { if (intro) { e.preventDefault(); e.stopImmediatePropagation(); endIntro() } }, true)
  const bestCombo = new BestCombo()
  let pendingBest: Combo | null = null, bestReplay: { replay: Replay; combo: Combo; from: number; to: number } | null = null
  /** Keep the best combo's ticks (from a little before its pop to a little after it banks) as a replay. */
  const captureBest = (c: Combo) => {
    pendingBest = null
    const R = pres.replay, hz = data.physics.tickHz, now = sim.world.tick
    const to = Math.min(now, c.to + R.tail), from = Math.max(c.from - R.lead, to - Math.round(R.maxSeconds * hz))
    try { bestReplay = { replay: rec.current.replay(now - from + 2, 'best combo', { park: parkName }), combo: c, from, to } } catch { bestReplay = null }
  }
  let resultsLoop: { things: Thing[]; ticks: number[]; cams: CamPose[]; cars: CarPose[][]; t0: number } | null = null
  const startResultsLoop = () => {
    const B = bestReplay
    if (!B || B.combo.points < pres.replay.minPoints || !ui.resultsOpen) return
    const things: Thing[] = [], ticks: number[] = [], cams: CamPose[] = [], cars: CarPose[][] = []
    const rc = new Cam(); rc.park = park; rc.mode = 'quarter'
    const dr = replayDirector()   // the trick director's angles over the three-quarter camera (director.ts)
    let first = true
    runReplay(B.replay, park, { onTick: (s, ev) => {
      const tk = s.world.tick
      if (tk < B.from - 60 || tk > B.to) return
      const t = structuredClone(skater(s)); rc.obstacles = carBoxes(s.world.things, s.data.traffic, t.pos); rc.step(t, first); first = false
      dr.step(t, ev.filter((e) => playerOf(e) === 1), tk, rc.pose, rc, true)
      if (tk < B.from) return
      const c = dr.pose ?? rc.pose!
      things.push(t); ticks.push(tk); cams.push({ ...c, pos: { ...c.pos }, look: { ...c.look } }); cars.push(carPoses(s.world.things))
    } })
    if (things.length < 20) return
    resultsLoop = { things, ticks, cams, cars, t0: performance.now() }
    ui.resultsReplay(B.combo.name, B.combo.points)
    document.body.classList.add('results-replay')
  }
  const endResultsLoop = () => {
    resultsLoop = null
    ui.resultsReplay('', 0)
    document.body.classList.remove('results-replay')
    cam.step(skater(sim), true)
  }
  // Instant replay (X): the last 6 seconds again from a three-quarter camera, the trick director's shots and slow
  // motion at the moments, 0.8 speed between them (half speed throughout with Slow motion off).
  let replayPlay: { things: Thing[]; ticks: number[]; cams: CamPose[]; cars: CarPose[][]; speeds: number[]; base: number; t: number; last: number } | null = null
  const startReplay = () => {
    const rp = rec.current.replay(120 * 6, 'instant replay', { park: parkName })
    const things: Thing[] = [], ticks: number[] = [], cams: CamPose[] = [], cars: CarPose[][] = [], speeds: number[] = []
    const rc = new Cam(); rc.park = park; rc.mode = 'quarter'
    const dr = replayDirector()
    runReplay(rp, park, { onTick: (s, ev) => {
      const t = structuredClone(skater(s)); rc.obstacles = carBoxes(s.world.things, s.data.traffic, t.pos); rc.step(t, things.length === 0)
      dr.step(t, ev.filter((e) => playerOf(e) === 1), s.world.tick, rc.pose, rc, dr.allowed(session(s).game, !!player2(s)))
      const c = dr.pose ?? rc.pose!
      things.push(t); ticks.push(s.world.tick); cams.push({ ...c, pos: { ...c.pos }, look: { ...c.look } }); cars.push(carPoses(s.world.things)); speeds.push(dr.speed(s.world.tick))
    } })
    if (things.length < 30) { toast('nothing to replay yet'); return }
    replayPlay = { things, ticks, cams, cars, speeds, base: dr.level === 'off' ? 0.5 : 0.8, t: 0, last: performance.now() }
    paused = true; sound.setVolume(0)
    document.body.classList.add('replaying')
    toast('Replay. X skips')
  }
  const endReplay = () => {
    replayPlay = null; paused = false; sound.setVolume(settings.get('master'))
    document.body.classList.remove('replaying'); cam.step(skater(sim), true)
  }
  // Share clip in the hosted build (V): the last 15 seconds replay on screen at full speed, from the
  // camera you play with, while the browser records the picture and the replay's own sound (its own
  // AudioContext; the radio's generated station too); then the file downloads.
  type BrowserClip = { things: Thing[]; ticks: number[]; cams: CamPose[]; cars: CarPose[][]; events: SimEvent[][]; speeds: number[]; dir: Director; f: number; last: number; t0: number; i: number; rec: ClipRecorder; ctx: AudioContext; snd: Sound; station: { stop(): void } | null }
  let shareRec: BrowserClip | null = null
  const startBrowserClip = async () => {
    if (shareRec || replayPlay) return
    if (!ClipRecorder.supported()) { toast("This browser can't record video; photo mode (B) works"); return }
    const rp = rec.current.replay(120 * 15, 'share', { park: parkName, cam: cam.mode })
    const things: Thing[] = [], ticks: number[] = [], cams: CamPose[] = [], cars: CarPose[][] = [], events: SimEvent[][] = [], speeds: number[] = []
    const rc = new Cam(); rc.park = park; rc.mode = cam.mode === 'orbit' ? 'chase' : cam.mode
    const dr = replayDirector()
    runReplay(rp, park, { onTick: (s, ev) => {
      const t = structuredClone(skater(s)); rc.obstacles = carBoxes(s.world.things, s.data.traffic, t.pos); rc.step(t, things.length === 0)
      const mine = ev.filter((e) => playerOf(e) === 1)
      dr.step(t, mine, s.world.tick, rc.mode === 'chase' ? rc.pose : null, rc, dr.allowed(session(s).game, !!player2(s)))
      const c = dr.pose ?? rc.pose!
      things.push(t); ticks.push(s.world.tick); cams.push({ ...c, pos: { ...c.pos }, look: { ...c.look } }); cars.push(carPoses(s.world.things)); events.push(mine); speeds.push(dr.speed(s.world.tick))
    } })
    if (things.length < 120) { toast('nothing to record yet'); return }
    const ctx = new AudioContext(), dest = ctx.createMediaStreamDestination()
    // The game's sound and the station sum here: a little headroom and a limiter, so the file never clips.
    const mix = ctx.createGain(), lim = ctx.createDynamicsCompressor()
    mix.gain.value = 0.8; lim.threshold.value = -3; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.002; lim.release.value = 0.12
    mix.connect(lim).connect(dest)
    const snd = new Sound(park, src); snd.character = () => r.skater.characterId; snd.weather = () => r.weather
    await snd.init(ctx, undefined, mix)
    const kind = radio?.synthPlaying
    const station = kind ? (kind === 'punk' ? new PunkStation() : kind === 'hyphy' ? new HyphyStation() : new LofiStation()) : null
    if (station && radio) { station.setVolume(radio.level); station.build(ctx, mix); station.start() }
    const c = canvas, k = Math.min(1, 1920 / c.width, 1080 / c.height)
    const recd = new ClipRecorder(Math.round((c.width * k) / 2) * 2, Math.round((c.height * k) / 2) * 2, dest.stream)
    shareRec = { things, ticks, cams, cars, events, speeds, dir: dr, f: 0, last: performance.now(), t0: performance.now(), i: -1, rec: recd, ctx, snd, station }
    paused = true; sound.setVolume(0)
    document.body.classList.add('replaying')
    toast('Recording the last 15 seconds. Esc cancels'); ui.rec(true)
  }
  const endBrowserClip = (keep: boolean) => {
    const R = shareRec
    if (!R) return
    shareRec = null; paused = false; sound.setVolume(settings.get('master')); ui.rec(false)
    document.body.classList.remove('replaying'); cam.step(skater(sim), true)
    R.station?.stop()
    const close = () => void R.ctx.close().catch(() => {})
    if (!keep) { R.rec.cancel(); close(); toast('clip cancelled'); return }
    void R.rec.stop().then((blob) => {
      close()
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `soma-skate-${Date.now()}.${R.rec.ext}`; a.click()
      window.setTimeout(() => URL.revokeObjectURL(a.href), 60_000)
      toast(`Saved to your downloads (${(blob.size / 1e6).toFixed(1)} MB)`)
    })
  }
  // A slow device (the first frames on the title, once per browser, Quality: auto): start on low.
  const B = settingsData.bench
  let bench: { n: number; last: number; times: number[] } | null = null
  try { if (settings.get('quality') === 'auto' && !localStorage.getItem('soma-skate:bench')) bench = { n: 0, last: 0, times: [] } } catch { /* private window */ }
  // The full-size photos wait for the bench's verdict (low keeps the half-size ones).
  let benchDone = () => {}
  const benched = bench ? new Promise<void>((r) => { benchDone = r }) : Promise.resolve()
  const benchFrame = (now: number) => {
    if (!bench) return
    if (++bench.n > B.skipFrames) bench.times.push(now - bench.last)
    bench.last = now
    if (bench.times.length < B.frames) return
    const med = [...bench.times].sort((a, b) => a - b)[Math.floor(bench.times.length / 2)]
    bench = null
    try { localStorage.setItem('soma-skate:bench', JSON.stringify({ medianMs: +med.toFixed(1), at: new Date().toISOString().slice(0, 10) })) } catch { /* private window */ }
    if (med > (isPhone() ? B.phoneSlowMs ?? B.slowMs : B.slowMs) && settings.get('quality') === 'auto') { settings.set('quality', 'low'); applySettings(); toast(B.toast) }
    benchDone()
  }
  const frame = (now: number) => {
    benchFrame(now)
    keys.poll()
    if (player2(sim)) keys2.pollInteract()
    // Attract mode: a demo plays through the clip machinery; a pad button (or any key: wake) ends it.
    const pad = padNow().some(Boolean)
    if (pad) { lastInput = now; touch?.otherInput(); story?.woke(now) }
    touch?.setMenu(menuOpen || picker.isOpen || lobby.isOpen || results2p.isOpen || ui.resultsOpen || schoolAsk.isOpen || !!demo || !!story?.overlay || !!story?.talking)
    if (demo) {
      if (pad) stopDemo()
      else {
        const i = Math.floor(((now - demo.t0) / 1000) * data.physics.tickHz)
        if (i >= demo.ticks && !demoLoading) void startDemo()   // the next run (the last frame holds while it loads)
        demo.clip.frame(Math.min(i, demo.ticks - 1))
        requestAnimationFrame(frame)
        return
      }
    }
    // Attract mode: idle in the pause menu (the game boots into free roam; the menu is where it waits).
    if (attractData && !demoLoading && menuOpen && ui.menuOpen && !picker.isOpen && !schoolAsk.isOpen && !story?.overlay && !document.querySelector('.help.on') && now - lastInput > attractData.idleSeconds * 1000) void startDemo()
    if (intro) {
      // The Tour level intro: the flyover onto the chase camera, the clock held; any key or button skips.
      const u = (now - intro.t0) / 1000 / pres.intro.seconds
      if (u >= 1 || menuOpen || padPressed(intro.pad)) endIntro()
      else {
        r.skater.tick = sim.world.tick
        r.setSkater(skater(sim), sim.data, 0)
        r.setCamera(intro.path(Math.max(0, u)))
        r.render()
        requestAnimationFrame(frame)
        return
      }
    }
    if (resultsLoop) {
      // Your best combo of the run, looping in slow motion behind the results card until you leave it.
      if (!ui.resultsOpen) endResultsLoop()
      else {
        const L = resultsLoop, hz = data.physics.tickHz, t = (now - L.t0) / 1000
        const i = loopIndex(t, L.things.length, hz, pres.replay)
        if (i >= 0) {
          const f = (t % (L.things.length / (hz * pres.replay.speed) + pres.replay.pause)) * hz * pres.replay.speed, k = Math.min(1, Math.max(0, f - i))
          const a = L.things[i], b = L.things[Math.min(L.things.length - 1, i + 1)], c0 = L.cams[i], c1 = L.cams[Math.min(L.cams.length - 1, i + 1)]
          const lp = (p: { x: number; y: number; z: number }, q: { x: number; y: number; z: number }) => ({ x: p.x + (q.x - p.x) * k, y: p.y + (q.y - p.y) * k, z: p.z + (q.z - p.z) * k })
          r.skater.tick = L.ticks[i]
          r.setSkater({ ...a, pos: lp(a.pos, b.pos), fwd: lp(a.fwd, b.fwd), up: lp(a.up, b.up) }, sim.data, k)
          r.setCamera(besideCard({ pos: lp(c0.pos, c1.pos), look: lp(c0.look, c1.look), fov: c0.fov }, pres.replay.shift))
          traffic.update(L.cars[i] ?? [], k, hz, 0, c0.pos)
        }
        r.render()
        requestAnimationFrame(frame)
        return
      }
    }
    if (shareRec) {
      // Real time through the slow motion: the recording plays the moments slower, the sound pitched with them.
      const R = shareRec, hz = data.physics.tickHz
      R.f += (Math.max(0, now - R.last) / 1000) * hz * (R.speeds[Math.min(R.speeds.length - 1, Math.floor(R.f))] ?? 1); R.last = Math.max(R.last, now)
      const f = R.f, i = Math.min(R.things.length - 1, Math.floor(f)), k = i < R.things.length - 1 ? f - i : 0
      { const so = R.dir.sound(R.speeds[i] ?? 1); R.snd.slowmo(so.rate, so.cutoff, R.ctx.currentTime) }
      if (i > R.i) {
        // This frame's ticks: their events into the clip's sound (and the landed combos onto the picture).
        const when = R.ctx.currentTime
        for (let j = R.i + 1; j <= i; j++) for (const e of R.events[j]) {
          R.snd.event(e, R.things[j], when)
          if (e.t === 'comboLanded') R.rec.combo(e.name, `+${e.points.toLocaleString('en-US')}`, now)
        }
        R.snd.update(R.things[i], when, Math.min(0.1, (i - Math.max(0, R.i)) / hz)); R.i = i
      }
      const a = R.things[i], b = R.things[Math.min(R.things.length - 1, i + 1)], c0 = R.cams[i], c1 = R.cams[Math.min(R.cams.length - 1, i + 1)]
      const lp = (p: { x: number; y: number; z: number }, q: { x: number; y: number; z: number }) => ({ x: p.x + (q.x - p.x) * k, y: p.y + (q.y - p.y) * k, z: p.z + (q.z - p.z) * k })
      r.skater.tick = R.ticks[i]
      r.setSkater({ ...a, pos: lp(a.pos, b.pos), fwd: lp(a.fwd, b.fwd), up: lp(a.up, b.up) }, sim.data, k)
      r.setCamera({ pos: lp(c0.pos, c1.pos), look: lp(c0.look, c1.look), fov: c0.fov + (c1.fov - c0.fov) * k, lens: c0.lens })
      traffic.update(R.cars[i] ?? [], k, hz, 0, c0.pos)
      r.render()
      R.rec.frame(canvas, now)
      if (i >= R.things.length - 1) endBrowserClip(true)
      requestAnimationFrame(frame)
      return
    }
    if (replayPlay) {
      const R = replayPlay
      // rAF stamps the frame's start, which can come before the key press: never run backwards.
      const rdt = Math.max(0, now - R.last) / 1000
      R.t += rdt * data.physics.tickHz * R.base * (R.speeds[Math.max(0, Math.min(R.speeds.length - 1, Math.floor(R.t)))] ?? 1); R.last = Math.max(R.last, now)
      const i = Math.max(0, Math.floor(R.t))
      if (i >= R.things.length) endReplay()
      else {
        r.skater.tick = R.ticks[i]
        r.setSkater(R.things[i], sim.data, R.t - i)
        r.setCamera(R.cams[i])
        traffic.update(R.cars[i] ?? [], 0, data.physics.tickHz, rdt, R.cams[i].pos)
        r.render()
        requestAnimationFrame(frame)
        return
      }
    }
    // Slow motion: the sim's ticks come slower (the director's time scale); the sim itself is the same.
    acc += Math.min(250, now - last) * director.speed(sim.world.tick + acc / dtMs); last = now
    if (sound.ctx) { const so = director.sound(director.speed(sim.world.tick)); sound.slowmo(so.rate, so.cutoff) }
    let n = 0
    if (!paused) while (!paused && acc >= dtMs && n < 12) { tick(); acc -= dtMs; n++ }
    else { acc = 0; while (stepBudget > 0) { tick(); stepBudget-- } }
    const k = paused ? 1 : acc / dtMs
    // Transforms interpolate between the last two ticks; everything else is the current tick
    // (the pose solver uses k for trick progress within the tick).
    const view: Thing = {
      ...curr,
      pos: { x: lerp(prev.pos.x, curr.pos.x, k), y: lerp(prev.pos.y, curr.pos.y, k), z: lerp(prev.pos.z, curr.pos.z, k) },
      fwd: { x: lerp(prev.fwd.x, curr.fwd.x, k), y: lerp(prev.fwd.y, curr.fwd.y, k), z: lerp(prev.fwd.z, curr.fwd.z, k) },
      up: { x: lerp(prev.up.x, curr.up.x, k), y: lerp(prev.up.y, curr.up.y, k), z: lerp(prev.up.z, curr.up.z, k) },
    }
    if (picker.isOpen) {
      // Turntable: the skater stands still and fidgets (state time runs on for the pose only).
      view.stateTicks = 200 + Math.floor((now - picker.openedAt) / (1000 / data.physics.tickHz))
      view.vel = { x: 0, y: 0, z: 0 }; view.crouch = false; view.prevB = 0
    } else if (cas?.isOpen) {
      // Create-a-Skater's turntable: standing and fidgeting, then a kickflip off the spot and its landing (pose only).
      const L = cas.loop(now), hz = data.physics.tickHz
      view.vel = { x: 0, y: 0, z: 0 }; view.crouch = false; view.prevB = 0; view.trick = null
      if (L.kind === 'idle') { view.state = 'ground'; view.stateTicks = 200 + Math.floor(L.t * hz); view.airTicks = 0 }
      else if (L.kind === 'air') {
        const flip = data.tricks.flips.find((f) => f.id === 'kickflip') as { ticks?: number } | undefined
        view.state = 'air'; view.stateTicks = Math.floor(L.t * hz); view.airTicks = view.stateTicks
        view.pos = { ...view.pos, z: view.pos.z + 0.85 * Math.sin(Math.PI * L.q) }
        view.vel = { x: 0, y: 0, z: 3.4 * Math.cos(Math.PI * L.q) }
        view.trick = { id: 'kickflip', kind: 'flip', tick: Math.floor(L.q * (flip?.ticks ?? 40)), phase: 'run', held: 0 }
      } else { view.state = 'ground'; view.stateTicks = Math.floor(L.t * hz); view.airTicks = 102 }
    }
    r.skater.tick = sim.world.tick
    r.setSkater(view, sim.data, k)
    // Player 2's skater, between its last two ticks like player 1's.
    if (p2view) {
      p2view.root.visible = !!curr2 && r.isVisible('skater')
      if (curr2) {
        const a = prev2 ?? curr2, kk = paused ? 1 : k
        p2view.tick = sim.world.tick
        p2view.update({ ...curr2, pos: { x: lerp(a.pos.x, curr2.pos.x, kk), y: lerp(a.pos.y, curr2.pos.y, kk), z: lerp(a.pos.z, curr2.pos.z, kk) }, fwd: { x: lerp(a.fwd.x, curr2.fwd.x, kk), y: lerp(a.fwd.y, curr2.fwd.y, kk), z: lerp(a.fwd.z, curr2.fwd.z, kk) }, up: { x: lerp(a.up.x, curr2.up.x, kk), y: lerp(a.up.y, curr2.up.y, kk), z: lerp(a.up.z, curr2.up.z, kk) } }, sim.data, kk)
      }
    }
    tagPaint.update(session(sim).game === 'graffiti2p' || session(sim).game === 'graffiti' ? session(sim).tags : undefined)
    if (lobby.isOpen) lobby.poll(keys.frame().b, keys2.frame().b, Btn)
    { const want = curr2 || lobby.isOpen ? keys2 : null; if (want !== keysYield) { keys.giveWay(want); keysYield = want } }   // two on one keyboard: the arrows are player 2's
    r.skater.showcase(picker.isOpen && picker.boardMode, now / 1000, r.camera.position)   // the board shop's display deck
    if (orbit) orbit.update()
    else if (picker.isOpen) r.setCamera(picker.camera(now, view.pos, picker.boardMode ? r.skater.showcaseAt() : undefined))
    else if (cas?.isOpen && !casShot) r.setCamera(cas.camera(now, curr.pos, r.skater.characterHeight))
    else if (lobby.isOpen) r.setCamera(lobbyCam(curr, curr2))
    else if (menuOpen && !started) r.setCamera(flyover(now))
    else if (menuOpen && ui.menuOpen && !demo && cam.pose) r.setCamera(pauseOrbit(now, cam.pose))
    else { pauseFrom = null; const c = director.at(k) ?? cam.at(k); if (c) r.setCamera(c) }
    // Split screen while playing (not over menus, the picker, photo mode or the free camera).
    const splitNow = !!split && started && !menuOpen && !picker.isOpen && !photoMode && !orbit && split.following && !lobby.isOpen
    if (split && splitNow !== split.active) {
      split.setActive(splitNow)
      if (splitNow) { splitScaleBefore = r.renderScale; r.setScale(Math.min(r.renderScale, splitData.renderScale)) } else r.setScale(splitScaleBefore)
      r.setAo(!splitNow || splitData.ao)
    }
    const p2Pose = splitNow ? split!.pose(k) : null
    if (fx) fx.camera2 = p2Pose?.pos ?? null
    const sess = session(sim)
    const lvl = sess.game === 'level' && sess.mode !== 'free' && sess.level ? data.tour.levels.find((L) => L.id === sess.level) : undefined
    r.setLetters(lvl ? lvl.letters.map((l) => ({ letter: l.letter, pos: l.pos })) : sess.game === 'run' && sess.mode !== 'free' ? data.run.letters.map((l) => ({ letter: l.letter, pos: l.pos })) : [], sess.letters, now / 1000)
    r.setTape(lvl && !sess.tape && sess.mode === 'level' ? lvl.tape.pos : null, now / 1000)
    // The game's target, else the mission's objective (story.ts): the beacon and the minimap's arrow.
    const storyHidden = menuOpen || picker.isOpen || lobby.isOpen || ui.resultsOpen || !!intro || !!demo
    // Under a menu or an overlay the world's marks go too (the beacon, the story's marks): the menu is over a quiet scene.
    const marksHidden = storyHidden || !!cas?.isOpen || !!story?.overlay
    { const tg = modeTarget(sess) ?? story?.target(sim) ?? null; r.setBeacon(marksHidden ? null : tg, now / 1000); ui.mapTarget = tg }
    story?.frame(now, r.camera.position, r.style, storyHidden, marksHidden)
    vehicleKey.frame(sim, storyHidden || (!vehicleKey.driving(sim) && (!!story?.prompting || !!story?.talking)), keys.keysFor('interact')[0], !!touch?.visible)
    vehicleKey2.frame(sim, storyHidden || !player2(sim), keys2.keysFor('interact')[0], false, 2)
    // The ghost: waits at its start line until you cross yours, then rides at your race time.
    if (ghost && sess.mode === 'bomb') {
      const i = Math.min(ghost.frames.length - 1, ghost.start + (sess.raceGate === 0 ? 0 : sess.raceTicks))
      ghostView.set(ghost.frames[i], sim.data, sess.raceGate > 0 && i > 0 ? ghost.frames[i - 1] : undefined, k)
    } else ghostView.set(null, sim.data)
    sessionMarker.update(skater(sim))
    r.setBurritos(data.run.burritoParks.includes(park.name) ? data.run.burritos : [], sess.burritos, now / 1000)
    { const t = skater(sim), dt = Math.min(0.1, (now - lastSoundAt) / 1000); pigeons.update(dt, t.pos, Math.hypot(t.vel.x, t.vel.y)); seaLions?.update(dt, r.camera.position, sk3.set(t.pos.x, t.pos.y, t.pos.z)); if (castPeople) { castPeople.setStyle(r.style); castPeople.update(dt, sk3, r.camera.position) } if (interiors) { interiors.setStyle(r.style); interiors.update(r.camera.position, r.night); r.setBloomShare(interiors.bloomShare) } traffic.update(carPoses(sim.world.things), k, data.physics.tickHz, dt, r.camera.position); r.tickWeather(dt) }
    if (spectators) { spectators.setStyle(r.style); spectators.update(sim.world.tick + k, view.pos, landed) }
    // Split: an NPC either player's view sees is drawn (player 2's camera, at its half's shape).
    if (p2Pose) { p2cam.position.set(p2Pose.pos.x, p2Pose.pos.y, p2Pose.pos.z); p2cam.up.set(0, 0, 1); p2cam.lookAt(p2Pose.look.x, p2Pose.look.y, p2Pose.look.z); p2cam.fov = p2Pose.fov; p2cam.aspect = r.camera.aspect * (split?.layout === 'lr' ? 0.5 : 2); p2cam.updateProjectionMatrix() }
    npcViews.setStyle(r.style); npcViews.you = view; npcViews.sync(npcFrames(), sim.world.tick, k, sim.data, r.camera, false, p2Pose ? p2cam : null)
    if (fx) { const dt = paused ? 0 : Math.min(0.1, (now - lastFxAt) / 1000); fx.update(dt, [view, ...npcFrames().map((f) => f.cur)], r.camera, data.physics.skater.radius) }
    lastFxAt = now
    if (crowd) {
      const sk = skater(sim)
      crowd.setStyle(r.style)
      // The sim's own pedestrians (when the sim has them) go in the last argument: drawn the same way, the crowd kept off them.
      const said = crowd.update(sim.world.tick + k, r.camera, { x: view.pos.x, y: view.pos.y, z: view.pos.z, speed: Math.hypot(sk.vel.x, sk.vel.y) }, landed, !menuOpen && !picker.isOpen, simPeds(sim.world.things, sim.world.tick))
      if (said) toast(said)
      if (crowd.stats.cheers) sound.applause(Math.min(6, crowd.stats.cheers))   // the sidewalk cheering a big combo
    }
    if (dogs) {
      const sk = skater(sim), dt = Math.min(0.1, (now - lastDogAt) / 1000)
      lastDogAt = now
      dogs.setStyle(r.style)
      for (const b of dogs.update(dt, { x: view.pos.x, y: view.pos.y, z: view.pos.z, vx: sk.vel.x, vy: sk.vel.y }, r.camera)) sound.bark(b.size, r.camera.position.distanceTo(new THREE.Vector3(b.x, b.y, b.z)))
    }
    if (sound.ctx) sound.update(skater(sim), sound.ctx.currentTime, Math.min(0.1, (now - lastSoundAt) / 1000), drivenBy(sim, skater(sim)))
    lastSoundAt = now
    if (splitNow) { const sz = r.renderer.getSize(new THREE.Vector2()); r.renderViews(split!.views(cam.at(k) ?? cam.pose!, p2Pose, sz.x, sz.y)) }
    else r.render()
    frames++
    if (now - fpsT > 500) {
      fps = Math.round((frames * 1000) / (now - fpsT)); frames = 0; fpsT = now
      // Dynamic resolution (Quality: auto): drop the render scale when frames run late, raise it back when there is room.
      if (settings.get('quality') === 'auto' && !paused) {
        const [lo, hi] = settingsData.presets?.auto?.scale ?? [0.5, 1]
        slowFor = fps < 54 ? slowFor + 1 : 0; fastFor = fps >= 59 ? fastFor + 1 : 0
        if (slowFor >= 3) { r.setScale(Math.max(lo, r.renderScale - 0.15)); slowFor = 0 }
        else if (fastFor >= 12 && r.renderScale < hi) { r.setScale(Math.min(hi, r.renderScale + 0.1)); fastFor = 0 }
        // Still too slow while skating (the scale is not the bottleneck: draw calls, the CPU): low, once.
        const SD = settingsData.autoStepDown
        const skating = !menuOpen && !document.hidden && !demo && !ui.resultsOpen
        lowFor = SD && skating && fps < SD.fps ? lowFor + 0.5 : 0
        if (SD && lowFor >= SD.seconds && !steppedDown) { steppedDown = true; settings.set('quality', 'low'); applySettings(); toast(SD.toast) }
      }
    }
    if (r.isVisible('hud')) {
      const cd = r.camera.getWorldDirection(camDir)
      ui.frame(sim, now, Math.atan2(cd.y, cd.x))
      if (splitNow && p2Pose) split!.frameHud(split!.real ? player2(sim)?.s ?? session(sim) : session(sim), sim.data, park, now, Math.atan2(p2Pose.look.y - p2Pose.pos.y, p2Pose.look.x - p2Pose.pos.x))
      // Name tags over the hill bomb rivals, and over your ghost with the time it set.
      // Split screen: the tags in player 1's half (its shape and size); the stand-in's combos are in its own HUD.
      const half = splitNow ? split!.views(cam.pose!, null, innerWidth, innerHeight)[0].rect : null
      const tags = session(sim).mode === 'bomb' || session(sim).mode === 'skate' ? inHalf(r.camera, half, (w, h) => racerTags(sim.world.things, r.camera, park, w, h)) : []
      if (ghost && session(sim).mode === 'bomb' && ghost.finish !== null) {
        const f = ghost.frames[Math.min(ghost.frames.length - 1, ghost.start + (session(sim).raceGate === 0 ? 0 : session(sim).raceTicks))]
        const g = inHalf(r.camera, half, (w, h) => tagAt(-1, `your ghost ${ghost!.finish!.toFixed(2)} s`, f.pos, r.camera, park, w, h, false))
        if (g) tags.push(g)
      }
      ui.racerTags(tags)
      ui.npcPops(inHalf(r.camera, half, (w, h) => npcPopTags(splitNow ? npcCombos.filter((c) => c.id !== split!.standIn) : npcCombos, sim.world.things, sim.world.tick + k, data.physics.tickHz, popData, r.camera, park, w, h)))
      const t = skater(sim)
      const sp = Math.hypot(t.vel.x, t.vel.y, t.vel.z)
      const fakie = t.state === 'ground' && t.vel.x * t.fwd.x + t.vel.y * t.fwd.y + t.vel.z * t.fwd.z < -0.3
      hud.textContent = `${(sp * 3.6).toFixed(0)} km/h  ${t.state === 'bail' ? 'BAIL' : t.state}${fakie ? ' fakie' : ''}${t.crouch ? ' crouch' : ''}${paused ? '  PAUSED' : ''}` +
        `\n${t.spot} · ${parkName} · tick ${sim.world.tick} · ${fps} fps · cam ${cam.mode}`
      log.textContent = events.map((e) => e.t === 'land' ? `land${e.fakie ? ' fakie' : ''} ${(e.airTicks / 120).toFixed(2)}s` : e.t === 'air' ? `air${e.vert ? ' (vert)' : ''}` : e.t === 'bail' ? `bail: ${e.reason}` : e.t === 'pop' ? `ollie${e.fakie ? ' (fakie)' : ''} ${Math.round(e.charge * 100)}%` : e.t === 'trickStart' ? e.trick : e.t === 'grindStart' || e.t === 'manualStart' || e.t === 'lipStart' ? e.trick : e.t === 'revert' ? 'Revert' : e.t === 'wallplant' ? 'Wallplant' : e.t === 'wallrideStart' ? 'Wallride' : e.t === 'specialReady' ? 'SPECIAL READY' : e.t === 'manualEnd' || e.t === 'lipEnd' || e.t === 'wallrideEnd' ? '' : e.t === 'grindEnd' ? (e.reason === 'end' || e.reason === 'ollie' || e.reason === 'void' ? '' : `${e.trick}: ${e.reason}`) : e.t === 'trickEnd' || e.t === 'comboLanded' || e.t === 'comboLost' ? '' : e.t).filter(Boolean).join('\n')
    }
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
  performance.mark('boot:frame-loop')
  // Ready after the first frame; then the city's decoration, then the park's photos at full size
  // (half size until then; headless loads them full).
  requestAnimationFrame(() => requestAnimationFrame(() => {
    document.body.classList.add('ready')
    window.setTimeout(prebuildNpcs, 0)
    void Promise.resolve(city?.decorate()).then(() => benched).then(() => r.sharpen()).then(() => performance.mark('boot:sharp'))
      // Built site: now the game is up, the service worker fetches the rest of the files for offline play.
      .then(() => { if (import.meta.env.PROD) void navigator.serviceWorker?.ready.then((reg) => reg.active?.postMessage('warm')) })   // ready: it may not control a first visit yet
  }))

  // Menu backdrop: a slow orbit over the park.
  // The middle of the spawn spots, an ellipse along the park, under the freeway deck.
  const inPark = park.spots.filter((s) => s.pos.x > -20 && s.pos.x < 120 && s.pos.y > -10 && s.pos.y < 50)   // the park, not the city's spots
  const pc = inPark.length ? { x: inPark.reduce((s, p) => s + p.pos.x, 0) / inPark.length, y: inPark.reduce((s, p) => s + p.pos.y, 0) / inPark.length } : { x: 0, y: 0 }
  // The pause menu's scene (docs/art-direction.md): dimmed by the menu, slowly orbiting the skater from where the
  // camera was (about 3 degrees a second; still with Reduce motion). The tape glitch as it closes hides the cut back.
  let pauseFrom: { pose: CamPose; at: number } | null = null
  const pauseOrbit = (now: number, base: CamPose): CamPose => {
    if (!pauseFrom) pauseFrom = { pose: { pos: { ...base.pos }, look: { ...base.look }, fov: base.fov }, at: now }
    const P = pauseFrom.pose, a = Cam.calm ? 0 : (now - pauseFrom.at) / 1000 * 0.05
    const dx = P.pos.x - P.look.x, dy = P.pos.y - P.look.y, c = Math.cos(a), sn = Math.sin(a)
    return { pos: { x: P.look.x + dx * c - dy * sn, y: P.look.y + dx * sn + dy * c, z: P.pos.z }, look: P.look, fov: P.fov }
  }
  const flyover = (now: number) => {
    const a = now / 1000 * 0.045 + 3.6
    return { pos: { x: pc.x + Math.cos(a) * 34, y: pc.y + Math.sin(a) * 13, z: 6.5 }, look: { x: pc.x + Math.cos(a + 1.1) * 12, y: pc.y + Math.sin(a + 1.1) * 4, z: 1.2 }, fov: 58 }
  }

  // ---- dev keys ----
  const clipBox = $('clip'), clipNote = $<HTMLTextAreaElement>('clip-note')
  const tuning = $('tuning')
  keys.onDev = (action) => {
    if (action.startsWith('layer:')) return r.toggleLayer(action.slice(6) as Layer)
    switch (action) {
      case 'pause': paused = !paused; break
      case 'stepTick': if (paused) stepBudget++; break
      case 'camera': setCam(CAM_MODES[(CAM_MODES.indexOf(cam.mode) + 1) % CAM_MODES.length]); toast(`camera: ${cam.mode}`); break
      case 'respawn': if (school?.active) { schoolSignals(school.restart()); break } queue(`teleport ${skater(sim).spot || data.spots.default}`); break   // in Skate School: the lesson's start
      case 'nextSpot': {
        const i = (spotIds.indexOf(skater(sim).spot) + 1) % spotIds.length
        queue(`teleport ${spotIds[i]}`).then((res) => toast(res.ok ? spotIds[i] : res.text)); break
      }
      case 'save':
        quick = saveSnapshot(sim)
        if (DEV) post('/__skate/snapshot', { name: 'quicksave', snapshot: quick }).then((x) => toast(`saved ${x.path ?? 'in memory'}`)).catch(() => toast('saved in memory'))
        else toast('saved in memory')
        break
      case 'load':
        if (!quick) { toast('nothing saved yet (F5)'); break }
        sim = loadSnapshot(quick, park, sim.data)
        resetRecorder(); prev = curr = pose(skater(sim)); cam.step(skater(sim), true); toast('loaded quicksave')
        break
      case 'clip':
        if (!DEV) { toast('Clips go to the dev server (npm run dev)'); break }
        if (clipBox.style.display === 'block') { closeClip(); break }
        paused = true; keys.enabled = false
        clipBox.style.display = 'block'; clipNote.value = ''; clipNote.focus()
        break
      case 'pin': if (DEV) setPinMode(!pinMode); break
      case 'map': if (story?.map.isOpen) story.closeOverlay(); else if (!photoMode && !pinMode && !story?.talking && !intro && !demo) story?.openMap(menuOpen ? 'menu' : 'play'); break
      case 'character': if (menuOpen) openPicker(); else { toast(picker.step(1)); showSkaterName() } break
      case 'emote': emote(); break
      case 'style': { const s = r.styles; r.setStyle(s[(s.indexOf(r.style) + 1) % s.length]); toast(`look: ${r.style}`); break }
      case 'photo': {
        // Photo mode: freeze, hide the HUD, orbit the skater; Enter saves the frame.
        photoMode = !photoMode
        document.body.classList.toggle('hud-off', photoMode || !settings.get('hud'))
        if (photoMode) { camBeforePhoto = cam.mode === 'orbit' ? 'chase' : cam.mode; paused = true; setCam('orbit'); toast('Photo mode. Drag to frame, Enter saves, F postcard, B exits') }
        else { setCam(camBeforePhoto); paused = false }
        showPostcard()
        break
      }
      case 'share': {
        if (!DEV || params.has('browserclip')) { void startBrowserClip(); break }   // ?browserclip: the hosted build's recorder on the dev server
        // The last 15 seconds as a video with sound, rendered by the dev server into out/clips (SOMA_SKATE_CLIPS_DIR).
        const replay = rec.current.replay(120 * 15, 'share', { park: parkName, cam: cam.mode })
        toast('Rendering the last 15 seconds')
        post('/__skate/share', { replay, style: r.style, character: r.skater.characterId, music: radio?.synthPlaying ?? undefined, musicLevel: radio ? radio.level * 1.1 : undefined })
          .then((x) => toast(x.path ? `Saved: ${x.path}` : `Clip failed: ${x.error}`)).catch((err) => toast(`clip failed: ${err}`))
        break
      }
      case 'replay': if (replayPlay) endReplay(); else if (!menuOpen) startReplay(); break
      case 'radio': radio?.next(1); break
      case 'radioPrev': radio?.next(-1); break
      case 'radioOff': radio?.toggle(); break
      case 'help': ui.toggleHelp(); break
      case 'tuning':
        tuning.style.display = tuning.style.display === 'block' ? 'none' : 'block'
        if (tuning.style.display === 'block') buildTuning()
        break
    }
  }
  const closeClip = () => { clipBox.style.display = 'none'; keys.enabled = true; paused = false; canvas.focus() }
  clipNote.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); closeClip() }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      const replay = rec.current.replay(120 * 20, clipNote.value.trim(), { park: parkName, cam: cam.mode })
      r.render()
      const screenshot = canvas.toDataURL('image/png')
      post('/__skate/clip', { replay, screenshot }).then((x) => toast(x.path ? `clip saved: ${x.path}` : `clip failed: ${x.error}`)).catch((err) => toast(`clip failed: ${err}`))
      closeClip()
    }
  })

  /** Where the current game mode wants you: the courier stop or the next hill bomb gate. */
  const modeTarget = (s: Thing): { x: number; y: number; z: number; ring?: boolean } | null => {
    const R = data.run as unknown as { courier: { start: { pos: number[] }; legs: { to: number[] }[] } }
    if (s.mode === 'courier') { const p = s.courierCarrying ? R.courier.legs[s.courierLeg].to : R.courier.start.pos; return { x: p[0], y: p[1], z: p[2] } }
    if (s.mode === 'bomb') { const G = bombRoute(sim, s.raceRoute).gates, g = G[Math.min(s.raceGate, G.length - 1)].pos; return { x: g[0], y: g[1], z: g[2] } }
    if (s.mode === 'escape') { const me = skater(sim).pos, t = sim.world.things.filter((x) => x.id === s.escapeTaxi || x.id === s.escapeBackup).sort((a, b) => Math.hypot(a.pos.x - me.x, a.pos.y - me.y) - Math.hypot(b.pos.x - me.x, b.pos.y - me.y))[0]; if (t) return { x: t.pos.x, y: t.pos.y, z: t.pos.z, ring: true } }   // the nearer robotaxi   // where the robotaxi is: the minimap arrow, a ring under it
    if (s.mode === 'muni') {
      const L = (data.run as unknown as { muni: { lines: { id: string; stops: { at: number[] }[] }[] } }).muni.lines.find((l) => l.id === s.muniLine)
      if (L) { const n = Math.min(L.stops.length - 1, Math.max(...(s.muniReached ?? [0])) + 1), at = L.stops[n].at, h = raycast(park, v3(at[0], at[1], skater(sim).pos.z + 30), v3(0, 0, -1), 80); return { x: at[0], y: at[1], z: h ? h.point.z : skater(sim).pos.z } }
    }
    if (s.mode === 'skate') { const m = (data.run as unknown as { skate: { spot: { mark: number[] } } }).skate.spot.mark, h = raycast(park, v3(m[0], m[1], skater(sim).pos.z + 3), v3(0, 0, -1), 8); return { x: m[0], y: m[1], z: h ? h.point.z : skater(sim).pos.z, ring: true } }
    return null
  }

  const showResults = (e: Extract<SimEvent, { t: 'runOver' }>) => {
    ui.results(e, sim, '<kbd>Enter</kbd>again&emsp;<kbd>F</kbd>free skate', r.skater.characterName)
    paused = true
  }

  // ---- park comments: pin a spot, write it to the park model's data/comments.json (world generator; else out/park-comments) ----
  const pinBox = $('pin'), pinNote = $<HTMLTextAreaElement>('pin-note'), pinWhat = $('pin-what'), banner = $('banner')
  let pinHit: ReturnType<Renderer['pick']> = null
  const refreshPins = () => fetch('/__skate/park-comments').then((x) => x.json()).then((all: { n: number; point_site: number[]; done: boolean }[]) =>
    r.setPins(all.map((c) => ({ n: c.n, point: c.point_site, done: c.done })))).catch(() => {})
  if (DEV) refreshPins()
  const setPinMode = (on: boolean) => {
    pinMode = on
    banner.style.display = on ? 'block' : 'none'
    canvas.style.cursor = on ? 'crosshair' : ''
    r.setLayer('pins', on)
    if (on) { camBeforePin = cam.mode === 'orbit' ? 'chase' : cam.mode; paused = true; setCam('orbit') }
    else { closePin(); setCam(camBeforePin); paused = false }
  }
  const closePin = () => { pinBox.style.display = 'none'; pinHit = null; keys.enabled = true }
  let downAt: { x: number; y: number } | null = null
  canvas.addEventListener('pointerdown', (e) => { downAt = { x: e.clientX, y: e.clientY } })
  canvas.addEventListener('pointerup', (e) => {
    if (!pinMode || !downAt || Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 5) return
    const rect = canvas.getBoundingClientRect()
    const hit = r.pick(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1)
    if (!hit) { toast('nothing there to pin'); return }
    pinHit = hit
    const e2 = hit.element
    pinWhat.textContent = `${e2.feature ? e2.feature + ' ' : ''}${e2.name || e2.id} (${e2.collection}) at ${hit.point.x.toFixed(2)} ${hit.point.y.toFixed(2)} ${hit.point.z.toFixed(2)}`
    pinBox.style.display = 'block'; keys.enabled = false; pinNote.value = ''; pinNote.focus()
  })
  pinNote.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); closePin() }
    if (e.key === 'Enter' && !e.shiftKey && pinHit) {
      e.preventDefault()
      const h = pinHit, t = skater(sim)
      r.render()
      const screenshot = canvas.toDataURL('image/jpeg', 0.88)
      const target = orbit ? orbit.target : h.point
      post('/__skate/park-comment', {
        text: pinNote.value, point: h.point.toArray(), normal: h.normal.toArray(),
        element: h.element.id, elementName: h.element.name, collection: h.element.collection,
        camera: r.camera.position.toArray(), lookAt: [target.x, target.y, target.z],
        skater: { pos: [t.pos.x, t.pos.y, t.pos.z], spot: t.spot }, screenshot,
      }).then((x) => { toast(x.n ? `pin #${x.n} saved to the skatepark comments` : `pin failed: ${x.error}`); refreshPins() })
        .catch((err) => toast(`pin failed: ${err}`))
      closePin()
    }
  })
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && pinMode && pinBox.style.display !== 'block') setPinMode(false)
  })

  // ---- tuning panel: edits data/physics.json through the dev server ----
  const buildTuning = () => {
    const rows: string[] = []
    const walk = (o: Record<string, unknown>, path: string[]) => {
      for (const [k, v] of Object.entries(o)) {
        if (typeof v === 'number') rows.push(`<label><span>${[...path, k].join('.')}</span><input type="number" step="any" data-path="${[...path, k].join('.')}" value="${v}"></label>`)
        else if (v && typeof v === 'object') walk(v as Record<string, unknown>, [...path, k])
      }
    }
    walk(sim.data.physics as unknown as Record<string, unknown>, [])
    tuning.innerHTML = `<b>physics.json</b> <small>changes save to the file and apply live</small>${rows.join('')}`
    tuning.querySelectorAll('input').forEach((el) => el.addEventListener('change', () => {
      const value = Number(el.value)
      if (!Number.isFinite(value)) return
      post('/__skate/data', { file: 'physics', path: el.dataset.path, value }).then((x) => toast(x.ok ? `physics.${el.dataset.path} = ${value}` : x.error))
    }))
  }

  // ---- live bridge and hot data ----
  const hot = import.meta.hot
  if (hot) {
    hot.on('skate:cmd', async ({ id, text }: { id: string; text: string }) => {
      const results: string[] = []
      let ok = true
      for (const part of text.split(';').map((s) => s.trim()).filter(Boolean)) {
        const c = clientCommand(part)
        if (c !== null) { results.push(c); continue }
        if (paused && stepBudget === 0) results.push('(paused: runs on the next step)')
        const res = await queue(part)
        ok &&= res.ok; results.push(res.text)
      }
      hot.send('skate:result', { id, ok, text: results.join('; ') })
    })
    hot.on('skate:watch', ({ on }: { on: boolean }) => { watching = on })
    hot.on('skate:data', ({ file, json }: { file: string; json: unknown }) => {
      if (file === 'look') {
        try { r.setLook(lookSchema.parse(json)); toast('data: look.json reloaded') } catch (e) { toast(String((e as Error).message).slice(0, 200)) }
        return
      }
      if (file === 'camera') { Cam.setData(json as Parameters<typeof Cam.setData>[0]); toast('data: camera.json reloaded'); return }
      if (file === 'ui') {
        try { ui.setData(json); toast('data: ui.json reloaded') } catch (e) { toast(String((e as Error).message).slice(0, 200)) }
        return
      }
      if (file === 'radio') {
        try { radio?.setData(json); toast('data: radio.json reloaded') } catch (e) { toast(String((e as Error).message).slice(0, 200)) }
        return
      }
      if (file === 'sound') {
        try { sound.setData(json); toast('data: sound.json reloaded') } catch (e) { toast(String((e as Error).message).slice(0, 200)) }
        return
      }
      if (file === 'poses') {
        try { r.skater.setPoses(json as Parameters<SkaterView['setPoses']>[0]); toast('data: poses.json reloaded') } catch (e) { toast(String((e as Error).message).slice(0, 200)) }
        return
      }
      if (!(DATA_FILES as readonly string[]).includes(file)) return
      try {
        const next = validateGameData({ ...sim.data, [file]: json })
        const cmds = diffLeaves((sim.data as unknown as Record<string, unknown>)[file], (next as unknown as Record<string, unknown>)[file], file)
        for (const c of cmds) queue(c)
        if (cmds.length) toast(`data: ${cmds.length} change${cmds.length > 1 ? 's' : ''} from ${file}.json`)
      } catch (e) { toast(String((e as Error).message).slice(0, 200)) }
    })
  }
  ;(window as unknown as { __skateGame: unknown }).__skateGame = { get sim() { return sim }, get school() { return school }, get story() { return story }, get demo() { return demo ? { run: demoRun, ticks: demo.ticks } : null }, get split() { return split ? { active: split.active, layout: split.layout, standIn: split.standIn } : null }, get p2Input() { return p2Input.b }, queue, stateLine, get perf() { const i = r.renderer.info.render; return { calls: i.calls, triangles: i.triangles, scale: r.renderScale, pixelRatio: r.renderer.getPixelRatio(), quality: settings.get('quality') } }, ...(DEV ? { renderer: r, director, vignettes, sound, castPeople, interiors, ui, portraits: async (jobs: PortraitJob[], size?: number) => (await import("./portrait.ts")).renderPortraits(r.skater, data, jobs, size) } : {}) }   // renderer, director, vignettes, sound, castPeople, interiors, ui, portraits (tools/portraits.ts): dev probes only
}

function diffLeaves(a: unknown, b: unknown, path: string, out: string[] = []): string[] {
  if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
    for (const k of Object.keys(b)) diffLeaves((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}.${k}`, out)
  } else if (JSON.stringify(a) !== JSON.stringify(b)) out.push(`setData ${path} ${JSON.stringify(b)}`)
  return out
}

/** Night lamps: the park's freeway LEDs (and the city's street lights when exported) light the park shader. */
function nightLamps(src: ParkSource, cityLights: number[][]) {
  const lamps: { x: number; y: number; z: number; r: number }[] = []
  const p = src.positions, ix = src.indices
  for (const e of src.elements) {
    if (!/_lens$/.test(e.id) || e.collection !== 'freeway_lights') continue
    let x = 0, y = 0, z = 0, n = 0
    for (let t = e.tris[0]; t < e.tris[0] + e.tris[1]; t++) for (let k = 0; k < 3; k++) { const v = ix[t * 3 + k] * 3; x += p[v]; y += p[v + 1]; z += p[v + 2]; n++ }
    if (!n) continue
    x /= n; y /= n; z /= n
    lamps.push({ x, y, z: z - 0.2, r: 16 })
  }
  for (const l of cityLights) lamps.push({ x: l[0], y: l[1], z: l[2] - 0.2, r: 13 })
  return lamps
}

/** Headless API for the harness: render snapshots, re-run replays for cross-runtime checks. */
function exposeHeadless(r: Renderer, cam: Cam, getSim: () => Sim, setSim: (s: Sim) => void, src: ParkSource, pigeons: Pigeons, traffic: Traffic, ui: Hud, spectators: Spectators | null, npcViews: NpcViews, ghostView: GhostView, crowd: Crowd | null, dogs: Dogs | null, fx: Fx | null, pres: PresentData, schoolData: SchoolData | null, controls: Controls, splitData: SplitData, castPeople: CastPeople | null, casApply: ((k: CasSkater) => void) | null = null, interiors: Interiors | null = null) {
  ui.showMenu(false)
  pigeons.group.visible = traffic.group.visible = npcViews.group.visible = false   // shots judge the park; clips turn the street life on
  if (crowd) crowd.group.visible = false
  if (dogs) dogs.group.visible = false
  if (spectators) spectators.group.visible = false
  const api = {
    clip: clipApi(r, getSim().park, src, pigeons, traffic, ui, spectators, npcViews, crowd, dogs, fx, pres, schoolData ? { d: schoolData, keysFor: (a) => controls.keyboard[a] ?? [], padFor: (a) => controls.gamepad.buttons[a] ?? [] } : undefined, splitData),
    /** One more frame of the scene as the last render set it up (frame-cost probes: render, then read a pixel). */
    frame() { r.render(); return r.renderer.getContext() },
    /** Created skaters (Create-a-Skater: { id, name, choices }) to ride in shots and clips (--cas). */
    cas(list: CasSkater[]) { for (const k of list) casApply?.(k) },
    render(o: { snapshot: Snapshot; style?: Style; character?: string; layers?: Layer[]; cam?: CamMode; crop?: 'skater' | 'full'; width?: number; height?: number; camPose?: { pos: number[]; look: number[]; fov?: number; up?: number[]; lens?: number }; pins?: { n: number; point: number[]; done: boolean }[]; fog?: boolean; far?: number; weather?: string; life?: boolean; emote?: number; ghost?: Thing; tint?: Record<string, string> | null; react?: NpcReact | null; silhouette?: boolean; crowdLineup?: { x: number; y: number; z: number; h: number }; crowdCombo?: number; crowdSims?: SimPedestrian[]; picture?: { lens: boolean; ps2: boolean } }) {
      const sim = loadSnapshot(o.snapshot, getSim().park)
      setSim(sim)
      r.skater.setSilhouette(false)
      // Shots default to everything except HUD and debug, so shots show the scene without clutter.
      for (const l of LAYERS) r.setLayer(l, o.layers ? o.layers.includes(l) : l !== 'debug' && l !== 'hud' && l !== 'rails')
      document.body.classList.toggle('nohud', !(o.layers?.includes('hud') ?? false))
      // tint: the colours panel's paint (colour keys) on the shot's character, and so on its race ghost.
      if (o.tint !== undefined) r.skater.setTint(o.character?.split(':')[0] ?? r.skater.characterId, o.tint)
      if (o.character) { const [id, outfit] = o.character.split(':'); r.skater.setCharacter(id, outfit) }
      r.skater.emoteTick = o.emote !== undefined ? sim.world.tick - o.emote : -1
      r.skater.react = o.react ?? null   // the NPC reactions (skater/react.ts) on the shot's skater, to judge them per character
      const style = o.style ?? r.defaultStyle
      if (style !== r.style) r.setStyle(style)
      if (o.silhouette) r.skater.setSilhouette(true)   // a locked secret skater, as the picker shows it
      r.setWeather(o.weather ?? 'clear', true)
      r.setPicture(o.picture ?? { lens: true, ps2: false })   // the settings' defaults unless the shot asks
      cam.mode = o.cam && o.cam !== 'orbit' ? o.cam : 'chase'
      cam.step(skater(sim), true)
      r.skater.tick = sim.world.tick
      r.skater.pickupTick = pickupFromSession(skater(sim), session(sim), sim.data, sim.world.tick)
      r.setSkater(skater(sim), sim.data, 0)
      r.setPins(o.pins ?? [])
      const cp = o.camPose
      r.setCamera(cp ? { pos: { x: cp.pos[0], y: cp.pos[1], z: cp.pos[2] }, look: { x: cp.look[0], y: cp.look[1], z: cp.look[2] }, fov: cp.fov ?? 62, lens: cp.lens } : cam.at(1)!, cp?.up)
      if (cp) r.shadowAt({ x: cp.look[0], y: cp.look[1], z: cp.look[2] })   // views: shadows where the camera looks
      // life: the snapshot's cars drawn (shots of skitching and car grinds); off by default, as before.
      traffic.group.visible = !!o.life
      if (o.life) traffic.update(carPoses(sim.world.things), 0, sim.data.physics.tickHz, 0, r.camera.position)
      // --life also seats the watchers, cheering the snapshot's last banked combo (from where the skater is now).
      if (spectators) {
        spectators.group.visible = !!o.life
        const t = skater(sim), L = t.lastLand
        spectators.setStyle(r.style)
        spectators.update(sim.world.tick, t.pos, L.bankTick >= 0 ? { tick: L.bankTick, points: L.points, x: t.pos.x, y: t.pos.y, z: t.pos.z } : null)
      }
      // --life: the cast at their home spots too, turned to the skater if it is near (shots of the park alone leave them out, as the goldens do).
      if (castPeople) { castPeople.group.visible = !!o.life; castPeople.setStyle(r.style); if (o.life) { const t = skater(sim); castPeople.update(0, new THREE.Vector3(t.pos.x, t.pos.y, t.pos.z), r.camera.position) } }
      if (interiors) { interiors.group.visible = !!o.life; interiors.setStyle(r.style); if (o.life) { for (let i = 0; i < 40; i++) interiors.update(r.camera.position, r.night); r.setBloomShare(interiors.bloomShare) } }
      // --life draws the snapshot's NPC skaters too; a ghost frame (a Thing) draws the race ghost.
      npcViews.group.visible = !!o.life
      if (o.life) { npcViews.setStyle(r.style); npcViews.you = skater(sim); npcViews.sync(sim.world.things.filter((t) => t.kind === 'npc' && t.alive).map((cur) => ({ cur })), sim.world.tick, 0, sim.data, r.camera, true) }
      ghostView.set(o.ghost ?? null, sim.data)
      // --life: the people on the sidewalks too, reacting to the skater as they would at this moment.
      if (crowd) {
        crowd.group.visible = !!o.life
        crowd.lineup(o.crowdLineup ?? null)   // review shots: every type in a row
        if (o.life) {
          const t = skater(sim), L = t.lastLand
          crowd.setStyle(r.style)
          // crowdCombo (review shots): a combo of that many points landed here 40 ticks ago, for the filming and cheering.
          const landedNow = o.crowdCombo ? { tick: sim.world.tick - 40, points: o.crowdCombo, x: t.pos.x, y: t.pos.y } : L.bankTick >= 0 ? { tick: L.bankTick, points: L.points, x: t.pos.x, y: t.pos.y } : null
          crowd.update(sim.world.tick, r.camera, { x: t.pos.x, y: t.pos.y, z: t.pos.z, speed: Math.hypot(t.vel.x, t.vel.y) }, landedNow, false, o.crowdSims ?? [])
        }
      }
      // --life: the park dogs, their last few seconds played out with the skater coming along its line.
      if (dogs) {
        dogs.group.visible = !!o.life
        if (o.life) { const t = skater(sim); dogs.setStyle(r.style); dogs.settle({ x: t.pos.x, y: t.pos.y, z: t.pos.z, vx: t.vel.x, vy: t.vel.y }); dogs.update(0, { x: t.pos.x, y: t.pos.y, z: t.pos.z, vx: t.vel.x, vy: t.vel.y }, r.camera) }
      }
      // Overviews: no fog, a farther far plane (restored after the shot).
      const fog = r.scene.fog, far = r.camera.far
      if (o.fog === false) r.scene.fog = null
      if (o.far) { r.camera.far = o.far; r.camera.updateProjectionMatrix() }
      r.render()
      r.scene.fog = fog
      if (o.far) { r.camera.far = far; r.camera.updateProjectionMatrix() }
      return { crop: o.crop === 'skater' ? r.skaterRect() : null, tick: sim.world.tick, hash: worldHash(sim.world), pose: `${r.skater.last?.tag ?? ''}${r.skater.mood && r.skater.mood.mood !== 'neutral' ? ` · ${r.skater.mood.mood}` : ''}`, character: r.skater.characterId }
    },
    /** A loading photograph (tools/photos.ts, data/photos.json): the shot as render() sets it up, then src/client/photo.ts stages the figures and the flash and develops it. Dev only, as the portraits. */
    ...(DEV ? { async photo(o: { snapshot: Snapshot; job: PhotoJob }): Promise<string> { api.render(o as never); return (await import('./photo.ts')).shootPhoto(r, getSim().data, o.job) } } : {}),
    runReplay(replay: Replay) {
      const hashes: [number, string][] = []
      const res = runReplay(replay, getSim().park, { onTick: (s) => { if (s.world.tick % 30 === 0) hashes.push([s.world.tick, worldHash(s.world)]) } })
      return { hashes, final: worldHash(res.sim.world), divergence: res.divergence }
    },
  }
  ;(window as unknown as { __skate: unknown }).__skate = api
  document.body.classList.add('ready')
  document.body.dataset.ready = '1'
}

/** The GL context went away mid-game: a card over everything with a reload button. */
function contextLost() {
  if (document.getElementById('gl-lost')) return
  const c = document.createElement('div')
  c.id = 'gl-lost'
  c.innerHTML = '<div class="gl-lost-card"><b>The graphics reset.</b>Your browser took the game’s graphics memory back. Reload to keep skating: your scores, stickers and Tour are saved.<button>Reload</button></div>'
  c.querySelector('button')!.addEventListener('click', () => location.reload())
  document.body.append(c)
}

/** The browser or the device has no WebGL 2: the loading screen says what to try. */
function noWebGL() {
  const l = document.getElementById('loading')!
  l.classList.add('no-gl')
  document.getElementById('loading-status')!.innerHTML = '<div class="no-gl-card"><b>This browser can’t draw the park.</b>SoMa Skate needs WebGL 2. Try a recent Chrome, Edge, Firefox or Safari, and check that hardware acceleration is on in the browser’s settings.</div>'
}

boot().catch((e) => {
  document.body.dataset.error = String(e?.stack ?? e)
  const el = document.getElementById('toast')
  if (el) { el.textContent = `failed to start: ${e?.message ?? e}`; el.style.opacity = '1' }
  console.error(e)
})
