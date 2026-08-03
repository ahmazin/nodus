import { defineConfig } from 'tsup';
export default defineConfig({
  entry: ['src/index.ts', 'src/bin.ts'],
  format: ['esm', 'cjs'],
  dts: { entry: 'src/index.ts' },
  clean: true,
  sourcemap: true,
  treeshake: true,
  banner: { js: '' },
  external: ['@nodus-dev/core', '@nodus-dev/preset-diagrams', '@nodus-dev/preset-infra', '@nodus-dev/preset-draw', '@nodus-dev/from-mermaid', '@nodus-dev/layout-dagre', '@nodus-dev/layout-elk', '@napi-rs/canvas'],
});
