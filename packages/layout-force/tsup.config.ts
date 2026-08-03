import { defineConfig } from 'tsup';
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true, clean: true, sourcemap: true, treeshake: true,
  external: ['@nodus-dev/core', 'd3-force', 'elkjs'],
});
