import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('.', import.meta.url))
const version = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version as string

export default defineConfig({
  root,
  base: './',
  plugins: [react()],
  define: { __MANAGER_VERSION__: JSON.stringify(version) },
  server: { host: '127.0.0.1', port: 5176, strictPort: true },
  build: { outDir: '../dist-server-manager/renderer', emptyOutDir: true },
})
