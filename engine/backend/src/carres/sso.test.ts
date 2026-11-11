import { describe, expect, it, vi } from "vitest";
import app, { HR_ROLE, HR_ROLE_PERMISSIONS, LAST_LOGIN_RESOLUTION_MS, NEW_MEMBER_ROLE, lastLoginStale, verifyAssertion } from "./sso";

const b64url = (bytes: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes as ArrayBuffer))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const SECRET = "x".repeat(32);
async function sign(payload: object, secret = SECRET) {
  const enc = new TextEncoder();
  const body = b64url(enc.encode(JSON.stringify(payload)));
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return `${body}.${b64url(await crypto.subtle.sign("HMAC", key, enc.encode(body)))}`;
}

describe("verifyAssertion", () => {
  const now = 1_000_000;
  it("accepts a fresh assertion signed with the shared secret", async () => {
    const a = await verifyAssertion(SECRET, await sign({ email: "a@b.c", role: "operation", exp: now + 30_000 }), now);
    expect(a?.email).toBe("a@b.c");
  });
  it("refuses another secret, an expired one and one that lives too long", async () => {
    expect(await verifyAssertion(SECRET, await sign({ email: "a@b.c", role: "operation", exp: now + 30_000 }, "y".repeat(32)), now)).toBeNull();
    expect(await verifyAssertion(SECRET, await sign({ email: "a@b.c", role: "operation", exp: now - 1 }), now)).toBeNull();
    expect(await verifyAssertion(SECRET, await sign({ email: "a@b.c", role: "operation", exp: now + 120_000 }), now)).toBeNull();
  });
});

vi.mock("../services/auth", () => ({ createSession: async () => "tok", mintSessionPass: async () => null }));

/** A tiny stand-in for env.DB: users, roles and the Settings-editor list, matched on the SQL text. Every
 *  statement is logged, so a test can say which writes were made. */
function fakeDb() {
  const roles: Array<{ id: number; name: string; permissions: string }> = [];
  const users: Array<{ id: number; email: string; role_id: number; status: string; last_login_at?: string | null }> = [];
  const editors = new Set<number>();
  const log: string[] = [];
  const prepare = (sql: string) => {
    let args: unknown[] = [];
    const stmt = {
      bind: (...a: unknown[]) => { args = a; return stmt; },
      first: async () => {
        log.push(sql);
        if (sql.includes(`permissions LIKE '%"*"%'`)) return roles.find((r) => r.permissions.includes('"*"')) ?? null;
        if (sql.includes("FROM roles WHERE name")) return roles.find((r) => r.name === args[0]) ?? null;
        if (sql.includes("FROM users u WHERE u.email")) {
          const u = users.find((x) => x.email === args[0]);
          return u ? { id: u.id, status: u.status, role_id: u.role_id, last_login_at: u.last_login_at ?? null, settings_editor: editors.has(u.id) } : null;
        }
        return null;
      },
      run: async () => {
        log.push(sql);
        if (sql.startsWith("INSERT INTO roles")) roles.push({ id: roles.length + 1, name: args[0] as string, permissions: args[2] as string });
        else if (sql.startsWith("INSERT INTO users")) users.push({ id: users.length + 1, email: args[0] as string, role_id: args[2] as number, status: "active" });
        else if (sql.startsWith("INSERT INTO carres_settings_editors")) editors.add(args[0] as number);
        else if (sql.startsWith("DELETE FROM carres_settings_editors")) editors.delete(args[0] as number);
        else if (sql.startsWith("UPDATE users SET last_login_at")) {
          const u = users.find((x) => x.id === args[0]);
          if (u) u.last_login_at = new Date().toISOString().slice(0, 19).replace("T", " ");
        }
        return {};
      },
    };
    return stmt;
  };
  return { roles, users, editors, log, DB: { prepare } };
}

