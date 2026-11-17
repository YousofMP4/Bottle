import { cloudflare } from '@cloudflare/vite-plugin';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// The cloud build reuses the same React app as the Mac version (../web) and serves it from the Worker.
export default defineConfig({
  publicDir: '../web/public',
  resolve: { alias: { '/web-src': fileURLToPath(new URL('../web/src', import.meta.url)) } },
  plugins: [react(), cloudflare()],
  build: { target: 'es2022' },
  define: { 'import.meta.env.VITE_PORTAL_CLOUD': JSON.stringify('1') },
  server: { port: 5180, strictPort: true, fs: { allow: ['..'] } },
});
