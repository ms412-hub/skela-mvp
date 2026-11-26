import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/skela-mvp/',
  build: {
    rollupOptions: {
      // index.html: 캐릭터 도구, room.html: Skela Room (3D 인테리어 편집기), room2.html: Skela Room v2 시제품
      input: { main: 'index.html', room: 'room.html', room2: 'room2.html' },
    },
  },
})
