// Carres only (not part of Houzs's code): the supplier's own web address, supp.carresofficial.com.
//
// THE RULE IT KEEPS (owner, 15 Nov 2026): a supplier's login is never a way into Carres's system. Until 16 Nov 2026
// the supplier pages shared one address with the staff engine (carres-scm.pages.dev/supplier), so the staff
// sign-in page and the whole staff API answered at the address a supplier was given. This Worker is that address
// now (wrangler.supplier-site.toml), and it hands out the supplier side and NOTHING else of the engine:
//
//   /api/carres-supplier/*   the engine Worker, over a service binding: the supplier API, which checks its own
//                            session (../supplier/routes.ts)
//   /api/track/company       the engine Worker: the company's public name, which the sign-in page shows
//   any other /api/*         404. The staff API is not offered at this address at all
//   a file (/assets/…)       the engine site, as it is
//   a page under /supplier   the site's one page; the app draws the supplier pages for that path
//   any other page           sent to /supplier
//
// It also answers at a 3PL company's address, 3pl.carresofficial.com (LOGISTICS_HOST; owner, 20 Nov 2026): the same
// rules, with /logistics in place of /supplier, so a 3PL's link never says "supplier".
//
// It keeps no session, reads no database and holds no secret: what a supplier may read is still decided by the
// engine (the session, and the two functions of migration 2012). This is the address, and a second lock in front.

interface Env {
  /** The engine Worker (carres-scm-engine). */
  ENGINE: { fetch: (request: Request) => Promise<Response> };
  /** The engine site that holds the built pages and files (https://carres-scm.pages.dev). */
  SITE_ORIGIN: string;
  /** The supplier's address (supp.carresofficial.com). */
  PUBLIC_HOST: string;
  /** A 3PL company's address (3pl.carresofficial.com; owner, 20 Nov 2026: a 3PL's link must not say "supplier"). The
   *  same platform and API; its pages live under /logistics instead of /supplier. */
  LOGISTICS_HOST?: string;
}

/** Whether a request came for the address suppliers are given. The Worker also has a workers.dev address, on only
 *  because the deploy needs it on (wrangler.supplier-site.toml says why). It must answer nothing: one way in. */
export const isPublicHost = (hostname: string, publicHost: string | undefined): boolean =>
  !!publicHost && hostname.toLowerCase() === publicHost.trim().toLowerCase();

/** What one request gets. Decided from the method and the path alone, so it can be read and tested as a table. */
export type Plan =
  | { kind: "api" }
  | { kind: "file" }
  | { kind: "page" }
  | { kind: "robots" }
  | { kind: "redirect"; to: string }
  | { kind: "refuse"; status: 404 | 405 };

/** The supplier pages' own address prefix (frontend routing/appSurface.ts). */
export const SUPPLIER_HOME = "/supplier";
/** The same pages at a 3PL company's address (frontend carres/supplier/host.ts BASE). */
export const LOGISTICS_HOME = "/logistics";

/** Which pages an address serves: the 3PL address serves /logistics, the supplier address /supplier. */
export const homeFor = (hostname: string, env: Pick<Env, "LOGISTICS_HOST">): string =>
  isPublicHost(hostname, env.LOGISTICS_HOST) ? LOGISTICS_HOME : SUPPLIER_HOME;

const isSupplierApi = (path: string): boolean => path === "/api/carres-supplier" || path.startsWith("/api/carres-supplier/");
const isPageOf = (path: string, home: string): boolean => path === home || path.startsWith(`${home}/`);

/** A path that names a file: its last part carries an extension (the built files, the logo, the fonts). */
const isFile = (path: string): boolean => /\.[a-z0-9]{1,12}$/i.test(path.split("/").pop() ?? "");

/** `pathname` is the request's own path, as the runtime parsed it (dot segments already resolved). It is matched
 *  as written, never tidied first: a path that only resembles the supplier API after tidying is not the supplier
 *  API, and must not be handed to the engine. */
