import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

const src = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@ahmazin/core': src('./packages/core/src/index.ts'),
      '@ahmazin/preset-infra': src('./packages/preset-infra/src/index.ts'),
      '@ahmazin/layout-dagre': src('./packages/layout-dagre/src/index.ts'),
      '@ahmazin/layout-tree': src('./packages/layout-tree/src/index.ts'),
      '@ahmazin/layout-force': src('./packages/layout-force/src/index.ts'),
      '@ahmazin/layout-elk': src('./packages/layout-elk/src/index.ts'),
      '@ahmazin/plugin-freehand': src('./packages/plugin-freehand/src/index.ts'),
      '@ahmazin/preset-diagrams': src('./packages/preset-diagrams/src/index.ts'),
      '@ahmazin/text-to-diagram': src('./packages/text-to-diagram/src/index.ts'),
      '@ahmazin/import-infra': src('./packages/import-infra/src/index.ts'),
      '@ahmazin/preset-draw': src('./packages/preset-draw/src/index.ts'),
      '@ahmazin/from-mermaid': src('./packages/from-mermaid/src/index.ts'),
      '@ahmazin/mcp': src('./packages/mcp/src/index.ts'),
      '@ahmazin/persistence': src('./packages/persistence/src/index.ts'),
      '@ahmazin/react': src('./packages/react/src/index.tsx'),
      '@ahmazin/stencils': src('./packages/stencils/src/index.ts'),
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
