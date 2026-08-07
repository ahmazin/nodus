#!/usr/bin/env node
/** Entry point: run the Nodus MCP server on stdio. Configure your MCP client with `command: node`,
 *  `args: [<this file>]`. Optional env NODUS_MCP_DATA sets the data dir for exports + saved docs.
 *  By default, export_png/export_svg may only write inside that data dir. Set NODUS_MCP_ALLOW_CWD
 *  (1/true/yes) to also allow writes under the current working directory. */
import { DiagramSession } from './session.js';
import { runStdioServer } from './server.js';

const dataDir = process.env.NODUS_MCP_DATA;
const allowCwd = /^(1|true|yes)$/i.test(process.env.NODUS_MCP_ALLOW_CWD ?? '');
runStdioServer(new DiagramSession({ ...(dataDir ? { dataDir } : {}), allowCwd }));
