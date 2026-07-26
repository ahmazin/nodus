/**
 * Minimal, dependency-free MCP server over stdio (newline-delimited JSON-RPC 2.0). Handles the
 * initialize handshake, tools/list, and tools/call, delegating tool logic to DiagramSession/dispatch.
 * All non-protocol output goes to stderr — stdout carries ONLY JSON-RPC messages.
 */
import { createRequire } from 'node:module';
import { DiagramSession, TOOLS, dispatch } from './session.js';

// serverInfo.version tracks package.json (single source of truth) instead of a hardcoded literal that
// silently goes stale on the next version bump.
const PKG_VERSION = (createRequire(import.meta.url)('../package.json') as { version: string }).version;

// Advertise the newest MCP revision we handshake with, and keep older revisions accepted so a client
// negotiating any of them still connects. The initialize handler echoes the client's requested version
// when it is one we support, else offers PROTOCOL_VERSION.
const PROTOCOL_VERSION = '2025-06-18';
const SUPPORTED_VERSIONS = new Set(['2025-06-18', '2025-03-26', '2024-11-05']);

interface JsonRpcIn {
  jsonrpc?: string;
  id?: number | string | null;
  method?: string;
  params?: Record<string, unknown>;
}

export interface StdioServerOptions {
  /** Input stream of newline-delimited JSON-RPC (default `process.stdin`). */
  input?: NodeJS.ReadableStream;
  /** Output stream for JSON-RPC responses (default `process.stdout`). */
  output?: NodeJS.WritableStream;
  /** Called instead of `process.exit` when the input ends — injectable so tests don't kill the runner. */
  onExit?: (code: number) => void;
}

export function runStdioServer(session: DiagramSession = new DiagramSession(), opts: StdioServerOptions = {}): void {
  const input = opts.input ?? process.stdin;
  const output = opts.output ?? process.stdout;
  const onExit = opts.onExit ?? ((code: number): void => void process.exit(code));
  let buffer = '';
  let queue: Promise<void> = Promise.resolve(); // serialize handling so tool calls never race on state
  const write = (msg: object): void => void output.write(`${JSON.stringify(msg)}\n`);
  const reply = (id: JsonRpcIn['id'], result: object): void => write({ jsonrpc: '2.0', id, result });
  const replyError = (id: JsonRpcIn['id'], code: number, message: string): void => write({ jsonrpc: '2.0', id, error: { code, message } });

  async function handle(raw: unknown): Promise<void> {
    // A parseable-but-non-object line (`null`, `42`, `"x"`, `[…]`) must never destructure-crash the
    // loop: JSON.parse('null') is not a parse error, so a bare `null` reaches here. Reject as Invalid
    // Request (id undeterminable → null) instead of throwing.
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      replyError(null, -32600, 'Invalid Request');
      return;
    }
    const msg = raw as JsonRpcIn;
    const { id, method, params } = msg;
    const isNotification = id === undefined || id === null;
    // Malformed envelope — missing/non-string method, or a jsonrpc that isn't "2.0" — is -32600 Invalid
    // Request, NOT -32601 Method not found (which is reserved for a well-formed request naming an
    // unknown method).
    if (typeof method !== 'string' || (msg.jsonrpc != null && msg.jsonrpc !== '2.0')) {
      if (!isNotification) replyError(id, -32600, 'Invalid Request');
      return;
    }
    try {
      switch (method) {
        case 'initialize': {
          // Only echo the client's version if we actually implement it; otherwise offer ours (spec:
          // the server proposes a version it supports rather than falsely claiming the client's).
          const req = params?.protocolVersion;
          const version = typeof req === 'string' && SUPPORTED_VERSIONS.has(req) ? req : PROTOCOL_VERSION;
          if (!isNotification) reply(id, { protocolVersion: version, capabilities: { tools: {} }, serverInfo: { name: 'nodus-mcp', version: PKG_VERSION } });
          return;
        }
        case 'notifications/initialized':
        case 'initialized':
          return; // notification — no response
        case 'ping':
          if (!isNotification) reply(id, {});
          return;
        case 'tools/list':
          if (!isNotification) reply(id, { tools: TOOLS });
          return;
        case 'tools/call': {
          const result = await dispatch(session, params?.name as string, (params?.arguments as Record<string, unknown>) ?? {});
          if (!isNotification) reply(id, result); // a notification-form call runs but MUST NOT be answered
          return;
        }
        default:
          if (!isNotification) replyError(id, -32601, `Method not found: ${method}`);
      }
    } catch (e) {
      if (!isNotification) replyError(id, -32603, e instanceof Error ? e.message : String(e));
    }
  }

  // Last-resort backstop: never let a stray rejection terminate the process (engines.node>=20 defaults
  // unhandledRejection to throw). The queue `.catch` above already covers the handler path. Only in real
  // stdio mode — injected-stream (test) callers must not mutate global process listeners.
  if (opts.input === undefined) {
    process.on('unhandledRejection', (reason) => {
      process.stderr.write(`nodus-mcp: unhandledRejection: ${reason instanceof Error ? (reason.stack ?? reason.message) : String(reason)}\n`);
    });
  }

  input.setEncoding('utf8');
  input.on('data', (chunk: string) => {
    buffer += chunk;
    let nl: number;
    while ((nl = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      let msg: unknown;
      try {
        msg = JSON.parse(line);
      } catch {
        write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
        continue;
      }
      // `.catch` so a single rejected handler can NEVER poison the serialization chain — an un-caught
      // rejection here would make every subsequent message be silently dropped (server goes deaf) and
      // block clean exit. handle() already replies -32603 for tool errors; this is the last-resort net.
      queue = queue.then(() => handle(msg)).catch((e) => {
        process.stderr.write(`nodus-mcp: handler error: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`);
      });
    }
  });
  input.on('end', () => {
    // Drain in-flight handlers (import/layout/export await real async work) and flush output before
    // exiting, so a final response is never truncated by an eager exit.
    void queue.then(() => {
      const pending = (output as { writableLength?: number }).writableLength ?? 0;
      if (pending > 0) output.once('drain', () => onExit(0));
      else onExit(0);
    });
  });
  process.stderr.write(`nodus-mcp: ready on stdio (${TOOLS.length} tools)\n`);
}