export function plan(method: string, pathname: string, home: string = SUPPLIER_HOME): Plan {
  const path = pathname;
  if (isSupplierApi(path)) return { kind: "api" };
  if (path === "/api/track/company") return method === "GET" || method === "HEAD" ? { kind: "api" } : { kind: "refuse", status: 405 };
  // Everything else under /api is the staff engine. It does not exist here.
  if (path === "/api" || path.startsWith("/api/")) return { kind: "refuse", status: 404 };
  if (method !== "GET" && method !== "HEAD") return { kind: "refuse", status: 405 };
  if (path === "/robots.txt") return { kind: "robots" };
  if (isPageOf(path, home)) return { kind: "page" };
  if (isFile(path)) return { kind: "file" };
  return { kind: "redirect", to: home };
}

/** On every answer: nothing here needs the camera, the microphone or the place, and nothing is guessed from a
 *  file's bytes. */
function harden(headers: Headers): void {
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
  headers.set("Strict-Transport-Security", "max-age=15552000");
}

/** On every page: never inside a frame, on any site (the same rule the engine site keeps for /supplier, here for
 *  the whole address), and kept out of search results. */
function hardenPage(headers: Headers): void {
  headers.set("Content-Security-Policy", "frame-ancestors 'none'");
  headers.set("X-Frame-Options", "DENY");
  headers.set("X-Robots-Tag", "noindex, nofollow");
}

const plain = (body: string, status: number, extra: Record<string, string> = {}): Response => {
  const headers = new Headers({ "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", ...extra });
  harden(headers);
  return new Response(body, { status, headers });
};

const json = (body: unknown, status: number): Response => {
  const headers = new Headers({ "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  harden(headers);
  return new Response(JSON.stringify(body), { status, headers });
};

/** A copy of an answer with this Worker's headers on it. The body is passed through, never read. */
function passOn(response: Response, page: boolean): Response {
  const headers = new Headers(response.headers);
  harden(headers);
  if (page) hardenPage(headers);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

type SiteFetch = (input: string, init?: RequestInit) => Promise<Response>;

export async function handle(request: Request, env: Env, siteFetch: SiteFetch = fetch): Promise<Response> {
  const url = new URL(request.url);
  // Any other host is not this address. Nothing is answered there, and nothing behind it is asked.
  if (!isPublicHost(url.hostname, env.PUBLIC_HOST) && !isPublicHost(url.hostname, env.LOGISTICS_HOST)) return plain("Not found.", 404);
  const decided = plan(request.method, url.pathname, homeFor(url.hostname, env));
  const site = (env.SITE_ORIGIN || "").replace(/\/+$/, "");

  switch (decided.kind) {
    case "api":
      // As it came: the method, the headers (the supplier's own token among them) and the body.
      return passOn(await env.ENGINE.fetch(request), false);
    case "refuse":
      return decided.status === 405 ? plain("Method not allowed.", 405, { allow: "GET, HEAD" }) : json({ error: "Not found." }, 404);
    case "robots":
      return plain("User-agent: *\nDisallow: /\n", 200, { "cache-control": "public, max-age=86400" });
    case "redirect":
      return new Response(null, { status: 302, headers: { location: decided.to, "cache-control": "no-store" } });
    case "file": {
      // Asked for by its own path. Of the visitor's headers only "do I already have this file" goes along: the
      // site answers a file the same for everyone.
      const ask = new Headers();
      for (const name of ["if-none-match", "if-modified-since"]) {
        const value = request.headers.get(name);
        if (value) ask.set(name, value);
      }
      const res = await siteFetch(`${site}${url.pathname}${url.search}`, { method: request.method, headers: ask, redirect: "manual" });
      if (res.status === 304) return passOn(res, false);
      // A page where a file was asked for, or a move to another address, is the site's "no such file" answer.
      // Say so, and let nothing keep it.
      if (/text\/html/i.test(res.headers.get("content-type") ?? "") || (res.status >= 300 && res.status < 400)) {
        return plain("Not found.", 404);
      }
      return passOn(res, false);
    }
    case "page": {
      // The site's one page, asked for at its root. Never at the supplier path itself: the site sends that path
      // to this address, and asking for it from here would go round in a circle.
      const res = await siteFetch(`${site}/`, { method: request.method, redirect: "manual" });
      if (!res.ok) return plain("The page could not be loaded. Try again in a moment.", 502);
      return passOn(res, true);
    }
  }
}

export default {
  fetch: (request: Request, env: Env): Promise<Response> => handle(request, env),
};
