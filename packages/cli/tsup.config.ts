import { defineConfig } from 'tsup';
export default defineConfig({
  entry: ['src/index.ts', 'src/bin.ts'],
  format: ['esm', 'cjs'],
  dts: { entry: 'src/index.ts' },
  clean: true,
  sourcemap: true,
  treeshake: true,
  banner: { js: '' },
  external: ['@ahmazin/core', '@ahmazin/preset-diagrams', '@ahmazin/preset-infra', '@ahmazin/preset-draw', '@napi-rs/canvas'],
});
