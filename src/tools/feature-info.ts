import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiGet, handleApiError } from "../services/api-client.js";
import { CHARACTER_LIMIT } from "../constants.js";
import type { PrunedFeature, PrunedFeatureCollection } from "../types.js";

/**
 * Strip geometry from every feature in a GeoJSON FeatureCollection.
 * Only the properties (and optional id) of each feature are kept.
 */
function pruneFeatureCollection(raw: Record<string, unknown>): PrunedFeatureCollection {
  const rawFeatures = Array.isArray(raw.features)
    ? (raw.features as Record<string, unknown>[])
    : [];

  const features: PrunedFeature[] = rawFeatures.map((f) => ({
    ...(f.id !== undefined ? { id: String(f.id) } : {}),
    type: "Feature" as const,
    properties: (f.properties as Record<string, unknown>) ?? {},
  }));

  return {
    type: "FeatureCollection",
    totalFeatures: features.length,
    features,
  };
}

function formatCollectionMarkdown(
  collection: PrunedFeatureCollection,
  title: string
): string {
  const lines: string[] = [`# ${title}`, ""];

  if (!collection.features.length) {
    lines.push("No features found at this location.");
    return lines.join("\n");
  }

  lines.push(`${collection.totalFeatures} feature(s) found:`, "");

  for (const [i, f] of collection.features.entries()) {
    const header = f.id ? `Feature ${i + 1} (id: ${f.id})` : `Feature ${i + 1}`;
    lines.push(`## ${header}`);

    const props = f.properties;
    for (const [key, val] of Object.entries(props)) {
      if (val !== null && val !== undefined && val !== "") {
        const display =
          typeof val === "object" ? JSON.stringify(val) : String(val);
        lines.push(`- **${key}**: ${display}`);
      }
    }
    lines.push("");
  }

  return lines.join("\n");
}

