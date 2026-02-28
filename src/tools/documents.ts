import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiGet, handleApiError } from "../services/api-client.js";
import { CHARACTER_LIMIT } from "../constants.js";
import type { DocumentFile } from "../types.js";

// Strip bbox and geometry from a document or grid object
function pruneDoc(raw: Record<string, unknown>): Record<string, unknown> {
  const { bbox, ...doc } = raw as Record<string, unknown> & { bbox?: unknown };
  if (doc.grid && typeof doc.grid === "object") {
    const { geometry, ...grid } = doc.grid as Record<string, unknown>;
    void geometry;
    doc.grid = grid;
  }
  return doc;
}

export function registerDocumentTools(server: McpServer): void {
  // ─── Tool 1: infoplu_search_documents ───────────────────────────────────────
  server.registerTool(
    "infoplu_search_documents",
    {
      title: "Search Urban Planning Documents",
      description: `Search and filter urban planning documents from the French Géoportail de l'Urbanisme.

Use this tool to find PLU, PLUi, POS, CC, PSMV, SUP, and SCoT documents for a given territory, filtered by type, legal status, partition code, or upload date. This is the entry point for most workflows — it returns document IDs that can then be used with infoplu_get_document_details.

Args:
  - documentFamily (array, optional): Filter by document family:
    - "DU" = Documents d'Urbanisme (PLU, POS, CC, PLUi)
    - "PSMV" = Plans de Sauvegarde et de Mise en Valeur
    - "SUP" = Servitudes d'Utilité Publique
    - "SCoT" = Schémas de Cohérence Territoriale
  - documentType (array, optional): Filter by specific type: "PLU", "PLUi", "CC", "POS", "PSMV", "SUP", "SCoT"
  - partition (string, optional): Filter by exact partition code (e.g., "69123_PLU_20220101")
  - legalStatus (string, optional): "APPROVED" (legally in force), "PENDING" (under review), "REJECTED", "UNKNOWN"
  - uploadedAfter (string, optional): Only documents uploaded after this date, format "YYYYMMDD" (e.g., "20240101")
  - page (number, optional): Page number starting at 0 (default: 0)
  - limit (number, optional): Results per page, max 100 (default: 20)
  - response_format (string, optional): "markdown" (default) or "json"

Returns:
  List of documents with:
  - id: 32-char hex identifier → use with infoplu_get_document_details
  - originalName: upload folder name (e.g., "69123_PLU_20220101")
  - type: document type (PLU, PLUi, CC, POS, PSMV, SUP, SCoT)
  - legalStatus: APPROVED / PENDING / REJECTED / UNKNOWN
  - status: processing status (document.production or document.deleted)
  - name: partition identifier
  - grid: { name, title, type } of the associated territory
  - uploadDate / updateDate: timestamps

Examples:
  - Find PLU for Lyon: documentType=["PLU"], then filter by grid name "69123"
  - List all approved DU: documentFamily=["DU"], legalStatus="APPROVED"
  - Recent uploads: uploadedAfter="20240101"

Error handling:
  - Returns an informative message if no documents match
  - Narrow search with documentFamily or legalStatus if results are too broad`,
      inputSchema: z.object({
        documentFamily: z
          .array(z.enum(["DU", "PSMV", "SUP", "SCoT"]))
          .optional()
          .describe(
            'Filter by family: "DU" (Documents d\'Urbanisme: PLU/PLUi/CC/POS), "PSMV" (Plans de Sauvegarde), "SUP" (Servitudes d\'Utilité Publique), "SCoT" (Schémas de Cohérence Territoriale)'
          ),
        documentType: z
          .array(z.enum(["POS", "CC", "PLU", "PLUi", "PSMV", "SUP", "SCoT"]))
          .optional()
          .describe(
            'Filter by type: "PLU" (Plan Local d\'Urbanisme), "PLUi" (PLU intercommunal), "CC" (Carte Communale), "POS" (Plan d\'Occupation des Sols, legacy), "PSMV", "SUP", "SCoT"'
          ),
        partition: z
          .string()
          .optional()
          .describe('Exact partition code, e.g., "69123_PLU_20220101"'),
        legalStatus: z
          .enum(["APPROVED", "PENDING", "REJECTED", "UNKNOWN"])
          .optional()
          .describe(
            '"APPROVED" = legally in force, "PENDING" = under review / awaiting approval, "REJECTED" = rejected, "UNKNOWN" = status undetermined'
          ),
        uploadedAfter: z
          .string()
          .regex(/^\d{8}$/, 'Must be YYYYMMDD format, e.g., "20240101"')
          .optional()
          .describe('Only return documents uploaded after this date, format "YYYYMMDD" (e.g., "20240101")'),
        page: z
          .number()
          .int()
          .min(0)
          .default(0)
          .describe("Page number starting at 0 (default: 0)"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .default(20)
          .describe("Results per page, max 100 (default: 20)"),
        response_format: z
          .enum(["markdown", "json"])
          .default("markdown")
          .describe('"markdown" for readable text output (default), "json" for structured data'),
      }).strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params) => {
      try {
        const queryParams: Record<string, unknown> = {
          page: params.page,
          limit: params.limit,
        };
        if (params.documentFamily?.length) queryParams.documentFamily = params.documentFamily;
        if (params.documentType?.length) queryParams.documentType = params.documentType;
        if (params.partition) queryParams.partition = params.partition;
        if (params.legalStatus) queryParams.legalStatus = params.legalStatus;
        if (params.uploadedAfter) queryParams.uploadedAfter = params.uploadedAfter;

        const docs = await apiGet<Record<string, unknown>[]>("/document", queryParams);

        if (!docs.length) {
          return {
            content: [
              {
                type: "text",
                text: "No documents found matching the given filters. Try removing legalStatus, changing documentType, or searching by territory with infoplu_search_grids first.",
              },
            ],
          };
        }

        const pruned = docs.map(pruneDoc);

        if (params.response_format === "json") {
          const out = JSON.stringify({ count: pruned.length, documents: pruned }, null, 2);
          return { content: [{ type: "text", text: out.slice(0, CHARACTER_LIMIT) }] };
        }

        const lines: string[] = [
          `# Documents d'Urbanisme — ${pruned.length} result(s)`,
          "",
        ];
        for (const doc of pruned) {
          lines.push(`## ${String(doc.originalName ?? doc.name ?? doc.id)}`);
          lines.push(`- **ID**: \`${doc.id}\``);
          lines.push(`- **Type**: ${doc.type}`);
          lines.push(`- **Legal status**: ${doc.legalStatus}`);
          lines.push(`- **Processing status**: ${doc.status}`);
          if (doc.grid && typeof doc.grid === "object") {
            const g = doc.grid as Record<string, unknown>;
            lines.push(`- **Territory**: ${g.title} (${g.name}) — ${g.type}`);
          }
          lines.push(`- **Uploaded**: ${doc.uploadDate}  |  **Updated**: ${doc.updateDate}`);
          if (doc.fileIdentifier) lines.push(`- **File identifier**: ${doc.fileIdentifier}`);
          lines.push("");
        }

        return {
          content: [{ type: "text", text: lines.join("\n").slice(0, CHARACTER_LIMIT) }],
        };
      } catch (error) {
        return { content: [{ type: "text", text: handleApiError(error) }] };
      }
    }
  );

  // ─── Tool 2: infoplu_get_document_details ────────────────────────────────────
  server.registerTool(
    "infoplu_get_document_details",
    {
      title: "Get Document Details",
      description: `Get full details of a specific urban planning document by its 32-character hex ID.

Use this tool after finding a document ID via infoplu_search_documents to retrieve complete metadata including the list of attached written pieces (règlement, rapport de présentation, annexes), archive URL, and producer information.

Args:
  - documentId (string, required): 32-character hex document ID obtained from infoplu_search_documents
  - response_format (string, optional): "markdown" (default) or "json"

Returns:
  Full document object including:
  - id, originalName, type, legalStatus, status, statusDate
  - name: partition identifier
  - grid: associated territory { name, title, type }
  - uploadDate, updateDate
  - title: official document title
  - producer: issuing authority name
  - projectionCode: coordinate system used (e.g., "EPSG:2154")
  - typeref: cadastral reference type ("01" or "02")
  - files: array of attached written pieces with { name, title, path }
  - writingMaterials: map of written piece names to download URLs
  - archiveUrl: URL to download the full ZIP archive
  - fileIdentifier: metadata sheet identifier
  - protected: whether download access is restricted

Error handling:
  - Returns "Error: Resource not found" if the documentId does not exist
  - Use infoplu_search_documents to discover valid document IDs`,
      inputSchema: z.object({
        documentId: z
          .string()
          .length(32)
          .regex(/^[a-f0-9]{32}$/, "Must be a 32-character lowercase hex string")
          .describe(
            '32-character hex document ID (e.g., "a1b2c3d4..."), obtainable from infoplu_search_documents'
          ),
        response_format: z
          .enum(["markdown", "json"])
          .default("markdown")
          .describe('"markdown" for readable output (default), "json" for structured data'),
      }).strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params) => {
      try {
        const raw = await apiGet<Record<string, unknown>>(
          `/document/${params.documentId}/details`
        );
        const doc = pruneDoc(raw);

        if (params.response_format === "json") {
          return {
            content: [{ type: "text", text: JSON.stringify(doc, null, 2).slice(0, CHARACTER_LIMIT) }],
          };
        }

        const lines: string[] = [
          `# ${String(doc.title ?? doc.originalName ?? doc.id)}`,
          "",
          `- **ID**: \`${doc.id}\``,
          `- **Type**: ${doc.type}`,
          `- **Legal status**: ${doc.legalStatus}`,
          `- **Processing status**: ${doc.status} (since ${doc.statusDate})`,
          `- **Partition**: ${doc.name}`,
        ];

        if (doc.grid && typeof doc.grid === "object") {
          const g = doc.grid as Record<string, unknown>;
          lines.push(`- **Territory**: ${g.title} (${g.name}) — ${g.type}`);
        }

        lines.push(`- **Uploaded**: ${doc.uploadDate}  |  **Updated**: ${doc.updateDate}`);
        if (doc.producer) lines.push(`- **Producer**: ${doc.producer}`);
        if (doc.projectionCode) lines.push(`- **Projection**: ${doc.projectionCode}`);
        if (doc.typeref) lines.push(`- **Cadastral reference**: ${doc.typeref}`);
        if (doc.archiveUrl) lines.push(`- **Archive URL**: ${doc.archiveUrl}`);
        if (doc.protected !== undefined)
          lines.push(`- **Download restricted**: ${doc.protected ? "Yes" : "No"}`);
        if (doc.fileIdentifier) lines.push(`- **File identifier**: ${doc.fileIdentifier}`);

        const files = doc.files as DocumentFile[] | undefined;
        if (files?.length) {
          lines.push("", `## Attached Written Pieces (${files.length})`);
          for (const f of files) {
            lines.push(`- **${f.title ?? f.name}** — \`${f.path}\``);
          }
        }

        const materials = doc.writingMaterials as Record<string, string> | undefined;
        if (materials && Object.keys(materials).length > 0) {
          lines.push("", "## Writing Materials (URLs)");
          for (const [name, url] of Object.entries(materials)) {
            lines.push(`- **${name}**: ${url}`);
          }
        }

        return {
          content: [{ type: "text", text: lines.join("\n").slice(0, CHARACTER_LIMIT) }],
        };
      } catch (error) {
        return { content: [{ type: "text", text: handleApiError(error) }] };
      }
    }
  );

  // ─── Tool 3: infoplu_list_document_files ─────────────────────────────────────
  server.registerTool(
    "infoplu_list_document_files",
    {
      title: "List Document Written Pieces",
      description: `List the written pieces (pièces écrites) attached to an urban planning document — the règlement (zoning regulations), rapport de présentation (planning report), PADD, annexes, etc.

Use this to discover which PDF files are attached to a document before referencing them. File paths can be used to locate and identify specific regulation files.

Args:
  - documentId (string, required): 32-character hex document ID, obtained from infoplu_search_documents or infoplu_get_document_details

Returns:
  Array of file objects, each with:
  - name: filename (e.g., "reglement.pdf")
  - title: human-readable label (e.g., "Règlement")
  - path: relative path to access the file

Error handling:
  - Returns "Error: Resource not found" for invalid documentId
  - Returns an empty list message if the document has no attached files`,
      inputSchema: z.object({
        documentId: z
          .string()
          .length(32)
          .regex(/^[a-f0-9]{32}$/, "Must be a 32-character lowercase hex string")
          .describe("32-character hex document ID, obtainable from infoplu_search_documents"),
      }).strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params) => {
      try {
        const files = await apiGet<DocumentFile[]>(
          `/document/${params.documentId}/files`
        );

        if (!files.length) {
          return {
            content: [
              {
                type: "text",
                text: `No written pieces found for document \`${params.documentId}\`. The document may have no attached files or may not be in production status.`,
              },
            ],
          };
        }

        const lines = [
          `# Written Pieces for Document \`${params.documentId}\``,
          `${files.length} file(s) attached:`,
          "",
          ...files.map((f) => `- **${f.title ?? f.name}** — \`${f.path}\``),
        ];

        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (error) {
        return { content: [{ type: "text", text: handleApiError(error) }] };
      }
    }
  );
}
