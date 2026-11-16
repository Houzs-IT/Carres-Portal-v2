// Pages middleware — attaches a REPORT-ONLY Content-Security-Policy to HTML
// document responses across the whole SPA (every route, including deep links),
// without touching the merge-fragile public/_headers file.
//
// Why report-only (audit H6): browsers only REPORT violations to the console,
// they NEVER block, so this cannot break the app. It is the defense-in-depth
// layer under the stored-XSS fixes — even if an XSS ever lands, a tight
// script-src is what stops the session token in localStorage being exfiltrated.
//
// How to graduate it (owner / dev, over ~a week):
//   1. Deploy this and confirm the header appears:
//        curl -sI https://erp.houzscentury.com/ | grep -i content-security-policy
//      (It only decorates text/html responses; assets are untouched.)
//   2. Use the site normally and watch the browser console for
//      "Content-Security-Policy-Report-Only" violation lines.
//   3. Widen the directives below for anything legitimate that reports (a real
//      third-party the app loads), then rename the header from
//      `Content-Security-Policy-Report-Only` to `Content-Security-Policy` to
//      ENFORCE. Only then does it start blocking.
//
// Self-contained types, matching the sibling [[path]].ts — no need to pull
// @cloudflare/workers-types into the frontend devDependencies for one file.

interface PagesContext {
  request: Request;
  next: () => Promise<Response>;
}

// Starting policy: tight where it matters (script-src 'self' — no inline/eval),
// realistic where the app needs it (style-src 'unsafe-inline' for React/CSS-in-JS
// runtime styles; img data:/blob: for previews/canvas). connect-src lists the
// same-origin API plus the legacy workers.dev host still referenced in the bundle.
// Tighten these as the report-only run reveals what is actually loaded.
const CSP_REPORT_ONLY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self' https://carres-scm-engine.wwch.workers.dev",
  // Carres: the engine is shown inside the Carres portal, so the portal may frame it.
  "frame-ancestors 'self' https://erp.carresofficial.com https://carres-portal.pages.dev https://*.carres-portal.pages.dev",
  "base-uri 'self'",
  "object-src 'none'",
  "form-action 'self'",
].join("; ");

// Carres: the supplier pages (/supplier, src/carres/supplier/) are never shown inside another page. The portal
// frames the staff pages only. So this one rule is ENFORCED for them, not report-only: no site, the portal
// included, may put a supplier page in a frame and draw over it to take a click or a typed password. It names
// frames and nothing else, so it cannot block anything the pages load.
export const isSupplierPage = (url: string): boolean => /^\/supplier(\/|$)/.test(new URL(url).pathname);

// Carres: the supplier pages have an address of their own since 16 Nov 2026, supp.carresofficial.com
// (engine/backend/src/carres/supplier-site/worker.ts), where the staff sign-in and the staff API do not exist. A
// visitor who opens a supplier page at THIS site's production address is sent on, with the same path. The secret
// of a one-time link sits after the `#`, which the browser carries over by itself.
//   * The exact production host only. A preview of this site and a local run keep showing /supplier, so the pages
//     can still be looked at before a deploy.
//   * Only a page being read. That address fetches this site's one page at "/" and its files by their own paths
//     (never a supplier path), so it is never sent round in a circle.
export const OLD_SUPPLIER_HOST = "carres-scm.pages.dev";
export const SUPPLIER_ORIGIN = "https://supp.carresofficial.com";

export function supplierMoveTo(request: Request): string | null {
  if (request.method !== "GET" && request.method !== "HEAD") return null;
  const url = new URL(request.url);
  if (url.hostname.toLowerCase() !== OLD_SUPPLIER_HOST || !isSupplierPage(request.url)) return null;
  return `${SUPPLIER_ORIGIN}${url.pathname}${url.search}`;
}

export const onRequest = async ({ request, next }: PagesContext): Promise<Response> => {
  const moved = supplierMoveTo(request);
  if (moved) return new Response(null, { status: 302, headers: { Location: moved, "Cache-Control": "no-store" } });
  const response = await next();
  const contentType = response.headers.get("Content-Type") || "";
  // Only decorate HTML documents — the CSP that matters governs the page, and
  // touching asset responses would be pointless noise.
  if (!contentType.includes("text/html")) return response;
  const headers = new Headers(response.headers);
  headers.set("Content-Security-Policy-Report-Only", CSP_REPORT_ONLY);
  if (isSupplierPage(request.url)) {
    headers.set("Content-Security-Policy", "frame-ancestors 'none'");
    headers.set("X-Frame-Options", "DENY");
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};
