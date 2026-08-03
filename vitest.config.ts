import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

const src = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@nodus-dev/core': src('./packages/core/src/index.ts'),
      '@nodus-dev/preset-infra': src('./packages/preset-infra/src/index.ts'),
      '@nodus-dev/layout-dagre': src('./packages/layout-dagre/src/index.ts'),
      '@nodus-dev/layout-tree': src('./packages/layout-tree/src/index.ts'),
      '@nodus-dev/layout-force': src('./packages/layout-force/src/index.ts'),
      '@nodus-dev/layout-elk': src('./packages/layout-elk/src/index.ts'),
      '@nodus-dev/plugin-freehand': src('./packages/plugin-freehand/src/index.ts'),
      '@nodus-dev/preset-diagrams': src('./packages/preset-diagrams/src/index.ts'),
      '@nodus-dev/text-to-diagram': src('./packages/text-to-diagram/src/index.ts'),
      '@nodus-dev/import-infra': src('./packages/import-infra/src/index.ts'),
      '@nodus-dev/preset-draw': src('./packages/preset-draw/src/index.ts'),
      '@nodus-dev/from-mermaid': src('./packages/from-mermaid/src/index.ts'),
      '@nodus-dev/mcp': src('./packages/mcp/src/index.ts'),
      '@nodus-dev/persistence': src('./packages/persistence/src/index.ts'),
      '@nodus-dev/react': src('./packages/react/src/index.tsx'),
      '@nodus-dev/stencils': src('./packages/stencils/src/index.ts'),
      // gifenc ships CJS main + `module` ESM but no exports map: plain Node resolves the CJS
      // build whose named exports the lexer can't see. Bundlers use `module`; tests must too.
      gifenc: src('./packages/react/node_modules/gifenc/dist/gifenc.esm.js'),
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
