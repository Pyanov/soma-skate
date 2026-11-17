import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, relative } from 'node:path'

// Where the harness looks outside this repo. Every place is an environment variable with a default.

/**
 * The world generator's checkout (the park model and the city generator; see docs/roadmap.md, World generator).
 * SOMA_SKATEPARK_DIR, else SKATE_PARK_REPO (older name), else ~/soma-skatepark.
 */
export const parkRepoDir = () => process.env.SOMA_SKATEPARK_DIR ?? process.env.SKATE_PARK_REPO ?? join(homedir(), 'soma-skatepark')

/** The generator's checkout, or a clear error for commands that need it. */
export function requireParkRepo(what: string): string {
  const dir = parkRepoDir()
  if (!existsSync(dir)) throw new Error(`${what} needs the world generator's checkout (not found at ${dir}; set SOMA_SKATEPARK_DIR). Players and most contributors do not need it: ./skate world fetch gets the built world.`)
  return dir
}

/** Photos (B) and share videos (V) from the dev server: SOMA_SKATE_CLIPS_DIR, else out/clips in the repo. */
export const clipsDir = (root: string) => process.env.SOMA_SKATE_CLIPS_DIR ?? join(root, 'out', 'clips')

/** A path to show the player: relative to the repo when inside it. */
export const shownPath = (root: string, p: string) => { const r = relative(root, p); return r.startsWith('..') ? p : r }
