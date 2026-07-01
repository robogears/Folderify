import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

// music-metadata and chokidar are pure-ESM. We keep them EXTERNAL (not bundled)
// and load them in the main process via dynamic `await import(...)`, which works
// cleanly from a CommonJS main bundle and sidesteps the ERR_REQUIRE_ESM trap.
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/main/index.ts') }
      }
    }
  },
  preload: {
    // Sandboxed preload must be CommonJS — externalize everything.
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/preload/index.ts') }
      }
    }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared'),
        '@renderer': resolve(__dirname, 'src/renderer/src')
      }
    },
    server: {
      // Allow Vite to read the shared/ folder, which lives outside the renderer root.
      fs: { allow: [resolve(__dirname)] }
    },
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/renderer/index.html') }
      }
    },
    plugins: [react()]
  }
})
