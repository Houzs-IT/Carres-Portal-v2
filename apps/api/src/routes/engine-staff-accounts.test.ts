import { describe, it, expect, beforeEach, vi } from "vitest";

// One fake service-role client per test: app_users rows by email, and every GoTrue admin call recorded.
let rows: Record<string, { id: string; email: string; name: string; role: string; status: string; dealer_id?: null }>;
let inserts: Array<{ table: string; row: Record<string, unknown> }>;
let updates: Array<{ table: string; patch: Record<string, unknown> }>;
const admin = {
  createUser: vi.fn(),
  inviteUserByEmail: vi.fn(),
  updateUserById: vi.fn(),
  deleteUser: vi.fn(),
};
const rpc = vi.fn();
function from(table: string) {
  let col = "", val = "";
  const q = {
    select: () => q,
    eq: (c: string, v: string) => { col = c; val = v; return q; },
    maybeSingle: async () => ({
      data: Object.values(rows).find((r) => (col === "email" ? r.email === val : r.id === val)) ?? null,
      error: null,
    }),
    insert: async (row: Record<string, unknown>) => { inserts.push({ table, row }); return { error: null }; },
    update: (patch: Record<string, unknown>) => {
      updates.push({ table, patch });
      return { eq: async () => ({ error: null }) };
    },
  };
  return q;
}
vi.mock("../lib/supabase", () => ({ adminClient: () => ({ from, rpc, auth: { admin } }) }));

import app from "../index";
import { portalRoleForDepartment, signStaffRequest, verifyStaffRequest } from "./engine-staff-accounts";

const SECRET = "s".repeat(32);
const env = {
  SUPABASE_URL: "https://test.supabase.co",
  SUPABASE_ANON_KEY: "a",
  SUPABASE_SERVICE_ROLE_KEY: "svc",
  SUPABASE_JWT_SECRET: "unused",
  STAFF_SESSION_SECRET: "x".repeat(32),
  SCM_ENGINE_SSO_SECRET: SECRET,
};

