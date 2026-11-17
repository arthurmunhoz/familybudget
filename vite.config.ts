import { resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Two pages: index.html is the static marketing landing (SEO — plain HTML, no
// JS), casa.html is the React app (Modo Casa + /admin). In production
// vercel.json rewrites every non-file path to /casa.html; this mirrors that in
// dev so /casa and /admin work under `npm run dev` too.
const LANDING = new Set(['/', '/index.html', '/pt', '/pt/', '/es', '/es/'])
function spaFallback(): Plugin {
  return {
    name: 'casa-spa-fallback',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const path = (req.url ?? '/').split('?')[0]
        const isFile = /\.[a-z0-9]+$/i.test(path) || path.startsWith('/@') || path.startsWith('/src/') || path.startsWith('/node_modules/')
        if (req.method === 'GET' && !isFile && !LANDING.has(path) && !path.startsWith('/api/')) req.url = '/casa.html'
        next()
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), spaFallback()],
  server: {
    host: true, // listen on the LAN so phones on the same wifi can connect
  },
  build: {
    rollupOptions: {
      input: { landing: resolve(__dirname, 'index.html'), casa: resolve(__dirname, 'casa.html') },
    },
  },
})
