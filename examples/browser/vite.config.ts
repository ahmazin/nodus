import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const src = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@nodus/core': src('../../packages/core/src/index.ts'),
      '@nodus/react': src('../../packages/react/src/index.tsx'),
      '@nodus/preset-infra': src('../../packages/preset-infra/src/index.ts'),
      '@nodus/preset-diagrams': src('../../packages/preset-diagrams/src/index.ts'),
      '@nodus/icons-cloud': src('../../packages/icons-cloud/src/index.ts'),
      '@nodus/preset-draw': src('../../packages/preset-draw/src/index.ts'),
      '@nodus/layout-dagre': src('../../packages/layout-dagre/src/index.ts'),
      '@nodus/plugin-freehand': src('../../packages/plugin-freehand/src/index.ts'),
      '@nodus/from-mermaid': src('../../packages/from-mermaid/src/index.ts'),
      '@nodus/import-infra': src('../../packages/import-infra/src/index.ts'),
      '@nodus/layout-tree': src('../../packages/layout-tree/src/index.ts'),
      '@nodus/layout-force': src('../../packages/layout-force/src/index.ts'),
      '@nodus/layout-elk': src('../../packages/layout-elk/src/index.ts'),
      '@nodus/stencils': src('../../packages/stencils/src/index.ts'),
    },
  },
  server: { port: 5188, strictPort: true },
});
