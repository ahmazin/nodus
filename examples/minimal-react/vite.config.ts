import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The @nodus/* workspace packages point `main`/`types` at their `src/index.ts`, so Vite resolves them
// straight from source — no build step needed while developing.
export default defineConfig({
  plugins: [react()],
  server: { port: 5190, strictPort: true },
});
