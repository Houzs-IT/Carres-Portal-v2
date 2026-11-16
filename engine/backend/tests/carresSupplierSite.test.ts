/* Carres only: the supplier's own web address (src/carres/supplier-site/worker.ts, supp.carresofficial.com).
 *
 * The property that matters: at this address a visitor reaches the supplier pages and the supplier API, and
 * nothing else of the engine. The staff API must not answer here whatever the method or the spelling. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { handle, plan } from '../src/carres/supplier-site/worker';

const SITE = 'https://site.test';

/** A stand-in for the engine Worker and for the engine site, recording what each was asked. */
function world() {
  const engine: Request[] = [];
  const site: Array<{ url: string; init?: RequestInit }> = [];
  const env = {
    SITE_ORIGIN: `${SITE}/`,
    ENGINE: {
      fetch: async (request: Request) => {
        engine.push(request);
        return new Response(JSON.stringify({ from: 'engine' }), { status: 200, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
      },
    },
  };
  const siteFetch = async (url: string, init?: RequestInit) => {
    site.push({ url, init });
    const path = new URL(url).pathname;
    if (path === '/') return new Response('<!doctype html><div id="root"></div>', { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', 'content-security-policy-report-only': "frame-ancestors 'self' https://erp.carresofficial.com" } });
    if (path === '/assets/app-1a2b.js') {
      if (new Headers(init?.headers).get('if-none-match') === '"v1"') return new Response(null, { status: 304, headers: { etag: '"v1"' } });
      return new Response('console.log(1)', { status: 200, headers: { 'content-type': 'text/javascript', etag: '"v1"' } });
    }
    if (path === '/moved.png') return new Response(null, { status: 302, headers: { location: 'https://elsewhere.test/' } });
    // The site's answer for a file it does not have: the page itself.
    return new Response('<!doctype html><div id="root"></div>', { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
  };
  const ask = (path: string, init?: RequestInit) => handle(new Request(`https://supp.carresofficial.com${path}`, init), env, siteFetch);
  return { engine, site, ask };
}

describe('Carres supplier address: what each request gets', () => {
  it('the supplier API and the public company name go to the engine', () => {
    expect(plan('POST', '/api/carres-supplier/auth/login')).toEqual({ kind: 'api' });
    expect(plan('GET', '/api/carres-supplier/orders')).toEqual({ kind: 'api' });
    expect(plan('GET', '/api/carres-supplier')).toEqual({ kind: 'api' });
    expect(plan('GET', '/api/track/company')).toEqual({ kind: 'api' });
    expect(plan('POST', '/api/track/company')).toEqual({ kind: 'refuse', status: 405 });
  });

  it('nothing else under /api exists here: the staff API is not offered at this address', () => {
    for (const path of [
      '/api', '/api/', '/api/auth/login', '/api/auth/status', '/api/carres-sso', '/api/carres/supplier-access',
      '/api/carres/supplier-pickups', '/api/track/orders', '/api/track/company/x', '/api/scm/sales-orders', '/api/users',
      // Spellings that only look like the supplier API.
      '/api/carres-supplierx', '/api/carres-supplier-admin/x', '/api//auth/login', '/api//carres-supplier/orders',
      '/api/carres-supplier/../auth/login', '/api/carres-supplier/%2e%2e/auth/login', '/api/carres-supplier%2Forders',
    ]) {
      for (const method of ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']) {
        const got = plan(method, new URL(path, 'https://x.test').pathname);
        expect(got, `${method} ${path}`).toEqual({ kind: 'refuse', status: 404 });
      }
    }
  });

  it('a page under /supplier is the page; every other page is sent to /supplier', () => {
    for (const path of ['/supplier', '/supplier/', '/supplier/login', '/supplier/orders/CR-SO-2611-001', '/supplier/setup', '/supplier/v1.2']) {
      expect(plan('GET', path), path).toEqual({ kind: 'page' });
    }
    for (const path of ['/', '/login', '/scm/sales-orders', '/settings', '/suppliers', '/supplierx', '/team', '//api/auth/login', '/API/auth/login']) {
      expect(plan('GET', path), path).toEqual({ kind: 'redirect', to: '/supplier' });
    }
  });

  it('a file is fetched as a file; only reading is allowed outside the API', () => {
    expect(plan('GET', '/assets/app-1a2b.js')).toEqual({ kind: 'file' });
    expect(plan('GET', '/logo-wordmark.png')).toEqual({ kind: 'file' });
    expect(plan('HEAD', '/favicon.ico')).toEqual({ kind: 'file' });
    expect(plan('GET', '/robots.txt')).toEqual({ kind: 'robots' });
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
      expect(plan(method, '/supplier/login')).toEqual({ kind: 'refuse', status: 405 });
      expect(plan(method, '/assets/app-1a2b.js')).toEqual({ kind: 'refuse', status: 405 });
    }
  });
});

describe('Carres supplier address: the answers', () => {
  it('a supplier API call reaches the engine as it came: method, token and body', async () => {
    const w = world();
    const res = await w.ask('/api/carres-supplier/auth/login', {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer tok' }, body: JSON.stringify({ email: 'a@b.test' }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ from: 'engine' });
    expect(w.engine).toHaveLength(1);
    expect(w.engine[0]!.method).toBe('POST');
    expect(new URL(w.engine[0]!.url).pathname).toBe('/api/carres-supplier/auth/login');
    expect(w.engine[0]!.headers.get('authorization')).toBe('Bearer tok');
    expect(await w.engine[0]!.json()).toEqual({ email: 'a@b.test' });
    expect(w.site).toHaveLength(0);
  });

  it('a staff API call never reaches the engine', async () => {
    const w = world();
    for (const [path, method] of [['/api/auth/login', 'POST'], ['/api/carres/supplier-access', 'GET'], ['/api/scm/sales-orders', 'GET']] as const) {
      const res = await w.ask(path, { method });
      expect(res.status, path).toBe(404);
      expect(await res.json()).toEqual({ error: 'Not found.' });
    }
    expect(w.engine).toHaveLength(0);
    expect(w.site).toHaveLength(0);
  });

  it('a supplier page is the site\'s one page, never in a frame, asked for at the root and without the visitor\'s headers', async () => {
    const w = world();
    const res = await w.ask('/supplier/orders', { headers: { cookie: 'x=1', authorization: 'Bearer tok', 'sec-fetch-dest': 'document' } });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<div id="root">');
    expect(res.headers.get('content-security-policy')).toBe("frame-ancestors 'none'");
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    expect(res.headers.get('x-robots-tag')).toBe('noindex, nofollow');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(w.site).toHaveLength(1);
    expect(w.site[0]!.url).toBe(`${SITE}/`);
    expect(w.site[0]!.init?.headers).toBeUndefined();
    expect(w.engine).toHaveLength(0);
  });

  it('any other page is sent to the supplier pages', async () => {
    const w = world();
    for (const path of ['/', '/login', '/scm/sales-orders?x=1']) {
      const res = await w.ask(path);
      expect(res.status, path).toBe(302);
      expect(res.headers.get('location')).toBe('/supplier');
    }
    expect(w.site).toHaveLength(0);
    expect(w.engine).toHaveLength(0);
  });

  it('a file comes from the site by its own path; a file the site does not have is a 404, not the page', async () => {
    const w = world();
    const js = await w.ask('/assets/app-1a2b.js?v=2', { headers: { authorization: 'Bearer tok', cookie: 'x=1' } });
    expect(js.status).toBe(200);
    expect(js.headers.get('content-type')).toBe('text/javascript');
    expect(js.headers.get('content-security-policy')).toBeNull();
    expect(w.site[0]!.url).toBe(`${SITE}/assets/app-1a2b.js?v=2`);
    const sent = new Headers(w.site[0]!.init?.headers);
    expect(sent.get('authorization')).toBeNull();
    expect(sent.get('cookie')).toBeNull();

    const again = await w.ask('/assets/app-1a2b.js', { headers: { 'if-none-match': '"v1"' } });
    expect(again.status).toBe(304);

    const missing = await w.ask('/assets/gone-9z.js');
    expect(missing.status).toBe(404);
    expect(missing.headers.get('cache-control')).toBe('no-store');
    expect(await missing.text()).toBe('Not found.');

    const moved = await w.ask('/moved.png');
    expect(moved.status).toBe(404);
  });

  it('search engines are told to stay out, and writing to a page is refused', async () => {
    const w = world();
    const robots = await w.ask('/robots.txt');
    expect(await robots.text()).toBe('User-agent: *\nDisallow: /\n');
    const post = await w.ask('/supplier/login', { method: 'POST', body: 'x' });
    expect(post.status).toBe(405);
    expect(w.engine).toHaveLength(0);
  });
});

describe('Carres supplier address: how it is deployed', () => {
  const toml = readFileSync(new URL('../wrangler.supplier-site.toml', import.meta.url), 'utf8');

  it('answers at the one address suppliers are given, and nowhere else', () => {
    expect(toml).toContain('name = "carres-supplier-site"');
    expect(toml).toContain('{ pattern = "supp.carresofficial.com", custom_domain = true }');
    expect(toml).toMatch(/^workers_dev = false$/m);
    expect(toml).toMatch(/^preview_urls = false$/m);
  });

  it('holds no secret and no database: one binding, to the engine Worker', () => {
    expect(toml.match(/^\[\[services\]\]$/gm) ?? []).toHaveLength(1);
    expect(toml).toContain('service = "carres-scm-engine"');
    for (const word of ['hyperdrive', 'kv_namespaces', 'r2_buckets', 'd1_databases', 'SECRET', 'KEY', 'TOKEN']) {
      expect(toml, word).not.toContain(word);
    }
  });

  it('the engine Worker keeps its own address: this file never gives it a route', () => {
    // A `routes` line in the ENGINE's config switches its workers.dev address off unless workers_dev is pinned,
    // and the engine site reaches the Worker at that address (frontend/functions/api/[[path]].ts).
    const engine = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');
    expect(engine).not.toMatch(/^\s*routes?\s*=/m);
  });
});
