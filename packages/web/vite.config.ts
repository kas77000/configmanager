import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The API runs on :4000. In dev, proxy /api and inject a Windows identity header
// (in production a reverse proxy does Windows Integrated Auth and sets this header).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
});
