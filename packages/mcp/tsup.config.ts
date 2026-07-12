import { defineConfig } from 'tsup';
export default defineConfig({
  entry: ['src/index.ts', 'src/bin.ts'],
  format: ['esm', 'cjs'],
  dts: { entry: 'src/index.ts' },
  clean: true,
  sourcemap: true,
  treeshake: true,
  banner: { js: '' },
  external: ['@nodus/core', '@nodus/preset-diagrams', '@nodus/preset-infra', '@nodus/preset-draw', '@nodus/from-mermaid', '@nodus/layout-dagre', '@nodus/layout-elk', '@napi-rs/canvas'],
});
