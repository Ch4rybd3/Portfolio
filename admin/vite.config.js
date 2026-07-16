import { resolve } from 'path'
import { defineConfig } from 'vite'

export default defineConfig({
  base: '/admin/',
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        login:     resolve(__dirname, 'login.html'),
        dashboard: resolve(__dirname, 'dashboard.html'),
        editor:    resolve(__dirname, 'editor.html'),
        kanban:    resolve(__dirname, 'kanban.html'),
        docs:      resolve(__dirname, 'docs.html'),
        remora:    resolve(__dirname, 'remora.html'),
        security:  resolve(__dirname, 'security.html'),
      }
    }
  }
})
