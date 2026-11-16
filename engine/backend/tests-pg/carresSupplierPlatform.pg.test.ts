import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Hono } from 'hono';
import postgres, { type Sql } from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { assertDisposableTestDatabase } from './lib/doc-no-fixture';
import { dbOver, useDbForTests, type Db } from '../src/carres/supplier/db';
import { addPerson, getAccess, previewAccess, saveAccess, updatePerson } from '../src/carres/supplier/access';
import { getForecast, getOrder, listOrders } from '../src/carres/supplier/orders';
import {
  acceptPickup, answerPickupAsk, cancelPickup, collectPickup, createPickup, deliveryOrderFile, eligibleLines, getPickup, getSupplierPickup,
  listPickups, listSupplierPickups, todayMyt,
} from '../src/carres/supplier/pickups';
import { useInviteDepsForTests } from '../src/carres/supplier/invite';
import { changePassword, issueLink, readLink, resolveSession, signIn, useLink } from '../src/carres/supplier/session';
import { MAX_FAILS_PER_EMAIL, MAX_RESET_MAILS_PER_EMAIL, WORKER_SUBREQUEST_ADDRESS, sha256Hex } from '../src/carres/supplier/credentials';
import { useResetDepsForTests } from '../src/carres/supplier/reset';
import type { Mail, MailResult } from '../src/carres/supplier/mail';
import supplierApp from '../src/carres/supplier/routes';
import portalCalls, { waitingAsks } from '../src/carres/supplier/portal-asks';
import { supplierAccess, supplierPickups } from '../src/carres/supplier/staff-routes';
import type { Env } from '../src/types';

/* The Supplier Platform against real Postgres, through postgres.js (the driver the Worker uses).
 *
 * THE PROPERTY THAT MATTERS is the owner's rule (15 Nov 2026): a supplier's login must never be a way into Carres's
 * data. So the fixture plants a sentinel in every field a supplier must not read (prices, costs, margin, phone,
 * email, remarks, notes, staff names, another supplier's lines) and the tests assert that no sentinel and no
 * unexpected key ever appears in an answer, for the functions AND for the HTTP routes.
 *
 * Needs a disposable database: TEST_DATABASE_URL=postgres://...@127.0.0.1/houzs_test. An empty one is built from
 * scripts/carres-db/migrations first. SKIPPED, not failed, without it. */

const url = process.env.TEST_DATABASE_URL ?? '';
const describePg = url ? describe : describe.skip;
const migrationsDir = fileURLToPath(new URL('../scripts/carres-db/migrations/', import.meta.url));

/** Planted in every money field: it must never leave. */
const MONEY = '7770';
const SECRETS = [
  '0127770001', 'zzt-secret@customer.test', 'ZZT-INTERNAL-REMARK', 'ZZT-INTERNAL-NOTE', 'ZZT-SECRET-STAGE-NOTE', 'ZZT-FIELD-CHANGE', 'ZZT Staff Member',
  // The two parts of a line's second description that are not the goods: the salesperson's add-on note and the
  // word that the line was given free.
  'ZZT-ADDON-NOTE', 'ZZT-CAMPAIGN', 'SPECIAL:', 'FREE ·',
];
/** Every seeded line's second description: what the goods are, then a note (with a phone number in it) and a free
 *  campaign. Only the first part may leave. */
const DESCRIPTION_2 = 'ZZT SPEC / SPECIAL: Right Drawer + ZZT-ADDON-NOTE call 0127770001 / FREE · ZZT-CAMPAIGN';

let sql: Sql;
let db: Db;
let undoDb: () => void;
let staffId = 0;
let supA = '';
let supB = '';
let supC = '';
let modelMattress = '';

const TODAY = '2026-11-15';

/** The portal's server asking for the supplier asks waiting on Carres, signed the way it signs them
 *  (apps/api/src/routes/operation/scm-engine.ts). */
async function portalAsks(): Promise<{ status: number; body: unknown }> {
  const secret = 'p'.repeat(40);
  const body = '{}';
  const ts = String(Date.now());
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(`supplier-asks.${ts}.${body}`)));
  const signature = btoa(String.fromCharCode(...mac)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const res = await portalCalls.request('/supplier-asks', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-carres-portal-ts': ts, 'x-carres-portal-signature': signature },
    body,
  }, { CARRES_SSO_SECRET: secret } as unknown as Env);
  return { status: res.status, body: await res.json() };
}

async function buildSchemaIfEmpty(s: Sql): Promise<void> {
  const has = await s`select to_regclass('scm.mfg_sales_orders')::text as t`;
  if (!has[0]?.t) {
    await s.unsafe(`
      do $$ begin
        if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
        if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
        if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
      end $$;
      create schema if not exists extensions;
      grant usage on schema public, extensions to anon, authenticated, service_role;`);
    for (const f of (await readdir(migrationsDir)).filter((x) => x.endsWith('.sql')).sort()) {
      const body = await readFile(join(migrationsDir, f), 'utf8');
      await s.begin(async (tx) => { await tx.unsafe(body); });
      await s.unsafe(`set search_path = "$user", public, extensions`);
    }
    return;
  }
  // A database built earlier: run the platform's steps again. They are written to be re-run, and running them here
  // means the functions, columns and grants under test are the ones in the files, not the ones an older build left.
  const all = await readdir(migrationsDir);
  for (const suffix of ['_supplier_platform.sql', '_supplier_pickup_asks_and_people.sql']) {
    const files = all.filter((x) => x.endsWith(suffix));
    if (files.length !== 1) throw new Error(`expected one *${suffix}, found ${files.length}`);
    await s.begin(async (tx) => { await tx.unsafe(await readFile(join(migrationsDir, files[0]!), 'utf8')); });
  }
}

async function clean(s: Sql): Promise<void> {
  await s.unsafe(`
    delete from public.carres_pickup_request_lines where so_doc_no like 'ZZT-%';
    delete from public.carres_pickup_request_counters where period = '2611';
    delete from public.carres_pickup_requests where supplier_id in (select id from scm.suppliers where code like 'ZZT-%');
    delete from public.carres_supplier_events where supplier_id in (select id from scm.suppliers where code like 'ZZT-%') or subject like '%@zzt.test';
    delete from public.carres_supplier_users where email like '%@zzt.test';
    delete from public.carres_supplier_access where supplier_id in (select id from scm.suppliers where code like 'ZZT-%');
    delete from scm.mfg_so_status_changes where doc_no like 'ZZT-%';
    delete from scm.mfg_so_audit_log where so_doc_no like 'ZZT-%';
    delete from scm.mfg_sales_order_items where doc_no like 'ZZT-%';
    delete from scm.mfg_sales_orders where doc_no like 'ZZT-%';
    delete from scm.supplier_material_bindings where item_code like 'ZZT-%';
    delete from scm.mfg_products where code like 'ZZT-%';
    delete from scm.product_models where model_code like 'ZZT-%';
    delete from scm.suppliers where code like 'ZZT-%';
    delete from public.sessions where token like 'zzt-%';
    delete from public.users where email like '%@zzt-staff.test';
    delete from public.roles where name = 'ZZT test role';`);
}

async function seed(s: Sql): Promise<void> {
  const role = await s`insert into public.roles (name, description, permissions, is_system, scope_to_pic) values ('ZZT test role', 'test', '[]', 0, 0) returning id`;
  const user = await s`insert into public.users (email, name, role_id, status) values ('ops@zzt-staff.test', 'ZZT Staff Member', ${role[0]!.id}, 'active') returning id`;
  staffId = Number(user[0]!.id);

  const sup = await s`insert into scm.suppliers (code, name) values ('ZZT-A', 'ZZT MATTRESS MAKER'), ('ZZT-B', 'ZZT SOFA MAKER'), ('ZZT-C', 'ZZT NO ACCESS') returning id::text as id, code`;
  supA = sup.find((r) => r.code === 'ZZT-A')!.id;
  supB = sup.find((r) => r.code === 'ZZT-B')!.id;
  supC = sup.find((r) => r.code === 'ZZT-C')!.id;

  const models = await s`insert into scm.product_models (model_code, name, category) values ('ZZT-MX', 'ZZT Cloud', 'MATTRESS'), ('ZZT-SX', 'ZZT Lounge', 'SOFA') returning id::text as id, model_code`;
  modelMattress = models.find((r) => r.model_code === 'ZZT-MX')!.id;
  const modelSofa = models.find((r) => r.model_code === 'ZZT-SX')!.id;

  await s`insert into scm.mfg_products (id, code, name, category, model_id, cost_price_sen, sell_price_sen) values
    ('zzt-m1', 'ZZT-M1-Q', 'ZZT CLOUD QUEEN', 'MATTRESS', ${modelMattress}, 777011, 777012),
    ('zzt-m2', 'ZZT-M2-K', 'ZZT BASIC KING', 'MATTRESS', null, 777013, 777014),
    ('zzt-s1', 'ZZT-S1', 'ZZT LOUNGE 3S', 'SOFA', ${modelSofa}, 777015, 777016),
    ('zzt-acc', 'ZZT-ACC', 'ZZT PILLOW', 'ACCESSORY', null, 777017, 777018)`;
  await s`insert into scm.supplier_material_bindings (supplier_id, material_kind, item_code, material_name, supplier_sku, unit_price_sen)
          values (${supA}, 'mfg_product', 'ZZT-M1-Q', 'ZZT CLOUD QUEEN', 'A-SKU-1', 777019)`;

  const so = (docNo: string, status: string, name: string, extra: Record<string, unknown> = {}) => s`
    insert into scm.mfg_sales_orders ${s({
      doc_no: docNo, debtor_name: name, status, so_date: '2026-11-01', phone: '0127770001', email: 'zzt-secret@customer.test',
      address1: '1 ZZT Road', address2: 'Taman ZZT', postcode: '47000', city: 'Klang', customer_state: 'Selangor',
      local_total_sen: 777001, total_cost_sen: 777002, total_margin_sen: 777003, balance_sen: 777004, deposit_sen: 777005,
      paid_sen: 777006, note: 'ZZT-INTERNAL-NOTE', remark2: 'ZZT-INTERNAL-REMARK', approval_code: '777007', ...extra,
    })}`;
  await so('ZZT-SO-1', 'CONFIRMED', 'ZZT Customer One', { customer_delivery_date: '2026-12-20' });
  await so('ZZT-SO-2', 'IN_PRODUCTION', 'ZZT Customer Two', { processing_date: '2026-11-10', customer_delivery_date: '2027-01-10' });
  await so('ZZT-SO-3', 'DRAFT', 'ZZT Customer Draft');
  await so('ZZT-SO-4', 'CONFIRMED', 'ZZT Customer Sofa');
  await so('ZZT-SO-5', 'DELIVERED', 'ZZT Customer Done', { processing_date: '2026-11-02' });
  await so('ZZT-SO-6', 'CANCELLED', 'ZZT Customer Gone');
  await so('ZZT-SO-7', 'CONFIRMED', 'ZZT Customer Struck');

  const line = (docNo: string, lineNo: number, group: string, code: string, description: string, qty: number, extra: Record<string, unknown> = {}) => s`
    insert into scm.mfg_sales_order_items ${s({
      doc_no: docNo, line_no: lineNo, item_group: group, item_code: code, description, description2: DESCRIPTION_2, uom: 'UNIT', qty,
      unit_price_sen: 777021, total_sen: 777022, unit_cost_sen: 777023, line_cost_sen: 777024, line_margin_sen: 777025,
      remark: 'ZZT-INTERNAL-REMARK', ...extra,
    })}`;
  await line('ZZT-SO-1', 0, 'mattress', 'ZZT-M1-Q', 'ZZT CLOUD QUEEN', 2);
  await line('ZZT-SO-1', 1, 'sofa', 'ZZT-S1', 'ZZT LOUNGE 3S', 1);
  await line('ZZT-SO-2', 0, 'mattress', 'ZZT-M2-K', 'ZZT BASIC KING', 1);
  await line('ZZT-SO-3', 0, 'mattress', 'ZZT-M1-Q', 'ZZT CLOUD QUEEN', 5);
  await line('ZZT-SO-4', 0, 'sofa', 'ZZT-S1', 'ZZT LOUNGE 3S', 3);
  await line('ZZT-SO-5', 0, 'mattress', 'ZZT-M1-Q', 'ZZT CLOUD QUEEN', 1);
  await line('ZZT-SO-6', 0, 'mattress', 'ZZT-M1-Q', 'ZZT CLOUD QUEEN', 4);
  await line('ZZT-SO-7', 0, 'mattress', 'ZZT-M1-Q', 'ZZT CLOUD QUEEN', 9, { cancelled: true });
  await line('ZZT-SO-7', 1, 'accessory', 'ZZT-ACC', 'ZZT PILLOW', 1);

  await s`insert into scm.mfg_so_status_changes (doc_no, from_status, to_status, notes, created_at) values
    ('ZZT-SO-5', null, 'DRAFT', 'ZZT-SECRET-STAGE-NOTE', '2026-11-01T01:00:00Z'),
    ('ZZT-SO-5', 'DRAFT', 'CONFIRMED', 'ZZT-SECRET-STAGE-NOTE', '2026-11-01T02:00:00Z'),
    ('ZZT-SO-5', 'CONFIRMED', 'IN_PRODUCTION', 'ZZT-SECRET-STAGE-NOTE', '2026-11-02T02:00:00Z'),
    ('ZZT-SO-5', 'IN_PRODUCTION', 'SHIPPED', 'ZZT-SECRET-STAGE-NOTE', '2026-11-08T02:00:00Z'),
    ('ZZT-SO-5', 'SHIPPED', 'DELIVERED', 'ZZT-SECRET-STAGE-NOTE', '2026-11-09T02:00:00Z')`;
  // The second record of the same changes: the one already told must not be told twice.
  await s`insert into scm.mfg_so_audit_log (so_doc_no, action, actor_name_snapshot, field_changes, status_snapshot, note, created_at) values
    ('ZZT-SO-5', 'UPDATE_STATUS', 'ZZT Staff Member', ${s.json([{ field: 'ZZT-FIELD-CHANGE', from: 1, to: 2 }])}, 'IN_PRODUCTION', 'ZZT-SECRET-STAGE-NOTE', '2026-11-02T02:00:01Z'),
    ('ZZT-SO-5', 'UPDATE_DETAILS', 'ZZT Staff Member', ${s.json([{ field: 'ZZT-FIELD-CHANGE' }])}, 'IN_PRODUCTION', 'ZZT-SECRET-STAGE-NOTE', '2026-11-03T02:00:00Z')`;
}

