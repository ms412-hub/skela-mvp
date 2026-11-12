// 체험용 아티팩트 번들 (앱 본체와 분리). 실행: npx vite build -c tools/artifact-demo/vite.config.ts
import { defineConfig } from 'vite'
import { resolve } from 'node:path'

export default defineConfig({
  root: resolve(__dirname),
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
    lib: { entry: resolve(__dirname, 'demo.ts'), name: 'SkelaDemo', formats: ['iife'], fileName: () => 'demo.js' },
  },
})
