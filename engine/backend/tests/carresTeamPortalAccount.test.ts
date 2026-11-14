import { describe, expect, test } from "vitest";

/* Carres: Team > Invite Member, Set a new password and Disable account keep the person's Carres PORTAL login in
 * step (src/carres/portal-staff.ts -> apps/api/src/routes/engine-staff-accounts.ts). Staff sign in on the portal,
 * so the portal login is made first and the engine member is created active with no engine password; a portal
 * refusal leaves the engine unchanged.
 *
 * WHY A SOURCE TEST, for the reason adminResetLink.test.ts and salesDirectorInviteRole.test.ts give: these handlers
 * are Drizzle/Postgres and the Workers suite binds no Postgres, so a route test 500s before the Carres branch runs.
 * The call itself (signature, body, error mapping) is tested for real in src/carres/portal-staff.test.ts; here the
 * ORDER inside the handlers is pinned, with comments stripped so an explanatory comment cannot satisfy it.
 */

const sources = import.meta.glob("../src/routes/users.ts", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const usersRoute = Object.values(sources)[0] ?? "";

function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function handlerSource(registration: string): string {
  const start = usersRoute.indexOf(registration);
  expect(start, `${registration} not found — did the route move?`).toBeGreaterThan(-1);
  const rest = usersRoute.slice(start + 1);
  const next = rest.search(/\napp\.(post|get|patch|put|delete)\(/);
  return stripComments(next === -1 ? rest : rest.slice(0, next));
}

/** Index of the first match, failing loudly when absent. */
function at(body: string, pattern: RegExp): number {
  const m = pattern.exec(body);
  expect(m, `${pattern} not found in the handler`).not.toBeNull();
  return m!.index;
}

const INVITE = handlerSource('app.post("/invite"');
const PATCH = handlerSource('app.patch("/:id"');
const DELETE = handlerSource('app.delete("/:id"');

describe("Invite Member", () => {
  test("in Carres mode the engine member is active and stores no engine password", () => {
    expect(INVITE).toMatch(/const carresPortal = portalStaffEnabled\(c\.env\);/);
    expect(INVITE).toMatch(/if \(carresPortal\) passwordHash = null;/);
    expect(INVITE).toMatch(/const activate = !!passwordHash \|\| carresPortal;/);
  });

  test("the portal login is made BEFORE the engine member is written, and a refusal returns early", () => {
    const portal = at(INVITE, /await createPortalStaffAccount\(c\.env,/);
    expect(portal).toBeLessThan(at(INVITE, /\.insert\(users\)/));
    expect(portal).toBeLessThan(at(INVITE, /\.update\(users\)/));
    expect(INVITE).toMatch(/if \(!made\.ok\) return c\.json\(\{ error: made\.error \}, made\.status\);/);
  });

  test("the department name is what the portal maps a role from; the password goes only when the admin set one", () => {
    expect(INVITE).toMatch(/department: dept,/);
    expect(INVITE).toMatch(/delivery: directPassword \? "password" : "invite"/);
  });

  test("the response reports the portal login and never carries the password", () => {
    const response = INVITE.slice(at(INVITE, /carres_portal: \{/));
    expect(response.slice(0, 400)).not.toMatch(/password\s*:/);
  });
});

describe("member drawer: Set a new password, Disable account", () => {
  test("a new password goes to the portal and no engine hash is stored in Carres mode", () => {
    expect(PATCH).toMatch(/if \(portalStaffEnabled\(c\.env\)\) carresPortalPassword = body\.password;\s*else set\.password_hash = await hashPassword\(body\.password\);/);
  });

  test("portal password and status are changed BEFORE the engine row, and a refusal returns early", () => {
    const write = at(PATCH, /db\.update\(users\)\.set\(set\)/);
    expect(at(PATCH, /await setPortalStaffPassword\(c\.env,/)).toBeLessThan(write);
    expect(at(PATCH, /await setPortalStaffStatus\(c\.env,/)).toBeLessThan(write);
    expect(PATCH).toMatch(/if \(!r\.ok\) return c\.json\(\{ error: r\.error \}, r\.status\);/);
    // No portal account for the email: nothing to disable there, the engine change goes on.
    expect(PATCH).toMatch(/if \(!r\.ok && r\.status !== 404\) return c\.json\(\{ error: r\.error \}, r\.status\);/);
  });

  test("the audit records that a portal password was set, never the password", () => {
    expect(PATCH).toMatch(/auditedSet\.carres_portal_password = "set";/);
  });

  test("removing a member disables the portal login first", () => {
    expect(at(DELETE, /await setPortalStaffStatus\(c\.env,/)).toBeLessThan(at(DELETE, /db\.delete\(sessions\)/));
    expect(DELETE).toMatch(/status: "disabled"/);
  });
});
