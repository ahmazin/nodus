import { defineConfig } from 'tsup';
import { readFile, writeFile } from 'node:fs/promises';

// RSC boundary marker. esbuild drops a `'use client'` directive during bundling — whether it comes
// from a tsup `banner` OR the entry source ("Module level directives cause errors when bundled ...
// was ignored") — because it can't attach a per-module directive to a multi-module bundle. The only
// way to ship it in the built dist is to prepend it AFTER esbuild finishes, so it is never parsed as
// a directive to strip. We prepend on the SAME first line (no newline) so line numbers stay aligned
// with the existing source map, and guard against double-prepend on watch rebuilds.
const USE_CLIENT = "'use client';";

export default defineConfig({
  entry: ['src/index.tsx'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  treeshake: true,
  external: ['react', 'react-dom', 'rbush', '@dagrejs/dagre', '@ahmazin/core'],
  // gifenc@1.0.3 has a `module` field but no `exports` map, so plain Node ESM resolves its CJS
  // `main` and cjs-module-lexer can't see the named exports (GIFEncoder/quantize/applyPalette) —
  // a real consumer importing @ahmazin/react from the tarball dies with "Named export not found".
  // tsup auto-externalizes dependencies, so bundle gifenc's (small) ESM build into the dist instead.
  noExternal: ['gifenc'],
  async onSuccess() {
    for (const file of ['dist/index.js', 'dist/index.cjs']) {
      const code = await readFile(file, 'utf8');
      if (!/^['"]use client['"]/.test(code)) {
        await writeFile(file, USE_CLIENT + code);
      }
    }
  },
});
