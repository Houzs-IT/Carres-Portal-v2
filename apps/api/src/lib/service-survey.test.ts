import { describe, it, expect, vi } from "vitest";
import { sendCompletionSurvey } from "./service-survey";

function sb(caseRow: unknown) {
  return {
    from: (table: string) => {
      const chain: Record<string, unknown> = {};
      for (const m of ["select", "eq", "is", "gt", "order", "limit", "maybeSingle", "insert"]) chain[m] = () => chain;
      chain.then = (res: (v: unknown) => unknown) =>
        Promise.resolve({ data: table === "service_cases" ? caseRow : [], error: null }).then(res);
      return chain;
    },
  } as never;
}
const env = { RESEND_API_KEY: "re_test", SURVEY_EMAIL_FROM: "service@carres.test", PUBLIC_WEB_URL: "https://p.test" } as never;

describe("sendCompletionSurvey", () => {
  it("emails the survey link to the case's survey email", async () => {
    const transport = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    const out = await sendCompletionSurvey(env, sb({ case_no: "SC2611-01", customer_name: "Ryan Chong", survey_email: "ryan@x.test" }), "c1", transport);
    expect(out).toBe("dispatched");
    const body = JSON.parse(transport.mock.calls[0][1].body);
    expect(body.to).toEqual(["ryan@x.test"]);
    expect(body.text).toContain("https://p.test/survey/");
  });

  it("sends nothing without a sender or an address", async () => {
    const transport = vi.fn();
    expect(await sendCompletionSurvey({} as never, sb({ survey_email: "a@b.test" }), "c1", transport)).toBe("skipped");
    expect(await sendCompletionSurvey(env, sb({ case_no: "x", survey_email: null }), "c1", transport)).toBe("skipped");
    expect(transport).not.toHaveBeenCalled();
  });
});
