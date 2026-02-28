import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiGet, handleApiError } from "../services/api-client.js";
import { CHARACTER_LIMIT } from "../constants.js";

// Strip geometry from a grid object returned by the API
function pruneGrid(raw: Record<string, unknown>): Record<string, unknown> {
  const { geometry, ...grid } = raw as Record<string, unknown> & { geometry?: unknown };
  void geometry;
  return grid;
}

function gridToMarkdown(g: Record<string, unknown>): string[] {
  const lines: string[] = [
    `- **Type**: ${g.type}`,
  ];
  if (g.rnu === true) lines.push(`- **RNU**: Yes — no approved urban planning document (national default rules apply)`);
  if (g.coastline === true) lines.push(`- **Coastal territory**: Yes`);
  if (g.approved !== undefined) lines.push(`- **Approved SCoT**: ${g.approved ? "Yes" : "No"}`);
  return lines;
}

export function registerGridTools(server: McpServer): void {
  // ─── Tool 1: infoplu_search_grids ────────────────────────────────────────────
  server.registerTool(
    "infoplu_search_grids",
    {
      title: "Search Administrative Territories",
      description: `Search for French administrative territories (communes, EPCIs, departments, regions, SCoT perimeters) in the Géoportail de l'Urbanisme.

The "grid name" returned by this tool is the territory code used throughout the platform — it serves as the key to look up documents (via partition), procedures, and administrative hierarchy.

Use this tool to:
  - Look up a municipality's grid name by its INSEE code or French name
  - Find which EPCIs or departments contain a commune
  - Identify territories subject to the national default regulation (RNU) — meaning no PLU/CC is in force
  - Check whether a SCoT territory has an approved document

Args:
  - name (string, optional): Territory code — INSEE code for communes (e.g., "69123" for Lyon 3e), department code (e.g., "69"), region code (e.g., "84"), SIREN for EPCI (e.g., "200046977"), or "scot_[SIREN]" for a SCoT
  - title (string, optional): Territory name in French, partial match (e.g., "Lyon", "Métropole de Lyon", "Rhône")
  - type (array, optional): Filter by territory type:
    - "municipality" — communes
    - "epci" — groupements de communes (EPCI)
    - "departement" — departments
    - "region" — regions
    - "scot" — Schéma de Cohérence Territoriale perimeters
    - "state" — national level
  - rnu (boolean, optional): true to find territories still governed by national default regulation (no PLU/CC in force)
  - approved (boolean, optional): true to find SCoT territories with an approved document
  - limit (number, optional): Max results (default: 20, max: 100)
  - offset (number, optional): Pagination offset (default: 0)
  - response_format (string, optional): "markdown" (default) or "json"

Returns:
  Array of territory objects with:
  - name: territory code (→ use in infoplu_search_documents, infoplu_search_procedures)
  - title: official French name
  - type: territory level
  - rnu: true if national default regulation applies
  - coastline: true if coastal territory
  - approved: true if SCoT has approved document

Error handling:
  - If no results, try the INSEE code format (5 digits, e.g., "69123") or search by title`,
      inputSchema: z.object({
        name: z
          .string()
          .optional()
          .describe(
            'Territory code: INSEE commune code (e.g., "69123"), dept code (e.g., "69"), region code (e.g., "84"), EPCI SIREN (e.g., "200046977"), or "scot_[SIREN]"'
          ),
        title: z
          .string()
          .optional()
          .describe('Partial name match in French (e.g., "Lyon", "Métropole de Lyon", "Rhône-Alpes")'),
        type: z
          .array(z.enum(["state", "region", "departement", "municipality", "epci", "scot"]))
          .optional()
          .describe(
            'Filter by territory type: "municipality" (commune), "epci" (intercommunal), "departement", "region", "scot", "state"'
          ),
        rnu: z
          .boolean()
          .optional()
          .describe(
            "true = only territories under national default regulation (no PLU/CC in force)"
          ),
        approved: z
          .boolean()
          .optional()
          .describe("true = only SCoT territories with an approved document"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .default(20)
          .describe("Max results (default: 20, max: 100)"),
        offset: z
          .number()
          .int()
          .min(0)
          .default(0)
          .describe("Pagination offset (default: 0)"),
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
          _limit: params.limit,
          _offset: params.offset,
          _fields: ["name", "title", "type", "rnu", "approved", "coastline"],
        };
        if (params.name) queryParams.name = params.name;
        if (params.title) queryParams.title = params.title;
        if (params.type?.length) queryParams.type = params.type;
        if (params.rnu !== undefined) queryParams.rnu = params.rnu;
        if (params.approved !== undefined) queryParams.approved = params.approved;

        const grids = await apiGet<Record<string, unknown>[]>("/grid/", queryParams);
        const pruned = grids.map(pruneGrid);

        if (!pruned.length) {
          return {
            content: [
              {
                type: "text",
                text: 'No territories found. Try using the INSEE code (e.g., "69123" for Lyon 3e), or search by title (e.g., "Lyon").',
              },
            ],
          };
        }

        if (params.response_format === "json") {
          const out = JSON.stringify({ count: pruned.length, grids: pruned }, null, 2);
          return { content: [{ type: "text", text: out.slice(0, CHARACTER_LIMIT) }] };
        }

        const lines: string[] = [`# Administrative Territories — ${pruned.length} result(s)`, ""];
        for (const g of pruned) {
          lines.push(`## ${g.title} (${g.name})`);
          lines.push(...gridToMarkdown(g));
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

  // ─── Tool 2: infoplu_get_grid ─────────────────────────────────────────────────
  server.registerTool(
    "infoplu_get_grid",
    {
      title: "Get Territory Details",
      description: `Get details of a specific administrative territory by its grid name (territory code).

Use this when you already have a territory code (from infoplu_search_grids or from a document's grid field) and want to confirm its name, type, and RNU status.

Args:
  - gridName (string, required): Territory code — INSEE code (e.g., "69123"), department code (e.g., "69"), region code (e.g., "84"), EPCI SIREN
  - response_format (string, optional): "markdown" (default) or "json"

Returns:
  Territory object with name, title, type, rnu, coastline, approved.

Error handling:
  - Returns "Error: Resource not found" for invalid territory codes
  - Use infoplu_search_grids to discover valid codes`,
      inputSchema: z.object({
        gridName: z
          .string()
          .min(1)
          .describe(
            'Territory code: INSEE commune (e.g., "69123"), department (e.g., "69"), region (e.g., "84"), EPCI SIREN (e.g., "200046977")'
          ),
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
        const raw = await apiGet<Record<string, unknown>>(`/grid/${params.gridName}`, {
          _fields: ["name", "title", "type", "rnu", "approved", "coastline"],
        });
        const g = pruneGrid(raw);

        if (params.response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(g, null, 2) }] };
        }

        const lines = [
          `# ${g.title} (${g.name})`,
          "",
          ...gridToMarkdown(g),
        ];
        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (error) {
        return { content: [{ type: "text", text: handleApiError(error) }] };
      }
    }
  );

  // ─── Tool 3: infoplu_get_grid_parents ────────────────────────────────────────
  server.registerTool(
    "infoplu_get_grid_parents",
    {
      title: "Get Parent Territories",
      description: `Get the parent administrative territories of a given territory, traversing upwards in the French administrative hierarchy.

For a commune (municipality), parents typically include its EPCI, its department, its region, and the state. Useful for understanding which higher-level planning documents (SCoT, departmental/regional plans) govern a territory.

Args:
  - gridName (string, required): Territory code of the child territory (e.g., "69123" for a commune)
  - response_format (string, optional): "markdown" (default) or "json"

Returns:
  Array of parent territory objects, each with name, title, type, rnu, approved.

Error handling:
  - Returns "Error: Resource not found" for invalid gridName
  - Returns an informative message if no parents exist (top-level territory)`,
      inputSchema: z.object({
        gridName: z
          .string()
          .min(1)
          .describe('Territory code to find parents for (e.g., "69123" for Lyon 3e commune)'),
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
        const raw = await apiGet<Record<string, unknown>[]>(
          `/grid/${params.gridName}/parents`
        );
        const pruned = raw.map(pruneGrid);

        if (!pruned.length) {
          return {
            content: [
              {
                type: "text",
                text: `No parent territories found for "${params.gridName}". This territory may be at the top of the administrative hierarchy.`,
              },
            ],
          };
        }

        if (params.response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(pruned, null, 2) }] };
        }

        const lines = [`# Parent Territories of ${params.gridName}`, ""];
        for (const g of pruned) {
          lines.push(`- **${g.title}** (\`${g.name}\`) — ${g.type}${g.rnu ? " | RNU" : ""}`);
        }
        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (error) {
        return { content: [{ type: "text", text: handleApiError(error) }] };
      }
    }
  );

  // ─── Tool 4: infoplu_get_grid_children ───────────────────────────────────────
  server.registerTool(
    "infoplu_get_grid_children",
    {
      title: "Get Child Territories",
      description: `Get the child administrative territories of a given territory.

For a department, children are its communes and EPCIs. For an EPCI, children are its member communes. Useful for enumerating all territories within a larger administrative area.

Args:
  - gridName (string, required): Territory code of the parent (e.g., "69" for Rhône department, "200046977" for Métropole de Lyon)
  - response_format (string, optional): "markdown" (default) or "json"

Returns:
  Array of child territory objects with name, title, type, rnu, approved.

Error handling:
  - Returns "Error: Resource not found" for invalid gridName
  - Returns an informative message if no children exist`,
      inputSchema: z.object({
        gridName: z
          .string()
          .min(1)
          .describe(
            'Territory code of the parent (e.g., "69" for Rhône dept, "200046977" for Métropole de Lyon)'
          ),
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
        const raw = await apiGet<Record<string, unknown>[]>(
          `/grid/${params.gridName}/children`
        );
        const pruned = raw.map(pruneGrid);

        if (!pruned.length) {
          return {
            content: [
              {
                type: "text",
                text: `No child territories found for "${params.gridName}".`,
              },
            ],
          };
        }

        if (params.response_format === "json") {
          const out = JSON.stringify({ count: pruned.length, children: pruned }, null, 2);
          return { content: [{ type: "text", text: out.slice(0, CHARACTER_LIMIT) }] };
        }

        const lines = [
          `# Child Territories of ${params.gridName} — ${pruned.length} result(s)`,
          "",
        ];
        for (const g of pruned) {
          const rnu = g.rnu ? " | ⚠ RNU" : "";
          lines.push(`- **${g.title}** (\`${g.name}\`) — ${g.type}${rnu}`);
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
