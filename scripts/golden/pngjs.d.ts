/**
 * Minimal ambient types for `pngjs` (no @types package installed; adding one is a
 * lead-owned dependency change). Covers only the surface compare.ts uses.
 */
declare module 'pngjs' {
  export class PNG {
    constructor(options?: { width?: number; height?: number });
    width: number;
    height: number;
    data: Buffer;
    static sync: {
      read(buffer: Buffer): PNG;
      write(png: PNG): Buffer;
    };
  }
}
