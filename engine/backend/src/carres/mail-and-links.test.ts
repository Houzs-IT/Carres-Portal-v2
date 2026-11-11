// Carres: no engine mail or link may fall back to a Houzs domain or open the Carres portal for an
// engine-only page.
import { describe, expect, test } from "vitest";
import type { Env } from "../types";
import { brandingMailDomain, CARRES_MAIL_DOMAIN } from "../services/branding";
import { enginePublicUrl, publicUrl, DEFAULT_ENGINE_PUBLIC_URL } from "../services/email";
import { clientErrorDigestRecipient } from "../services/clientErrors";
import { customerPortalUrlFor } from "../services/printQr";
import { posSettingsDefaults } from "../scm/shared/pos-settings";
import app from "../routes/track";

/** An Env whose app_settings holds `branding` (or nothing). */
function envWith(branding: Record<string, unknown> | null, vars: Partial<Env> = {}): Env {
  const DB = {
    prepare: () => ({
      bind: () => ({
        first: async () => (branding ? { value: JSON.stringify(branding) } : null),
      }),
      all: async () => ({ results: [{ id: 1, code: "HOUZS" }] }),
    }),
  };
  return { DB, ...vars } as unknown as Env;
}

describe("mail domain", () => {
  test("is the Branding email's domain, else carresofficial.com", () => {
    expect(brandingMailDomain({ email: "Hello@Carres.example" })).toBe("carres.example");
    expect(brandingMailDomain({ email: "" })).toBe(CARRES_MAIL_DOMAIN);
    expect(brandingMailDomain(null)).toBe("carresofficial.com");
  });
});

describe("links to public engine pages", () => {
  test("survey, invite, reset and the customer case QR open the engine site, not the portal", () => {
    const env = envWith(null, { PUBLIC_APP_URL: "https://carres-portal.pages.dev" });
    expect(enginePublicUrl(env, "/survey/t1")).toBe(`${DEFAULT_ENGINE_PUBLIC_URL}/survey/t1`);
    expect(enginePublicUrl(env, "invite/t2")).toBe("https://carres-scm.pages.dev/invite/t2");
    expect(customerPortalUrlFor(env, "t3")).toBe("https://carres-scm.pages.dev/portal/case/t3");
    expect(enginePublicUrl({ ...env, ENGINE_PUBLIC_URL: "https://x.test/" } as Env, "/reset/t4")).toBe("https://x.test/reset/t4");
    // Other links keep PUBLIC_APP_URL.
    expect(publicUrl(env, "/projects")).toBe("https://carres-portal.pages.dev/projects");
  });

  test("an unset PUBLIC_APP_URL never falls back to a Houzs host", () => {
    expect(publicUrl(envWith(null), "/x")).not.toMatch(/houzs/i);
  });
});

describe("client-error digest recipient", () => {
  test("CLIENT_ERROR_DIGEST_TO wins, then the Branding email, else nobody (the send is skipped)", async () => {
    expect(await clientErrorDigestRecipient(envWith({ email: "hello@carresofficial.com" }, { CLIENT_ERROR_DIGEST_TO: "it@carresofficial.com" }))).toBe("it@carresofficial.com");
    expect(await clientErrorDigestRecipient(envWith({ email: "hello@carresofficial.com" }))).toBe("hello@carresofficial.com");
    expect(await clientErrorDigestRecipient(envWith(null))).toBe("");
  });
});

describe("POS alerts", () => {
  test("mail nobody until an address is typed", () => {
    expect(posSettingsDefaults().general.alert_email).toBe("");
  });
});

describe("GET /api/track/company", () => {
  test("serves only the Branding contact a customer may see, customer-service contact first", async () => {
    const env = envWith({ companyName: "Carres Sdn Bhd", email: "hello@carresofficial.com", csEmail: "cs@carresofficial.com", phone: "03-1", csPhone: "", customerPaymentDetails: "secret bank" });
    const res = await app.request("/company", {}, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, string>;
    expect(body).toEqual({ companyName: "Carres Sdn Bhd", registrationNo: "", address: "", postcode: "", phone: "03-1", email: "cs@carresofficial.com" });
  });
});
