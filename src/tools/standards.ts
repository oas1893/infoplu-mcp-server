import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiGet, handleApiError } from "../services/api-client.js";
import type {
  DocumentModel,
  DocumentModelSummary,
  SupCategorie,
  DuCategorie,
} from "../types.js";

export function registerStandardTools(server: McpServer): void {
  // ─── Tool 1: infoplu_list_document_models ────────────────────────────────────
  server.registerTool(
    "infoplu_list_document_models",
    {
      title: "List Document Models (CNIG Standards)",
      description: `List the CNIG national standards (modèles de documents) that define the data structure for each type of urban planning document.

Document models specify which feature types and attributes are present in a given type and version of urban planning document (e.g., PLU 2017, PLUi 2019, SUP 2016). They are versioned by year.

Use this tool to:
  - Discover which standards exist for a document type before using infoplu_get_document_model
  - Find the correct model name format (e.g., "cnig_PLU_2017") to pass to other tools

Args:
  - type (string, optional): Filter by document type: "PLU", "PLUi", "CC", "POS", "SCoT", "SUP", "PSMV"
  - abstract (boolean, optional): true = abstract/generic base models only; false = concrete versioned models only
  - response_format (string, optional): "markdown" (default) or "json"

Returns:
  Array of document model summaries with:
  - name: model name (e.g., "cnig_PLU_2017") → use with infoplu_get_document_model
  - title: human-readable title
  - description: brief description
  - abstract: whether this is an abstract base model
  - type: document type this model covers
  - parent: parent model name (for versioned models)`,
      inputSchema: z.object({
        type: z
          .enum(["PLU", "POS", "CC", "PLUi", "SCoT", "SUP", "PSMV"])
          .optional()
          .describe('Filter by document type: "PLU", "PLUi", "CC", "POS", "SCoT", "SUP", "PSMV"'),
        abstract: z
          .boolean()
          .optional()
          .describe(
            "true = abstract/generic base models only; false = concrete versioned models only"
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
        const queryParams: Record<string, unknown> = {};
        if (params.type) queryParams.type = params.type;
        if (params.abstract !== undefined) queryParams.abstract = params.abstract;

        const models = await apiGet<DocumentModelSummary[]>("/standard", queryParams);

        if (params.response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(models, null, 2) }] };
        }

        const lines: string[] = [
          `# CNIG Document Models — ${models.length} result(s)`,
          "",
        ];
        for (const m of models) {
          lines.push(`## \`${m.name}\``);
          lines.push(`- **Title**: ${m.title}`);
          lines.push(`- **Type**: ${m.type}`);
          lines.push(`- **Abstract**: ${m.abstract ? "Yes (generic base)" : "No (versioned)"}`);
          if (m.parent) lines.push(`- **Parent**: ${m.parent}`);
          if (m.description) lines.push(`- **Description**: ${m.description}`);
          lines.push("");
        }

        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (error) {
        return { content: [{ type: "text", text: handleApiError(error) }] };
      }
    }
  );

  // ─── Tool 2: infoplu_get_document_model ──────────────────────────────────────
  server.registerTool(
    "infoplu_get_document_model",
    {
      title: "Get Document Model Details",
      description: `Get the full structure of a specific CNIG document model, including all feature types and their attributes.

Use this tool to understand the data schema of a specific document model — for example, what attributes are present in the "zone_urba" feature type of the PLU 2017 standard, or what fields SUP 2016 exposes.

This is useful for interpreting the properties returned by infoplu_get_du_at_location or infoplu_get_sup_at_location.

Args:
  - documentModel (string, required): Model name in format "cnig_[TYPE]_[YEAR]" (e.g., "cnig_PLU_2017", "cnig_SUP_2016", "cnig_PLUi_2019"). Use infoplu_list_document_models to find valid names.
  - response_format (string, optional): "markdown" (default) or "json"

Returns:
  Document model with:
  - name, title, description, abstract, type, parent
  - featureTypes: array of feature types, each containing:
    - name: feature type name (table name, e.g., "zone_urba")
    - title: human-readable label
    - description: description of what this feature type represents
    - attributes: array of { name, title, type, description } for each field

Error handling:
  - Returns "Error: Resource not found" if the model name is invalid
  - Use infoplu_list_document_models to discover valid model names like "cnig_PLU_2017"`,
      inputSchema: z.object({
        documentModel: z
          .string()
          .regex(
            /^cnig_\w+_\d{4}$/,
            'Format must be "cnig_[TYPE]_[YEAR]", e.g., "cnig_PLU_2017", "cnig_SUP_2016"'
          )
          .describe(
            'Model name, e.g., "cnig_PLU_2017", "cnig_PLUi_2019", "cnig_SUP_2016", "cnig_SCoT_2018"'
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
        const model = await apiGet<DocumentModel>(`/standard/${params.documentModel}`);

        if (params.response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(model, null, 2) }] };
        }

        const lines: string[] = [
          `# ${model.name} — ${model.title}`,
          "",
          `- **Type**: ${model.type}`,
          `- **Abstract**: ${model.abstract ? "Yes" : "No"}`,
        ];
        if (model.parent) lines.push(`- **Parent model**: ${model.parent}`);
        if (model.description) lines.push(``, model.description);
        lines.push("", `## Feature Types (${model.featureTypes?.length ?? 0})`);

        for (const ft of model.featureTypes ?? []) {
          lines.push("", `### \`${ft.name}\` — ${ft.title}`);
          if (ft.description) lines.push(`_${ft.description}_`);
          if (ft.attributes?.length) {
            lines.push("", "| Attribute | Type | Description |");
            lines.push("|-----------|------|-------------|");
            for (const attr of ft.attributes) {
              lines.push(
                `| \`${attr.name}\` | ${attr.type} | ${attr.description ?? attr.title} |`
              );
            }
          }
        }

        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (error) {
        return { content: [{ type: "text", text: handleApiError(error) }] };
      }
    }
  );

  // ─── Tool 3: infoplu_list_sup_categories ─────────────────────────────────────
  server.registerTool(
    "infoplu_list_sup_categories",
    {
      title: "List SUP Categories",
      description: `List all categories of Servitudes d'Utilité Publique (SUP) — public utility easements that restrict land use.

SUP categories use alphanumeric codes (e.g., "AC1" for heritage protection, "EL3" for public road reserve, "PM1" for flood risk) grouped by domain. Use this to:
  - Decode a SUP category code returned by infoplu_get_sup_at_location
  - Find which SUP categories exist before filtering documents by supCategory in infoplu_search_documents
  - Understand whether a category has downloadable documents

Returns:
  Array of SUP category objects with:
  - name: category code (e.g., "AC1", "EL3", "PM1", "I4")
  - libelle: full French label
  - libelleCourt: abbreviated label
  - downloadable: true if documents for this category are available to download
  - urlFiche: URL of the reference information sheet (if available)`,
      inputSchema: z.object({
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
        const categories = await apiGet<SupCategorie[]>("/standard/sup-categories");

        if (params.response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(categories, null, 2) }] };
        }

        const lines: string[] = [`# SUP Categories — ${categories.length} total`, ""];
        for (const c of categories) {
          const dl = c.downloadable ? " `[downloadable]`" : "";
          lines.push(`- **${c.name}** — ${c.libelle} *(${c.libelleCourt})*${dl}`);
        }

        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (error) {
        return { content: [{ type: "text", text: handleApiError(error) }] };
      }
    }
  );

  // ─── Tool 4: infoplu_list_du_categories ──────────────────────────────────────
  server.registerTool(
    "infoplu_list_du_categories",
    {
      title: "List DU Zone Categories",
      description: `List the land-use zone category codes used in Documents d'Urbanisme (PLU, POS, CC).

Zone categories classify land in French urban planning documents:
  - Zone U (Urbaine): already built-up land authorised for construction
  - Zone AU (À Urbaniser): undeveloped land designated for future urbanisation
  - Zone N (Naturelle): protected natural land
  - Zone A (Agricole): agricultural land

Each category has sub-codes and applies to specific document types (PLU, POS, CC). Use this tool to decode zone codes returned by infoplu_get_du_at_location.

Returns:
  Array of zone category objects with:
  - type: document type this category applies to (PLU, POS, CC, etc.)
  - code: main zone code (e.g., "U", "AU", "N", "A")
  - sous_code: sub-category code (if applicable)
  - libelong: full French description of the zone category`,
      inputSchema: z.object({
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
        const categories = await apiGet<DuCategorie[]>("/standard/du-categories");

        if (params.response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(categories, null, 2) }] };
        }

        // Group by document type for readability
        const byType: Record<string, DuCategorie[]> = {};
        for (const c of categories) {
          if (!byType[c.type]) byType[c.type] = [];
          byType[c.type].push(c);
        }

        const lines: string[] = [
          `# DU Zone Categories — ${categories.length} total`,
          "",
        ];
        for (const [type, cats] of Object.entries(byType)) {
          lines.push(`## ${type}`);
          for (const c of cats) {
            const code = c.sous_code ? `${c.code}/${c.sous_code}` : c.code;
            lines.push(`- **${code}**: ${c.libelong}`);
          }
          lines.push("");
        }

        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (error) {
        return { content: [{ type: "text", text: handleApiError(error) }] };
      }
    }
  );
}
