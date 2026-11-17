import type { LineInfo, ParkSource } from '../sim/park/source.ts'

// Rider lines this game adds to a world's own (data/lines.json): the city export carries the lines
// written in the world generator's city config; places it has none for yet (EMB, Pier 7) get theirs here. Both
// loaders (the client's load.ts and the harness's io.ts) append them, so the sim sees one list.

/** data/lines.json: world name -> its extra lines (_doc aside). */
export type ExtraLines = Record<string, LineInfo[] | string>

/** A world's park source with its extra rider lines after its own (the same object when there are none). */
export function addLines<T extends ParkSource>(world: string, src: T, extra: ExtraLines | null | undefined): T {
  const more = extra?.[world]
  return Array.isArray(more) && more.length ? { ...src, lines: [...(src.lines ?? []), ...more] } : src
}
