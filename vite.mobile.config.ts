import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Standalone Vite build for the iOS (Capacitor) web layer. Reuses the existing
// renderer components/CSS/stores from src/renderer/src, with a mobile entry in
// src/mobile that installs a stub window.api (Phase 0) → later the Capacitor
// plugin bridge. Output goes to dist-mobile/, which capacitor.config.ts serves.
export default defineConfig({
  root: resolve(__dirname, 'src/mobile'),
  base: './',
  plugins: [
    react(),
    {
      // Capacitor serves over the capacitor:// custom scheme, which can't satisfy
      // CORS — Vite's default `crossorigin` on the module script/style makes the
      // WebView refuse to load the bundle (black screen). Strip it.
      name: 'folderify-strip-crossorigin',
      transformIndexHtml(html) {
        return html.replace(/\s+crossorigin/g, '')
      }
    }
  ],
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@renderer': resolve(__dirname, 'src/renderer/src')
    }
  },
  server: {
    fs: { allow: [resolve(__dirname)] }
  },
  build: {
    outDir: resolve(__dirname, 'dist-mobile'),
    emptyOutDir: true
  }
})