async function call(path: string, payload: object, opts: { secret?: string; now?: number; tamper?: boolean } = {}) {
  const body = JSON.stringify(payload);
  const { ts, signature } = await signStaffRequest(opts.secret ?? SECRET, body, opts.now);
  return app.fetch(
    new Request(`http://t/engine/staff-accounts${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-carres-engine-ts": ts, "x-carres-engine-signature": signature },
      body: opts.tamper ? body.replace("operation", "principal").replace("@", "@x") : body,
    }),
    env,
  );
}

beforeEach(() => {
  rows = {};
  inserts = [];
  updates = [];
  vi.clearAllMocks();
  admin.createUser.mockResolvedValue({ data: { user: { id: "u-new" } }, error: null });
  admin.inviteUserByEmail.mockResolvedValue({ data: { user: { id: "u-inv" } }, error: null });
  admin.updateUserById.mockResolvedValue({ data: {}, error: null });
  admin.deleteUser.mockResolvedValue({ data: {}, error: null });
  rpc.mockResolvedValue({ data: "CR042", error: null });
});

describe("trust: only the engine Worker, with the shared secret", () => {
  it("401 with no signature", async () => {
    const res = await app.fetch(new Request("http://t/engine/staff-accounts", {
      method: "POST", body: JSON.stringify({ email: "a@carres.com", delivery: "invite" }),
    }), env);
    expect(res.status).toBe(401);
    expect(admin.inviteUserByEmail).not.toHaveBeenCalled();
  });

  it("401 when signed with another secret", async () => {
    expect((await call("", { email: "a@carres.com", delivery: "invite" }, { secret: "w".repeat(32) })).status).toBe(401);
  });

  it("401 when the body was changed after signing", async () => {
    expect((await call("", { email: "a@carres.com", delivery: "invite" }, { tamper: true })).status).toBe(401);
  });

  it("401 for a stale signature (replay older than a minute)", async () => {
    expect((await call("", { email: "a@carres.com", delivery: "invite" }, { now: Date.now() - 120_000 })).status).toBe(401);
  });

  it("503 when the secret is not set on this Worker", async () => {
    const res = await app.fetch(new Request("http://t/engine/staff-accounts", { method: "POST", body: "{}" }),
      { ...env, SCM_ENGINE_SSO_SECRET: undefined });
    expect(res.status).toBe(503);
  });

  it("the signature binds the exact body", async () => {
    const body = "{}";
    const { ts, signature } = await signStaffRequest(SECRET, body);
    expect(await verifyStaffRequest(SECRET, ts, signature, body)).toBe(true);
    expect(await verifyStaffRequest(SECRET, ts, signature, `${body} `)).toBe(false);
  });

  it("is not reachable through the signed-in /api group", async () => {
    const res = await app.fetch(new Request("http://t/api/engine/staff-accounts", { method: "POST", body: "{}" }), env);
    expect(res.status).toBe(401);
  });
});

describe("portal role from the engine department — never principal", () => {
  it.each([
    ["Operation", "operation"],
    ["Warehouse", "operation"],
    ["Management", "operation"],
    ["Sales", "operation"],
    [null, "operation"],
    ["Finance", "finance"],
    ["Accounts", "finance"],
    ["Business Development", "bd"],
    ["BD", "bd"],
    ["HR", "hr"],
    ["Human Resources", "hr"],
    ["Principal", "operation"],
  ])("%s -> %s", (dept, role) => {
    expect(portalRoleForDepartment(dept)).toBe(role);
  });
});

describe("POST /engine/staff-accounts", () => {
  it("password mode: creates the login and the app_users row with the mapped role", async () => {
    const res = await call("", { email: " New@Carres.com ", name: "New Person", department: "Finance", delivery: "password", password: "correct horse battery", actor: "hr@carres.com" });
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json).toEqual({ status: "created", userId: "u-new", role: "finance", delivery: "password", emailSent: false });
    expect(JSON.stringify(json)).not.toContain("correct horse");
    expect(admin.createUser).toHaveBeenCalledWith({
      email: "new@carres.com", password: "correct horse battery", email_confirm: true, app_metadata: { role: "finance" },
    });
    const user = inserts.find((i) => i.table === "app_users")!.row;
    expect(user).toMatchObject({ id: "u-new", email: "new@carres.com", name: "New Person", role: "finance", status: "active", staff_code: "CR042", is_person: true });
    const auditRow = inserts.find((i) => i.table === "audit_log")!.row;
    expect(JSON.stringify(auditRow)).not.toContain("correct horse");
  });

  it("invite mode: Supabase's invite mail, landing on the staff portal's set-password page", async () => {
    const res = await call("", { email: "inv@carres.com", name: "Inv", department: "Operation", delivery: "invite" });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ status: "created", userId: "u-inv", role: "operation", emailSent: true });
    expect(admin.inviteUserByEmail).toHaveBeenCalledWith("inv@carres.com", {
      redirectTo: "https://erp.carresofficial.com/update-password", data: { name: "Inv" },
    });
    expect(admin.updateUserById).toHaveBeenCalledWith("u-inv", { app_metadata: { role: "operation" } });
    expect(admin.createUser).not.toHaveBeenCalled();
  });

  it("refuses a password shorter than 12", async () => {
    expect((await call("", { email: "a@carres.com", delivery: "password", password: "short" })).status).toBe(422);
    expect(admin.createUser).not.toHaveBeenCalled();
  });

  it("idempotent: an existing staff email is linked, not duplicated or changed", async () => {
    rows.a = { id: "u-old", email: "old@carres.com", name: "Old", role: "operation", status: "active" };
    const res = await call("", { email: "old@carres.com", department: "Finance", delivery: "password", password: "another long password" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "existing", userId: "u-old", role: "operation" });
    expect(admin.createUser).not.toHaveBeenCalled();
    expect(admin.updateUserById).not.toHaveBeenCalled();
    expect(inserts).toEqual([]);
  });

  it("links the principal's own email without touching it", async () => {
    rows.p = { id: "u-p", email: "boss@carres.com", name: "Boss", role: "principal", status: "active" };
    const res = await call("", { email: "boss@carres.com", delivery: "invite" });
    expect(res.status).toBe(200);
    expect(admin.inviteUserByEmail).not.toHaveBeenCalled();
  });

  it("refuses an email that signs in as a dealer, supplier or partner", async () => {
    for (const role of ["dealer", "showroom", "supplier", "partner"]) {
      rows.d = { id: "u-d", email: "store@x.com", name: "Store", role, status: "active" };
      expect((await call("", { email: "store@x.com", delivery: "invite" })).status).toBe(409);
    }
    expect(inserts).toEqual([]);
  });

  it("rolls the login back if the app_users row cannot be made", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    expect((await call("", { email: "a@carres.com", delivery: "password", password: "long enough password" })).status).toBe(500);
    expect(admin.deleteUser).toHaveBeenCalledWith("u-new");
  });
});

describe("POST /engine/staff-accounts/password and /status", () => {
  beforeEach(() => {
    rows.s = { id: "u-s", email: "staff@carres.com", name: "Staff", role: "operation", status: "active", dealer_id: null };
    rows.p = { id: "u-p", email: "boss@carres.com", name: "Boss", role: "principal", status: "active", dealer_id: null };
    rows.d = { id: "u-d", email: "store@x.com", name: "Store", role: "dealer", status: "active", dealer_id: null };
  });

  it("sets a staff password and never echoes it", async () => {
    const res = await call("/password", { email: "staff@carres.com", password: "a brand new password" });
    expect(res.status).toBe(200);
    expect(await res.text()).not.toContain("brand new");
    expect(admin.updateUserById).toHaveBeenCalledWith("u-s", { password: "a brand new password" });
    expect(JSON.stringify(inserts)).not.toContain("brand new");
  });

  it("refuses the principal's and a store's password", async () => {
    expect((await call("/password", { email: "boss@carres.com", password: "a brand new password" })).status).toBe(403);
    expect((await call("/password", { email: "store@x.com", password: "a brand new password" })).status).toBe(403);
    expect(admin.updateUserById).not.toHaveBeenCalled();
  });

  it("404 when the person has no portal account", async () => {
    expect((await call("/password", { email: "nobody@carres.com", password: "a brand new password" })).status).toBe(404);
  });

  it("disables through the shared sequence: status flip and login ban", async () => {
    const res = await call("/status", { email: "staff@carres.com", status: "disabled", reason: "left" });
    expect(res.status).toBe(200);
    expect(updates).toContainEqual({ table: "app_users", patch: { status: "disabled" } });
    expect(admin.updateUserById).toHaveBeenCalledWith("u-s", { ban_duration: "876000h" });
  });

  it("refuses to disable the principal from Team", async () => {
    expect((await call("/status", { email: "boss@carres.com", status: "disabled" })).status).toBe(403);
    expect(updates).toEqual([]);
  });
});
