import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'book.json', 'engine/*'],
      manifest: {
        name: 'ChessDoctor',
        short_name: 'ChessDoctor',
        description: 'Find and fix the leaks in the openings you actually play. Everything runs on your device.',
        theme_color: '#1b1a18',
        background_color: '#1b1a18',
        display: 'standalone',
        start_url: '.',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,json,wasm}'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        navigateFallback: 'index.html',
      },
    }),
  ],
  // Phone testing over `tailscale serve` (tailnet-only HTTPS).
  preview: { allowedHosts: ['.ts.net'] },
  test: { environment: 'node' },
});
