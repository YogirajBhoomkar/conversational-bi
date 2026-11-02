import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev proxy keeps the browser same-origin with the Mastra server (port 4111), so no CORS is needed locally.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { '/bi': process.env.API_URL ?? 'http://localhost:4111', '/auth': process.env.API_URL ?? 'http://localhost:4111' } },
});
