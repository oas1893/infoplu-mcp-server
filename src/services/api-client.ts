import axios, { AxiosError } from "axios";
import { API_BASE_URL, REQUEST_TIMEOUT_MS } from "../constants.js";

/**
 * Serializes query params to a query string, using bracket notation for arrays.
 * Arrays become: key[]=val1&key[]=val2  (as expected by useBrackets: true APIs)
 */
function serializeParams(params: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [key, val] of Object.entries(params)) {
    if (val === undefined || val === null) continue;
    if (Array.isArray(val)) {
      for (const item of val) {
        parts.push(`${encodeURIComponent(key)}[]=${encodeURIComponent(String(item))}`);
      }
    } else {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(val))}`);
    }
  }
  return parts.join("&");
}

const client = axios.create({
  baseURL: API_BASE_URL,
  timeout: REQUEST_TIMEOUT_MS,
  headers: { Accept: "application/json" },
  paramsSerializer: serializeParams,
});

export async function apiGet<T>(
  path: string,
  params?: Record<string, unknown>
): Promise<T> {
  const response = await client.get<T>(path, { params });
  return response.data;
}

export function handleApiError(error: unknown): string {
  if (error instanceof AxiosError) {
    if (error.response) {
      const status = error.response.status;
      const msg =
        (error.response.data as { message?: string } | undefined)?.message ??
        error.response.statusText ??
        "";
      switch (status) {
        case 400:
          return `Error: Invalid request parameters — ${msg}. Check your input values and try again.`;
        case 404:
          return `Error: Resource not found. The requested document or territory does not exist. Use a search tool to find valid IDs.`;
        case 429:
          return `Error: Rate limit exceeded. Please wait a moment before making more requests.`;
        case 500:
        case 502:
        case 503:
          return `Error: The Géoportail de l'Urbanisme API is temporarily unavailable (status ${status}). Try again later.`;
        default:
          return `Error: API request failed with status ${status}. ${msg}`;
      }
    }
    if (error.code === "ECONNABORTED") {
      return "Error: Request timed out. The API is slow to respond — try again.";
    }
    if (error.code === "ECONNREFUSED" || error.code === "ENOTFOUND") {
      return "Error: Cannot reach the Géoportail de l'Urbanisme API. Check your network connection or the API_BASE_URL environment variable.";
    }
  }
  return `Error: ${error instanceof Error ? error.message : String(error)}`;
}
