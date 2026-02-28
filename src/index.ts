#!/usr/bin/env node
/**
 * InfoPlu MCP Server
 *
 * MCP server wrapping the French Géoportail de l'Urbanisme API.
 * Provides 16 tools for querying urban planning documents, territories,
 * procedures, standards, and spatial feature lookups.
 *
 * Supports two transports:
 *   - stdio  (default) — for local use with Claude Desktop or CLI clients
 *   - sse             — HTTP+SSE server for Docker/VPS deployment
 *
 * Set TRANSPORT=sse and PORT=3000 (or your preferred port) for remote mode.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import express, { type Request, type Response } from "express";

import { TRANSPORT, PORT } from "./constants.js";
import { registerDocumentTools } from "./tools/documents.js";
import { registerGridTools } from "./tools/grids.js";
import { registerProcedureTools } from "./tools/procedures.js";
import { registerStandardTools } from "./tools/standards.js";
import { registerFeatureInfoTools } from "./tools/feature-info.js";

function createServer(): McpServer {
  const server = new McpServer({
    name: "infoplu-mcp-server",
    version: "1.0.0",
  });

  registerDocumentTools(server);
  registerGridTools(server);
  registerProcedureTools(server);
  registerStandardTools(server);
  registerFeatureInfoTools(server);

  return server;
}

async function runStdio(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("InfoPlu MCP server running via stdio");
}

async function runSse(): Promise<void> {
  const app = express();
  app.use(express.json());

  // Map of sessionId → SSEServerTransport for active connections
  const transports = new Map<string, SSEServerTransport>();

  // SSE endpoint — client connects here to receive events
  app.get("/sse", async (_req: Request, res: Response) => {
    const server = createServer();
    const transport = new SSEServerTransport("/message", res);

    transports.set(transport.sessionId, transport);
    res.on("close", () => transports.delete(transport.sessionId));

    await server.connect(transport);
  });

  // Message endpoint — client POSTs JSON-RPC messages here
  app.post("/message", async (req: Request, res: Response) => {
    const sessionId = req.query.sessionId as string | undefined;
    if (!sessionId) {
      res.status(400).json({ error: "Missing sessionId query parameter" });
      return;
    }

    const transport = transports.get(sessionId);
    if (!transport) {
      res.status(404).json({ error: `Session "${sessionId}" not found` });
      return;
    }

    await transport.handlePostMessage(req, res);
  });

  app.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "ok", server: "infoplu-mcp-server", transport: "sse" });
  });

  app.listen(PORT, () => {
    console.error(`InfoPlu MCP server running via SSE on port ${PORT}`);
    console.error(`  SSE endpoint:     http://0.0.0.0:${PORT}/sse`);
    console.error(`  Message endpoint: http://0.0.0.0:${PORT}/message`);
    console.error(`  Health check:     http://0.0.0.0:${PORT}/health`);
  });
}

async function main(): Promise<void> {
  if (TRANSPORT === "sse") {
    await runSse();
  } else {
    await runStdio();
  }
}

main().catch((error: unknown) => {
  console.error("Fatal error starting InfoPlu MCP server:", error);
  process.exit(1);
});
