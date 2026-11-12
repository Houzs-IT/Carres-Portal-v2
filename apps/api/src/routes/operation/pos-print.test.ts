import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { readFileSync } from "node:fs";
import { signTestJwt, useTestJwks } from "../../test/jwt";
import app from "../../index";
import { _setJwksForTesting } from "../../middleware/auth";

// 2026-08-02 — the route stopped assembling a priced payload and became a
// thin door over the money-free `purchasing_po_document` RPC (migration 0307,
// docs/pdf/PO-PDF-STANDARD.md). These tests mock the RPC and the three reads
// behind the two paper facts the route adds beside it (owner 2026-09-22).

vi.mock("../../lib/supabase", () => ({
  userClient: vi.fn(),
}));

import { userClient } from "../../lib/supabase";

const SUPABASE_URL = "https://test.supabase.co";
const PO_ID = "PO-9801";

const env = {
  SUPABASE_URL,
  SUPABASE_ANON_KEY: "test-anon",
  SUPABASE_SERVICE_ROLE_KEY: "test-service",
  SUPABASE_JWT_SECRET: "unused",
};

async function makeJwt(role: string) {
  return signTestJwt("11111111-1111-1111-1111-000000000999", {
    email: `${role}@carres.com`,
    app_metadata: { role },
  });
}

beforeEach(() => {
  useTestJwks();
  vi.mocked(userClient).mockReset();
});

afterAll(() => _setJwksForTesting(null));

/** The RPC's happy payload — money-free by construction (0307). */
function makeDocument(overrides: Record<string, unknown> = {}) {
  return {
    po_number: PO_ID,
    po_id: PO_ID,
    /* 0383 — the document authority carries EVERY fact the paper prints: its
       own version, the supplier's address, the real issuer, the Units it minted
       and which customer order each unit is for. The route adds none of them. */
    version: 1,
    issue_date: "2026-08-01",
    supplier: {
      name: "Ohana Furniture Sdn Bhd",
      address: "No 8, Jalan Industri, Muar, Johor",
      contact: "+60 3-1234 5678",
    },
    destination: { name: "Carres Klang", address: "Lot 12, Jalan Sungai Keramat, Klang" },
    delivery_instructions: "Call Jess 1 hour before arrival.",
    eta_date: "2026-08-12",
    so_refs: [4001],
    issued_by: "Yee Jin",
    lines: [
      {
        sku: "CODY-Q", description: "Queen", qty: 1, unit: "pc",
        attrs: { color: "Walnut", gap: '14"' },
        unit_codes: ["U1-000-001"],
        sources: [{ so: 4001, qty: 1 }],
      },
      {
        sku: "JAGER-K", description: "King", qty: 2, unit: "pc", attrs: {},
        unit_codes: ["U1-000-002", "U1-000-003"],
        sources: [{ so: 4001, qty: 2 }],
      },
    ],
    terms: null,
    ...overrides,
  };
}

function mockRpcAndRefs(opts: {
  document?: Record<string, unknown> | null;
  rpcError?: { code?: string; message?: string; details?: string };
  poRow?: { so: number | null; so_refs: number[] | null } | null;
}) {
  const rpc = vi.fn(() =>
    Promise.resolve(
      opts.rpcError
        ? { data: null, error: opts.rpcError }
        : { data: opts.document ?? makeDocument(), error: null },
    ),
  );
  const fromImpl = vi.fn(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chain: any = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn(() =>
        Promise.resolve({ data: opts.poRow === undefined ? { so: 4001, so_refs: [4001] } : opts.poRow, error: null }),
      ),
    };
    return chain;
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(userClient).mockReturnValue({ rpc, from: fromImpl } as any);
  return { rpc, fromImpl };
}

