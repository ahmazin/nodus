#!/usr/bin/env node
/** Entry point: run the Nodus MCP server on stdio. Configure your MCP client with `command: node`,
 *  `args: [<this file>]`. Optional env NODUS_MCP_DATA sets the data dir for exports + saved docs. */
import { DiagramSession } from './session.js';
import { runStdioServer } from './server.js';

const dataDir = process.env.NODUS_MCP_DATA;
runStdioServer(new DiagramSession(dataDir ? { dataDir } : {}));
