import { defineConfig } from 'vitest/config'
// testTimeout 30 s: the 5 s default timed out on a busy machine (parallel runs, builds).
export default defineConfig({ test: { include: ['tests/**/*.test.ts'], pool: 'threads', testTimeout: 30000 } })
