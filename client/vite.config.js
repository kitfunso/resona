import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5174,
    strictPort: true,
    proxy: {
      '/api': 'http://localhost:3030',
      '/ws': { target: 'ws://localhost:3030', ws: true },
      '/health': 'http://localhost:3030',
    },
  },
});
