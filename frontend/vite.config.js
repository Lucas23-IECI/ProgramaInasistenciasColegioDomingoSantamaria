import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  cssMinify: 'lightningcss',
  build: {
    modulePreload: { polyfill: false },
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'tool-xlsx', test: /node_modules[\\/]xlsx[\\/]/, priority: 20 },
            { name: 'tool-zxing', test: /node_modules[\\/]@zxing[\\/]/, priority: 20 },
            { name: 'tool-tour', test: /node_modules[\\/]driver\.js[\\/]/, priority: 20 },
          ],
        },
      },
    },
  },
})
