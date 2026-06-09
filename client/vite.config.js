import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Serve and copy MediaPipe wasm runtime from node_modules so face-detect doesn't
// depend on the jsdelivr CDN at demo time. The tflite model still loads from
// Google Cloud Storage, which is materially more stable than jsdelivr.
function mediapipeWasmPlugin() {
  const wasmDir = (() => {
    const candidates = [
      path.resolve(__dirname, 'node_modules/@mediapipe/tasks-vision/wasm'),
      path.resolve(__dirname, '..', 'node_modules/@mediapipe/tasks-vision/wasm'),
    ];
    return candidates.find((p) => fs.existsSync(p)) ?? null;
  })();
  return {
    name: 'mediapipe-wasm',
    configureServer(server) {
      if (!wasmDir) return;
      server.middlewares.use('/mediapipe/wasm', (req, res, next) => {
        const rel = (req.url || '').split('?')[0].replace(/^\/+/, '');
        const file = path.join(wasmDir, rel);
        if (!file.startsWith(wasmDir) || !fs.existsSync(file)) return next();
        if (file.endsWith('.wasm')) res.setHeader('Content-Type', 'application/wasm');
        else if (file.endsWith('.js')) res.setHeader('Content-Type', 'application/javascript');
        fs.createReadStream(file).pipe(res);
      });
    },
    writeBundle() {
      if (!wasmDir) return;
      const outDir = path.resolve(__dirname, 'dist/mediapipe/wasm');
      fs.mkdirSync(outDir, { recursive: true });
      for (const f of fs.readdirSync(wasmDir)) {
        fs.copyFileSync(path.join(wasmDir, f), path.join(outDir, f));
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), mediapipeWasmPlugin()],
  build: {
    rollupOptions: {
      // Multi-page: ship the React app AND the standalone heart-validation
      // harness (test-harness/validate.html) so the latter is reachable in a
      // static (Cloudflare Pages) deploy at /test-harness/validate.html.
      input: {
        main: path.resolve(__dirname, 'index.html'),
        validate: path.resolve(__dirname, 'test-harness/validate.html'),
      },
      output: {
        // Split the React runtime into its own chunk (FE-5). React changes far
        // less often than app code, so returning users keep vendor-react cached
        // across deploys instead of re-downloading React inside the app bundle
        // on every ship. (MediaPipe is already a separate lazy chunk.)
        manualChunks: {
          'vendor-react': ['react', 'react-dom'],
        },
      },
    },
  },
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
