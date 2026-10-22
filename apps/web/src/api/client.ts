import { configureApi } from "@jtk/api-client";

/**
 * The broker API. Loopback by default; the WebUI is a local surface (no tailnet exposure
 * in this milestone), so there is no auth beyond the WebAuthn gate on decisions.
 */
export const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "http://127.0.0.1:8787";
export const EVENTS_URL = API_BASE.replace(/^http/, "ws") + "/events";

configureApi(API_BASE);
