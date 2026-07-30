/**
 * @ahmazin/stencils — reusable element-group fragments (stencils) and starting diagrams (templates)
 * for Nodus, plus a canonical, git-diffable (de)serializer for stencil libraries.
 */

export type { Stencil, StencilLibrary, Template } from './types.js';
export { serializeLibrary, parseLibrary } from './serialize.js';
export { builtinStencils, builtinTemplates } from './builtin.js';
