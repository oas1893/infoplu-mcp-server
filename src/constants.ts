export const API_BASE_URL =
  process.env.API_BASE_URL ?? "https://www.geoportail-urbanisme.gouv.fr/api";

export const CHARACTER_LIMIT = 25000;

export const REQUEST_TIMEOUT_MS = 30000;

export const PORT = parseInt(process.env.PORT ?? "3000", 10);

export const TRANSPORT = process.env.TRANSPORT ?? "stdio";
