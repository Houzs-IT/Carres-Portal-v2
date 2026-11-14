import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../types";
import {
  createPortalStaffAccount,
  portalStaffEnabled,
  setPortalStaffPassword,
  setPortalStaffStatus,
} from "./portal-staff";

const SECRET = "x".repeat(32);
const PASSWORD = "Tr1cky-Horse-Battery-2026";

const json = (body: object, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function bound(reply: Response | (() => Promise<Response>)) {
  const fetch = vi.fn(async (_url: string, _init?: RequestInit) => (typeof reply === "function" ? reply() : reply.clone()));
  return { fetch };
}

const envWith = (extra: Record<string, unknown>) => ({ CARRES_SSO_SECRET: SECRET, ...extra }) as unknown as Env;

async function signatureValid(init: RequestInit): Promise<boolean> {
  const h = new Headers(init.headers);
  const ts = h.get("x-carres-engine-ts") ?? "";
  const sig = h.get("x-carres-engine-signature") ?? "";
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const bytes = Uint8Array.from(atob(sig.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
  return crypto.subtle.verify("HMAC", key, bytes, enc.encode(`staff-accounts.${ts}.${String(init.body)}`));
}

afterEach(() => vi.restoreAllMocks());

describe("portalStaffEnabled", () => {
  it("needs the shared secret (32+) and a way to reach the portal", () => {
    expect(portalStaffEnabled({} as Env)).toBe(false);
    expect(portalStaffEnabled(envWith({}))).toBe(false);
    expect(portalStaffEnabled(envWith({ CARRES_PORTAL_API: "https://api.example" }))).toBe(true);
    expect(portalStaffEnabled(envWith({ CARRES_PORTAL: bound(json({})) }))).toBe(true);
    expect(portalStaffEnabled({ CARRES_SSO_SECRET: "short", CARRES_PORTAL_API: "https://a" } as unknown as Env)).toBe(false);
  });
});

describe("calls to the Carres portal", () => {
  it("Invite Member: signed POST through the service binding, password only inside the signed body", async () => {
    const portal = bound(json({ status: "created", userId: "u1", role: "finance", delivery: "password", emailSent: false }, 201));
    const r = await createPortalStaffAccount(envWith({ CARRES_PORTAL: portal }), {
      email: "new@carres.com", name: "New", department: "Finance", title: null, delivery: "password", password: PASSWORD, actor: "hr@carres.com",
    });
    expect(r).toEqual({ ok: true, status: 201, body: { status: "created", userId: "u1", role: "finance", delivery: "password", emailSent: false } });
    const [url, init] = portal.fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.carresofficial.com/engine/staff-accounts");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toMatchObject({ email: "new@carres.com", department: "Finance", delivery: "password", password: PASSWORD });
    expect(await signatureValid(init)).toBe(true);
    // The password is in the body only: not in the URL or any header.
    expect(url).not.toContain(PASSWORD);
    expect(JSON.stringify([...new Headers(init.headers)])).not.toContain(PASSWORD);
  });

  it("falls back to CARRES_PORTAL_API over fetch when there is no binding", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(json({ ok: true }));
    const r = await setPortalStaffPassword(envWith({ CARRES_PORTAL_API: "https://api.test/" }), { email: "a@carres.com", password: PASSWORD });
    expect(r.ok).toBe(true);
    expect(spy.mock.calls[0][0]).toBe("https://api.test/engine/staff-accounts/password");
  });

  it("Disable account: /status with the reason", async () => {
    const portal = bound(json({ ok: true, status: "disabled" }));
    await setPortalStaffStatus(envWith({ CARRES_PORTAL: portal }), { email: "a@carres.com", status: "disabled", reason: "left" });
    const [url, init] = portal.fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/engine\/staff-accounts\/status$/);
    expect(JSON.parse(String(init.body))).toEqual({ email: "a@carres.com", status: "disabled", reason: "left" });
  });

  it.each([
    [409, 409],
    [403, 403],
    [404, 404],
    [422, 400],
    [401, 502],
    [500, 502],
  ])("portal %i is answered as %i, with the portal's message and never the password", async (portalStatus, mapped) => {
    const portal = bound(json({ error: "x", message: "refused here" }, portalStatus));
    const r = await setPortalStaffPassword(envWith({ CARRES_PORTAL: portal }), { email: "a@carres.com", password: PASSWORD });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.status).toBe(mapped);
    expect(r.error).toBe("Carres portal: refused here");
    expect(r.error).not.toContain(PASSWORD);
  });

  it("an unreachable portal is a 502 that says nothing was changed", async () => {
    const portal = bound(() => Promise.reject(new Error("down")));
    const r = await createPortalStaffAccount(envWith({ CARRES_PORTAL: portal }), {
      email: "a@carres.com", name: null, department: null, title: null, delivery: "invite",
    });
    expect(r).toMatchObject({ ok: false, status: 502 });
    if (!r.ok) expect(r.error).toMatch(/nothing was changed/);
  });
});
