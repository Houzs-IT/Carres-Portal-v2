import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Hono } from 'hono';
import postgres, { type Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { assertDisposableTestDatabase } from './lib/doc-no-fixture';
import { dbOver, useDbForTests, type Db } from '../src/carres/supplier/db';
import { addPerson, getAccess, previewAccess, saveAccess } from '../src/carres/supplier/access';
import { getForecast, getOrder, listOrders } from '../src/carres/supplier/orders';
import { acceptPickup, cancelPickup, collectPickup, createPickup, eligibleLines, getPickup, getSupplierPickup, listSupplierPickups } from '../src/carres/supplier/pickups';
import { changePassword, issueLink, resolveSession, signIn, useLink } from '../src/carres/supplier/session';
import { MAX_FAILS_PER_EMAIL, WORKER_SUBREQUEST_ADDRESS, sha256Hex } from '../src/carres/supplier/credentials';
import supplierApp from '../src/carres/supplier/routes';
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
  // A database built earlier: run this step again. It is written to be re-run, and running it here means the
  // functions and grants under test are the ones in the file, not the ones an older build left behind.
  const files = (await readdir(migrationsDir)).filter((x) => x.endsWith('_supplier_platform.sql'));
  if (files.length !== 1) throw new Error(`expected one *_supplier_platform.sql, found ${files.length}`);
  await s.begin(async (tx) => { await tx.unsafe(await readFile(join(migrationsDir, files[0]!), 'utf8')); });
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
        'badges', 'badges.pickupsToAccept', 'supplier', 'supplier.code', 'supplier.name', 'user', 'user.canFinance', 'user.canOperation', 'user.email', 'user.name',
      ]);
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

    test('a new link is how Carres lets a locked person back in', async () => {
      // Still locked by the burst above.
      const person = await sql`select id from public.carres_supplier_users where email = 'ana@zzt.test'`;
      const link = await issueLink(db, { userId: Number(person[0]!.id), staffUserId: staffId });
      expect(link).not.toBeNull();
      expect(await useLink(db, { token: link!.token, password: PASSWORD, ip: null })).toMatchObject({ ok: true, email: 'ana@zzt.test' });
      expect((await signIn(db, { email: 'ana@zzt.test', password: PASSWORD, ip: null, userAgent: null })).ok).toBe(true);
      // The wrong tries are still on record. They only stopped counting.
      const kept = await sql`select count(*)::int as n from public.carres_supplier_events where kind = 'signin_failed' and subject = 'ana@zzt.test'`;
      expect(kept[0]!.n).toBeGreaterThanOrEqual(MAX_FAILS_PER_EMAIL);
      await sql`delete from public.carres_supplier_events where kind = 'signin_failed' and subject like '%@zzt.test'`;
    });

    test('a wrong current password is counted at its own door, and past the limit every session ends', async () => {
      const opened = await signIn(db, { email: 'ana@zzt.test', password: PASSWORD, ip: null, userAgent: null });
      expect(opened.ok).toBe(true);
      if (!opened.ok) return;
      // An outsider's wrong sign-ins lock the sign-in door for this email ...
      for (let i = 0; i < MAX_FAILS_PER_EMAIL; i++) {
        await signIn(db, { email: 'ana@zzt.test', password: 'not the password', ip: null, userAgent: null });
      }
      expect(await signIn(db, { email: 'ana@zzt.test', password: PASSWORD, ip: null, userAgent: null })).toMatchObject({ ok: false, status: 429 });
      // ... and do not throw out the person who is signed in: the session lives, and the right current password
      // still changes the password.
      expect(await resolveSession(db, opened.token)).not.toBeNull();
      const changed = await changePassword(db, opened.user, { current: PASSWORD, next: 'a brand new pass phrase', ip: null, userAgent: null });
      expect(changed.ok).toBe(true);
      if (!changed.ok) return;
      expect(await resolveSession(db, opened.token)).toBeNull();
      // Wrong current passwords: the limit's worth are answered, and the session is still there.
      for (let i = 0; i < MAX_FAILS_PER_EMAIL; i++) {
        expect(await changePassword(db, opened.user, { current: `a wrong guess ${i}`, next: 'whatever comes next', ip: null, userAgent: null }))
          .toMatchObject({ ok: false, status: 400 });
      }
      expect(await resolveSession(db, changed.token)).not.toBeNull();
      // One more try, even with the right password, ends every session: whoever is at that keyboard is guessing.
      expect(await changePassword(db, opened.user, { current: 'a brand new pass phrase', next: 'whatever comes next', ip: null, userAgent: null }))
        .toMatchObject({ ok: false, status: 401 });
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
        'acceptedAt', 'acceptedByName', 'cancelReason', 'cancelledAt', 'collectedAt', 'expectedDate', 'expectedTime', 'id', 'lineCount',
        'lines', 'note', 'requestNo', 'requestedAt', 'soDocNos', 'status', 'supplierName', 'unitCount',
      ]);
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
