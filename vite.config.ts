import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // The manifest is kept: installability is real value for a vendor — an app
      // window, an icon, no browser chrome — and it carries no risk.
      //
      // The service worker is not. It precached index.html and bound every
      // navigation to that cached copy, so a deploy stayed invisible until the
      // worker updated on a later visit. Three deploys today appeared to serve
      // the previous build and I put it down to CDN caching; it was this. An
      // admin tool has to reflect a publish immediately, and nobody edits a
      // credential schema offline, so the caching bought nothing and cost
      // trust in what was on screen.
      //
      // selfDestroying ships a worker that unregisters itself and clears the old
      // caches, which is the only way to undo the ones already registered in
      // browsers that have visited the site.
      selfDestroying: true,
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'apple-touch-icon.png'],
      manifest: {
        name: 'CredPass Admin',
        short_name: 'CredPass',
        description: 'CredPass catalogue publishing and platform administration',
        theme_color: '#16213e',
        background_color: '#ffffff',
        display: 'standalone',
        scope: '/',
        start_url: '/',
        icons: [
          { src: 'icon-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512x512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      'react': path.resolve(__dirname, 'node_modules/react'),
      'react-dom': path.resolve(__dirname, 'node_modules/react-dom'),
    },
    dedupe: ['react', 'react-dom', 'react-router-dom', '@tanstack/react-query', '@tanstack/react-table'],
  },
  server: {
    host: '::',
    port: 3001,
  },
})
