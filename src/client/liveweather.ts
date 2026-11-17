// Weather → "Live: SF right now": the real San Francisco weather from Open-Meteo (free, no key, no
// user data sent beyond the request), mapped onto the game's presets: night, foggy night, Karl the
// Fog, golden hour or clear. Numbers in data/look.json real.live.

export type LiveLook = { lat: number; lon: number; fogVisibility: number; fogCloud: number; goldenMinutes: number; refreshMinutes: number }
export type LiveNow = { isDay: boolean; cloud: number; visibility: number; code: number; tempC: number; time: string; sunrise: string; sunset: string }

const FOG_CODES = new Set([45, 48])
const WET_CODES = new Set([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82])
const minutes = (iso: string) => { const t = iso.split('T')[1] ?? '00:00'; const [h, m] = t.split(':').map(Number); return h * 60 + m }

/** Which preset fits the weather now, and a short description for the menu. */
export function presetFor(n: LiveNow, L: LiveLook): { preset: string; summary: string } {
  const foggy = n.visibility < L.fogVisibility || FOG_CODES.has(n.code) || (n.isDay && n.cloud >= L.fogCloud) || WET_CODES.has(n.code)
  const what = FOG_CODES.has(n.code) || n.visibility < L.fogVisibility ? 'fog' : WET_CODES.has(n.code) ? 'drizzle' : n.cloud >= L.fogCloud ? 'overcast' : n.cloud >= 40 ? 'some clouds' : 'clear'
  const summary = `${what}, ${Math.round(n.tempC)} °C`
  if (!n.isDay) return { preset: foggy ? 'fognight' : 'night', summary }
  if (foggy) return { preset: 'karl', summary }
  const now = minutes(n.time), up = minutes(n.sunrise), down = minutes(n.sunset)
  if (now - up < L.goldenMinutes || down - now < L.goldenMinutes) return { preset: 'golden', summary }
  return { preset: 'clear', summary }
}

/** The weather now in San Francisco, or null when the service can't be reached. */
export async function fetchSF(L: LiveLook): Promise<LiveNow | null> {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${L.lat}&longitude=${L.lon}&current=is_day,cloud_cover,visibility,weather_code,temperature_2m&daily=sunrise,sunset&timezone=America%2FLos_Angeles&forecast_days=1`
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) })
    if (!r.ok) return null
    const j = await r.json() as { current: { is_day: number; cloud_cover: number; visibility: number; weather_code: number; temperature_2m: number; time: string }; daily: { sunrise: string[]; sunset: string[] } }
    const c = j.current
    return { isDay: c.is_day === 1, cloud: c.cloud_cover, visibility: c.visibility, code: c.weather_code, tempC: c.temperature_2m, time: c.time, sunrise: j.daily.sunrise[0], sunset: j.daily.sunset[0] }
  } catch { return null }
}