/** Every key at every depth, as `a.b[].c`. */
function keyPaths(v: unknown, prefix = ''): string[] {
  if (Array.isArray(v)) return v.flatMap((x) => keyPaths(x, `${prefix}[]`));
  if (v !== null && typeof v === 'object') {
    return Object.entries(v as Record<string, unknown>).flatMap(([k, x]) => {
      const here = prefix ? `${prefix}.${k}` : k;
      return [here, ...keyPaths(x, here)];
    });
  }
  return [];
}

/** No planted secret and no money sentinel anywhere in what was answered. */
function expectClean(answer: unknown, alsoNot: string[] = []): void {
  const text = JSON.stringify(answer);
  for (const secret of [...SECRETS, ...alsoNot]) expect(text).not.toContain(secret);
  expect(text).not.toMatch(new RegExp(`${MONEY}\\d\\d`));
}

const scope = (categories: string[], extra: Partial<{ modelIds: string[]; skuCodes: string[]; ownItems: boolean; enabled: boolean; subscriptionShare: boolean }> = {}) => ({
  enabled: extra.enabled ?? true, ownItems: extra.ownItems ?? false, subscriptionShare: extra.subscriptionShare ?? false,
  categories, modelIds: extra.modelIds ?? [], skuCodes: extra.skuCodes ?? [],
});

const docNos = (rows: Array<{ docNo: string }>) => rows.map((r) => r.docNo).sort();

