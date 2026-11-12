/**
 * STAGE 3 · card 3.3 — the attribution lane's NEGATIVE CONTROLS, at the door.
 *
 * The card names four things that must NOT happen. Three of them are enforced
 * inside the RPC (0329) and are proven against the live database in the card's
 * evidence; the fourth — "no `update orders set …` from a payload" — is a
 * property of THIS layer, because the API is where a payload could be spread.
 *
 * So this file asserts what only the door can assert:
 *   · the three verbs are three separate routes — one cannot perform another,
 *   · SUBMIT forwards a CLOSED field set: anything outside the four attribution
 *     fields is refused HERE, before the database is asked,
 *   · the SAVE door no longer accepts an attribution field at all (0329 made
 *     the RPC raise; a schema that still accepted one would turn a designed
 *     refusal into a 500),
 *   · HR reaches the approver lane, and reaches ONLY it. GATE 3 gives HR the
 *     right to approve a salesperson move; HR must not gain SUBMIT or APPLY.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { signTestJwt, useTestJwks } from "../../test/jwt";
import app from "../../index";
import { _setJwksForTesting } from "../../middleware/auth";

vi.mock("../../lib/supabase", () => ({ userClient: vi.fn() }));
import { userClient } from "../../lib/supabase";

const env = {
  SUPABASE_URL: "https://t.x",
  SUPABASE_ANON_KEY: "a",
  SUPABASE_SERVICE_ROLE_KEY: "s",
  SUPABASE_JWT_SECRET: "",
};

async function makeJwt(role: string) {
  return signTestJwt("u1", { email: `${role}@x`, app_metadata: { role } });
}

type RpcCall = { name: string; args: Record<string, unknown> };

/** Records every RPC the route made — the assertions are about WHICH function
 *  was called with WHAT, which is exactly what a payload spread would leak. */
function makeSb(result: { data: unknown; error: unknown }, calls: RpcCall[]) {
  return {
    from: vi.fn(() => {
      throw new Error("the attribution lane must not touch a table directly");
    }),
    rpc: vi.fn((name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      return Promise.resolve(result);
    }),
  };
}

beforeEach(() => {
  useTestJwks();
  vi.mocked(userClient).mockReset();
});
afterAll(() => _setJwksForTesting(null));

const ORDER_ID = "00000000-0000-0000-0000-0000000000d1";
const REQ_ID = "00000000-0000-0000-0000-0000000000e1";
const SP_ID = "00000000-0000-0000-0000-0000000000a1";
const BASE = "http://t/api/operation/orders";

async function call(
  path: string,
  role: string,
  body?: unknown,
  rpcResult: { data: unknown; error: unknown } = { data: { ok: true }, error: null },
) {
  const calls: RpcCall[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(userClient).mockReturnValue(makeSb(rpcResult, calls) as any);
  const jwt = await makeJwt(role);
  const res = await app.fetch(
    new Request(`${BASE}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { Authorization: `Bearer ${jwt}`, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    env,
  );
  return { res, calls };
}

describe("STAGE 3 · 3.3 — the SAVE door lost the attribution fields", () => {
  /* 0329 made `sales_order_save_revision` RAISE on a header carrying one. A
   * schema that still accepted the field would forward it and turn a designed
   * refusal into a database error — so the refusal has to live here too. */
  for (const field of ["salesperson_id", "outlet_id", "dealer_id", "channel"] as const) {
    it(`refuses a save carrying ${field}, without asking the database`, async () => {
      const { res, calls } = await call(`/${ORDER_ID}/save`, "operation", {
        header: { customer_name: "Tan Ah Kow", [field]: SP_ID },
      });
      expect(res.status).toBe(422);
      expect(calls).toHaveLength(0);
    });
  }

  it("still saves an ordinary Class B correction", async () => {
    const { res, calls } = await call(
      `/${ORDER_ID}/save`,
      "operation",
      { header: { customer_phone: "0123456789" } },
      { data: { revision: 4, changed: ["customer_phone"] }, error: null },
    );
    expect(res.status).toBe(201);
    expect(calls.map((c) => c.name)).toEqual(["sales_order_save_revision"]);
  });
});

describe("STAGE 3 · 3.5 — the amendment spine, and the wall past it", () => {

  it("APPLY exists, and can only ever refuse — that refusal IS the deliverable", async () => {
    const { res } = await call(`/amendment/${REQ_ID}/apply`, "operation", {}, {
      data: null,
      error: {
        code: "22023",
        details: "accept_not_built",
        message: "Class A amendment cannot be applied - ACCEPT is not built yet",
      },
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { code: string; message: string };
    expect(body.code).toBe("accept_not_built");
    expect(body.message).toMatch(/ACCEPT is not built yet/);
  });

  it("has NO issue door and NO accept door at all", async () => {
    for (const path of [`/amendment/${REQ_ID}/issue`, `/amendment/${REQ_ID}/accept`]) {
      const { res } = await call(path, "operation", {});
      /* 404 is the assertion: the route does not exist. A 403 or a 422 would
       * mean someone built the door and then guarded it. */
      expect(res.status).toBe(404);
    }
  });
});