describe("GET /api/operation/pos/:id/print-data", () => {
  it("the governed repair reads the audit ledger's real occurred_at column", () => {
    const sql = readFileSync(
      new URL("../../../../../supabase/migrations/0402_the_po_document_carries_every_destination.sql", import.meta.url),
      "utf8",
    );
    expect(sql).toContain("order by occurred_at asc");
    expect(sql).not.toMatch(/from audit_log[\s\S]{0,160}order by created_at/);
  });

  it("the document authority returns each line's effective destination", () => {
    const sql = readFileSync(
      new URL("../../../../../supabase/migrations/0402_the_po_document_carries_every_destination.sql", import.meta.url),
      "utf8",
    );
    expect(sql).toContain("coalesce(l.destination_id, v_po.destination_id)");
    expect(sql).toMatch(/'destination'[\s\S]{0,500}'name'[\s\S]{0,500}'address'/);
  });

  it("200 — returns the document authority's answer, and adds nothing to it", async () => {
    const { rpc } = mockRpcAndRefs({});
    const jwt = await makeJwt("operation");
    const res = await app.fetch(
      new Request(`http://t/api/operation/pos/${PO_ID}/print-data`, {
        headers: { Authorization: `Bearer ${jwt}` },
      }),
      env,
    );
    expect(res.status).toBe(200);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body = (await res.json()) as any;
    expect(rpc).toHaveBeenCalledWith("purchasing_po_document", { p_po_id: PO_ID });
    expect(body.po_number).toBe(PO_ID);
    expect(body.destination.name).toBe("Carres Klang");
    expect(body.so_refs).toEqual([4001]);
    /* ⭐ THE REAL ISSUER. The route used to hard-code `null` over it. */
    expect(body.issued_by).toBe("Yee Jin");
    expect(body.version).toBe(1);
    expect(body.supplier.address).toBe("No 8, Jalan Industri, Muar, Johor");
    expect(body.lines).toHaveLength(2);
    /* ⭐ AND THE PER-LINE LINEAGE (0382), which is what feeds `SO NO` on a bulk
       purchase order instead of a blank column. */
    expect(body.lines[0].sources).toEqual([{ so: 4001, qty: 1 }]);
    expect(body.lines[0].unit_codes).toEqual(["U1-000-001"]);
  });

  it("?version=N answers with the KEPT document of that version, through its own authority", async () => {
    /* 0430 — a confirmed send freezes the document per version; reprinting an
       already-sent version reads THAT record, never a live reconstruction. */
    const { rpc } = mockRpcAndRefs({ document: makeDocument({ version: 2 }) });
    const jwt = await makeJwt("operation");
    const res = await app.fetch(
      new Request(`http://t/api/operation/pos/${PO_ID}/print-data?version=2`, {
        headers: { Authorization: `Bearer ${jwt}` },
      }),
      env,
    );
    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("purchasing_po_version_document", { p_po_id: PO_ID, p_version: 2 });
    expect(rpc).not.toHaveBeenCalledWith("purchasing_po_document", expect.anything());
  });

  it("?version=N on a version nobody kept is a NAMED absence, never a reconstruction", async () => {
    mockRpcAndRefs({
      rpcError: { code: "P0001", message: "No kept document", details: "version_document_missing" },
    });
    const jwt = await makeJwt("operation");
    const res = await app.fetch(
      new Request(`http://t/api/operation/pos/${PO_ID}/print-data?version=1`, {
        headers: { Authorization: `Bearer ${jwt}` },
      }),
      env,
    );
    expect(res.status).toBe(404);
    expect(((await res.json()) as { code: string }).code).toBe("version_document_missing");
  });

  it("?version rejects a non-integer before touching the database", async () => {
    const { rpc } = mockRpcAndRefs({});
    const jwt = await makeJwt("operation");
    const res = await app.fetch(
      new Request(`http://t/api/operation/pos/${PO_ID}/print-data?version=abc`, {
        headers: { Authorization: `Bearer ${jwt}` },
      }),
      env,
    );
    expect(res.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("re-reads NO fact the RPC answered — only the supplier's identity and week, to count what SQL cannot", async () => {
    const reads: Array<{ table: string; columns: string }> = [];
    const rpc = vi.fn(() => Promise.resolve({ data: makeDocument(), error: null }));
    const from = vi.fn((table: string) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const chain: any = {
        select: vi.fn((columns: string) => { reads.push({ table, columns }); return chain; }),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn(() => Promise.resolve({ data: table === "purchase_orders" ? { supplier_id: "sup-1" } : null, error: null })),
      };
      return chain;
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(userClient).mockReturnValue({ rpc, from } as any);
    const jwt = await makeJwt("operation");
    await app.fetch(
      new Request(`http://t/api/operation/pos/${PO_ID}/print-data`, {
        headers: { Authorization: `Bearer ${jwt}` },
      }),
      env,
    );
    /* A second read of so_refs / issuer / destination was a second truth about
       the same paper (0383). The only reads left are the three inputs of the
       two paper facts (owner 2026-09-22): nothing else, no other column. */
    expect(reads.sort((a, b) => a.table.localeCompare(b.table))).toEqual([
      { table: "purchase_orders", columns: "supplier_id, is_consignment" },
      { table: "purchasing_supplier_settings", columns: "off_days" },
      { table: "suppliers", columns: "kind" },
    ]);
  });

  it("200 — the payload is money-free: no price key, no total key, anywhere", async () => {
    mockRpcAndRefs({});
    const jwt = await makeJwt("operation");
    const res = await app.fetch(
      new Request(`http://t/api/operation/pos/${PO_ID}/print-data`, {
        headers: { Authorization: `Bearer ${jwt}` },
      }),
      env,
    );
    const raw = await res.text();
    // The whole wire body — keys and values — must never mention money.
    expect(raw).not.toMatch(/unit_price|line_total|grand_total|currency|"RM/i);
  });

  it("200 — CJK supplier name passes through unchanged", async () => {
    mockRpcAndRefs({
      document: makeDocument({
        supplier: { name: "海尔集团", address: null, contact: "+86 10 8888 8888" },
      }),
    });
    const jwt = await makeJwt("operation");
    const res = await app.fetch(
      new Request(`http://t/api/operation/pos/${PO_ID}/print-data`, {
        headers: { Authorization: `Bearer ${jwt}` },
      }),
      env,
    );
    expect(res.status).toBe(200);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body = (await res.json()) as any;
    expect(body.supplier.name).toBe("海尔集团");
  });

  it("422 — cancelled PO refused by the RPC", async () => {
    mockRpcAndRefs({
      rpcError: { code: "P0001", message: "PO PO-9801 is cancelled", details: "po_not_printable" },
    });
    const jwt = await makeJwt("operation");
    const res = await app.fetch(
      new Request(`http://t/api/operation/pos/${PO_ID}/print-data`, {
        headers: { Authorization: `Bearer ${jwt}` },
      }),
      env,
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string; code: string };
    expect(body.code).toBe("po_not_printable");
    expect(body.error).toBe("rule_violation");
  });

  it("422 — destination without an address is refused", async () => {
    mockRpcAndRefs({
      rpcError: { code: "P0001", message: "no address on file", details: "destination_address_missing" },
    });
    const jwt = await makeJwt("operation");
    const res = await app.fetch(
      new Request(`http://t/api/operation/pos/${PO_ID}/print-data`, {
        headers: { Authorization: `Bearer ${jwt}` },
      }),
      env,
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("destination_address_missing");
  });

  it("404 — PO does not exist", async () => {
    mockRpcAndRefs({
      rpcError: { code: "42P01", message: "PO PO-9801 not found", details: "po_not_found" },
    });
    const jwt = await makeJwt("operation");
    const res = await app.fetch(
      new Request(`http://t/api/operation/pos/${PO_ID}/print-data`, {
        headers: { Authorization: `Bearer ${jwt}` },
      }),
      env,
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("not_found");
  });

  it("403 — dealer role rejected (guard fires before any Supabase call)", async () => {
    const from = vi.fn();
    const rpc = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(userClient).mockReturnValue({ from, rpc } as any);
    const jwt = await makeJwt("dealer");
    const res = await app.fetch(
      new Request(`http://t/api/operation/pos/${PO_ID}/print-data`, {
        headers: { Authorization: `Bearer ${jwt}` },
      }),
      env,
    );
    expect(res.status).toBe(403);
    expect(from).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("401 — missing Authorization header", async () => {
    const res = await app.fetch(new Request(`http://t/api/operation/pos/${PO_ID}/print-data`), env);
    expect(res.status).toBe(401);
  });
});

/**
 * ⭐ THE TWO FACTS THE SQL DOCUMENT CANNOT DERIVE (owner 2026-09-22,
 * PO-PDF-STANDARD §2): `delivery_working_days` — the n of `PO {n}-Day Delivery
 * Date`, counted by the shared working-day engine on THIS supplier's week — and
 * `delivery_method`. Added beside the document; nothing it answered changes.
 */
describe("GET /api/operation/pos/:id/print-data — paper facts", () => {
  function mockTables(tables: Record<string, unknown>, document = makeDocument({ issue_date: "2026-09-21", eta_date: "2026-10-09" })) {
    const rpc = vi.fn(() => Promise.resolve({ data: document, error: null }));
    const from = vi.fn((table: string) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const chain: any = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn(() => Promise.resolve({ data: tables[table] ?? null, error: null })),
      };
      return chain;
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(userClient).mockReturnValue({ rpc, from } as any);
    return { rpc, from };
  }

  async function get(path = "") {
    const jwt = await makeJwt("operation");
    const res = await app.fetch(
      new Request(`http://t/api/operation/pos/${PO_ID}/print-data${path}`, { headers: { Authorization: `Bearer ${jwt}` } }),
      env,
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { res, body: (await res.json()) as any };
  }

  it("counts the supplier's working days PO Date → delivery date, and a delivering supplier reads supplier_delivers", async () => {
    mockTables({
      purchase_orders: { supplier_id: "sup-nf" },
      suppliers: { kind: "factory" },
      purchasing_supplier_settings: { off_days: [0, 6] },
    });
    const { res, body } = await get();
    expect(res.status).toBe(200);
    /* Mon 21 Sep → Fri 9 Oct 2026 on a Mon–Fri week, no public holiday between. */
    expect(body.delivery_working_days).toBe(14);
    expect(body.delivery_method).toBe("supplier_delivers");
    /* Nothing the document answered is overwritten. */
    expect(body.eta_date).toBe("2026-10-09");
    expect(body.issued_by).toBe("Yee Jin");
  });

  it("a collection supplier (factory_pickup) reads we_collect", async () => {
    mockTables({
      purchase_orders: { supplier_id: "sup-nf" },
      suppliers: { kind: "factory_pickup" },
      purchasing_supplier_settings: { off_days: [0, 6] },
    });
    const { body } = await get();
    expect(body.delivery_method).toBe("we_collect");
  });

  it("no delivery date → no number, never a guessed one", async () => {
    mockTables(
      { purchase_orders: { supplier_id: "sup-nf" }, suppliers: { kind: "factory" }, purchasing_supplier_settings: { off_days: [0, 6] } },
      makeDocument({ issue_date: "2026-09-21", eta_date: null }),
    );
    const { body } = await get();
    expect(body.delivery_working_days).toBeNull();
  });

  it("a Consignment Order adds its Unit Prices beside the document; two prices on one SKU print none (Weisiang 2026-10-22)", async () => {
    const rpc = vi.fn(() => Promise.resolve({ data: makeDocument(), error: null }));
    const lineRows = [{ sku: "CODY-Q", cost: "1200.00" }, { sku: "JAGER-K", cost: 800 }, { sku: "JAGER-K", cost: 900 }, { sku: "JAGER-K", cost: 800 }];
    const from = vi.fn((table: string) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const chain: any = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn(() => Promise.resolve({ data: table === "purchase_orders" ? { supplier_id: null, is_consignment: true } : null, error: null })),
        then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: table === "purchase_order_lines" ? lineRows : [], error: null }).then(ok),
      };
      return chain;
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(userClient).mockReturnValue({ rpc, from } as any);
    const { body } = await get();
    expect(body.consignment).toBe(true);
    expect(body.line_prices).toEqual({ "CODY-Q": 1200, "JAGER-K": null });
    expect(body.lines).toEqual(makeDocument().lines);
  });

  it("an ordinary PO stays money-free: no consignment facts", async () => {
    mockTables({ purchase_orders: { supplier_id: "sup-nf", is_consignment: false }, suppliers: { kind: "factory" } });
    const { body } = await get();
    expect(body).not.toHaveProperty("consignment");
    expect(body).not.toHaveProperty("line_prices");
  });

  it("a KEPT version reprints exactly what was sent — no paper facts are added to it", async () => {
    const kept = { ...makeDocument(), version: 1 };
    const rpc = vi.fn(() => Promise.resolve({ data: kept, error: null }));
    const from = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(userClient).mockReturnValue({ rpc, from } as any);
    const { body } = await get("?version=1");
    expect(body).not.toHaveProperty("delivery_working_days");
    expect(body).not.toHaveProperty("delivery_method");
    expect(from).not.toHaveBeenCalled();
  });
});
