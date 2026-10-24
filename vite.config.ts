import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // Electron loads the packaged renderer from file://. Relative asset URLs keep
  // Vite's hashed bundles next to index.html instead of resolving from /assets.
  base: './',
  plugins: [react()],
  clearScreen: false,
  server: {
    host: '127.0.0.1',
    port: 5175,
    strictPort: true,
    watch: {
      // Electron writes its isolated test profile under server/.data while Vite
      // runs. Those runtime files never affect renderer source and can be held
      // open by Chromium on Windows.
      ignored: [
        '**/server/.data/**',
        '**/*.sqlite', '**/*.sqlite-wal', '**/*.sqlite-shm',
        '**/GPUPersistentCache/**', '**/generated-documents-temp/**',
      ],
    },
  },
  optimizeDeps: {
    force: true,
  },
})
