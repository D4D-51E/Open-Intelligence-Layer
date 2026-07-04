import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// adsb.lol does not send CORS headers, so the browser cannot call it directly.
// Proxy it same-origin in dev/preview; production uses the equivalent Vercel rewrite.
const adsbLolProxy = {
  '/adsb-lol': {
    target: 'https://api.adsb.lol',
    changeOrigin: true,
    rewrite: (path: string) => path.replace(/^\/adsb-lol/, ''),
  },
};

export default defineConfig({
  plugins: [react()],
  server: { host: '0.0.0.0', proxy: adsbLolProxy },
  preview: { proxy: adsbLolProxy },
  test: {
    environment: 'jsdom',
    setupFiles: './vitest.setup.ts',
    globals: true
  }
});
