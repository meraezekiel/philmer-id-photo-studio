import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// Tauri expects a fixed dev port and must not clear the terminal.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: false,
    watch: {
      // Rust is watched by cargo, not vite — and a `target` directory is full
      // of files that appear and vanish mid-build, which crashes the watcher.
      ignored: ['**/src-tauri/**', '**/crates/**', '**/tools/**', '**/target/**'],
    },
  },
  build: {
    // WebView2 on Windows 10/11 is evergreen Chromium.
    target: 'chrome110',
    sourcemap: false,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // The walkthrough's anchor test reads the source tree from disk.
    root: process.cwd(),
  },
})
