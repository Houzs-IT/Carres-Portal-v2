import { SELF, env } from "cloudflare:test";
import { beforeEach, describe, expect, test } from "vitest";

// Carres: "PJ Showroom" is Carres's own showroom name and stays exactly that.
// Houzs folded it into "2990s PJ" (a 2990 name) on project create/edit, on the
// project-venue picker, in the D1 mirror's triggers and in the profitability
// breakdown. The engine runs for Carres, so none of those may rename it.

// The role name starts with "bd": only BD may create events (routes/projects.ts).
async function seedAdmin(): Promise<string> {
  const role = await env.DB.prepare(
    `INSERT INTO roles (name, description, permissions, scope_to_pic) VALUES (?, 'test', ?, 0)`,
  )
    .bind(`bd admin ${Math.random().toString(36).slice(2)}`, JSON.stringify(["*"]))
    .run();
  const user = await env.DB.prepare(
    `INSERT INTO users (email, name, role_id, status, joined_at)
     VALUES (?, 'Admin', ?, 'active', datetime('now'))`,
  )
    .bind(`venue_${Math.random().toString(36).slice(2)}@test.local`, role.meta.last_row_id)
    .run();
  const token = `tok-venue-${Math.random().toString(36).slice(2)}`;
  await env.DB.prepare(`INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)`)
    .bind(token, user.meta.last_row_id, new Date(Date.now() + 3_600_000).toISOString())
    .run();
  return `Bearer ${token}`;
}

let bearer: string;

beforeEach(async () => {
  await env.DB.exec(`DELETE FROM project_activity`);
  await env.DB.exec(`DELETE FROM project_finance`);
  await env.DB.exec(`DELETE FROM sales_entries`);
  await env.DB.exec(`DELETE FROM projects`);
  await env.DB.exec(`DELETE FROM project_venues`);
  await env.DB.exec(`DELETE FROM sessions`);
  await env.DB.exec(`DELETE FROM users`);
  await env.DB.exec(`DELETE FROM roles WHERE is_system = 0`);
  bearer = await seedAdmin();
});

const api = (path: string, init: RequestInit = {}) =>
  SELF.fetch(`https://test.local/api/projects${path}`, {
    ...init,
    headers: { Authorization: bearer, "Content-Type": "application/json" },
  });

describe("Carres: no Houzs/2990 venue aliases", () => {
  test('project create and edit keep "PJ Showroom"', async () => {
    const res = await api("", {
      method: "POST",
      body: JSON.stringify({
        name: "PJ event",
        brand: "AKEMI", // a brand the seeded test schema knows
        state: "SELANGOR",
        venue: "PJ Showroom",
        organizer: "TEST ORG",
      }),
    });
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: number };
    const created = await env.DB.prepare(`SELECT venue FROM projects WHERE id = ?`)
      .bind(id)
      .first<{ venue: string }>();
    expect(created?.venue).toBe("PJ Showroom");

    const patch = await api(`/${id}`, { method: "PATCH", body: JSON.stringify({ venue: "  pj showroom " }) });
    expect(patch.status).toBeLessThan(300);
    const edited = await env.DB.prepare(`SELECT venue FROM projects WHERE id = ?`)
      .bind(id)
      .first<{ venue: string }>();
    expect(edited?.venue).toBe("pj showroom");
  });

  test("the D1 mirror no longer rewrites a raw write", async () => {
    await env.DB.prepare(`INSERT INTO projects (code, name, venue) VALUES ('RAW-1', 'Raw', 'PJ Showroom')`).run();
    await env.DB.prepare(`INSERT INTO project_venues (name) VALUES ('PJ Showroom')`).run();
    await env.DB.prepare(`UPDATE projects SET venue = 'pjshowroom' WHERE code = 'RAW-1'`).run();
    const p = await env.DB.prepare(`SELECT venue FROM projects WHERE code = 'RAW-1'`).first<{ venue: string }>();
    const v = await env.DB.prepare(`SELECT name FROM project_venues`).first<{ name: string }>();
    expect(p?.venue).toBe("pjshowroom");
    expect(v?.name).toBe("PJ Showroom");
  });

  test('the profitability breakdown buckets under "PJ Showroom", never "2990s PJ"', async () => {
    await env.DB.prepare(
      `INSERT INTO projects (code, name, venue, stage)
       VALUES ('BD-1', 'One', 'PJ Showroom', 'completed'), ('BD-2', 'Two', ' PJ Showroom ', 'completed')`,
    ).run();
    const res = await api("/analytics/profitability?scope=all");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { by_venue: { key: string; count: number }[] };
    expect(body.by_venue).toEqual([expect.objectContaining({ key: "PJ Showroom", count: 2 })]);
    expect(JSON.stringify(body.by_venue)).not.toContain("2990");
  });
});
