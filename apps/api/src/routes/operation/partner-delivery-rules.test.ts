/**
 * T9 · Logistic partner profiles (migration 0283).
 *
 *   PUT /api/operation/partners/:id/delivery-rules  — author the four facts
 *   GET /api/operation/orders/:id/booking/partner-check?date=…  — read them
 *
 * The rule these tests exist to pin: partner rules WARN, they never BLOCK. A
 * date the carrier cannot honour still confirms — the operator may have already
 * phoned them. Only OUR obligations (goods, balance, Sunday) refuse.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { signTestJwt, useTestJwks } from "../../test/jwt";
import app from "../../index";
import { _setJwksForTesting } from "../../middleware/auth";

vi.mock("../../lib/supabase", () => ({ userClient: vi.fn(), adminClient: vi.fn() }));
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

type Result = { data: unknown; error: unknown };

function tableMock(read: Result, write?: Result) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const b: any = {
    select: vi.fn(() => b),
    eq: vi.fn(() => b),
    order: vi.fn(() => b),
    upsert: vi.fn(() => b),
    maybeSingle: vi.fn().mockResolvedValue(read),
    single: vi.fn().mockResolvedValue(write ?? read),
    then: (res: (v: Result) => unknown, rej?: (e: unknown) => unknown) =>
      Promise.resolve(read).then(res, rej),
  };
  return b;
}

function makeSb(
  tables: Record<string, ReturnType<typeof tableMock>>,
  rpc = vi.fn().mockResolvedValue({ data: null, error: null }),
) {
  return {
    from: vi.fn((t: string) => {
      const b = tables[t];
      if (!b) throw new Error(`unmocked table ${t}`);
      return b;
    }),
    rpc,
  };
}

beforeEach(() => {
  useTestJwks();
  vi.mocked(userClient).mockReset();
});

afterAll(() => _setJwksForTesting(null));

const PARTNER_ID = "00000000-0000-0000-0000-0000000000b1";
const RULES_URL = `http://t/api/operation/partners/${PARTNER_ID}/delivery-rules`;

const OK_RULES = {
  offDays: [0, 6],
  blackoutDates: ["2026-08-15"],
  dailyCapacity: 8,
  bookingLeadDays: 2,
};

function put(jwt: string | null, body: unknown, url = RULES_URL) {
  return app.fetch(
    new Request(url, {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}),
      },
      body: JSON.stringify(body),
    }),
    env,
  );
}

function partnerRow(over: Record<string, unknown> = {}) {
  return {
    id: PARTNER_ID,
    name: "NETS",
    off_days: [0],
    blackout_dates: [],
    daily_capacity: null,
    booking_lead_days: 0,
    ...over,
  };
}

describe("PUT /api/operation/partners/:id/delivery-rules", () => {
  it("401 without Authorization", async () => {
    expect((await put(null, OK_RULES)).status).toBe(401);
  });

  it("403 for a dealer", async () => {
    expect((await put(await makeJwt("dealer"), OK_RULES)).status).toBe(403);
  });

  it("422 on a weekday number that is not a weekday", async () => {
    const res = await put(await makeJwt("operation"), {
      ...OK_RULES,
      offDays: [0, 9],
    });
    expect(res.status).toBe(422);
  });

  it("422 on a zero capacity — NULL is how 'not recorded' is said", async () => {
    const res = await put(await makeJwt("operation"), {
      ...OK_RULES,
      dailyCapacity: 0,
    });
    expect(res.status).toBe(422);
  });

  it("422 when the carrier would run on no day at all", async () => {
    const res = await put(await makeJwt("operation"), {
      ...OK_RULES,
      offDays: [0, 1, 2, 3, 4, 5, 6],
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { message: string };
    expect(body.message).toContain("at least one day");
  });

  it("saves through the audited RPC — never a table UPDATE", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
    const sb = makeSb(
      {
        delivery_partners: tableMock({
          data: partnerRow({
            off_days: [0, 6],
            blackout_dates: ["2026-08-15"],
            daily_capacity: 8,
            booking_lead_days: 2,
          }),
          error: null,
        }),
      },
      rpc,
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(userClient).mockReturnValue(sb as any);
    const res = await put(await makeJwt("operation"), OK_RULES);
    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("set_partner_delivery_rules", {
      p_partner_id: PARTNER_ID,
      p_off_days: [0, 6],
      p_blackout_dates: ["2026-08-15"],
      p_daily_capacity: 8,
      p_booking_lead_days: 2,
    });
    const body = (await res.json()) as { partner: { daily_capacity: number } };
    expect(body.partner.daily_capacity).toBe(8);
  });

  it("de-duplicates and sorts what the operator typed", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
    const sb = makeSb(
      { delivery_partners: tableMock({ data: partnerRow(), error: null }) },
      rpc,
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(userClient).mockReturnValue(sb as any);
    await put(await makeJwt("operation"), {
      offDays: [6, 0, 6],
      blackoutDates: ["2026-09-02", "2026-08-15", "2026-08-15"],
      dailyCapacity: null,
      bookingLeadDays: 0,
    });
    expect(rpc.mock.calls[0]![1]).toMatchObject({
      p_off_days: [0, 6],
      p_blackout_dates: ["2026-08-15", "2026-09-02"],
      p_daily_capacity: null,
    });
  });
});
