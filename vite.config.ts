import { defineConfig } from 'vite';
import pkg from './package.json';

// Single source of truth for the app version: package.json (bumped by scripts/release.mjs).
// Baked into the bundle as the __APP_VERSION__ global and shown in the credits window.

// Mobile is the priority platform; `host: true` exposes the dev server on the
// LAN so a phone can reach it. WebGPU and camera access require a secure context
// on real devices, so use HTTPS when testing from another device.
export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  server: {
    host: true,
    // Keep the port fixed so the Caddy reverse proxy target stays valid.
    port: 5173,
    strictPort: true,
    // Accept the Host header forwarded by the Caddy reverse proxy.
    allowedHosts: true,
  },
});
