/**
 * THE SATISFACTION SURVEY (0765) — Houzs routes/survey.ts. The token is the only gate:
 * an unknown or expired link says one sentence, a rating outside 1 to 5 is refused, and a
 * link answers once.
 */
import { describe, it, expect, vi } from "vitest";
import app from "../../index";

vi.mock("../../lib/supabase", () => ({ userClient: vi.fn(), adminClient: vi.fn() }));
import { adminClient } from "../../lib/supabase";

const env = { SUPABASE_URL: "https://t.x", SUPABASE_ANON_KEY: "a", SUPABASE_SERVICE_ROLE_KEY: "s", SUPABASE_JWT_SECRET: "" };
const TOKEN = "A".repeat(43);
const future = new Date(Date.now() + 86_400_000).toISOString();

function mockSb(byTable: Record<string, unknown>) {
  const writes: Array<[string, unknown]> = [];
  const from = vi.fn((table: string) => {
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "eq", "is", "maybeSingle"]) chain[m] = () => chain;
    chain.update = (row: unknown) => { writes.push([table, row]); return chain; };
    chain.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: byTable[table] ?? null, error: null }).then(res);
    return chain;
  });
  vi.mocked(adminClient).mockReturnValue({ from } as never);
  return writes;
}
const call = (init?: RequestInit) =>
  app.fetch(new Request(`http://t/public/service-survey/${TOKEN}`, { ...init, headers: init?.body ? { "Content-Type": "application/json" } : {} }), env as never);
const post = (body: unknown) => call({ method: "POST", body: JSON.stringify(body) });

describe("public service survey", () => {
  it("shows the case to a live link", async () => {
    mockSb({
      service_case_survey_tokens: { case_id: "c1", submitted_at: null, expires_at: future },
      service_cases: { case_no: "SC2611-01", customer_name: "Ryan Chong", satisfaction_rating: null, satisfaction_notes: null },
    });
    const res = await call();
    expect(await res.json()).toEqual({ alreadySubmitted: false, caseNo: "SC2611-01", customerName: "Ryan Chong", rating: null, notes: null });
  });

  it("treats an expired link as gone", async () => {
    mockSb({ service_case_survey_tokens: { case_id: "c1", submitted_at: null, expires_at: "2020-01-01T00:00:00Z" } });
    const res = await call();
    expect(res.status).toBe(404);
  });

  it("refuses a rating outside 1 to 5", async () => {
    mockSb({});
    expect((await post({ rating: 6 })).status).toBe(400);
  });

  it("writes the rating onto the case the token names, once", async () => {
    const writes = mockSb({
      service_case_survey_tokens: [{ token: TOKEN }],
      service_cases: null,
    });
    // The read of the token answers with the same table; give it a live row first.
    vi.mocked(adminClient).mockReturnValueOnce({
      from: () => {
        const chain: Record<string, unknown> = {};
        for (const m of ["select", "eq", "maybeSingle"]) chain[m] = () => chain;
        chain.then = (res: (v: unknown) => unknown) =>
          Promise.resolve({ data: { case_id: "c1", submitted_at: null, expires_at: future }, error: null }).then(res);
        return chain;
      },
    } as never);
    const res = await post({ rating: 4, notes: "  Quick fix  " });
    expect(res.status).toBe(200);
    expect(writes).toContainEqual(["service_cases", { satisfaction_rating: 4, satisfaction_notes: "Quick fix" }]);
  });

  it("refuses a second answer", async () => {
    mockSb({ service_case_survey_tokens: { case_id: "c1", submitted_at: future, expires_at: future } });
    expect((await post({ rating: 5 })).status).toBe(409);
  });
});
