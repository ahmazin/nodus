import { defineConfig } from 'tsup';

// Multi-entry: the package ships subpath exports (`.`, `./aws`, `./azure`, `./gcp`) whose
// publishConfig points at dist/{index,aws,azure,gcp}.{js,cjs,d.ts}. Each entry below maps to one
// of those files; shared code (install.ts, the generated packs) is split into common chunks.
// @nodus/core is a peer of the consuming app, so it stays external rather than being bundled.
export default defineConfig({
  entry: ['src/index.ts', 'src/aws.ts', 'src/azure.ts', 'src/gcp.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  treeshake: true,
  external: ['@nodus/core'],
});
