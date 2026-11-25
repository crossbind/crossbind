import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import crossbind from 'crossbind'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), crossbind()],
})
