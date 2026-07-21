import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

const src = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@nodus/core': src('./packages/core/src/index.ts'),
      '@nodus/preset-infra': src('./packages/preset-infra/src/index.ts'),
      '@nodus/layout-dagre': src('./packages/layout-dagre/src/index.ts'),
      '@nodus/layout-tree': src('./packages/layout-tree/src/index.ts'),
      '@nodus/layout-force': src('./packages/layout-force/src/index.ts'),
      '@nodus/layout-elk': src('./packages/layout-elk/src/index.ts'),
      '@nodus/plugin-freehand': src('./packages/plugin-freehand/src/index.ts'),
      '@nodus/preset-diagrams': src('./packages/preset-diagrams/src/index.ts'),
      '@nodus/text-to-diagram': src('./packages/text-to-diagram/src/index.ts'),
      '@nodus/import-infra': src('./packages/import-infra/src/index.ts'),
      '@nodus/preset-draw': src('./packages/preset-draw/src/index.ts'),
      '@nodus/from-mermaid': src('./packages/from-mermaid/src/index.ts'),
      '@nodus/mcp': src('./packages/mcp/src/index.ts'),
      '@nodus/persistence': src('./packages/persistence/src/index.ts'),
      '@nodus/react': src('./packages/react/src/index.tsx'),
      '@nodus/stencils': src('./packages/stencils/src/index.ts'),
    },
  },
  test: {
    include: [
      'packages/**/*.test.{ts,tsx}',
      'examples/browser/src/import-analyze.test.ts',
      'examples/browser/src/status-bar.test.ts',
    ],
    environment: 'node',
  },
});
