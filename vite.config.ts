import { defineConfig } from 'vite';

// Dev: `npm run dev` on http://127.0.0.1:5273
export default defineConfig({
  server: { host: '127.0.0.1', port: 5273 },
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
});
