// Carres only (not part of Houzs's code): the supplier's own web address.
//
// supp.carresofficial.com is a small Worker in front of the supplier pages and the supplier API
// (engine/backend/src/carres/supplier-site/worker.ts). It sends every page that is not under /supplier to
// /supplier, and it does not serve the staff API. This is the same rule on the screen side: at that address this
// app is the supplier pages and nothing else, so the staff sign-in is never drawn there, whatever path a click or a
// typed address reaches without loading a new document.
export const SUPPLIER_HOSTS: readonly string[] = ["supp.carresofficial.com"];
/** A 3PL company's address (owner, 20 Nov 2026: a 3PL's link must not say "supplier"). Same pages, under /logistics. */
export const LOGISTICS_HOSTS: readonly string[] = ["3pl.carresofficial.com"];

export const isLogisticsHost = (hostname: string | null | undefined): boolean =>
  !!hostname && LOGISTICS_HOSTS.includes(hostname.toLowerCase());

export const isSupplierHost = (hostname: string | null | undefined): boolean =>
  !!hostname && (SUPPLIER_HOSTS.includes(hostname.toLowerCase()) || isLogisticsHost(hostname));

/** The address this page was opened at, or "" where there is no window (a test that renders nothing). */
export const currentHostname = (): string => {
  try { return window.location.hostname; } catch { return ""; }
};

/** Where these pages live at the address this page was opened at: /logistics at a 3PL's address, else /supplier. */
export const BASE: string = isLogisticsHost(currentHostname()) ? "/logistics" : "/supplier";
