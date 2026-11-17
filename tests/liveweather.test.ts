import { describe, expect, it } from 'vitest'
import { presetFor, type LiveNow } from '../src/client/liveweather.ts'

// Weather → Live: the real SF weather mapped onto the game's presets.
const L = { lat: 37.77, lon: -122.42, fogVisibility: 4000, fogCloud: 90, goldenMinutes: 50, refreshMinutes: 15 }
const at = (o: Partial<LiveNow>): LiveNow => ({ isDay: true, cloud: 10, visibility: 30000, code: 0, tempC: 16, time: '2026-10-17T13:00', sunrise: '2026-10-17T07:20', sunset: '2026-10-17T18:29', ...o })

describe('live weather', () => {
  it('maps the sky onto a preset', () => {
    expect(presetFor(at({}), L).preset).toBe('clear')
    expect(presetFor(at({ visibility: 900 }), L).preset).toBe('karl')
    expect(presetFor(at({ code: 45 }), L).preset).toBe('karl')
    expect(presetFor(at({ cloud: 95 }), L).preset).toBe('karl')
    expect(presetFor(at({ time: '2026-10-17T18:00' }), L).preset).toBe('golden')
    expect(presetFor(at({ time: '2026-10-17T07:40' }), L).preset).toBe('golden')
    expect(presetFor(at({ isDay: false, time: '2026-10-17T23:00' }), L).preset).toBe('night')
    expect(presetFor(at({ isDay: false, visibility: 1500 }), L).preset).toBe('fognight')
  })
  it('says what it is', () => {
    expect(presetFor(at({ visibility: 900, tempC: 13.6 }), L).summary).toBe('fog, 14 °C')
    expect(presetFor(at({ code: 61 }), L).summary).toBe('drizzle, 16 °C')
  })
})
