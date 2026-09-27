import { defineConfig } from 'vite';

// Dev: `npm run dev` on http://127.0.0.1:5273
// `npm run test:e2e` starts its own server with RISK_E2E=1: no HMR and no file watching, so editing a
// file mid-run can't reload the page under a running flow.
const e2e = !!process.env.RISK_E2E;

export default defineConfig({
  server: { host: '127.0.0.1', port: 5273, ...(e2e ? { hmr: false, watch: null } : {}) },
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
});
