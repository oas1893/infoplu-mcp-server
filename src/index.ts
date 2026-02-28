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
  // express.json() is applied per-route below — NOT globally.
  // The legacy SSE /message route needs the raw body stream, so it must not
  // be pre-parsed by this middleware.

  // ── StreamableHTTP — modern transport, works with n8n ────────────────────
  // Session-aware: POST (initialize) and GET (SSE stream) share the same
  // transport instance, looked up by the mcp-session-id header n8n sends.
  const streamableSessions = new Map<string, StreamableHTTPServerTransport>();

  const handleStreamable = async (req: Request, res: Response): Promise<void> => {
    try {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;

      // Reuse existing session (e.g. the GET that follows an initializing POST)
      if (sessionId && streamableSessions.has(sessionId)) {
        const transport = streamableSessions.get(sessionId)!;
        await transport.handleRequest(req, res, req.body);
        return;
      }

      // New session — create server + transport, store once session ID is known
      const mcpServer = createServer();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => {
          streamableSessions.set(id, transport);
        },
      });

      res.on("close", () => {
        for (const [id, t] of streamableSessions.entries()) {
          if (t === transport) { streamableSessions.delete(id); break; }
        }
      });

      await mcpServer.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error("StreamableHTTP error:", err);
      if (!res.headersSent) res.status(500).json({ error: "Internal server error" });
    }
  };

  app.head("/mcp", (_req: Request, res: Response) => {
    res.status(200).end();
  });
  app.post("/mcp", express.json(), handleStreamable);
  app.get("/mcp", (req: Request, res: Response) => {
    // n8n probes with GET but no Accept: text/event-stream — return 200 and let
    // the POST-based StreamableHTTP flow handle the actual MCP session.
    if (!req.headers.accept?.includes("text/event-stream")) {
      res.status(200).end();
      return;
    }
    handleStreamable(req, res);
  });
  app.delete("/mcp", express.json(), async (req: Request, res: Response) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    if (sessionId) {
      const transport = streamableSessions.get(sessionId);
      if (transport) { await transport.close().catch(() => {}); streamableSessions.delete(sessionId); }
    }
    res.status(200).end();
  });

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
