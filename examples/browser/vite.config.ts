import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const src = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@nodus-dev/core': src('../../packages/core/src/index.ts'),
      '@nodus-dev/react': src('../../packages/react/src/index.tsx'),
      '@nodus-dev/preset-infra': src('../../packages/preset-infra/src/index.ts'),
      '@nodus-dev/preset-diagrams': src('../../packages/preset-diagrams/src/index.ts'),
      '@nodus-dev/icons-cloud': src('../../packages/icons-cloud/src/index.ts'),
      '@nodus-dev/preset-draw': src('../../packages/preset-draw/src/index.ts'),
      '@nodus-dev/layout-dagre': src('../../packages/layout-dagre/src/index.ts'),
      '@nodus-dev/plugin-freehand': src('../../packages/plugin-freehand/src/index.ts'),
      '@nodus-dev/from-mermaid': src('../../packages/from-mermaid/src/index.ts'),
      '@nodus-dev/import-infra': src('../../packages/import-infra/src/index.ts'),
      '@nodus-dev/layout-tree': src('../../packages/layout-tree/src/index.ts'),
      '@nodus-dev/layout-force': src('../../packages/layout-force/src/index.ts'),
      '@nodus-dev/layout-elk': src('../../packages/layout-elk/src/index.ts'),
      '@nodus-dev/stencils': src('../../packages/stencils/src/index.ts'),
    },
  },
  server: { port: 5188, strictPort: true },
});
