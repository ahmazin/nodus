import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const src = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@ahmazin/core': src('../../packages/core/src/index.ts'),
      '@ahmazin/react': src('../../packages/react/src/index.tsx'),
      '@ahmazin/preset-infra': src('../../packages/preset-infra/src/index.ts'),
      '@ahmazin/preset-diagrams': src('../../packages/preset-diagrams/src/index.ts'),
      '@ahmazin/icons-cloud': src('../../packages/icons-cloud/src/index.ts'),
      '@ahmazin/preset-draw': src('../../packages/preset-draw/src/index.ts'),
      '@ahmazin/layout-dagre': src('../../packages/layout-dagre/src/index.ts'),
      '@ahmazin/plugin-freehand': src('../../packages/plugin-freehand/src/index.ts'),
      '@ahmazin/from-mermaid': src('../../packages/from-mermaid/src/index.ts'),
      '@ahmazin/import-infra': src('../../packages/import-infra/src/index.ts'),
      '@ahmazin/layout-tree': src('../../packages/layout-tree/src/index.ts'),
      '@ahmazin/layout-force': src('../../packages/layout-force/src/index.ts'),
      '@ahmazin/layout-elk': src('../../packages/layout-elk/src/index.ts'),
      '@ahmazin/stencils': src('../../packages/stencils/src/index.ts'),
    },
  },
  server: { port: 5188, strictPort: true },
});
