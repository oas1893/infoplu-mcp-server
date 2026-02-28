#!/usr/bin/env node
/**
 * InfoPlu MCP Server
 *
 * Supports three transports:
 *   - stdio               — local use with Claude Desktop / CLI clients
 *   - sse  (TRANSPORT=sse) — HTTP server exposing both:
 *       POST/GET /mcp  — StreamableHTTP (modern, works with n8n)
 *       GET  /sse      — legacy SSE (fallback for older clients)
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express, { type Request, type Response } from "express";
import { randomUUID } from "node:crypto";

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

async function runHttp(): Promise<void> {
  const app = express();
  app.use(express.json());

  // ── StreamableHTTP — modern transport, works with n8n ────────────────────
  // Each request creates its own server+transport pair (stateless).
  // This avoids session state complexity and works perfectly for read-only tools.
  const handleStreamable = async (req: Request, res: Response): Promise<void> => {
    try {
      const mcpServer = createServer();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
      });
      res.on("close", () => { transport.close().catch(() => {}); });
      await mcpServer.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error("StreamableHTTP error:", err);
      if (!res.headersSent) res.status(500).json({ error: "Internal server error" });
    }
  };

  app.post("/mcp", handleStreamable);
  app.get("/mcp", handleStreamable);
  app.delete("/mcp", (_req: Request, res: Response) => res.status(200).end());

  // ── Legacy SSE — kept for backward compatibility ──────────────────────────
  const sseTransports = new Map<string, SSEServerTransport>();

  app.get("/sse", async (_req: Request, res: Response) => {
    const mcpServer = createServer();
    const transport = new SSEServerTransport("/message", res);
    sseTransports.set(transport.sessionId, transport);
    res.on("close", () => sseTransports.delete(transport.sessionId));
    await mcpServer.connect(transport);
  });

  app.post("/message", async (req: Request, res: Response) => {
    const sessionId = req.query.sessionId as string | undefined;
    if (!sessionId) { res.status(400).json({ error: "Missing sessionId" }); return; }
    const transport = sseTransports.get(sessionId);
    if (!transport) { res.status(404).json({ error: "Session not found" }); return; }
    await transport.handlePostMessage(req, res);
  });

  // ── Health check ───────────────────────────────────────────────────────────
  app.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "ok", server: "infoplu-mcp-server" });
  });

  app.listen(PORT, () => {
    console.error(`InfoPlu MCP server running on port ${PORT}`);
    console.error(`  StreamableHTTP (n8n): http://0.0.0.0:${PORT}/mcp`);
    console.error(`  SSE (legacy):         http://0.0.0.0:${PORT}/sse`);
    console.error(`  Health:               http://0.0.0.0:${PORT}/health`);
  });
}

async function main(): Promise<void> {
  if (TRANSPORT === "sse") {
    await runHttp();
  } else {
    await runStdio();
  }
}

main().catch((error: unknown) => {
  console.error("Fatal error starting InfoPlu MCP server:", error);
  process.exit(1);
});
