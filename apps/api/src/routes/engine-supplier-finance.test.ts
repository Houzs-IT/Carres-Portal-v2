import { describe, it, expect, beforeEach, vi } from "vitest";

// One fake service-role client: the agreement rows it holds, and every read asked of it.
type Row = Record<string, unknown>;
let agreements: Row[];
let skus: Row[];
let reads: Array<{ table: string; columns: string; filters: string[] }>;

function from(table: string) {
  const read = { table, columns: "", filters: [] as string[] };
  reads.push(read);
  let idEq: string | null = null;
  let range: [number, number] | null = null;
  const rowsNow = () => {
    const all = table === "rental_agreements" ? agreements : table === "product_skus" ? skus : [];
    const byId = idEq ? all.filter((r) => r.id === idEq) : all;
    return range ? byId.slice(range[0], range[1] + 1) : byId;
  };
  const q = {
    select: (columns: string) => { read.columns = columns; return q; },
    eq: (c: string, v: string) => { read.filters.push(`eq:${c}`); if (c === "id") idEq = v; return q; },
    gt: (c: string, v: number) => { read.filters.push(`gt:${c}:${v}`); return q; },
    not: (c: string, op: string, v: string) => { read.filters.push(`not:${c}:${op}:${v}`); return q; },
    in: (c: string) => { read.filters.push(`in:${c}`); return q; },
    order: () => q,
    range: (a: number, b: number) => { range = [a, b]; return q; },
    maybeSingle: async () => ({ data: rowsNow()[0] ?? null, error: null }),
    then: (resolve: (v: { data: Row[]; error: null }) => unknown) => resolve({ data: rowsNow(), error: null }),
  };
  return q;
}
vi.mock("../lib/supabase", () => ({ adminClient: () => ({ from }) }));

import app from "../index";
import { signStaffRequest } from "./engine-staff-accounts";
import { signFinanceRequest, verifyFinanceRequest } from "./engine-supplier-finance";

const SECRET = "s".repeat(32);
const env = {
  SUPABASE_URL: "https://test.supabase.co",
  SUPABASE_ANON_KEY: "a",
  SUPABASE_SERVICE_ROLE_KEY: "svc",
  SUPABASE_JWT_SECRET: "unused",
  STAFF_SESSION_SECRET: "x".repeat(32),
  SCM_ENGINE_SSO_SECRET: SECRET,
};

const ID = "11111111-1111-4111-8111-111111111111";

/** An agreement as the database could answer it, with columns a supplier must never read planted in it. */
const agreementRow = (over: Row = {}): Row => ({
  id: ID, agreement_no: "RA-7", sku: "CLOUD-Q", term_months: 3, monthly_fee: 59, supplier_rate_pct: 49, start_date: "2026-09-07",
  status: "active",
  customers: { name: "Tan Ah Kow", phone: "0127770001", email: "secret@customer.test", stripe_customer_id: "cus_SECRET" },
  orders: { so: 321, customer_phone: "0127770001" },
  rental_billings: [
    { seq: 1, due_date: "2026-09-07", amount_due: 59, status: "paid", paid_at: "2026-09-07T17:30:00Z", paid_amount: 59, supplier_share: 28.91, commission_share: 11.8, stripe_invoice_id: "in_SECRET", reference: "REF-SECRET", method: "stripe" },
    { seq: 2, due_date: "2026-10-07", amount_due: 59, status: "due", paid_at: null, paid_amount: null, supplier_share: null, commission_share: null, stripe_invoice_id: null, reference: null, method: null },
    { seq: 3, due_date: "2099-11-07", amount_due: 59, status: "due", paid_at: null, paid_amount: null, supplier_share: null },
  ],
  stripe_subscription_id: "sub_SECRET", signed_nric: "900101-10-SECRET", commission_base_pct: 20, signature_path: "sig/SECRET.png",
  ...over,
});

async function call(payload: object, opts: { secret?: string; now?: number; sign?: typeof signFinanceRequest; body?: string } = {}) {
  const body = JSON.stringify(payload);
  const { ts, signature } = await (opts.sign ?? signFinanceRequest)(opts.secret ?? SECRET, body, opts.now);
  return app.fetch(
    new Request("http://t/engine/supplier-finance", {
      method: "POST",
      headers: { "content-type": "application/json", "x-carres-engine-ts": ts, "x-carres-engine-signature": signature },
      body: opts.body ?? body,
    }),
    env,
  );
}

beforeEach(() => {
  agreements = [agreementRow()];
  skus = [{ sku: "CLOUD-Q", description: "Cloud Mattress Queen" }];
  reads = [];
});

