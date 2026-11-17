import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'
import { skateDevPlugin } from './src/harness/devserver.ts'

const root = fileURLToPath(new URL('.', import.meta.url)).replace(/\/$/, '')

export default defineConfig({
  plugins: [skateDevPlugin(root)],
  server: {
    host: '127.0.0.1',
    port: 5410,
    strictPort: true,
    open: false,
    watch: { ignored: ['**/out/**', '**/inbox/**', '**/replays/**', '**/goldens/**', '**/scenarios/**'] },
  },
})
