/* Carres only: the Supplier Platform's three structural guards, read off the source (src/carres/supplier/).
 *
 * The owner's rule (15 Nov 2026): a supplier's login must never be a way into Carres's system. Three things make
 * that true by where code sits rather than by what it checks, and an edit elsewhere could undo each one quietly:
 *
 *   1. the suppliers' API is mounted BEFORE the staff sign-in gate (a supplier is not staff), while the Carres side
 *      of it is mounted AFTER (a supplier must never reach it);
 *   2. the suppliers' router answers EVERY path under it, so a request never falls through to a staff route, and
 *      its own session gate sits in front of every data route;
 *   3. no statement binds a JSON string straight to a jsonb parameter (the driver would encode it twice and the
 *      list would read as empty: docs/jsonb-double-encoding-coe.md). The repo's own scanner does not see through
 *      the helper this folder uses, so the rule is pinned here. */
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const INDEX = read('../src/index.ts');
const ROUTES = read('../src/carres/supplier/routes.ts');

const at = (source: string, needle: string): number => {
  const i = source.indexOf(needle);
  expect(i, `missing: ${needle}`).toBeGreaterThan(-1);
  return i;
};

describe('Carres supplier platform: where the routes sit', () => {
  it('the suppliers API is before the staff sign-in gate; the Carres side is after it', () => {
    const gate = at(INDEX, 'app.use("/api/*", auth);');
    expect(at(INDEX, 'app.route("/api/carres-supplier", carresSupplier);')).toBeLessThan(gate);
    expect(at(INDEX, 'app.route("/api/carres/supplier-access", carresSupplierAccess);')).toBeGreaterThan(gate);
    expect(at(INDEX, 'app.route("/api/carres/supplier-pickups", carresSupplierPickups);')).toBeGreaterThan(gate);
  });

  it('the suppliers router answers every path, behind its own session gate', () => {
    at(ROUTES, 'app.all("*", (c) => c.json({ error: "Not found." }, 404));');
    const gate = at(ROUTES, 'app.use("*", session);');
    // Only signing in and the one-time link come before the gate.
    const before = ROUTES.slice(0, gate).match(/app\.(get|post|put|patch|delete)\("([^"]+)"/g) ?? [];
    expect(before).toEqual(['app.post("/auth/login"', 'app.post("/auth/link"', 'app.post("/auth/link/use"']);
    for (const route of ['app.get("/orders"', 'app.get("/forecast"', 'app.get("/pickups"', 'app.get("/finance/summary"', 'app.get("/auth/me"']) {
      expect(at(ROUTES, route)).toBeGreaterThan(gate);
    }
  });

  it('no supplier route takes the supplier from the request: it comes from the session', () => {
    expect(ROUTES).not.toMatch(/req\.(query|param)\(\s*["']supplierId["']\s*\)/);
    expect(ROUTES).not.toMatch(/\bb\?\.supplierId\b/);
  });

  it('the suppliers router never imports the staff sign-in or the Carres-side functions that take any supplier', () => {
    expect(ROUTES).not.toMatch(/from "\.\.\/\.\.\/middleware\/auth"/);
    expect(ROUTES).not.toMatch(/from "\.\/access"/);
    expect(ROUTES).not.toMatch(/from "\.\/staff-routes"/);
    for (const name of ['createPickup', 'collectPickup', 'cancelPickup', 'eligibleLines']) expect(ROUTES).not.toContain(name);
  });
});

describe('Carres supplier platform: statements', () => {
  const dir = new URL('../src/carres/supplier/', import.meta.url);
  const sources = readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));

  it('reads its source files', () => {
    expect(sources).toEqual(expect.arrayContaining(['access.ts', 'orders.ts', 'pickups.ts', 'session.ts', 'routes.ts']));
  });

  it('no JSON string is bound as jsonb without going through text', () => {
    for (const f of sources) {
      expect(readFileSync(new URL(f, dir), 'utf8').match(/\$\d+::jsonb/g) ?? [], f).toEqual([]);
    }
  });

  it('no statement is assembled from a request value', () => {
    // The only text spliced into a statement in this folder is a constant: a column list, or the order-by picked
    // from a fixed map. A `${...}` that reads the request (c.req, input.q, body) would be an injection.
    for (const f of sources) {
      const source = readFileSync(new URL(f, dir), 'utf8');
      const spliced = [...source.matchAll(/`[^`]*\b(?:SELECT|INSERT|UPDATE|DELETE|WITH)\b[^`]*`/g)].flatMap((m) => m[0].match(/\$\{[^}]+\}/g) ?? []);
      for (const s of spliced) {
        expect(s, `${f}: ${s}`).toMatch(/^\$\{(USER_COLUMNS|ORDER_COLUMNS|REQUEST_COLUMNS|PERSON_COLUMNS|LINE_SELECT|sortColumn|direction|ts\("[a-z_.()]+"\))\}$/);
      }
    }
  });
});