describe("POST /api/carres-sso", () => {
  async function signIn(db: ReturnType<typeof fakeDb>, who: object) {
    const assertion = await sign({ ...who, exp: Date.now() + 30_000 });
    return app.request("/", { method: "POST", body: JSON.stringify({ assertion }), headers: { "content-type": "application/json" } }, { DB: db.DB, CARRES_SSO_SECRET: SECRET } as never);
  }
  const roleOf = (db: ReturnType<typeof fakeDb>, email: string) => db.roles.find((r) => r.id === db.users.find((u) => u.email === email)?.role_id)?.name;

  it("starts the owner with full access and anyone else on the no-access role", async () => {
    const db = fakeDb();
    expect((await signIn(db, { email: "jess@carres.com", role: "principal" })).status).toBe(200);
    expect((await signIn(db, { email: "ops@carres.com", role: "operation" })).status).toBe(200);
    expect(roleOf(db, "jess@carres.com")).toBe("Owner");
    expect(roleOf(db, "ops@carres.com")).toBe(NEW_MEMBER_ROLE);
    expect(JSON.parse(db.roles.find((r) => r.name === NEW_MEMBER_ROLE)!.permissions)).toEqual([]);
  });

  it("leaves an existing account on the role the owner gave it", async () => {
    const db = fakeDb();
    db.roles.push({ id: 7, name: "Warehouse", permissions: "[]" });
    db.users.push({ id: 1, email: "ops@carres.com", role_id: 7, status: "active" });
    await signIn(db, { email: "ops@carres.com", role: "principal" });
    expect(roleOf(db, "ops@carres.com")).toBe("Warehouse");
  });

  it("keeps the Supply Chain settings editor list in step on every sign-in", async () => {
    const db = fakeDb();
    await signIn(db, { email: "ops@carres.com", role: "operation", settingsEditor: true });
    expect(db.editors.has(1)).toBe(true);
    await signIn(db, { email: "ops@carres.com", role: "operation" });
    expect(db.editors.has(1)).toBe(false);
  });

  it("writes nothing that would not change: a second sign-in is one read (the session itself is created by services/auth)", async () => {
    const db = fakeDb();
    await signIn(db, { email: "ops@carres.com", role: "operation", settingsEditor: true });
    db.log.length = 0;
    expect((await signIn(db, { email: "ops@carres.com", role: "operation", settingsEditor: true })).status).toBe(200);
    expect(db.log).toHaveLength(1);
    expect(db.log[0]).toContain("FROM users u WHERE u.email");
    expect(db.editors.has(1)).toBe(true);
  });

  it("still records the sign-in time when the recorded one is older than a minute", async () => {
    const db = fakeDb();
    db.roles.push({ id: 7, name: "Warehouse", permissions: "[]" });
    db.users.push({ id: 1, email: "ops@carres.com", role_id: 7, status: "active", last_login_at: "2026-01-01 00:00:00" });
    await signIn(db, { email: "ops@carres.com", role: "operation" });
    expect(db.log.filter((q) => q.startsWith("UPDATE users SET last_login_at"))).toHaveLength(1);
    expect(db.log.some((q) => q.includes("carres_settings_editors (user_id)") || q.startsWith("DELETE"))).toBe(false);
    expect(db.users[0].last_login_at).not.toBe("2026-01-01 00:00:00");
  });

  it("refuses a disabled account before writing anything", async () => {
    const db = fakeDb();
    db.roles.push({ id: 7, name: "Warehouse", permissions: "[]" });
    db.users.push({ id: 1, email: "ops@carres.com", role_id: 7, status: "disabled" });
    expect((await signIn(db, { email: "ops@carres.com", role: "operation", settingsEditor: true })).status).toBe(403);
    expect(db.log.filter((q) => !q.startsWith("SELECT"))).toEqual([]);
  });

  it("admits an hr account, starting a new one on the HR role (Team, view only)", async () => {
    const db = fakeDb();
    expect((await signIn(db, { email: "hr@carres.com", role: "hr" })).status).toBe(200);
    expect(roleOf(db, "hr@carres.com")).toBe(HR_ROLE);
    expect(JSON.parse(db.roles.find((r) => r.name === HR_ROLE)!.permissions)).toEqual(HR_ROLE_PERMISSIONS);
    expect(HR_ROLE_PERMISSIONS).toEqual(["users.read", "roles.read"]);
  });

  it("leaves an existing hr account on the role the owner gave it", async () => {
    const db = fakeDb();
    db.roles.push({ id: 7, name: "Warehouse", permissions: "[]" });
    db.users.push({ id: 1, email: "hr@carres.com", role_id: 7, status: "active" });
    expect((await signIn(db, { email: "hr@carres.com", role: "hr" })).status).toBe(200);
    expect(roleOf(db, "hr@carres.com")).toBe("Warehouse");
  });

  it("refuses a role that does not open Supply Chain", async () => {
    expect((await signIn(fakeDb(), { email: "d@x.com", role: "dealer" })).status).toBe(403);
  });

  it("lets a finance account in, on the no-access role until the owner picks one (Finance, 11 Nov 2026)", async () => {
    const db = fakeDb();
    expect((await signIn(db, { email: "fin@carres.com", role: "finance" })).status).toBe(200);
    expect(roleOf(db, "fin@carres.com")).toBe(NEW_MEMBER_ROLE);
  });
});

describe("lastLoginStale", () => {
  const now = Date.parse("2026-11-11T10:00:30Z");
  it("rewrites a missing, unreadable or older-than-a-minute time", () => {
    expect(lastLoginStale(null, now)).toBe(true);
    expect(lastLoginStale("not a date", now)).toBe(true);
    expect(lastLoginStale("2026-11-11 09:59:30", now)).toBe(true);
    expect(LAST_LOGIN_RESOLUTION_MS).toBe(60_000);
  });
  it("keeps a time recorded within the last minute (UTC, as datetime('now') writes it)", () => {
    expect(lastLoginStale("2026-11-11 10:00:00", now)).toBe(false);
    expect(lastLoginStale("2026-11-11T10:00:00Z", now)).toBe(false);
  });
});
