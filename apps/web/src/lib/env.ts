import { resolveApiBase } from "./config";

const api = resolveApiBase(import.meta.env.VITE_API_URL);
if (api.warning && import.meta.env.DEV) console.warn(`[elyia] ${api.warning}`);

/** Origin of the Elyia API (VITE_API_URL, default http://localhost:3001). */
export const API_BASE = api.base;
