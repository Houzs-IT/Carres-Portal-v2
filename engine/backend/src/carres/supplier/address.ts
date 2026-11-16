// Carres only (not part of Houzs's code): where a supplier's pages are, as an address to show or to send.
//
// The supplier pages have an address of their own, supp.carresofficial.com (../supplier-site/worker.ts). Carres
// shows it in Settings › Supplier Access and builds every set-password link on it. SUPPLIER_PUBLIC_URL names it
// (wrangler.toml); while it is not set, the address is the engine site, where the pages were first served.
import { DEFAULT_ENGINE_PUBLIC_URL } from "../../services/email";

export type AddressEnv = { SUPPLIER_PUBLIC_URL?: string; ENGINE_PUBLIC_URL?: string };

/** `path` on the supplier pages' address, e.g. "/supplier" or "/supplier/setup". */
export function supplierPublicUrl(env: AddressEnv, path: string): string {
  const base = (env.SUPPLIER_PUBLIC_URL || env.ENGINE_PUBLIC_URL || DEFAULT_ENGINE_PUBLIC_URL).replace(/\/+$/, "");
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}
