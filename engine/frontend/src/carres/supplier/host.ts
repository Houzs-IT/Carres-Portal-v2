// Carres only (not part of Houzs's code): the supplier's own web address.
//
// supp.carresofficial.com is a small Worker in front of the supplier pages and the supplier API
// (engine/backend/src/carres/supplier-site/worker.ts). It sends every page that is not under /supplier to
// /supplier, and it does not serve the staff API. This is the same rule on the screen side: at that address this
// app is the supplier pages and nothing else, so the staff sign-in is never drawn there, whatever path a click or a
// typed address reaches without loading a new document.
export const SUPPLIER_HOSTS: readonly string[] = ["supp.carresofficial.com"];

export const isSupplierHost = (hostname: string | null | undefined): boolean =>
  !!hostname && SUPPLIER_HOSTS.includes(hostname.toLowerCase());

/** The address this page was opened at, or "" where there is no window (a test that renders nothing). */
export const currentHostname = (): string => {
  try { return window.location.hostname; } catch { return ""; }
};