describePg('Carres supplier platform', () => {
  beforeAll(async () => {
    assertDisposableTestDatabase(url);
    sql = postgres(url, {
      max: 1, prepare: false, fetch_types: false, idle_timeout: 0, onnotice: () => {},
      types: { bigint: { to: 20, from: [20], parse: (x: string) => Number(x), serialize: (x: number | string) => String(x) } },
    });
    await buildSchemaIfEmpty(sql);
    await clean(sql);
    await seed(sql);
    db = dbOver(sql);
    undoDb = useDbForTests(db);
  }, 240_000);

  afterAll(async () => {
    undoDb?.();
    if (sql) {
      await clean(sql);
      await sql.end();
    }
  });

  describe('what a supplier is shared', () => {
    test('nothing, until Carres turns its access on', async () => {
      expect((await listOrders(db, supA, {})).rows).toEqual([]);
      const saved = await saveAccess(db, supA, scope(['MATTRESS'], { enabled: false }), staffId);
      expect(saved.ok).toBe(true);
      expect((await listOrders(db, supA, {})).rows).toEqual([]);
      expect(await getOrder(db, supA, 'ZZT-SO-1')).toBeNull();
    });

    test('turning access on needs something to share', async () => {
      const refused = await saveAccess(db, supA, scope([]), staffId);
      expect(refused).toMatchObject({ ok: false, status: 400 });
    });

    test('by category: every order past Draft with a line of that category, and only those lines', async () => {
      expect((await saveAccess(db, supA, scope(['MATTRESS']), staffId)).ok).toBe(true);
      const list = await listOrders(db, supA, {});
      // Not the Draft (3), not the sofa-only order (4), not the order whose only mattress line is cancelled (7).
      expect(docNos(list.rows)).toEqual(['ZZT-SO-1', 'ZZT-SO-2', 'ZZT-SO-5', 'ZZT-SO-6']);
      expect(list.total).toBe(4);
      const one = list.rows.find((r) => r.docNo === 'ZZT-SO-1')!;
      expect(one.lines.map((l) => l.itemCode)).toEqual(['ZZT-M1-Q']);
      expect(one).toMatchObject({ lineCount: 1, unitCount: 2, customerName: 'ZZT Customer One', status: 'CONFIRMED', deliveryDate: '2026-12-20' });
      expect(one.addressLines).toEqual(['1 ZZT Road', 'Taman ZZT', '47000 Klang Selangor']);
      // The sofa on the same order belongs to another supplier's scope: it is not told.
      expectClean(list, ['ZZT-S1', 'ZZT LOUNGE']);
    });

    test('the keys of an order are exactly the shared ones', async () => {
      const list = await listOrders(db, supA, {});
      expect([...new Set(list.rows.flatMap((r) => keyPaths(r)))].sort()).toEqual([
        'addressLines', 'customerName', 'deliveryDate', 'docNo', 'lineCount', 'lines', 'lines[].category', 'lines[].description',
        'lines[].itemCode', 'lines[].lineNo', 'lines[].modelName', 'lines[].pickup', 'lines[].pickup.expectedDate',
        'lines[].pickup.requestId', 'lines[].pickup.requestNo', 'lines[].pickup.state', 'lines[].qty', 'lines[].soItemId',
        'lines[].spec', 'lines[].uom', 'pickupState', 'processingDate', 'receivedAt', 'saleType', 'soDate', 'status', 'unitCount',
      ]);
    });

    test('by product model, by item, and by the supplier\'s own bound items', async () => {
      await saveAccess(db, supA, scope([], { modelIds: [modelMattress] }), staffId);
      expect(docNos((await listOrders(db, supA, {})).rows)).toEqual(['ZZT-SO-1', 'ZZT-SO-5', 'ZZT-SO-6']);
      await saveAccess(db, supA, scope([], { skuCodes: ['ZZT-M2-K'] }), staffId);
      expect(docNos((await listOrders(db, supA, {})).rows)).toEqual(['ZZT-SO-2']);
      await saveAccess(db, supA, scope([], { ownItems: true }), staffId);
      expect(docNos((await listOrders(db, supA, {})).rows)).toEqual(['ZZT-SO-1', 'ZZT-SO-5', 'ZZT-SO-6']);
      await saveAccess(db, supA, scope(['MATTRESS']), staffId);
    });

    test('a scope that names something not in the product list is refused', async () => {
      expect(await saveAccess(db, supA, scope(['NOT_A_CATEGORY']), staffId)).toMatchObject({ ok: false, status: 409 });
      expect(await saveAccess(db, supA, scope([], { skuCodes: ['ZZT-NO-SUCH-ITEM'] }), staffId)).toMatchObject({ ok: false, status: 409 });
    });

    test('another supplier sees its own lines of the same order, and not this one\'s orders', async () => {
      await saveAccess(db, supB, scope(['SOFA']), staffId);
      const list = await listOrders(db, supB, {});
      expect(docNos(list.rows)).toEqual(['ZZT-SO-1', 'ZZT-SO-4']);
      expect(list.rows.find((r) => r.docNo === 'ZZT-SO-1')!.lines.map((l) => l.itemCode)).toEqual(['ZZT-S1']);
      expect(await getOrder(db, supB, 'ZZT-SO-2')).toBeNull();
      expect(await getOrder(db, supC, 'ZZT-SO-1')).toBeNull();
      expectClean(list, ['ZZT-M1-Q', 'ZZT CLOUD']);
    });

    test('views, counts, search and paging', async () => {
      const all = await listOrders(db, supA, {});
      expect(all.counts).toEqual({ all: 4, incoming: 1, processing: 1, delivered: 1 });
      expect(docNos((await listOrders(db, supA, { view: 'incoming' })).rows)).toEqual(['ZZT-SO-1']);
      expect(docNos((await listOrders(db, supA, { view: 'processing' })).rows)).toEqual(['ZZT-SO-2']);
      expect(docNos((await listOrders(db, supA, { view: 'delivered' })).rows)).toEqual(['ZZT-SO-5']);
      expect(docNos((await listOrders(db, supA, { q: 'customer two' })).rows)).toEqual(['ZZT-SO-2']);
      expect(docNos((await listOrders(db, supA, { q: 'BASIC KING' })).rows)).toEqual(['ZZT-SO-2']);
      // A search word is text, never a pattern: a bare % finds nothing.
      expect((await listOrders(db, supA, { q: '%' })).rows).toEqual([]);
      // Searching for the sofa on a shared order finds nothing: that line is not this supplier's.
      expect((await listOrders(db, supA, { q: 'LOUNGE' })).rows).toEqual([]);
      const page = await listOrders(db, supA, { pageSize: 1, page: 2, sort: 'docNo', dir: 'asc' });
      expect(page).toMatchObject({ total: 4, page: 2, pageSize: 1 });
      expect(docNos(page.rows)).toEqual(['ZZT-SO-2']);
      // A sort word that is not on the list falls back to the default instead of reaching the statement.
      expect((await listOrders(db, supA, { sort: 'o.doc_no; drop table scm.suppliers' })).total).toBe(4);
      // So do the names every object answers for: they are not columns either.
      for (const sort of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
        expect((await listOrders(db, supA, { sort })).total).toBe(4);
      }
      // A page far past the end is an empty page, not an error; a page that is not a number is the first page.
      expect((await listOrders(db, supA, { page: 1e308 })).rows).toEqual([]);
      expect((await listOrders(db, supA, { page: Number.POSITIVE_INFINITY })).rows).toEqual([]);
      expect((await listOrders(db, supA, { page: Number.NaN })).rows).toHaveLength(4);
      expect((await listOrders(db, supA, { page: -5 })).rows).toHaveLength(4);
    });

    test('the specification leaves without the add-on note and without the word that the line was free', async () => {
      const one = (await getOrder(db, supA, 'ZZT-SO-2'))!;
      expect(one.lines.map((l) => l.spec)).toEqual(['ZZT SPEC']);
      const line = await sql`select id from scm.mfg_sales_order_items where doc_no = 'ZZT-SO-2' and item_code = 'ZZT-M2-K'`;
      const specOf = async (description2: string | null) => {
        await sql`update scm.mfg_sales_order_items set description2 = ${description2} where id = ${line[0]!.id}`;
        return (await getOrder(db, supA, 'ZZT-SO-2'))!.lines[0]!.spec;
      };
      try {
        // What the goods are stays, whatever follows it.
        expect(await specOf('QUEEN / COVE-13 / SEAT 24 / LEG 6"')).toBe('QUEEN / COVE-13 / SEAT 24 / LEG 6"');
        expect(await specOf('QUEEN / COVE-13 / SPECIAL: Right Drawer (10") + ZZT-ADDON-NOTE')).toBe('QUEEN / COVE-13');
        expect(await specOf('QUEEN / COVE-13 / FREE')).toBe('QUEEN / COVE-13');
        expect(await specOf('QUEEN / FREE · ZZT-CAMPAIGN')).toBe('QUEEN');
        expect(await specOf('QUEEN / special: zzt-addon-note / free · zzt-campaign')).toBe('QUEEN');
        // Nothing but a note or a free word: no specification at all.
        expect(await specOf('SPECIAL: ZZT-ADDON-NOTE')).toBeNull();
        expect(await specOf('FREE · ZZT-CAMPAIGN')).toBeNull();
        expect(await specOf('FREE')).toBeNull();
        expect(await specOf(null)).toBeNull();
        // A colour that only starts with the word is still a colour.
        expect(await specOf('QUEEN / FREEDOM-01 / SEAT 24')).toBe('QUEEN / FREEDOM-01 / SEAT 24');
      } finally {
        await sql`update scm.mfg_sales_order_items set description2 = ${DESCRIPTION_2} where id = ${line[0]!.id}`;
      }
    });

    test('the stage history tells each stage once, with no note, field change or staff name', async () => {
      const order = (await getOrder(db, supA, 'ZZT-SO-5'))!;
      expect(order.trail.map((t) => t.code)).toEqual(['RECEIVED', 'CONFIRMED', 'IN_PRODUCTION', 'SHIPPED', 'DELIVERED']);
      expect(order.trail.find((t) => t.code === 'SHIPPED')!.at).toBe('2026-11-08T02:00:00Z');
      expect(order.map.map((n) => `${n.type}:${n.state}`)).toEqual([
        'Sales Order:current', 'Pickup Request:pending', 'Collected:pending', 'Out for Delivery:done', 'Delivered:done',
      ]);
      expectClean(order);
    });

    test('the forecast counts open orders only, by the month the customer expects delivery', async () => {
      const f = await getForecast(db, supA);
      expect(f.rows.map((r) => [r.itemCode, r.incoming, r.processing, r.byMonth])).toEqual([
        ['ZZT-M1-Q', 2, 0, { '2026-12': 2 }],
        ['ZZT-M2-K', 0, 1, { '2027-01': 1 }],
      ]);
      expect(f.months).toEqual(['2026-12', '2027-01']);
      expect(f.totals).toEqual({ incoming: 2, processing: 1, total: 3, orders: 2 });
      expectClean(f);
    });

    test('a preview counts what WOULD be shared and saves nothing', async () => {
      const before = await getAccess(db, supC);
      const p = await previewAccess(db, supC, scope(['MATTRESS', 'SOFA']));
      expect(p).toMatchObject({ ok: true, preview: { orders: 5, incomingOrders: 2 } });
      const after = await getAccess(db, supC);
      expect(after).toEqual(before);
      expect(after!.saved).toBe(false);
      expect((await listOrders(db, supC, {})).rows).toEqual([]);
    });

    test('only one supplier is the subscription supplier', async () => {
      expect((await saveAccess(db, supA, scope(['MATTRESS'], { subscriptionShare: true }), staffId)).ok).toBe(true);
      const second = await saveAccess(db, supB, scope(['SOFA'], { subscriptionShare: true }), staffId);
      expect(second).toMatchObject({ ok: false, status: 409 });
      expect((second as { error: string }).error).toContain('ZZT MATTRESS MAKER');
    });
  });

  describe('signing in', () => {
    let token = '';
    let linkToken = '';
    const PASSWORD = 'correct horse battery';

    test('a new person has no password: they cannot sign in until they use their link', async () => {
      const made = await addPerson(db, supA, { name: 'Ana Ops', email: 'Ana@ZZT.test', canOperation: true, canFinance: false }, staffId);
      expect(made.ok).toBe(true);
      if (!made.ok) return;
      linkToken = made.link.token;
      expect(made.person).toMatchObject({ email: 'ana@zzt.test', hasPassword: false, canOperation: true, canFinance: false });
      expect(await signIn(db, { email: 'ana@zzt.test', password: PASSWORD, ip: '10.0.0.1', userAgent: null })).toMatchObject({ ok: false, status: 401 });
    });

    test('an email cannot belong to two people, or to Carres staff', async () => {
      expect(await addPerson(db, supB, { name: 'Dup', email: 'ana@zzt.test', canOperation: true, canFinance: false }, staffId)).toMatchObject({ ok: false, status: 409 });
      expect(await addPerson(db, supB, { name: 'Staff', email: 'ops@zzt-staff.test', canOperation: true, canFinance: false }, staffId)).toMatchObject({ ok: false, status: 409 });
      expect(await addPerson(db, supB, { name: 'No role', email: 'x@zzt.test', canOperation: false, canFinance: false }, staffId)).toMatchObject({ ok: false, status: 400 });
    });

    test('the link sets the password once; the link and the token are stored only as hashes', async () => {
      expect(await useLink(db, { token: linkToken, password: 'short', ip: null })).toMatchObject({ ok: false, status: 400 });
      expect(await useLink(db, { token: linkToken, password: PASSWORD, ip: null })).toMatchObject({ ok: true, email: 'ana@zzt.test' });
      expect(await useLink(db, { token: linkToken, password: 'another long password', ip: null })).toMatchObject({ ok: false, status: 404 });
      const raw = await sql`select count(*)::int as n from public.carres_supplier_links where token_hash = ${linkToken}`;
      expect(raw[0]!.n).toBe(0);
      const hashed = await sql`select count(*)::int as n from public.carres_supplier_links where token_hash = ${await sha256Hex(linkToken)}`;
      expect(hashed[0]!.n).toBe(1);
      const stored = await sql`select password_hash from public.carres_supplier_users where email = 'ana@zzt.test'`;
      expect(String(stored[0]!.password_hash)).not.toContain(PASSWORD);
    });

    test('a right password opens a session that names the person and the supplier', async () => {
      const out = await signIn(db, { email: ' ANA@zzt.test ', password: PASSWORD, ip: '10.0.0.1', userAgent: 'vitest' });
      expect(out.ok).toBe(true);
      if (!out.ok) return;
      token = out.token;
      expect(out.user).toMatchObject({ name: 'Ana Ops', supplierId: supA, supplierName: 'ZZT MATTRESS MAKER', canOperation: true, canFinance: false, subscriptionShare: true });
      expect((await resolveSession(db, token))?.email).toBe('ana@zzt.test');
      expect((await sql`select count(*)::int as n from public.carres_supplier_sessions where token_hash = ${token}`)[0]!.n).toBe(0);
    });

    test('a supplier token is not a staff session, and a staff session is not a supplier token', async () => {
      expect((await sql`select count(*)::int as n from public.sessions where token = ${token}`)[0]!.n).toBe(0);
      await sql`insert into public.sessions (token, user_id, expires_at) values ('zzt-staff-session-token', ${staffId}, '2099-01-01T00:00:00Z')`;
      expect(await resolveSession(db, 'zzt-staff-session-token')).toBeNull();
      expect(await resolveSession(db, '')).toBeNull();
      expect(await resolveSession(db, 'x'.repeat(5000))).toBeNull();
    });

    test('wrong passwords lock the email, known or unknown, and the answer never says which', async () => {
      const unknown = await signIn(db, { email: 'nobody@zzt.test', password: 'whatever it is', ip: '10.0.0.9', userAgent: null });
      const wrong = await signIn(db, { email: 'ana@zzt.test', password: 'not the password', ip: '10.0.0.9', userAgent: null });
      expect(unknown).toMatchObject({ ok: false, status: 401 });
      expect(wrong).toEqual(unknown);
      for (let i = 1; i < MAX_FAILS_PER_EMAIL; i++) {
        await signIn(db, { email: 'ana@zzt.test', password: 'not the password', ip: '10.0.0.9', userAgent: null });
        await signIn(db, { email: 'nobody@zzt.test', password: 'not the password', ip: '10.0.0.9', userAgent: null });
      }
      // Locked now: even the right password is refused, and the unknown email reads the same.
      expect(await signIn(db, { email: 'ana@zzt.test', password: PASSWORD, ip: '10.0.0.2', userAgent: null })).toMatchObject({ ok: false, status: 429 });
      expect(await signIn(db, { email: 'nobody@zzt.test', password: 'x'.repeat(12), ip: '10.0.0.2', userAgent: null })).toMatchObject({ ok: false, status: 429 });
      // The session opened before the lock still works: a lock stops guessing, it does not sign people out.
      expect(await resolveSession(db, token)).not.toBeNull();
      await sql`delete from public.carres_supplier_events where kind = 'signin_failed' and subject like '%@zzt.test'`;
    });

    test('the routes: no token, a bad token and the wrong role are all refused', async () => {
      const env = {} as Env;
      const get = (path: string, t?: string) => supplierApp.request(path, { headers: t ? { Authorization: `Bearer ${t}` } : {} }, env);
      for (const path of ['/auth/me', '/orders', '/orders/ZZT-SO-1', '/forecast', '/pickups', '/finance/summary', '/anything/else']) {
        expect((await get(path)).status).toBe(401);
        expect((await get(path, 'not-a-real-token')).status).toBe(401);
        expect((await get(path, 'zzt-staff-session-token')).status).toBe(401);
      }
      const orders = await get('/orders', token);
      expect(orders.status).toBe(200);
      expect(orders.headers.get('Cache-Control')).toBe('no-store');
      const answer = await orders.json() as { rows: Array<{ docNo: string }> };
      expect(docNos(answer.rows)).toEqual(['ZZT-SO-1', 'ZZT-SO-2', 'ZZT-SO-5', 'ZZT-SO-6']);
      expectClean(answer, ['ZZT-S1']);
      // Ana holds Warehouse and Operation only.
      expect((await get('/finance/summary', token)).status).toBe(403);
      expect((await get('/orders/ZZT-SO-4', token)).status).toBe(404);
      expect((await get('/orders/ZZT-SO-3', token)).status).toBe(404);
      const meRes = await (await get('/auth/me', token)).json();
      expect(keyPaths(meRes).sort()).toEqual([
        'badges', 'badges.pickupsToAccept', 'supplier', 'supplier.code', 'supplier.name', 'user', 'user.canFinance', 'user.canOperation', 'user.email',
        'user.id', 'user.mustChangePassword', 'user.name', 'user.perms', 'user.perms.finance', 'user.perms.operation',
      ]);
      // Carres added Ana: she holds every page and button of her one department, and none of the other.
      expect((meRes as { user: { perms: unknown; mustChangePassword: boolean } }).user).toMatchObject({
        mustChangePassword: false,
        perms: { operation: ['v_orders', 'v_forecast', 'v_pickups', 'a_accept', 'a_collect', 'a_date', 'a_cancel', 'a_export', 'a_users'], finance: [] },
      });
    });

    test('signing in over HTTP answers a token and the same refusal for every wrong try', async () => {
      const env = {} as Env;
      const post = (b: unknown) => supplierApp.request('/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', 'CF-Connecting-IP': '10.0.0.7' }, body: JSON.stringify(b) }, env);
      const good = await post({ email: 'ana@zzt.test', password: PASSWORD });
      expect(good.status).toBe(200);
      const body = await good.json() as { token: string };
      expect(body.token.length).toBeGreaterThan(30);
      const a = await post({ email: 'ana@zzt.test', password: 'nope nope nope' });
      const b = await post({ email: 'ghost@zzt.test', password: 'nope nope nope' });
      const c = await post({ email: { $ne: null }, password: ['x'] });
      expect([a.status, b.status, c.status]).toEqual([401, 401, 401]);
      expect(await a.json()).toEqual(await b.json());
      await sql`delete from public.carres_supplier_events where kind = 'signin_failed' and subject like '%@zzt.test'`;
    });

    test('nothing is counted per address: an outsider\'s wrong tries, from any address, lock nobody else out', async () => {
      const env = {} as Env;
      // Cloudflare gives a Worker that calls another zone this one address, so behind the engine site's /api proxy
      // it is the address of EVERY supplier's browser. Counted as one caller, it would be a switch that turns every
      // supplier's sign-in off.
      const post = (b: unknown, ip: string = WORKER_SUBREQUEST_ADDRESS) => supplierApp.request('/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', 'CF-Connecting-IP': ip }, body: JSON.stringify(b) }, env);
      for (let i = 0; i < 32; i++) {
        expect((await post({ email: `outsider${i}@zzt.test`, password: 'nope nope nope' })).status).toBe(401);
      }
      expect((await post({ email: 'ana@zzt.test', password: PASSWORD })).status).toBe(200);
      // The shared address names nobody, so it is not written down.
      expect((await sql`select count(*)::int as n from public.carres_supplier_events where ip = ${WORKER_SUBREQUEST_ADDRESS}`)[0]!.n).toBe(0);
      // A caller's own address is written down, and still decides nothing: an address that sent many wrong tries
      // for other emails signs in with a right password like any other.
      for (let i = 0; i < 32; i++) await post({ email: `spray${i}@zzt.test`, password: 'nope nope nope' }, '203.0.113.50');
      expect((await sql`select count(*)::int as n from public.carres_supplier_events where ip = '203.0.113.50'`)[0]!.n).toBe(32);
      expect((await post({ email: 'ana@zzt.test', password: PASSWORD }, '203.0.113.50')).status).toBe(200);
      await sql`delete from public.carres_supplier_events where kind = 'signin_failed' and subject like '%@zzt.test'`;
    }, 120_000);

    test('a body larger than a sign-in needs is refused, whether or not it says how long it is', async () => {
      const env = {} as Env;
      const big = JSON.stringify({ email: 'ana@zzt.test', password: PASSWORD, pad: 'x'.repeat(30_000) });
      const declared = await supplierApp.request('/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': String(big.length) }, body: big }, env);
      expect(declared.status).toBe(401);
      // A streamed body gives no length: it is read up to the limit, dropped and refused the same way.
      const stream = new ReadableStream<Uint8Array>({ start(ctrl) { ctrl.enqueue(new TextEncoder().encode(big)); ctrl.close(); } });
      const streamed = await supplierApp.request('/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: stream, duplex: 'half' } as RequestInit, env);
      expect(streamed.status).toBe(401);
      // The same sign-in at its real size is let in, so it was the size that refused it.
      const small = await supplierApp.request('/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'ana@zzt.test', password: PASSWORD }) }, env);
      expect(small.status).toBe(200);
      await sql`delete from public.carres_supplier_events where kind = 'signin_failed' and subject like '%@zzt.test'`;
    });

    test('disabling the person, or the supplier\'s access, ends the session on the next request', async () => {
      const person = await sql`select id from public.carres_supplier_users where email = 'ana@zzt.test'`;
      await sql`update public.carres_supplier_users set status = 'disabled' where id = ${person[0]!.id}`;
      expect(await resolveSession(db, token)).toBeNull();
      expect(await signIn(db, { email: 'ana@zzt.test', password: PASSWORD, ip: '10.0.0.1', userAgent: null })).toMatchObject({ ok: false, status: 401 });
      await sql`update public.carres_supplier_users set status = 'active' where id = ${person[0]!.id}`;
      expect(await resolveSession(db, token)).not.toBeNull();

      await saveAccess(db, supA, scope(['MATTRESS'], { enabled: false, subscriptionShare: true }), staffId);
      expect(await resolveSession(db, token)).toBeNull();
      expect((await sql`select count(*)::int as n from public.carres_supplier_sessions s join public.carres_supplier_users u on u.id = s.user_id where u.email = 'ana@zzt.test'`)[0]!.n).toBe(0);
      await saveAccess(db, supA, scope(['MATTRESS'], { subscriptionShare: true }), staffId);
      await sql`delete from public.carres_supplier_events where kind = 'signin_failed' and subject like '%@zzt.test'`;
    });

    test('tries sent at the same moment cannot outrun the limit', async () => {
      const burst = await Promise.all(Array.from({ length: 12 }, () =>
        signIn(db, { email: 'ana@zzt.test', password: 'not the password', ip: null, userAgent: null })));
      const checked = burst.filter((r) => !r.ok && r.status === 401).length;
      const locked = burst.filter((r) => !r.ok && r.status === 429).length;
      expect(checked + locked).toBe(12);
      // Each 401 is one real password check. Counted BEFORE they were written, all twelve tries read a count of
      // nought and all twelve were checked; written first, no more than the limit ever are.
      expect(checked).toBeLessThanOrEqual(MAX_FAILS_PER_EMAIL);
      expect(await signIn(db, { email: 'ana@zzt.test', password: PASSWORD, ip: null, userAgent: null })).toMatchObject({ ok: false, status: 429 });
    });

    test('a new link is how Carres lets a locked person back in, and the link itself signs them in', async () => {
      // Still locked by the burst above.
      const person = await sql`select id from public.carres_supplier_users where email = 'ana@zzt.test'`;
      const link = await issueLink(db, { userId: Number(person[0]!.id), staffUserId: staffId });
      expect(link).not.toBeNull();
      const used = await useLink(db, { token: link!.token, password: PASSWORD, ip: null });
      expect(used).toMatchObject({ ok: true, email: 'ana@zzt.test' });
      if (!used.ok) return;
      // The link opened a session: the person is in without typing the password at the sign-in page.
      expect(used.session?.user).toMatchObject({ email: 'ana@zzt.test', supplierId: supA });
      const linkSession = used.session!.token;
      expect((await resolveSession(db, linkSession))?.email).toBe('ana@zzt.test');
      // The old wrong tries no longer count: the sign-in page takes the right password again.
      expect((await signIn(db, { email: 'ana@zzt.test', password: PASSWORD, ip: null, userAgent: null })).ok).toBe(true);
      // An outsider who goes on trying locks the sign-in page again at once. The person the link let in stays in:
      // that is why the link signs them in instead of sending them to that page.
      for (let i = 0; i < MAX_FAILS_PER_EMAIL; i++) {
        await signIn(db, { email: 'ana@zzt.test', password: 'not the password', ip: null, userAgent: null });
      }
      expect(await signIn(db, { email: 'ana@zzt.test', password: PASSWORD, ip: null, userAgent: null })).toMatchObject({ ok: false, status: 429 });
      expect(await resolveSession(db, linkSession)).not.toBeNull();
      // The wrong tries of before the link are still on record. They only stopped counting.
      const kept = await sql`select count(*)::int as n from public.carres_supplier_events where kind = 'signin_failed' and subject = 'ana@zzt.test'`;
      expect(kept[0]!.n).toBeGreaterThanOrEqual(2 * MAX_FAILS_PER_EMAIL);
      await sql`delete from public.carres_supplier_events where kind = 'signin_failed' and subject like '%@zzt.test'`;
    });

    test('a good sign-in does not forgive the wrong tries before it: only a link does', async () => {
      // If it did, an email whose owner signs in would behave differently from an unknown one, and that difference
      // would tell an outsider which emails are real.
      const wrong = () => signIn(db, { email: 'ana@zzt.test', password: 'not the password', ip: null, userAgent: null });
      for (let i = 0; i < MAX_FAILS_PER_EMAIL - 1; i++) expect(await wrong()).toMatchObject({ ok: false, status: 401 });
      expect((await signIn(db, { email: 'ana@zzt.test', password: PASSWORD, ip: null, userAgent: null })).ok).toBe(true);
      // The good one was not a wrong try, so one wrong try is still left in this window, and no more.
      expect(await wrong()).toMatchObject({ ok: false, status: 401 });
      expect(await wrong()).toMatchObject({ ok: false, status: 429 });
      await sql`delete from public.carres_supplier_events where kind = 'signin_failed' and subject like '%@zzt.test'`;
    });

    test('a sign-in whose password was replaced while it was being checked opens no session', async () => {
      const count = async () => (await sql`select count(*)::int as n from public.carres_supplier_sessions s join public.carres_supplier_users u on u.id = s.user_id where u.email = 'ana@zzt.test'`)[0]!.n as number;
      const before = await count();
      const kept = await sql`select password_hash from public.carres_supplier_users where email = 'ana@zzt.test'`;
      // A database that lets a reset land in the one gap that matters: after the password was read and checked,
      // just before the session is written.
      const racing: Db = {
        query: (async (text: string, params?: readonly unknown[]) => {
          if (text.includes('INSERT INTO public.carres_supplier_sessions')) {
            await sql`update public.carres_supplier_users set password_hash = 'replaced-by-a-reset' where email = 'ana@zzt.test'`;
          }
          return db.query(text, params);
        }) as Db['query'],
        tx: (work) => db.tx(work),
      };
      try {
        // The password WAS right when it was checked. The session is still refused, as any wrong password is.
        expect(await signIn(racing, { email: 'ana@zzt.test', password: PASSWORD, ip: null, userAgent: null })).toMatchObject({ ok: false, status: 401 });
        expect(await count()).toBe(before);
      } finally {
        await sql`update public.carres_supplier_users set password_hash = ${kept[0]!.password_hash as string} where email = 'ana@zzt.test'`;
        await sql`delete from public.carres_supplier_events where kind = 'signin_failed' and subject like '%@zzt.test'`;
      }
      expect((await signIn(db, { email: 'ana@zzt.test', password: PASSWORD, ip: null, userAgent: null })).ok).toBe(true);
    });

    test('the two doors share one count of wrong tries; where they were made decides who is thrown out', async () => {
      const opened = await signIn(db, { email: 'ana@zzt.test', password: PASSWORD, ip: null, userAgent: null });
      expect(opened.ok).toBe(true);
      if (!opened.ok) return;
      const change = (current: string, next = 'whatever comes next') => changePassword(db, opened.user, { current, next, ip: null, userAgent: null });
      const wrongSignIn = () => signIn(db, { email: 'ana@zzt.test', password: 'not the password', ip: null, userAgent: null });

      // AN OUTSIDER guesses at the sign-in page until the email is locked.
      for (let i = 0; i < MAX_FAILS_PER_EMAIL; i++) await wrongSignIn();
      expect(await signIn(db, { email: 'ana@zzt.test', password: PASSWORD, ip: null, userAgent: null })).toMatchObject({ ok: false, status: 429 });
      // The person who is signed in is not thrown out. Their current password is not checked either while the
      // email is locked, right or wrong: an open session is not a second set of guesses.
      expect(await change(PASSWORD, 'a brand new pass phrase')).toMatchObject({ ok: false, status: 429 });
      expect(await change('a wrong guess')).toMatchObject({ ok: false, status: 429 });
      expect(await resolveSession(db, opened.token)).not.toBeNull();
      await sql`delete from public.carres_supplier_events where kind = 'signin_failed' and subject like '%@zzt.test'`;

      // Three wrong sign-ins and two wrong current passwords are five: the sixth try is refused at either door.
      for (let i = 0; i < 3; i++) await wrongSignIn();
      for (let i = 0; i < 2; i++) expect(await change(`a wrong guess ${i}`)).toMatchObject({ ok: false, status: 400 });
      expect(await change(PASSWORD, 'a brand new pass phrase')).toMatchObject({ ok: false, status: 429 });
      expect(await signIn(db, { email: 'ana@zzt.test', password: PASSWORD, ip: null, userAgent: null })).toMatchObject({ ok: false, status: 429 });
      expect(await resolveSession(db, opened.token)).not.toBeNull();
      await sql`delete from public.carres_supplier_events where kind = 'signin_failed' and subject like '%@zzt.test'`;

      // With nothing against the email, the right current password changes the password and every other session ends.
      const changed = await change(PASSWORD, 'a brand new pass phrase');
      expect(changed.ok).toBe(true);
      if (!changed.ok) return;
      expect(await resolveSession(db, opened.token)).toBeNull();

      // WHOEVER IS AT THIS KEYBOARD guesses the current password: the limit's worth are answered ...
      for (let i = 0; i < MAX_FAILS_PER_EMAIL; i++) expect(await change(`a wrong guess ${i}`)).toMatchObject({ ok: false, status: 400 });
      expect(await resolveSession(db, changed.token)).not.toBeNull();
      // ... and one more try, even with the right password, ends every session of the person.
      expect(await change('a brand new pass phrase')).toMatchObject({ ok: false, status: 401 });
      expect(await resolveSession(db, changed.token)).toBeNull();
      expect((await sql`select count(*)::int as n from public.carres_supplier_sessions s join public.carres_supplier_users u on u.id = s.user_id where u.email = 'ana@zzt.test'`)[0]!.n).toBe(0);

      // Put the password back for the tests that follow, the way Carres would: a new link.
      const person = await sql`select id from public.carres_supplier_users where email = 'ana@zzt.test'`;
      const link = await issueLink(db, { userId: Number(person[0]!.id), staffUserId: staffId });
      expect(await useLink(db, { token: link!.token, password: PASSWORD, ip: null })).toMatchObject({ ok: true });
      await sql`delete from public.carres_supplier_events where kind = 'signin_failed' and subject like '%@zzt.test'`;
    });

    test('a Finance person opens no Warehouse page, and a supplier that is paid no share reads no figures', async () => {
      // Supplier B has access (sofas) and is not the subscription supplier.
      const made = await addPerson(db, supB, { name: 'Fin B', email: 'fin@zzt.test', canOperation: false, canFinance: true }, staffId);
      expect(made.ok).toBe(true);
      if (!made.ok) return;
      expect(await useLink(db, { token: made.link.token, password: PASSWORD, ip: null })).toMatchObject({ ok: true });
      const fin = await signIn(db, { email: 'fin@zzt.test', password: PASSWORD, ip: null, userAgent: null });
      expect(fin.ok).toBe(true);
      if (!fin.ok) return;
      const env = {} as Env;
      const get = (path: string) => supplierApp.request(path, { headers: { Authorization: `Bearer ${fin.token}` } }, env);
      for (const path of ['/orders', '/orders/ZZT-SO-1', '/forecast', '/pickups']) expect((await get(path)).status).toBe(403);
      const summary = await get('/finance/summary');
      expect(summary.status).toBe(200);
      expect(await summary.json()).toEqual({ shared: false });
      expect((await get('/finance/orders/11111111-1111-4111-8111-111111111111')).status).toBe(404);
    });

    test('with the supplier\'s access off, a link still sets the password and signs nobody in', async () => {
      const env = {} as Env;
      const person = await sql`select id from public.carres_supplier_users where email = 'fin@zzt.test'`;
      await saveAccess(db, supB, scope(['SOFA'], { enabled: false }), staffId);
      try {
        const link = await issueLink(db, { userId: Number(person[0]!.id), staffUserId: staffId });
        // Over HTTP, as the page calls it: the answer carries the email and no token.
        const res = await supplierApp.request('/auth/link/use', {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: link!.token, password: 'a password for later use' }),
        }, env);
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ ok: true, email: 'fin@zzt.test' });
        expect((await sql`select count(*)::int as n from public.carres_supplier_sessions where user_id = ${person[0]!.id}`)[0]!.n).toBe(0);
        expect(await signIn(db, { email: 'fin@zzt.test', password: 'a password for later use', ip: null, userAgent: null })).toMatchObject({ ok: false, status: 401 });
      } finally {
        await saveAccess(db, supB, scope(['SOFA']), staffId);
        await sql`delete from public.carres_supplier_events where kind = 'signin_failed' and subject like '%@zzt.test'`;
      }
      // Access back on: the password chosen while it was off signs the person in.
      expect((await signIn(db, { email: 'fin@zzt.test', password: 'a password for later use', ip: null, userAgent: null })).ok).toBe(true);
      // And with access on, the same call over HTTP answers what signing in answers.
      const link = await issueLink(db, { userId: Number(person[0]!.id), staffUserId: staffId });
      const res = await supplierApp.request('/auth/link/use', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: link!.token, password: PASSWORD }),
      }, env);
      const body = await res.json() as { token: string; user: { email: string } };
      expect(res.status).toBe(200);
      expect(keyPaths(body).sort()).toEqual([
        'badges', 'badges.pickupsToAccept', 'email', 'expiresAt', 'ok', 'supplier', 'supplier.code', 'supplier.name', 'token',
        'user', 'user.canFinance', 'user.canOperation', 'user.email', 'user.id', 'user.mustChangePassword', 'user.name', 'user.perms',
        'user.perms.finance', 'user.perms.operation',
      ]);
      expect((await resolveSession(db, body.token))?.email).toBe('fin@zzt.test');
    });
  });

  describe('forgot password', () => {
    const env = { ENGINE_PUBLIC_URL: 'https://engine.test', SUPPLIER_PUBLIC_URL: 'https://supp.test/' } as unknown as Env;
    const sent: Array<{ to: string; mail: Mail }> = [];
    let mailOn = true;
    let outcome: MailResult | 'throw' = { status: 'sent' };
    let undoDeps: () => void = () => {};
    let ritaId = 0;

    const ask = (b: unknown) => supplierApp.request('/auth/forgot', {
      method: 'POST', headers: { 'content-type': 'application/json', 'CF-Connecting-IP': '10.0.0.9' }, body: typeof b === 'string' ? b : JSON.stringify(b),
    }, env);
    const tokenIn = (mail: Mail): string => /#t=([A-Za-z0-9_-]+)/.exec(mail.text)?.[1] ?? '';
    const asks = async (email: string) => (await sql`
      select kind, detail from public.carres_supplier_events
       where subject = ${email} and kind in ('reset_requested', 'reset_mailed', 'reset_not_mailed') order by id`) as unknown as Array<{ kind: string; detail: Record<string, unknown> }>;
    const forget = (email: string) => sql`
      delete from public.carres_supplier_events where subject = ${email} and kind in ('reset_requested', 'reset_mailed', 'reset_not_mailed')`;

    beforeAll(async () => {
      undoDeps = useResetDepsForTests({
        companyName: async () => 'ZZT Carres',
        mailOn: async () => mailOn,
        send: async (_env, to, mail) => {
          if (outcome === 'throw') throw new Error(`boom ${mail.text}`);
          sent.push({ to, mail });
          return outcome;
        },
      });
      const made = await addPerson(db, supA, { name: 'Rita <Reset>', email: 'rita@zzt.test', canOperation: true, canFinance: false }, staffId);
      if (!made.ok) throw new Error('fixture: rita');
      ritaId = made.person.id;
      expect(await useLink(db, { token: made.link.token, password: 'the first long password', ip: null })).toMatchObject({ ok: true });
    });
    afterAll(() => undoDeps());
    beforeEach(async () => {
      sent.length = 0;
      mailOn = true;
      outcome = { status: 'sent' };
      await forget('rita@zzt.test');
    });

    test('a person who may sign in is emailed a link that lives an hour, and the link is stored nowhere', async () => {
      const outboxBefore = (await sql`select count(*)::int as n from public.email_outbox`)[0]!.n;
      const logBefore = (await sql`select count(*)::int as n from public.email_log`)[0]!.n;

      const res = await ask({ email: ' Rita@ZZT.test ' });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
      expect(res.headers.get('Cache-Control')).toBe('no-store');

      expect(sent).toHaveLength(1);
      expect(sent[0]!.to).toBe('rita@zzt.test');
      const mail = sent[0]!.mail;
      expect(mail.subject).toBe('Choose a new password');
      expect(mail.text).toContain('https://supp.test/supplier/setup#t=');
      expect(mail.text).toContain('ZZT Carres');
      expect(mail.text).toContain('works once, for 1 hour');
      // The person's name is text, never markup.
      expect(mail.html).toContain('Rita &lt;Reset&gt;');
      expect(mail.html).not.toContain('<Reset>');
      const token = tokenIn(mail);
      expect(token.length).toBeGreaterThan(30);

      const link = await sql`
        select purpose, created_by, used_at, (extract(epoch from (expires_at - now())) / 60)::int as minutes
          from public.carres_supplier_links where token_hash = ${await sha256Hex(token)}`;
      expect(link).toHaveLength(1);
      expect(link[0]).toMatchObject({ purpose: 'reset', created_by: null, used_at: null });
      expect(link[0]!.minutes).toBeGreaterThanOrEqual(58);
      expect(link[0]!.minutes).toBeLessThanOrEqual(60);

      // The link is in the email and nowhere in the database: not in the platform's tables, and not in the engine's
      // own mail tables, which keep every message they send.
      expect((await sql`select count(*)::int as n from public.carres_supplier_links where token_hash = ${token}`)[0]!.n).toBe(0);
      expect((await sql`select count(*)::int as n from public.carres_supplier_events where detail::text like ${`%${token}%`} or coalesce(subject, '') like ${`%${token}%`}`)[0]!.n).toBe(0);
      expect((await sql`select count(*)::int as n from public.email_outbox`)[0]!.n).toBe(outboxBefore);
      expect((await sql`select count(*)::int as n from public.email_log`)[0]!.n).toBe(logBefore);

      // One row for the ask, which says the email left, and one for the link, which says it was asked for here.
      expect(await asks('rita@zzt.test')).toEqual([{ kind: 'reset_mailed', detail: {} }]);
      const made = await sql`
        select staff_user_id, detail from public.carres_supplier_events
         where kind = 'link_issued' and supplier_user_id = ${ritaId} order by id desc limit 1`;
      expect(made[0]).toMatchObject({ staff_user_id: null, detail: { purpose: 'reset', via: 'forgot' } });

      // And it is the same one-time link: it sets the password, signs the person in and ends the old password.
      const used = await useLink(db, { token, password: 'a second long password', ip: null });
      expect(used).toMatchObject({ ok: true, email: 'rita@zzt.test' });
      expect(await useLink(db, { token, password: 'a third long password', ip: null })).toMatchObject({ ok: false, status: 404 });
      expect(await signIn(db, { email: 'rita@zzt.test', password: 'the first long password', ip: null, userAgent: null })).toMatchObject({ ok: false, status: 401 });
      expect((await signIn(db, { email: 'rita@zzt.test', password: 'a second long password', ip: null, userAgent: null })).ok).toBe(true);
      await sql`delete from public.carres_supplier_events where kind = 'signin_failed' and subject like '%@zzt.test'`;
    });

    test('the answer is the same for every email, and one that does not sign in leaves nothing behind', async () => {
      const before = (await sql`select count(*)::int as n from public.carres_supplier_events`)[0]!.n;
      const linksBefore = (await sql`select count(*)::int as n from public.carres_supplier_links`)[0]!.n;
      const known = await ask({ email: 'rita@zzt.test' });
      const answers = [known];
      for (const body of [{ email: 'ghost@zzt.test' }, { email: 'not an email' }, { email: { $ne: null } }, { email: ['rita@zzt.test'] }, {}, 'not json', '[]']) {
        answers.push(await ask(body));
      }
      for (const r of answers) {
        expect(r.status).toBe(200);
        expect(await r.json()).toEqual({ ok: true });
      }
      // Only the one real person was emailed, and only their ask and their link were written.
      expect(sent.map((s) => s.to)).toEqual(['rita@zzt.test']);
      expect((await sql`select count(*)::int as n from public.carres_supplier_events`)[0]!.n).toBe(before + 2);
      expect((await sql`select count(*)::int as n from public.carres_supplier_links`)[0]!.n).toBe(linksBefore + 1);
      expect(await asks('ghost@zzt.test')).toEqual([]);
    });

    test('a disabled person, and a supplier whose access is off, are sent nothing and nothing is written', async () => {
      const before = (await sql`select count(*)::int as n from public.carres_supplier_events`)[0]!.n;
      await sql`update public.carres_supplier_users set status = 'disabled' where id = ${ritaId}`;
      try {
        expect((await ask({ email: 'rita@zzt.test' })).status).toBe(200);
      } finally {
        await sql`update public.carres_supplier_users set status = 'active' where id = ${ritaId}`;
      }
      await sql`update public.carres_supplier_access set enabled = false where supplier_id = ${supA}`;
      try {
        expect((await ask({ email: 'rita@zzt.test' })).status).toBe(200);
      } finally {
        await sql`update public.carres_supplier_access set enabled = true where supplier_id = ${supA}`;
      }
      expect(sent).toEqual([]);
      expect((await sql`select count(*)::int as n from public.carres_supplier_events`)[0]!.n).toBe(before);
    });

    test('three links an hour for one email: the fourth ask sends nothing and writes nothing', async () => {
      for (let i = 0; i < MAX_RESET_MAILS_PER_EMAIL; i++) expect((await ask({ email: 'rita@zzt.test' })).status).toBe(200);
      expect(sent).toHaveLength(MAX_RESET_MAILS_PER_EMAIL);
      expect((await asks('rita@zzt.test')).map((a) => a.kind)).toEqual(['reset_mailed', 'reset_mailed', 'reset_mailed']);

      for (let i = 0; i < 5; i++) expect(await (await ask({ email: 'rita@zzt.test' })).json()).toEqual({ ok: true });
      expect(sent).toHaveLength(MAX_RESET_MAILS_PER_EMAIL);
      expect(await asks('rita@zzt.test')).toHaveLength(MAX_RESET_MAILS_PER_EMAIL);

      // Another person's asks are their own count.
      const other = await sql`select email from public.carres_supplier_users where email = 'ana@zzt.test' and status = 'active'`;
      if (other.length) {
        await forget('ana@zzt.test');
        await ask({ email: 'ana@zzt.test' });
        expect(sent.at(-1)!.to).toBe('ana@zzt.test');
        await forget('ana@zzt.test');
      }

      // An hour later the count has started again.
      await sql`update public.carres_supplier_events set at = now() - interval '61 minutes' where subject = 'rita@zzt.test' and kind = 'reset_mailed'`;
      const n = sent.length;
      await ask({ email: 'rita@zzt.test' });
      expect(sent).toHaveLength(n + 1);
    });

    test('asks sent at the same moment cannot outrun the limit', async () => {
      const mark = Number((await sql`select coalesce(max(id), 0)::int as id from public.carres_supplier_events`)[0]!.id);
      await Promise.all(Array.from({ length: 12 }, () => ask({ email: 'rita@zzt.test' })));
      expect(sent.length).toBeLessThanOrEqual(MAX_RESET_MAILS_PER_EMAIL);
      // Counted from this burst alone: the links made for it are no more than the limit, and each one was emailed.
      const links = await sql`
        select count(*)::int as n from public.carres_supplier_events
         where id > ${mark} and kind = 'link_issued' and supplier_user_id = ${ritaId} and detail->>'via' = 'forgot'`;
      expect(links[0]!.n).toBeLessThanOrEqual(MAX_RESET_MAILS_PER_EMAIL);
      expect(links[0]!.n).toBe(sent.length);
      // Every ask that was written is settled: none is left saying only "asked".
      expect((await asks('rita@zzt.test')).filter((a) => a.kind === 'reset_requested')).toEqual([]);
    });

    test('the newest link is the one that works', async () => {
      await ask({ email: 'rita@zzt.test' });
      await ask({ email: 'rita@zzt.test' });
      expect(sent).toHaveLength(2);
      const [first, second] = sent.map((s) => tokenIn(s.mail));
      expect(first).not.toBe(second);
      expect(await readLink(db, first!)).toBeNull();
      expect(await readLink(db, second!)).toMatchObject({ email: 'rita@zzt.test', purpose: 'reset' });
    });

    test('when the email cannot leave, the record says why and never holds the link', async () => {
      mailOn = false;
      await ask({ email: 'rita@zzt.test' });
      mailOn = true;
      outcome = { status: 'not_sent', reason: 'The mail service refused the message (422).' };
      await ask({ email: 'rita@zzt.test' });
      outcome = 'throw';
      await ask({ email: 'rita@zzt.test' });

      const rows = await asks('rita@zzt.test');
      expect(rows).toEqual([
        { kind: 'reset_not_mailed', detail: { reason: 'Supplier emails are switched off in Settings.' } },
        { kind: 'reset_not_mailed', detail: { reason: 'The mail service refused the message (422).' } },
        { kind: 'reset_not_mailed', detail: { reason: 'The message could not be made.' } },
      ]);
      expect(JSON.stringify(rows)).not.toContain('#t=');
      // The switch was off for the first ask: the provider was never called for it.
      expect(sent).toHaveLength(1);
    });

    test('a person who has not chosen a password yet is sent the first-time link', async () => {
      const made = await addPerson(db, supA, { name: 'Nina New', email: 'nina@zzt.test', canOperation: true, canFinance: false }, staffId);
      expect(made.ok).toBe(true);
      await ask({ email: 'nina@zzt.test' });
      expect(sent).toHaveLength(1);
      expect(sent[0]!.mail.subject).toBe('Choose your password');
      expect(await readLink(db, tokenIn(sent[0]!.mail))).toMatchObject({ email: 'nina@zzt.test', purpose: 'setup' });
      // The link Carres made for her first no longer works: the newest one does.
      if (made.ok) expect(await readLink(db, made.link.token)).toBeNull();
      await forget('nina@zzt.test');
    });

    test('asking is the only thing the address does: it needs no session and gives none', async () => {
      await sql`delete from public.carres_supplier_sessions where user_id = ${ritaId}`;
      const res = await ask({ email: 'rita@zzt.test' });
      expect(keyPaths(await res.json())).toEqual(['ok']);
      expect((await sql`select count(*)::int as n from public.carres_supplier_sessions where user_id = ${ritaId}`)[0]!.n).toBe(0);
      // Reading it is not offered: without a session every other method meets the session gate.
      expect((await supplierApp.request('/auth/forgot', {}, env)).status).toBe(401);
    });
  });

  describe('pickup requests', () => {
    const actor = { id: 0, name: 'ZZT Staff Member' };
    let mattressLine = '';
    let kingLine = '';
    let sofaLine = '';
    let requestId = '';

    test('Carres may tick only the supplier\'s shared lines on orders that can still be collected', async () => {
      actor.id = staffId;
      const lines = await eligibleLines(db, supA);
      expect(lines.map((l) => `${l.soDocNo}:${l.itemCode}:${l.qty}`)).toEqual(['ZZT-SO-1:ZZT-M1-Q:2', 'ZZT-SO-2:ZZT-M2-K:1']);
      mattressLine = lines[0]!.soItemId;
      kingLine = lines[1]!.soItemId;
      sofaLine = (await sql`select id::text as id from scm.mfg_sales_order_items where doc_no = 'ZZT-SO-1' and item_code = 'ZZT-S1'`)[0]!.id;
    });

    test('a request for a line outside the supplier\'s scope, a past day, or no line is refused', async () => {
      expect(await createPickup(db, { supplierId: supA, expectedDate: '2026-11-20', soItemIds: [mattressLine, sofaLine] }, actor, TODAY)).toMatchObject({ ok: false, status: 409 });
      expect(await createPickup(db, { supplierId: supA, expectedDate: '2026-11-01', soItemIds: [mattressLine] }, actor, TODAY)).toMatchObject({ ok: false, status: 400 });
      expect(await createPickup(db, { supplierId: supA, expectedDate: '2026-11-20', soItemIds: [] }, actor, TODAY)).toMatchObject({ ok: false, status: 400 });
      expect(await createPickup(db, { supplierId: supA, expectedDate: '2026-11-20', expectedTime: '25:99', soItemIds: [mattressLine] }, actor, TODAY)).toMatchObject({ ok: false, status: 400 });
      expect(await createPickup(db, { supplierId: supC, expectedDate: '2026-11-20', soItemIds: [mattressLine] }, actor, TODAY)).toMatchObject({ ok: false, status: 409 });
      expect((await sql`select count(*)::int as n from public.carres_pickup_requests where supplier_id = ${supA}`)[0]!.n).toBe(0);
    });

    test('a request is numbered, keeps the lines as they read, and a line cannot be asked for twice', async () => {
      const made = await createPickup(db, { supplierId: supA, expectedDate: '2026-11-20', expectedTime: '10:30', note: ' Lorry WXY 1234 ', soItemIds: [mattressLine] }, actor, TODAY);
      expect(made.ok).toBe(true);
      if (!made.ok) return;
      requestId = made.pickup.id;
      expect(made.pickup).toMatchObject({
        requestNo: 'CR-PKR-2611-001', status: 'REQUESTED', expectedDate: '2026-11-20', expectedTime: '10:30', note: 'Lorry WXY 1234',
        soDocNos: ['ZZT-SO-1'], lineCount: 1, unitCount: 2, requestedByName: 'ZZT Staff Member',
      });
      expect(made.pickup.lines[0]).toMatchObject({ itemCode: 'ZZT-M1-Q', uom: 'UNIT', qty: 2, modelName: 'ZZT Cloud' });
      expect(await createPickup(db, { supplierId: supA, expectedDate: '2026-11-21', soItemIds: [mattressLine] }, actor, TODAY)).toMatchObject({ ok: false, status: 409 });
      expect((await eligibleLines(db, supA)).map((l) => l.soDocNo)).toEqual(['ZZT-SO-2']);
    });

    test('the supplier reads its own request without the Carres staff names; another supplier reads nothing', async () => {
      const token = (await signIn(db, { email: 'ana@zzt.test', password: 'correct horse battery', ip: '10.0.0.1', userAgent: null }) as { token: string }).token;
      const env = {} as Env;
      const res = await supplierApp.request(`/pickups/${requestId}`, { headers: { Authorization: `Bearer ${token}` } }, env);
      expect(res.status).toBe(200);
      const body = await res.json() as { pickup: Record<string, unknown> };
      expectClean(body);
      expect(Object.keys(body.pickup)).not.toContain('requestedByName');
      expect(Object.keys(body.pickup)).not.toContain('supplierId');
      // The keys of a request are exactly the ones named for a supplier: a new column does not travel by default.
      expect(Object.keys(body.pickup).sort()).toEqual([
        'acceptedAt', 'acceptedByName', 'answer', 'ask', 'cancelReason', 'cancelledAt', 'cancelledBySupplier', 'collectedAt',
        'collectedBySupplierName', 'dateChangedAt', 'deliveryOrder', 'expectedDate', 'expectedTime', 'id', 'lineCount', 'lines', 'note',
        'orders', 'previousExpectedDate', 'requestNo', 'requestedAt', 'soDocNos', 'status', 'supplierName', 'unitCount',
      ]);
      // Each Sales Order on the request with its customer, read through the supplier's own scope.
      expect(body.pickup.orders).toEqual([{ docNo: 'ZZT-SO-1', customerName: 'ZZT Customer One' }]);
      expect(Object.keys((body.pickup.lines as Array<Record<string, unknown>>)[0]!).sort()).toEqual([
        'description', 'itemCode', 'modelName', 'qty', 'soDocNo', 'soItemId', 'spec', 'uom',
      ]);
      // The supplier's side reads with the supplier in hand, or reads nothing.
      expect(await getSupplierPickup(db, requestId, supB)).toBeNull();
      expect(await getSupplierPickup(db, requestId, '')).toBeNull();
      expect(await listSupplierPickups(db, '')).toEqual([]);
      expect((await listSupplierPickups(db, supA)).map((p) => p.requestNo)).toEqual(['CR-PKR-2611-001']);
      expect(await getPickup(db, requestId, supB)).toBeNull();
      expect(await acceptPickup(db, requestId, { supplierId: supB, userId: 1, userName: 'Other', ip: null })).toMatchObject({ ok: false, status: 404 });
      // The order now says a pickup is waiting.
      const order = (await getOrder(db, supA, 'ZZT-SO-1'))!;
      expect(order.pickupState).toBe('requested');
      expect(order.lines[0]!.pickup).toMatchObject({ state: 'requested', requestNo: 'CR-PKR-2611-001', expectedDate: '2026-11-20' });
      // The other supplier's view of the same order does not mention it.
      expect((await getOrder(db, supB, 'ZZT-SO-1'))!.pickupState).toBe('none');

      const accepted = await supplierApp.request(`/pickups/${requestId}/accept`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } }, env);
      expect(accepted.status).toBe(200);
      expect(((await accepted.json()) as { pickup: { status: string; acceptedByName: string } }).pickup).toMatchObject({ status: 'ACCEPTED', acceptedByName: 'Ana Ops' });
      const again = await supplierApp.request(`/pickups/${requestId}/accept`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } }, env);
      expect(again.status).toBe(409);
    });

    test('collected goods leave the forecast and the history tells the whole pickup', async () => {
      expect(await collectPickup(db, requestId, actor)).toMatchObject({ ok: true, pickup: { status: 'COLLECTED', collectedByName: 'ZZT Staff Member' } });
      expect(await collectPickup(db, requestId, actor)).toMatchObject({ ok: false, status: 409 });
      expect(await cancelPickup(db, requestId, 'changed our mind', actor)).toMatchObject({ ok: false, status: 409 });
      const f = await getForecast(db, supA);
      expect(f.rows.map((r) => r.itemCode)).toEqual(['ZZT-M2-K']);
      const order = (await getOrder(db, supA, 'ZZT-SO-1'))!;
      expect(order.pickupState).toBe('collected');
      expect(order.trail.map((t) => t.code)).toEqual(['RECEIVED', 'PICKUP_REQUESTED', 'PICKUP_ACCEPTED', 'PICKUP_COLLECTED']);
      expect(order.map.map((n) => `${n.type}:${n.state}`).slice(0, 3)).toEqual(['Sales Order:current', 'Pickup Request:done', 'Collected:done']);
      expectClean(order);
    });

    test('a cancelled request needs a reason and frees its lines', async () => {
      const made = await createPickup(db, { supplierId: supA, expectedDate: '2026-11-25', soItemIds: [kingLine] }, actor, TODAY);
      expect(made).toMatchObject({ ok: true, pickup: { requestNo: 'CR-PKR-2611-002' } });
      if (!made.ok) return;
      expect(await cancelPickup(db, made.pickup.id, '  ', actor)).toMatchObject({ ok: false, status: 400 });
      expect(await cancelPickup(db, made.pickup.id, 'Customer moved the date', actor)).toMatchObject({ ok: true, pickup: { status: 'CANCELLED', cancelReason: 'Customer moved the date' } });
      expect(await acceptPickup(db, made.pickup.id, { supplierId: supA, userId: 1, userName: 'Ana', ip: null })).toMatchObject({ ok: false, status: 409 });
      expect((await eligibleLines(db, supA)).map((l) => l.soDocNo)).toEqual(['ZZT-SO-2']);
    });

    test('the Carres routes are closed to staff without the page, and open with it', async () => {
      const as = (user: Record<string, unknown>) => {
        const app = new Hono<{ Bindings: Env }>();
        app.use('*', async (c, next) => { c.set('user' as never, user as never); await next(); });
        app.route('/access', supplierAccess);
        app.route('/pickups', supplierPickups);
        return app;
      };
      const nobody = as({ id: staffId, name: 'No Access', permissions: [], permissions_set: new Set<string>(), page_access: {} });
      expect((await nobody.request('/access', {}, {} as Env)).status).toBe(403);
      expect((await nobody.request('/pickups', {}, {} as Env)).status).toBe(403);
      const viewer = as({ id: staffId, name: 'Viewer', permissions: [], permissions_set: new Set<string>(), page_access: { 'scm.procurement.po': 'view' } });
      expect((await viewer.request('/pickups', {}, {} as Env)).status).toBe(200);
      expect((await viewer.request(`/pickups/${requestId}/collect`, { method: 'POST' }, {} as Env)).status).toBe(403);
      expect((await viewer.request('/access', {}, {} as Env)).status).toBe(403);
      const owner = as({ id: staffId, name: 'Owner', permissions: ['*'], permissions_set: new Set(['*']), page_access: {} });
      const list = await owner.request('/access', {}, {} as Env);
      expect(list.status).toBe(200);
      const body = await list.json() as { suppliers: Array<{ code: string }> };
      expect(body.suppliers.map((s) => s.code).filter((c) => c.startsWith('ZZT-')).sort()).toEqual(['ZZT-A', 'ZZT-B']);
    });
  });

  describe('the supplier pages, second step: permissions, people, asks and Delivery Orders', () => {
    const PASSWORD = 'correct horse battery';
    const env = {} as Env;
    const actor = { id: 0, name: 'ZZT Staff Member' };
    /** A day from now in Kuala Lumpur: these tests ask for days the routes check against the real today. */
    const inDays = (n: number) => todayMyt(Date.now() + n * 86_400_000);
    let ana = '';
    let anaId = 0;
    const call = (path: string, token: string, init: RequestInit = {}, e: Env = env) =>
      supplierApp.request(path, { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` } }, e);
    const post = (path: string, token: string, b: unknown, e: Env = env) =>
      call(path, token, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }, e);
    const patch = (path: string, token: string, b: unknown) =>
      call(path, token, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
    const signedIn = async (email: string, password = PASSWORD) => {
      const out = await signIn(db, { email, password, ip: null, userAgent: null });
      if (!out.ok) throw new Error(`sign-in failed for ${email}`);
      return out.token;
    };

    beforeAll(async () => {
      actor.id = staffId;
      ana = await signedIn('ana@zzt.test');
      anaId = Number((await sql`select id from public.carres_supplier_users where email = 'ana@zzt.test'`)[0]!.id);
      // One more order with two of supplier A's lines, so there is something left to request.
      await sql`insert into scm.mfg_sales_orders ${sql({ doc_no: 'ZZT-SO-8', debtor_name: 'ZZT Customer Eight', status: 'CONFIRMED', so_date: '2026-11-02' })}`;
      await sql`insert into scm.mfg_sales_order_items ${sql([
        { doc_no: 'ZZT-SO-8', line_no: 0, item_group: 'mattress', item_code: 'ZZT-M2-K', description: 'ZZT BASIC KING', uom: 'UNIT', qty: 1 },
        { doc_no: 'ZZT-SO-8', line_no: 1, item_group: 'mattress', item_code: 'ZZT-M1-Q', description: 'ZZT CLOUD QUEEN', uom: 'UNIT', qty: 2 },
      ])}`;
    });

    test('what a person holds decides what answers, on the server', async () => {
      await sql`update public.carres_supplier_users set perms = jsonb_set(perms, '{operation}', '["v_pickups"]'::jsonb) where id = ${anaId}`;
      try {
        expect((await call('/orders', ana)).status).toBe(403);
        expect((await call('/forecast', ana)).status).toBe(403);
        expect((await call('/pickups', ana)).status).toBe(200);
        expect((await post('/pickups/accept', ana, { ids: ['11111111-1111-4111-8111-111111111111'] })).status).toBe(403);
        expect((await call('/users?department=operation', ana)).status).toBe(403);
        const me = await (await call('/auth/me', ana)).json() as { user: { perms: { operation: string[] } } };
        expect(me.user.perms.operation).toEqual(['v_pickups']);
      } finally {
        await sql`update public.carres_supplier_users set perms = jsonb_set(perms, '{operation}', ${JSON.stringify(['v_orders', 'v_forecast', 'v_pickups', 'a_accept', 'a_collect', 'a_date', 'a_cancel', 'a_export', 'a_users'])}::text::jsonb) where id = ${anaId}`;
      }
      expect((await call('/orders', ana)).status).toBe(200);
    });

    let benId = 0;
    let caraId = 0;
    const mails: Array<{ to: string; mail: Mail }> = [];

    test('an admin adds people to their own department; an email has one account in the whole platform', async () => {
      const made = await post('/users', ana, {
        department: 'operation', name: '  Ben   Wh ', email: 'Ben@ZZT.test', how: 'password', password: 'a long enough pass', mustChange: true,
        perms: ['v_orders', 'v_pickups', 'a_accept', 'a_date', 'v_coll'],
      });
      expect(made.status).toBe(200);
      const body = await made.json() as { user: { id: number; name: string; email: string; status: string; perms: string[]; self: boolean }; mailed: unknown };
      benId = body.user.id;
      expect(body).toMatchObject({ user: { name: 'Ben Wh', email: 'ben@zzt.test', status: 'active', self: false, perms: ['v_orders', 'v_pickups', 'a_accept', 'a_date'] }, mailed: null });
      const row = await sql`select can_operation, can_finance, must_change_password, perms::text as perms from public.carres_supplier_users where id = ${benId}`;
      expect(row[0]).toMatchObject({ can_operation: true, can_finance: false, must_change_password: true });
      expect(JSON.parse(String(row[0]!.perms))).toEqual({ operation: ['v_orders', 'v_pickups', 'a_accept', 'a_date'], finance: [] });

      // Taken anywhere: this company, another company, Carres staff. The answer never names the other company.
      for (const email of ['ben@zzt.test', 'fin@zzt.test', 'ops@zzt-staff.test']) {
        const again = await post('/users', ana, { department: 'operation', name: 'Dup', email, how: 'password', password: 'a long enough pass', perms: [] });
        expect(again.status).toBe(409);
        const text = await again.text();
        expect(text).toContain('This email already has an account.');
        expect(text).not.toContain('ZZT SOFA MAKER');
      }
      expect((await post('/users', ana, { department: 'operation', name: 'Short', email: 'short@zzt.test', how: 'password', password: 'short', perms: [] })).status).toBe(400);
      // Ana manages Warehouse and Operation only.
      expect((await post('/users', ana, { department: 'finance', name: 'F', email: 'f2@zzt.test', how: 'invite', perms: [] })).status).toBe(403);
      expect((await post('/users', ana, { department: 'sales', name: 'F', email: 'f2@zzt.test', how: 'invite', perms: [] })).status).toBe(400);
    });

    test('an invite emails a link that chooses the first password, and the person reads as invited until then', async () => {
      const undo = useInviteDepsForTests({
        companyName: async () => 'ZZT Carres', mailOn: async () => true,
        send: async (_e, to, mail) => { mails.push({ to, mail }); return { status: 'sent' }; },
      });
      try {
        const made = await post('/users', ana, { department: 'operation', name: 'Cara Ops', email: 'cara@zzt.test', how: 'invite', perms: ['v_orders'] });
        expect(made.status).toBe(200);
        const body = await made.json() as { user: { id: number; status: string }; mailed: boolean; mailNote: unknown };
        caraId = body.user.id;
        expect(body).toMatchObject({ user: { status: 'invited' }, mailed: true, mailNote: null });
      } finally {
        undo();
      }
      expect(mails).toHaveLength(1);
      expect(mails[0]!.to).toBe('cara@zzt.test');
      expect(mails[0]!.mail.text).toContain('Ana Ops added you to the ZZT Carres supplier pages for ZZT MATTRESS MAKER.');
      const token = /#t=([A-Za-z0-9_-]+)/.exec(mails[0]!.mail.text)![1]!;
      expect(await readLink(db, token)).toMatchObject({ email: 'cara@zzt.test', purpose: 'setup' });
      // The link is in the email and nowhere else.
      expect((await sql`select count(*)::int as n from public.carres_supplier_events where detail::text like ${`%${token}%`}`)[0]!.n).toBe(0);

      // With supplier emails switched off, the person is added and the admin is told the email did not leave.
      const off = useInviteDepsForTests({ companyName: async () => 'ZZT Carres', mailOn: async () => false, send: async () => ({ status: 'sent' }) });
      try {
        const made = await post('/users', ana, { department: 'operation', name: 'Dan Ops', email: 'dan@zzt.test', how: 'invite', perms: [] });
        expect(await made.json()).toMatchObject({ mailed: false, mailNote: 'Supplier emails are switched off at Carres.' });
      } finally {
        off();
      }

      // Supplier A's Warehouse and Operation people, by name; the Finance person of another company is not among them.
      const list = await (await call('/users?department=operation', ana)).json() as { users: Array<{ email: string; status: string; self: boolean }> };
      expect(list.users.map((u) => [u.email, u.status, u.self])).toEqual([
        ['ana@zzt.test', 'active', true], ['ben@zzt.test', 'active', false], ['cara@zzt.test', 'invited', false], ['dan@zzt.test', 'invited', false],
        ['nina@zzt.test', 'invited', false], ['rita@zzt.test', 'active', false],
      ]);
      expectClean(list);
    });

    test('a person given a password chooses their own before anything else answers', async () => {
      const ben = await signedIn('ben@zzt.test', 'a long enough pass');
      const me = await (await call('/auth/me', ben)).json() as { user: { mustChangePassword: boolean } };
      expect(me.user.mustChangePassword).toBe(true);
      const refused = await call('/orders', ben);
      expect(refused.status).toBe(403);
      expect(await refused.json()).toEqual({ error: 'Choose a new password first.', code: 'must_change_password' });
      const changed = await post('/auth/password', ben, { current: 'a long enough pass', next: PASSWORD });
      expect(changed.status).toBe(200);
      const fresh = (await changed.json() as { token: string }).token;
      expect((await call('/orders', fresh)).status).toBe(200);
      expect((await (await call('/auth/me', fresh)).json() as { user: { mustChangePassword: boolean } }).user.mustChangePassword).toBe(false);
      // Ben holds no Forecast and no Manage users.
      expect((await call('/forecast', fresh)).status).toBe(403);
      expect((await call('/users?department=operation', fresh)).status).toBe(403);
    });

    test('an admin cannot take away their own Manage users or remove themselves; removing takes access away', async () => {
      expect((await patch(`/users/${anaId}`, ana, { department: 'operation', perms: ['v_orders'] })).status).toBe(400);
      expect((await post(`/users/${anaId}/remove`, ana, { department: 'operation' })).status).toBe(400);
      const renamed = await patch(`/users/${benId}`, ana, { department: 'operation', name: 'Ben Warehouse', perms: ['v_pickups', 'a_accept', 'a_export'] });
      expect(await renamed.json()).toMatchObject({ user: { name: 'Ben Warehouse', perms: ['v_pickups', 'a_accept', 'a_export'] } });
      // Another company's person is not this admin's to change: it reads as not found.
      const finB = Number((await sql`select id from public.carres_supplier_users where email = 'fin@zzt.test'`)[0]!.id);
      expect((await patch(`/users/${finB}`, ana, { department: 'operation', name: 'X' })).status).toBe(404);

      const ben = await signedIn('ben@zzt.test');
      expect((await post(`/users/${benId}/remove`, ana, { department: 'operation' })).status).toBe(200);
      expect((await call('/auth/me', ben)).status).toBe(401);
      expect((await sql`select status from public.carres_supplier_users where id = ${benId}`)[0]!.status).toBe('disabled');

      // A person in both departments keeps the other one.
      expect((await updatePerson(db, caraId, { canFinance: true }, staffId)).ok).toBe(true);
      expect((await post(`/users/${caraId}/remove`, ana, { department: 'operation' })).status).toBe(200);
      const cara = await sql`select status, can_operation, can_finance, perms::text as perms from public.carres_supplier_users where id = ${caraId}`;
      expect(cara[0]).toMatchObject({ status: 'active', can_operation: false, can_finance: true });
      expect(JSON.parse(String(cara[0]!.perms))).toEqual({ operation: [], finance: ['v_coll', 'v_month', 'd_names', 'd_share', 'd_bad', 'a_export', 'a_stmt', 'a_users'] });
    });

    let r1 = '';
    let r2 = '';
    let r3 = '';

    test('accepting several requests is all or none', async () => {
      const lines = await eligibleLines(db, supA);
      const king = lines.find((l) => l.soDocNo === 'ZZT-SO-2')!.soItemId;
      const eight = lines.filter((l) => l.soDocNo === 'ZZT-SO-8').map((l) => l.soItemId);
      expect(eight).toHaveLength(2);
      const make = async (ids: string[]) => {
        const out = await createPickup(db, { supplierId: supA, expectedDate: inDays(5), soItemIds: ids }, actor, todayMyt());
        if (!out.ok) throw new Error(out.error);
        return out.pickup;
      };
      r1 = (await make([king])).id;
      r2 = (await make([eight[0]!])).id;
      const p3 = await make([eight[1]!]);
      r3 = p3.id;
      expect(p3.orders).toEqual([{ docNo: 'ZZT-SO-8', customerName: 'ZZT Customer Eight' }]);
      expect((await cancelPickup(db, r3, 'Not needed', actor)).ok).toBe(true);

      const refused = await post('/pickups/accept', ana, { ids: [r1, r3] });
      expect(refused.status).toBe(409);
      expect((await refused.json() as { error: string }).error).toContain(p3.requestNo);
      expect((await getSupplierPickup(db, r1, supA))!.status).toBe('REQUESTED');
      expect((await post('/pickups/accept', ana, { ids: [] })).status).toBe(400);

      const ok = await post('/pickups/accept', ana, { ids: [r1, r2] });
      expect(ok.status).toBe(200);
      const body = await ok.json() as { pickups: Array<{ id: string; status: string; acceptedByName: string }> };
      expect(body.pickups.map((p) => [p.id, p.status, p.acceptedByName])).toEqual([[r1, 'ACCEPTED', 'Ana Ops'], [r2, 'ACCEPTED', 'Ana Ops']]);
      expectClean(body);
    });

    test('the supplier asks to move or cancel; nothing moves until Carres answers', async () => {
      expect((await post(`/pickups/${r1}/ask`, ana, { kind: 'date', date: inDays(-1) })).status).toBe(400);
      expect((await post(`/pickups/${r1}/ask`, ana, { kind: 'date', date: inDays(5) })).status).toBe(400);
      expect((await post(`/pickups/${r1}/ask`, ana, { kind: 'later' })).status).toBe(400);
      const asked = await post(`/pickups/${r1}/ask`, ana, { kind: 'date', date: inDays(9) });
      expect(asked.status).toBe(200);
      const a = (await asked.json() as { pickup: { expectedDate: string; ask: unknown } }).pickup;
      expect(a.expectedDate).toBe(inDays(5));
      expect(a.ask).toMatchObject({ kind: 'date', date: inDays(9), askedByName: 'Ana Ops' });
      expect((await post(`/pickups/${r1}/ask`, ana, { kind: 'cancel' })).status).toBe(409);
      expect((await post(`/pickups/${r1}/ask/withdraw`, ana, {})).status).toBe(200);
      expect((await getSupplierPickup(db, r1, supA))!.ask).toBeNull();
      expect((await post(`/pickups/${r1}/ask/withdraw`, ana, {})).status).toBe(409);

      expect((await post(`/pickups/${r1}/ask`, ana, { kind: 'date', date: inDays(9) })).status).toBe(200);
      const staffList = await listPickups(db, { supplierId: supA, asked: true });
      expect(staffList.map((p) => p.id)).toEqual([r1]);
      // The portal's Alerts bell reads the same ask, through its signed call, with only what the bell shows.
      const waiting = await waitingAsks(db);
      expect(waiting.count).toBe(1);
      expect(waiting.asks).toEqual([{
        id: r1, requestNo: expect.stringMatching(/^CR-PKR-\d{4}-\d{3}$/), supplierName: 'ZZT MATTRESS MAKER', kind: 'date',
        askDate: inDays(9), expectedDate: inDays(5), askedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/),
      }]);
      expect(await portalAsks()).toEqual({ status: 200, body: waiting });
      const approved = await answerPickupAsk(db, r1, { approve: true }, actor);
      // Answered, it leaves the bell: the bell keeps no copy of an ask.
      expect(await waitingAsks(db)).toEqual({ count: 0, asks: [] });
      expect(approved).toMatchObject({
        ok: true,
        pickup: { expectedDate: inDays(9), previousExpectedDate: inDays(5), expectedTime: null, ask: null, answer: { kind: 'date', approved: true, byName: 'ZZT Staff Member' } },
      });
      expect(await answerPickupAsk(db, r1, { approve: true }, actor)).toMatchObject({ ok: false, status: 409 });
      const seen = (await getSupplierPickup(db, r1, supA))!;
      expect(seen.answer).toEqual({ kind: 'date', approved: true, date: inDays(9), answeredAt: expect.any(String), reason: null });
      expectClean(seen);
      const order = (await getOrder(db, supA, 'ZZT-SO-2'))!;
      expect(order.trail.filter((t) => t.code === 'PICKUP_DATE_CHANGED').map((t) => t.detail)).toEqual([inDays(9)]);

      // A cancel Carres declines leaves the request as it was, and the supplier reads why.
      expect((await post(`/pickups/${r2}/ask`, ana, { kind: 'cancel' })).status).toBe(200);
      expect(await answerPickupAsk(db, r2, { approve: false, reason: 'Lorry already booked' }, actor)).toMatchObject({
        ok: true, pickup: { status: 'ACCEPTED', ask: null, answer: { kind: 'cancel', approved: false, reason: 'Lorry already booked' } },
      });
      // A cancel Carres approves cancels the request and frees its lines.
      expect((await post(`/pickups/${r2}/ask`, ana, { kind: 'cancel' })).status).toBe(200);
      expect((await getSupplierPickup(db, r2, supA))!.answer).toBeNull();
      expect(await answerPickupAsk(db, r2, { approve: true }, actor)).toMatchObject({
        ok: true, pickup: { status: 'CANCELLED', cancelledBySupplier: true, cancelReason: 'Asked by the supplier', ask: null },
      });
      const freed = (await getSupplierPickup(db, r2, supA))!.lines[0]!.soItemId;
      expect((await eligibleLines(db, supA)).map((l) => l.soItemId)).toContain(freed);
      // Only an accepted request can be asked about.
      expect((await post(`/pickups/${r2}/ask`, ana, { kind: 'cancel' })).status).toBe(409);
    });

    test('marking collected needs the Delivery Order, a real PDF, and moves all or none', async () => {
      const stored = new Map<string, Uint8Array>();
      const bucket = {
        put: async (key: string, value: Uint8Array) => { stored.set(key, value); },
        get: async (key: string) => (stored.has(key) ? { body: new Blob([stored.get(key)!]).stream() } : null),
        delete: async (key: string) => { stored.delete(key); },
      };
      const withFiles = { POD_BUCKET: bucket } as unknown as Env;
      const pdf = (text: string) => new File([`%PDF-1.7\n${text}`], `${text}.pdf`, { type: 'application/pdf' });
      const upload = (form: FormData) => call('/pickups/collect', ana, { method: 'POST', body: form }, withFiles);
      const formOf = (ids: string[], mode: string, files: Record<string, File>) => {
        const f = new FormData();
        f.set('ids', JSON.stringify(ids));
        f.set('mode', mode);
        for (const [k, v] of Object.entries(files)) f.set(k, v);
        return f;
      };

      // A request still waiting to be accepted cannot be marked: nothing is stored.
      const r4 = (await createPickup(db, { supplierId: supA, expectedDate: inDays(6), soItemIds: [(await eligibleLines(db, supA)).find((l) => l.soDocNo === 'ZZT-SO-8')!.soItemId] }, actor, todayMyt()) as { pickup: { id: string } }).pickup.id;
      expect((await upload(formOf([r1, r4], 'one', { file: pdf('DO-ALL') }))).status).toBe(409);
      expect(stored.size).toBe(0);
      // Not a PDF, or no file at all: refused.
      expect((await upload(formOf([r1], 'one', { file: new File(['<html></html>'], 'DO.pdf', { type: 'application/pdf' }) }))).status).toBe(400);
      expect((await upload(formOf([r1], 'one', {}))).status).toBe(400);
      expect((await upload(formOf([r1], 'each', { file: pdf('DO-ONE') }))).status).toBe(400);
      // Larger than a Delivery Order may be.
      const big = new File([new Uint8Array(10 * 1024 * 1024 + 1).fill(0x25)], 'big.pdf', { type: 'application/pdf' });
      expect((await upload(formOf([r1], 'one', { file: big }))).status).toBe(413);
      expect(stored.size).toBe(0);
      // Without the file store bound, nothing is pretended.
      expect((await call('/pickups/collect', ana, { method: 'POST', body: formOf([r1], 'one', { file: pdf('DO-ALL') }) })).status).toBe(503);

      expect((await post('/pickups/accept', ana, { ids: [r4] })).status).toBe(200);
      const done = await upload(formOf([r1, r4], 'each', { [`file_${r1}`]: pdf('DO-0001'), [`file_${r4}`]: pdf('DO-0002') }));
      expect(done.status).toBe(200);
      const body = await done.json() as { pickups: Array<{ id: string; status: string; collectedBySupplierName: string; deliveryOrder: { name: string } }> };
      expect(body.pickups.map((p) => [p.status, p.collectedBySupplierName, p.deliveryOrder.name])).toEqual([
        ['COLLECTED', 'Ana Ops', 'DO-0001.pdf'], ['COLLECTED', 'Ana Ops', 'DO-0002.pdf'],
      ]);
      expect([...stored.keys()].every((k) => k.startsWith(`carres-supplier-do/${supA}/`))).toBe(true);
      expect(stored.size).toBe(2);
      expectClean(body, ['carres-supplier-do']);

      const file = await call(`/pickups/${r1}/do`, ana, {}, withFiles);
      expect(file.status).toBe(200);
      expect(file.headers.get('Content-Type')).toBe('application/pdf');
      expect(file.headers.get('Content-Disposition')).toContain('DO-0001.pdf');
      expect(await file.text()).toBe('%PDF-1.7\nDO-0001');
      // Another supplier's file is not found; a request with no file has none.
      expect(await deliveryOrderFile(db, r1, supB)).toBeNull();
      expect((await call(`/pickups/${r2}/do`, ana, {}, withFiles)).status).toBe(404);
      // Already collected: a second press changes nothing.
      expect((await upload(formOf([r1], 'one', { file: pdf('DO-AGAIN') }))).status).toBe(409);
      expect(stored.size).toBe(2);
    });

    test('Carres answers asks and reads the Delivery Order from its own pickup page', async () => {
      const owner = new Hono<{ Bindings: Env }>();
      owner.use('*', async (c, next) => { c.set('user' as never, { id: staffId, name: 'Owner', permissions: ['*'], permissions_set: new Set(['*']), page_access: {} } as never); await next(); });
      owner.route('/pickups', supplierPickups);
      const viewer = new Hono<{ Bindings: Env }>();
      viewer.use('*', async (c, next) => { c.set('user' as never, { id: staffId, name: 'Viewer', permissions: [], permissions_set: new Set<string>(), page_access: { 'scm.procurement.po': 'view' } } as never); await next(); });
      viewer.route('/pickups', supplierPickups);
      expect((await viewer.request(`/pickups/${r1}/ask/approve`, { method: 'POST' }, env)).status).toBe(403);
      expect((await viewer.request(`/pickups/${r1}/ask/decline`, { method: 'POST' }, env)).status).toBe(403);
      expect((await owner.request(`/pickups/${r1}/ask/approve`, { method: 'POST' }, env)).status).toBe(409);
      const asked = await owner.request('/pickups?asked=1', {}, env);
      expect(asked.status).toBe(200);
    });

    test('Finance figures leave without what a person may not see', async () => {
      const made = await addPerson(db, supA, { name: 'Fin A', email: 'fina@zzt.test', canOperation: false, canFinance: true }, staffId);
      if (!made.ok) throw new Error(made.error);
      expect((await useLink(db, { token: made.link.token, password: PASSWORD, ip: null })).ok).toBe(true);
      const fin = await signedIn('fina@zzt.test');
      const portal = {
        asOf: '2026-11-16',
        totals: { orders: 1, contractValue: 1200, shareTotal: 588, collected: 300, collectedCount: 3, shareEarned: 147, toCollect: 900, shareToCome: 441, overdueOrders: 1, overdueMonths: 1, overdueAmount: 100, overdueShare: 49, defaultOrders: 0 },
        months: [{ month: '2026-09', due: 100, dueShare: 49, collected: 0, collectedShare: 0, open: 100, openShare: 49 }],
        orders: [{
          id: '22222222-2222-4222-8222-222222222222', agreementNo: 'RA-ZZT', soNo: 'ZZT-SO-1', customerName: 'ZZT Customer One', item: 'Cloud',
          termMonths: 12, monthlyFee: 100, ratePct: 49, startDate: '2026-06-07', status: 'active', state: 'behind', contractValue: 1200,
          shareTotal: 588, paidCount: 3, collected: 300, shareEarned: 147, toCollect: 900, shareToCome: 441, overdueMonths: 1,
          overdueAmount: 100, overdueShare: 49, nextDueDate: '2026-09-07', lastPaidOn: '2026-08-07',
          schedule: [
            { seq: 3, dueDate: '2026-08-07', state: 'paid', amountDue: 100, share: 49, paidOn: '2026-08-07' },
            { seq: 4, dueDate: '2026-09-07', state: 'late', amountDue: 100, share: 49, paidOn: null },
            { seq: 5, dueDate: '2026-12-07', state: 'upcoming', amountDue: 100, share: 49, paidOn: null },
          ],
        }],
      };
      const withPortal = {
        CARRES_SSO_SECRET: 's'.repeat(32), CARRES_PORTAL_API: 'https://portal.test',
        CARRES_PORTAL: { fetch: async () => new Response(JSON.stringify(portal), { headers: { 'content-type': 'application/json' } }) },
      } as unknown as Env;

      const full = await (await call('/finance/summary', fin, {}, withPortal)).json() as Record<string, unknown> & { visible: unknown; orders: Array<Record<string, unknown>> };
      expect(full.visible).toEqual({ names: true, share: true, bad: true });
      expect(full.orders[0]).toMatchObject({ customerName: 'ZZT Customer One', shareEarned: 147, state: 'behind', overdueMonths: 1 });

      const finId = Number((await sql`select id from public.carres_supplier_users where email = 'fina@zzt.test'`)[0]!.id);
      await sql`update public.carres_supplier_users set perms = jsonb_set(perms, '{finance}', '["v_month"]'::jsonb) where id = ${finId}`;
      const narrow = await (await call('/finance/summary', fin, {}, withPortal)).json() as Record<string, unknown> & { visible: unknown; orders: Array<Record<string, unknown> & { schedule: Array<{ state: string; share: number }> }> };
      expect(narrow.visible).toEqual({ names: false, share: false, bad: false });
      expect(narrow.orders[0]).toMatchObject({ customerName: '', shareEarned: 0, ratePct: 0, state: 'open', overdueMonths: 0, overdueAmount: 0, nextDueDate: '2026-12-07' });
      expect(narrow.orders[0]!.schedule.map((r) => [r.state, r.share])).toEqual([['paid', 0], ['unpaid', 0], ['upcoming', 0]]);
      expect(JSON.stringify(narrow)).not.toContain('ZZT Customer One');
      // With neither Finance page on, no figure answers at all.
      await sql`update public.carres_supplier_users set perms = jsonb_set(perms, '{finance}', '["d_names","d_share"]'::jsonb) where id = ${finId}`;
      expect((await call('/finance/summary', fin, {}, withPortal)).status).toBe(403);
    });
  });

  describe('closed to the data API', () => {
    test('anon and authenticated can read none of the platform\'s tables', async () => {
      const tables = ['carres_supplier_access', 'carres_supplier_access_scope', 'carres_supplier_users', 'carres_supplier_sessions',
        'carres_supplier_links', 'carres_supplier_events', 'carres_pickup_requests', 'carres_pickup_request_lines', 'carres_pickup_request_counters'];
      for (const role of ['anon', 'authenticated']) {
        for (const t of tables) {
          const rows = await sql.unsafe(`select has_table_privilege('${role}', 'public.${t}', 'SELECT') as can,
            (select relrowsecurity from pg_class where oid = 'public.${t}'::regclass) as rls`);
          expect({ role, t, can: rows[0]!.can, rls: rows[0]!.rls }).toEqual({ role, t, can: false, rls: true });
        }
      }
    });

    test('nobody but the engine may run the two functions that decide what a supplier reads', async () => {
      for (const fn of ['public.carres_supplier_scope_items(uuid)', 'public.carres_supplier_scope_orders(uuid)']) {
        // `public` here is every role there is or will be.
        for (const role of ['public', 'anon', 'authenticated']) {
          const rows = await sql.unsafe(`select has_function_privilege('${role}', '${fn}', 'EXECUTE') as can`);
          expect({ fn, role, can: rows[0]!.can }).toEqual({ fn, role, can: false });
        }
      }
    });
  });
});
