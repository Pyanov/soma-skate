// Stable 64-bit-ish FNV-1a hashes (two 32-bit lanes), printed as 16 hex chars.

export function hashString(s: string): string {
  let h1 = 0x811c9dc5, h2 = 0x01000193 ^ 0x5bd1e995
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 0x01000193)
    h2 = Math.imul(h2 ^ c, 0x01000193 + 2)
  }
  return hex(h1) + hex(h2)
}

export function hashBytes(bytes: Uint8Array): string {
  let h1 = 0x811c9dc5, h2 = 0x01000193 ^ 0x5bd1e995
  for (let i = 0; i < bytes.length; i++) {
    h1 = Math.imul(h1 ^ bytes[i], 0x01000193)
    h2 = Math.imul(h2 ^ bytes[i], 0x01000193 + 2)
  }
  return hex(h1) + hex(h2)
}

const hex = (h: number) => (h >>> 0).toString(16).padStart(8, '0')