describe("trust: only the engine Worker, with the shared secret", () => {
  it("401 with no signature, a wrong secret, a changed body or an old timestamp", async () => {
    const bare = await app.fetch(new Request("http://t/engine/supplier-finance", { method: "POST", body: JSON.stringify({ view: "summary" }) }), env);
    expect(bare.status).toBe(401);
    expect((await call({ view: "summary" }, { secret: "w".repeat(32) })).status).toBe(401);
    expect((await call({ view: "summary" }, { body: JSON.stringify({ view: "agreement", id: ID }) })).status).toBe(401);
    expect((await call({ view: "summary" }, { now: Date.now() - 5 * 60_000 })).status).toBe(401);
    expect(reads).toEqual([]);
  });

  it("a signature made for staff accounts does not pass here", async () => {
    const res = await call({ view: "summary" }, { sign: signStaffRequest });
    expect(res.status).toBe(401);
    expect(reads).toEqual([]);
  });

  it("503 while the shared secret is not set", async () => {
    const res = await app.fetch(new Request("http://t/engine/supplier-finance", { method: "POST", body: "{}" }), { ...env, SCM_ENGINE_SSO_SECRET: "" });
    expect(res.status).toBe(503);
  });

  it("the signature is bound to its purpose word", async () => {
    const body = JSON.stringify({ view: "summary" });
    const { ts, signature } = await signFinanceRequest(SECRET, body);
    expect(await verifyFinanceRequest(SECRET, ts, signature, body)).toBe(true);
    const staff = await signStaffRequest(SECRET, body);
    expect(await verifyFinanceRequest(SECRET, staff.ts, staff.signature, body)).toBe(false);
  });

  it("there is no way in without a signature: GET and the signed-in API do not serve it", async () => {
    expect((await app.fetch(new Request("http://t/engine/supplier-finance"), env)).status).toBe(404);
    expect((await app.fetch(new Request("http://t/api/engine/supplier-finance", { method: "POST", body: "{}" }), env)).status).toBe(401);
  });
});

describe("what leaves", () => {
  const FORBIDDEN = ["stripe", "reference", "method", "commission", "nric", "phone", "email", "signature", "signed_", "address", "notes"];

  it("asks the database only for the shared columns, of approved agreements that pay a supplier share", async () => {
    const res = await call({ view: "summary" });
    expect(res.status).toBe(200);
    const read = reads.find((r) => r.table === "rental_agreements")!;
    for (const word of FORBIDDEN) expect(read.columns).not.toContain(word);
    expect(read.filters).toEqual(["gt:supplier_rate_pct:0", "not:status:in:(pending_approval,rejected)"]);
  });

  it("answers the figures and nothing planted beside them", async () => {
    const res = await call({ view: "summary" });
    const body = await res.json() as { totals: Record<string, number>; orders: Array<Record<string, unknown>> };
    const text = JSON.stringify(body);
    for (const secret of ["SECRET", "0127770001", "secret@customer.test", "11.8"]) expect(text).not.toContain(secret);
    expect(body.orders).toHaveLength(1);
    expect(body.orders[0]).toMatchObject({
      agreementNo: "RA-7", soNo: "SO-321", customerName: "Tan Ah Kow", item: "Cloud Mattress Queen", termMonths: 3, ratePct: 49,
      paidCount: 1, collected: 59, shareEarned: 28.91, toCollect: 118, shareToCome: 57.82, overdueMonths: 1, overdueAmount: 59,
      // 17:30 UTC on the 7th is the 8th in Kuala Lumpur.
      lastPaidOn: "2026-09-08", state: "behind",
    });
    expect(body.totals).toMatchObject({ orders: 1, contractValue: 177, shareTotal: 86.73, overdueOrders: 1 });
  });

  it("one order's schedule, month by month", async () => {
    const res = await call({ view: "agreement", id: ID });
    expect(res.status).toBe(200);
    const body = await res.json() as { order: { agreementNo: string }; instalments: Array<Record<string, unknown>> };
    expect(body.order.agreementNo).toBe("RA-7");
    expect(body.instalments.map((i) => i.state)).toEqual(["paid", "late", "upcoming"]);
    expect(Object.keys(body.instalments[0]!).sort()).toEqual(["amountDue", "daysLate", "dueDate", "paidAmount", "paidOn", "seq", "share", "state"]);
    expect(JSON.stringify(body)).not.toContain("SECRET");
  });

  it("404 for an order that is not there, has no schedule, or an id that is not one", async () => {
    expect((await call({ view: "agreement", id: "22222222-2222-4222-8222-222222222222" })).status).toBe(404);
    expect((await call({ view: "agreement", id: "1 or 1=1" })).status).toBe(404);
    agreements = [agreementRow({ rental_billings: [] })];
    expect((await call({ view: "agreement", id: ID })).status).toBe(404);
    expect((await call({ view: "everything" })).status).toBe(422);
  });

  it("an agreement with no schedule is not an order yet", async () => {
    agreements = [agreementRow(), agreementRow({ id: "33333333-3333-4333-8333-333333333333", agreement_no: "RA-8", rental_billings: [] })];
    const body = await (await call({ view: "summary" })).json() as { orders: Array<{ agreementNo: string }> };
    expect(body.orders.map((o) => o.agreementNo)).toEqual(["RA-7"]);
  });
});
