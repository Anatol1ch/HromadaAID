import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
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