export function registerFeatureInfoTools(server: McpServer): void {
  // ─── Tool 1: infoplu_get_du_at_location ──────────────────────────────────────
  server.registerTool(
    "infoplu_get_du_at_location",
    {
      title: "Get Urban Planning Features at Location",
      description: `Retrieve urban planning (DU) features at a specific geographic point (longitude/latitude), including the applicable zoning, prescriptions, and informational overlays from the governing PLU/PLUi/CC/POS document.

This is the core lookup tool for "what planning rules apply at this address or location?" It returns which zones, prescriptions, and secteurs from the applicable urban planning document govern a specific coordinate.

Geometry is stripped from all results — only textual properties and codes are returned.

Args:
  - lon (number, required): Longitude in decimal degrees, WGS84 (e.g., 2.3488 for Paris, 4.8357 for Lyon)
  - lat (number, required): Latitude in decimal degrees, WGS84 (e.g., 48.8534 for Paris, 45.7485 for Lyon)
  - typeName (string, optional): Narrow results to a specific feature type:
    - "zone_urba" — the urban planning zone at this point (e.g., UA, UB, AU1, N, A) ← most common
    - "document" — the governing urban planning document
    - "prescription_surf" — surface-area prescriptions (polygon)
    - "prescription_lin" — linear prescriptions (road setbacks, etc.)
    - "prescription_pct" — point prescriptions
    - "info_surf" — informational surface areas (non-regulatory)
    - "info_lin" — informational linear features
    - "info_pct" — informational point features
    - "secteur_cc" — secteurs in a Carte Communale
    - "municipality" — the municipality territory
  - partition (string, optional): Restrict results to a specific document partition
  - response_format (string, optional): "markdown" (default) or "json"

Returns:
  All urban planning features at the location (geometry stripped), with properties such as:
  - For zones (zone_urba): libelle (zone code), libelong (full description), typezone, destimpu, partition
  - For prescriptions: libelle, txt (regulation text), typeref
  - For documents: name, type, legalStatus

Examples:
  - "What zone is 48 rue de Rivoli, Paris?" → lon=2.3488, lat=48.8534, typeName="zone_urba"
  - "What prescriptions apply at this location?" → lon/lat, typeName="prescription_surf"

Error handling:
  - Returns empty result if no planning features exist at this point
  - Coordinates must be within France (metropolitan or overseas territories)`,
      inputSchema: z.object({
        lon: z
          .number()
          .min(-180)
          .max(180)
          .describe("Longitude in decimal degrees, WGS84 (e.g., 2.3488 for central Paris, 4.8357 for Lyon)"),
        lat: z
          .number()
          .min(-90)
          .max(90)
          .describe("Latitude in decimal degrees, WGS84 (e.g., 48.8534 for central Paris, 45.7485 for Lyon)"),
        typeName: z
          .enum([
            "document",
            "municipality",
            "info_lin",
            "info_pct",
            "info_surf",
            "prescription_lin",
            "prescription_pct",
            "prescription_surf",
            "secteur_cc",
            "zone_urba",
          ])
          .optional()
          .describe(
            '"zone_urba" to get the planning zone (most useful), "prescription_surf/lin/pct" for prescriptions, "document" for the governing document, "secteur_cc" for CC sectors, "info_surf/lin/pct" for informational layers'
          ),
        partition: z
          .string()
          .optional()
          .describe("Restrict results to a specific document partition"),
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
          lon: params.lon,
          lat: params.lat,
        };
        if (params.typeName) queryParams.typeName = params.typeName;
        if (params.partition) queryParams.partition = params.partition;

        const raw = await apiGet<Record<string, unknown>>("/feature-info/du", queryParams);
        const collection = pruneFeatureCollection(raw);

        if (params.response_format === "json") {
          const out = JSON.stringify(collection, null, 2);
          return { content: [{ type: "text", text: out.slice(0, CHARACTER_LIMIT) }] };
        }

        const title = `DU Features at (lon=${params.lon}, lat=${params.lat})${params.typeName ? ` — type: ${params.typeName}` : ""}`;
        const text = formatCollectionMarkdown(collection, title);
        return { content: [{ type: "text", text: text.slice(0, CHARACTER_LIMIT) }] };
      } catch (error) {
        return { content: [{ type: "text", text: handleApiError(error) }] };
      }
    }
  );

  // ─── Tool 2: infoplu_get_sup_at_location ─────────────────────────────────────
  server.registerTool(
    "infoplu_get_sup_at_location",
    {
      title: "Get SUP Servitudes at Location",
      description: `Retrieve SUP (Servitudes d'Utilité Publique — public utility easements) features at a specific geographic point.

SUP are legal constraints on land use imposed by public utility needs that overlay the zoning document (PLU). They include:
  - Heritage protection zones (AC1, AC2)
  - Flood and natural risk zones (PM1, PM3)
  - Power line and utility corridors (I4, I3)
  - Transport infrastructure reserves (EL, T)
  - Airport noise zones (PT)
  - Coastal protection (EL11)

Use this alongside infoplu_get_du_at_location for a complete picture of planning constraints at a location.
Geometry is stripped — only descriptive properties are returned.

Args:
  - lon (number, required): Longitude in decimal degrees, WGS84
  - lat (number, required): Latitude in decimal degrees, WGS84
  - typeName (string, optional): Filter by servitude geometry type:
    - "assiette_sup_s" — surface/area servitudes (most common for parcels)
    - "assiette_sup_l" — linear servitudes (corridors, roads, pipelines)
    - "assiette_sup_p" — point servitudes
  - partition (string, optional): Restrict to a specific SUP document partition
  - response_format (string, optional): "markdown" (default) or "json"

Returns:
  Features with SUP properties including the servitude category code, description, and legal reference.`,
      inputSchema: z.object({
        lon: z
          .number()
          .min(-180)
          .max(180)
          .describe("Longitude in decimal degrees, WGS84"),
        lat: z
          .number()
          .min(-90)
          .max(90)
          .describe("Latitude in decimal degrees, WGS84"),
        typeName: z
          .enum(["assiette_sup_p", "assiette_sup_l", "assiette_sup_s"])
          .optional()
          .describe(
            '"assiette_sup_s" for surface servitudes (most common), "assiette_sup_l" for linear, "assiette_sup_p" for point servitudes'
          ),
        partition: z
          .string()
          .optional()
          .describe("Restrict to a specific SUP document partition"),
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
          lon: params.lon,
          lat: params.lat,
        };
        if (params.typeName) queryParams.typeName = params.typeName;
        if (params.partition) queryParams.partition = params.partition;

        const raw = await apiGet<Record<string, unknown>>("/feature-info/sup", queryParams);
        const collection = pruneFeatureCollection(raw);

        if (params.response_format === "json") {
          const out = JSON.stringify(collection, null, 2);
          return { content: [{ type: "text", text: out.slice(0, CHARACTER_LIMIT) }] };
        }

        const title = `SUP Servitudes at (lon=${params.lon}, lat=${params.lat})`;
        const text = formatCollectionMarkdown(collection, title);
        return { content: [{ type: "text", text: text.slice(0, CHARACTER_LIMIT) }] };
      } catch (error) {
        return { content: [{ type: "text", text: handleApiError(error) }] };
      }
    }
  );

  // ─── Tool 3: infoplu_get_scot_at_location ────────────────────────────────────
  server.registerTool(
    "infoplu_get_scot_at_location",
    {
      title: "Get SCoT at Location",
      description: `Retrieve the SCoT (Schéma de Cohérence Territoriale — Territorial Coherence Scheme) covering a specific geographic point.

A SCoT is a strategic inter-municipal planning document that provides the overarching planning framework within which local PLUs and CCs must be compatible. Use this tool to identify which SCoT governs a location, and then use infoplu_search_documents with documentFamily=["SCoT"] to find the associated document.

Geometry is stripped — only descriptive properties are returned.

Args:
  - lon (number, required): Longitude in decimal degrees, WGS84
  - lat (number, required): Latitude in decimal degrees, WGS84
  - partition (string, optional): Restrict to a specific SCoT partition
  - response_format (string, optional): "markdown" (default) or "json"

Returns:
  SCoT feature properties (geometry stripped), including the SCoT document reference and territory name.`,
      inputSchema: z.object({
        lon: z
          .number()
          .min(-180)
          .max(180)
          .describe("Longitude in decimal degrees, WGS84"),
        lat: z
          .number()
          .min(-90)
          .max(90)
          .describe("Latitude in decimal degrees, WGS84"),
        partition: z
          .string()
          .optional()
          .describe("Restrict to a specific SCoT partition"),
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
          lon: params.lon,
          lat: params.lat,
        };
        if (params.partition) queryParams.partition = params.partition;

        const raw = await apiGet<Record<string, unknown>>("/feature-info/scot", queryParams);
        const collection = pruneFeatureCollection(raw);

        if (params.response_format === "json") {
          const out = JSON.stringify(collection, null, 2);
          return { content: [{ type: "text", text: out.slice(0, CHARACTER_LIMIT) }] };
        }

        const title = `SCoT at (lon=${params.lon}, lat=${params.lat})`;
        const text = formatCollectionMarkdown(collection, title);
        return { content: [{ type: "text", text: text.slice(0, CHARACTER_LIMIT) }] };
      } catch (error) {
        return { content: [{ type: "text", text: handleApiError(error) }] };
      }
    }
  );

  // ─── Tool 4: infoplu_get_features_by_parcel ──────────────────────────────────
  server.registerTool(
    "infoplu_get_features_by_parcel",
    {
      title: "Get Urban Planning Features by Parcel ID",
      description: `Retrieve all urban planning features intersecting a specific cadastral parcel (parcelle cadastrale), identified by its parcel reference ID.

This is the most direct way to find what planning rules apply to a specific land parcel — it returns all overlapping features (zones, prescriptions, documents) from the urban planning database for the given parcel reference.

Geometry is stripped from all results — only textual properties are returned.

Args:
  - parcelId (string, required): Cadastral parcel identifier in the format used by the French cadastre.
    Format: [2-digit-dept]_[3-digit-commune]_[3-digit-prefix]_[2-char-section]_[4-digit-number]
    Example: "69_123_000_AB_0042" (department 69, commune 123, section AB, parcel 0042)
  - response_format (string, optional): "markdown" (default) or "json"

Returns:
  All urban planning features intersecting the parcel (geometry stripped), including zones, prescriptions, SUP servitudes, and the governing documents.

Error handling:
  - Returns "Error: Resource not found" for an invalid or non-existent parcel ID
  - Returns an empty result if the parcel has no overlapping planning features`,
      inputSchema: z.object({
        parcelId: z
          .string()
          .min(1)
          .describe(
            'Cadastral parcel ID, e.g., "69_123_000_AB_0042". Format: [dept]_[commune]_[prefix]_[section]_[number]'
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
        const raw = await apiGet<Record<string, unknown>>(
          `/feature-info/parcel/${params.parcelId}`
        );
        const collection = pruneFeatureCollection(raw);

        if (params.response_format === "json") {
          const out = JSON.stringify(collection, null, 2);
          return { content: [{ type: "text", text: out.slice(0, CHARACTER_LIMIT) }] };
        }

        const title = `Urban Planning Features for Parcel ${params.parcelId}`;
        const text = formatCollectionMarkdown(collection, title);
        return { content: [{ type: "text", text: text.slice(0, CHARACTER_LIMIT) }] };
      } catch (error) {
        return { content: [{ type: "text", text: handleApiError(error) }] };
      }
    }
  );
}
