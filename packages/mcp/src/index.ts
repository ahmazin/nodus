/**
 * @ahmazin/mcp — a Model Context Protocol server around a headless Nodus Editor. An agent can build
 * diagrams (import Mermaid, add/connect/layout nodes) and export PNG/JSON. Run the stdio server via
 * the `nodus-mcp` bin, or embed DiagramSession + dispatch in your own transport.
 */
export { DiagramSession, TOOLS, dispatch } from './session.js';
export type { Content, Preset, ToolResult } from './session.js';
export { runStdioServer } from './server.js';
