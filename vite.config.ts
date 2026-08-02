import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages hosts this project below /ghost-deck/. Keep local dev at /.
export default defineConfig(({ command }) => ({
  base: command === 'serve' ? '/' : '/ghost-deck/',
  plugins: [react()],
}))
