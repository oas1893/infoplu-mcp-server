import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiGet, handleApiError } from "../services/api-client.js";
import { CHARACTER_LIMIT } from "../constants.js";
import type { Procedure } from "../types.js";

const PROCEDURE_TYPE_LABELS: Record<string, string> = {
  E: "Élaboration (initial creation)",
  R: "Révision (full revision)",
  RA: "Révision allégée (simplified revision)",
  M: "Modification",
  MS: "Modification simplifiée",
  MEC: "Mise en compatibilité",
  MAJ: "Mise à jour",
};

export function registerProcedureTools(server: McpServer): void {
  server.registerTool(
    "infoplu_search_procedures",
    {
      title: "Search Urban Planning Procedures",
      description: `Search for urban planning procedures (procédures d'urbanisme) associated with documents of a given territory.

A procedure is a formal administrative step in the lifecycle of an urban planning document — from its initial creation (Élaboration) through revisions, modifications, and updates. Each procedure is tied to a specific document and territory.

Use this tool to:
  - Find the latest modification procedure for a PLU or PLUi
  - List all approved procedures for a municipality to understand its planning history
  - Track the type and date of urban planning changes in a territory

Args:
  - gridName (string, required): Territory code (e.g., "69123" for a commune, "200046977" for an EPCI). Use infoplu_search_grids to find the right code.
  - documentType (string, optional): Filter by document type: "PLU", "PLUi", "CC", "POS", "PSMV", "SCoT"
  - procedureType (string, optional): Filter by procedure type:
    - "E" = Élaboration (initial creation of the document)
    - "R" = Révision (full revision)
    - "RA" = Révision allégée (simplified revision)
    - "M" = Modification
    - "MS" = Modification simplifiée
    - "MEC" = Mise en compatibilité
    - "MAJ" = Mise à jour (administrative update)
  - approbedAfter (string, optional): Only procedures approved after this date, format "YYYYMMDD"
  - page (number, optional): Page number starting at 1 (default: 1)
  - limit (number, optional): Results per page (default: 20, max: 100)
  - response_format (string, optional): "markdown" (default) or "json"

Returns:
  Array of procedure objects with:
  - id: unique identifier
  - name: procedure name (e.g., "69123_PLU_M_20221001")
  - documentType: associated document type
  - documentName: associated document name
  - procedureType: type code (E / R / RA / M / MS / MEC / MAJ)
  - approbationDate: approval date (YYYY-MM-DD format)
  - grid: { name, title, type } of the territory
  - files: attached procedure files

Error handling:
  - Returns "Error: Resource not found" if gridName does not exist — use infoplu_search_grids first
  - Returns an informative message if no procedures match the filters`,
      inputSchema: z.object({
        gridName: z
          .string()
          .min(1)
          .describe(
            'Territory code (e.g., "69123" for a commune, "200046977" for Métropole de Lyon EPCI). Use infoplu_search_grids to find it.'
          ),
        documentType: z
          .enum(["PLU", "POS", "CC", "PLUi", "PSMV", "SCoT"])
          .optional()
          .describe('Filter by document type: "PLU", "PLUi", "CC", "POS", "PSMV", "SCoT"'),
        procedureType: z
          .enum(["E", "R", "RA", "M", "MS", "MEC", "MAJ"])
          .optional()
          .describe(
            '"E"=Élaboration, "R"=Révision, "RA"=Révision allégée, "M"=Modification, "MS"=Modification simplifiée, "MEC"=Mise en compatibilité, "MAJ"=Mise à jour'
          ),
        approbedAfter: z
          .string()
          .regex(/^\d{8}$/, 'Must be YYYYMMDD format, e.g., "20200101"')
          .optional()
          .describe('Only return procedures approved after this date, format "YYYYMMDD"'),
        page: z
          .number()
          .int()
          .min(1)
          .default(1)
          .describe("Page number starting at 1 (default: 1)"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .default(20)
          .describe("Results per page (default: 20, max: 100)"),
        response_format: z
          .enum(["markdown", "json"])
          .default("markdown")
          .describe('"markdown" (default) or "json"'),
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
        if (params.documentType) queryParams.documentType = params.documentType;
        if (params.procedureType) queryParams.procedureType = params.procedureType;
        if (params.approbedAfter) queryParams.approbedAfter = params.approbedAfter;

        const procedures = await apiGet<Procedure[]>(
          `/${params.gridName}/procedures`,
          queryParams
        );

        if (!procedures.length) {
          return {
            content: [
              {
                type: "text",
                text: `No procedures found for territory "${params.gridName}" with the given filters. Try removing the documentType or procedureType filter.`,
              },
            ],
          };
        }

        if (params.response_format === "json") {
          const out = JSON.stringify({ count: procedures.length, procedures }, null, 2);
          return { content: [{ type: "text", text: out.slice(0, CHARACTER_LIMIT) }] };
        }

        const lines: string[] = [
          `# Procedures for ${params.gridName} — ${procedures.length} result(s)`,
          "",
        ];
        for (const p of procedures) {
          lines.push(`## ${p.name}`);
          lines.push(`- **Document type**: ${p.documentType}`);
          lines.push(`- **Document**: ${p.documentName}`);
          lines.push(
            `- **Procedure type**: ${PROCEDURE_TYPE_LABELS[p.procedureType] ?? p.procedureType}`
          );
          if (p.approbationDate) lines.push(`- **Approved on**: ${p.approbationDate}`);
          if (p.grid) lines.push(`- **Territory**: ${p.grid.title} (${p.grid.name})`);
          if (p.files?.length) lines.push(`- **Files attached**: ${p.files.length}`);
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
}
