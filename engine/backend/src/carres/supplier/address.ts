// Carres only (not part of Houzs's code): where a supplier's pages are, as an address to show or to send.
//
// The supplier pages have an address of their own, supp.carresofficial.com (../supplier-site/worker.ts). Carres
// shows it in Settings › Supplier Access and builds every set-password link on it. SUPPLIER_PUBLIC_URL names it
// (wrangler.toml); while it is not set, the address is the engine site, where the pages were first served.
import { DEFAULT_ENGINE_PUBLIC_URL } from "../../services/email";

export type AddressEnv = { SUPPLIER_PUBLIC_URL?: string; ENGINE_PUBLIC_URL?: string; LOGISTICS_PUBLIC_URL?: string };

/** A 3PL company's address (owner, 20 Nov 2026: a 3PL's link must not say "supplier"); the same pages under
 *  /logistics, served by the same Worker (../supplier-site/worker.ts LOGISTICS_HOST). */
export const DEFAULT_LOGISTICS_PUBLIC_URL = "https://3pl.carresofficial.com";

/** `path` (written as on the supplier pages, e.g. "/supplier/setup") at a 3PL's address: "/logistics/setup". */
export function logisticsPublicUrl(env: AddressEnv, path: string): string {
  const base = (env.LOGISTICS_PUBLIC_URL || DEFAULT_LOGISTICS_PUBLIC_URL).replace(/\/+$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${base}${p.replace(/^\/supplier(?=\/|$)/, "/logistics")}`;
}

/** Where a person's pages are: a 3PL's people at the 3PL address, everyone else at the supplier address. */
export const pagesUrl = (env: AddressEnv, logistics: boolean, path: string): string =>
  (logistics ? logisticsPublicUrl(env, path) : supplierPublicUrl(env, path));

/** `path` on the supplier pages' address, e.g. "/supplier" or "/supplier/setup". */
export function supplierPublicUrl(env: AddressEnv, path: string): string {
  const base = (env.SUPPLIER_PUBLIC_URL || env.ENGINE_PUBLIC_URL || DEFAULT_ENGINE_PUBLIC_URL).replace(/\/+$/, "");
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}
