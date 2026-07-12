/**
 * Minimal, dependency-free MCP server over stdio (newline-delimited JSON-RPC 2.0). Handles the
 * initialize handshake, tools/list, and tools/call, delegating tool logic to DiagramSession/dispatch.
 * All non-protocol output goes to stderr — stdout carries ONLY JSON-RPC messages.
 */
import { DiagramSession, TOOLS, dispatch } from './session.js';

const PROTOCOL_VERSION = '2024-11-05';
const SUPPORTED_VERSIONS = new Set([PROTOCOL_VERSION]);

interface JsonRpcIn {
  jsonrpc?: string;
  id?: number | string | null;
  method?: string;
  params?: Record<string, unknown>;
}

export function runStdioServer(session: DiagramSession = new DiagramSession()): void {
  let buffer = '';
  let queue: Promise<void> = Promise.resolve(); // serialize handling so tool calls never race on state
  const write = (msg: object): void => void process.stdout.write(`${JSON.stringify(msg)}\n`);
  const reply = (id: JsonRpcIn['id'], result: object): void => write({ jsonrpc: '2.0', id, result });
  const replyError = (id: JsonRpcIn['id'], code: number, message: string): void => write({ jsonrpc: '2.0', id, error: { code, message } });

  async function handle(msg: JsonRpcIn): Promise<void> {
    const { id, method, params } = msg;
    const isNotification = id === undefined || id === null;
    try {
      switch (method) {
        case 'initialize': {
          // Only echo the client's version if we actually implement it; otherwise offer ours (spec:
          // the server proposes a version it supports rather than falsely claiming the client's).
          const req = params?.protocolVersion;
          const version = typeof req === 'string' && SUPPORTED_VERSIONS.has(req) ? req : PROTOCOL_VERSION;
          if (!isNotification) reply(id, { protocolVersion: version, capabilities: { tools: {} }, serverInfo: { name: 'nodus-mcp', version: '0.1.0' } });
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

  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk: string) => {
    buffer += chunk;
    let nl: number;
    while ((nl = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      let msg: JsonRpcIn;
      try {
        msg = JSON.parse(line);
      } catch {
        write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
        continue;
      }
      queue = queue.then(() => handle(msg));
    }
  });
  process.stdin.on('end', () => {
    // Drain in-flight handlers (import/layout/export await real async work) and flush stdout before
    // exiting, so a final response is never truncated by an eager process.exit.
    void queue.then(() => {
      if (process.stdout.writableLength > 0) process.stdout.once('drain', () => process.exit(0));
      else process.exit(0);
    });
  });
  process.stderr.write(`nodus-mcp: ready on stdio (${TOOLS.length} tools)\n`);
}
