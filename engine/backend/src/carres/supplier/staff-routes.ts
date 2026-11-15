// Carres only (not part of Houzs's code): the Carres side of the Supplier Platform, for signed-in staff.
//
//   /api/carres/supplier-access/*    Settings › Supplier Access: who may sign in, what each supplier is shared, its
//                                    people and their set-password links. Open to whoever may change Settings.
//   /api/carres/supplier-pickups/*   Pickup requests: tick Sales Order lines, send, record the collection, cancel.
//                                    Open to whoever works Purchase Orders (view to read, edit to act).
// Both are mounted AFTER the staff sign-in gate (index.ts), so c.get("user") is an engine staff member. A supplier's
// token is not a staff session and cannot reach either.
import { Hono, type Context } from "hono";
import type { Env } from "../../types";
import { requirePageAccess } from "../../middleware/auth";
import { enginePublicUrl } from "../../services/email";
import { dbFor } from "./db";
import {
  accessOptions, addPerson, getAccess, listAccess, previewAccess, recentActivity, saveAccess, updatePerson,
  type AccessInput, type PersonInput, type PersonPatch,
} from "./access";
import { issueLink } from "./session";
import { cancelPickup, collectPickup, createPickup, eligibleLines, getPickup, isUuid, listPickups, type CreateInput, type StaffActor } from "./pickups";
import { financeSummary } from "./finance";

type Ctx = Context<{ Bindings: Env }>;

const staff = (c: Ctx): StaffActor => {
  const u = c.get("user") as { id?: number; name?: string | null; email?: string } | undefined;
  return { id: typeof u?.id === "number" ? u.id : null, name: (u?.name || u?.email || "Carres").slice(0, 120) };
};

async function body<T>(c: Ctx): Promise<T> {
  const parsed = (await c.req.json().catch(() => null)) as unknown;
  return (parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}) as T;
}

/** Where a supplier person opens their one-time link. The secret sits after the `#`, which a browser never sends to
 *  a server, so it reaches no access log. Built here because only this answer ever holds the token. */
const setupUrl = (c: Ctx, token: string) => `${enginePublicUrl(c.env, "/supplier/setup")}#t=${token}`;

// ── Settings › Supplier Access ──────────────────────────────────────────────────────────────────────────────────

export const supplierAccess = new Hono<{ Bindings: Env }>();
supplierAccess.use("*", requirePageAccess("settings", "full"));

supplierAccess.get("/", async (c) => c.json({ suppliers: await listAccess(dbFor(c.env)), signInUrl: enginePublicUrl(c.env, "/supplier") }));

supplierAccess.get("/options", async (c) => c.json(await accessOptions(dbFor(c.env))));

/** The share percentages subscription plans carry today, read from the portal: shown, never set, here. */
supplierAccess.get("/subscription-share", async (c) => {
  const out = await financeSummary(c.env);
  if (!out.ok) return c.json({ available: false, message: out.error });
  const rates = [...new Set(out.body.orders.map((o) => o.ratePct))].sort((a, b) => a - b);
  return c.json({ available: true, orders: out.body.totals.orders, rates });
});

supplierAccess.get("/:supplierId", async (c) => {
  const db = dbFor(c.env);
  const id = c.req.param("supplierId");
  const access = await getAccess(db, id);
  if (!access) return c.json({ error: "Supplier not found." }, 404);
  return c.json({ access, activity: await recentActivity(db, id, 30) });
});

supplierAccess.put("/:supplierId", async (c) => {
  const out = await saveAccess(dbFor(c.env), c.req.param("supplierId"), await body<AccessInput>(c), staff(c).id);
  if (!out.ok) return c.json({ error: out.error }, out.status);
  return c.json({ access: out.access });
});

supplierAccess.post("/:supplierId/preview", async (c) => {
  const out = await previewAccess(dbFor(c.env), c.req.param("supplierId"), await body<AccessInput>(c));
  if (!out.ok) return c.json({ error: out.error }, out.status);
  return c.json({ preview: out.preview });
});

supplierAccess.post("/:supplierId/people", async (c) => {
  const out = await addPerson(dbFor(c.env), c.req.param("supplierId"), await body<PersonInput>(c), staff(c).id);
  if (!out.ok) return c.json({ error: out.error }, out.status);
  return c.json({ person: out.person, link: { url: setupUrl(c, out.link.token), expiresAt: out.link.expiresAt } });
});

supplierAccess.patch("/people/:id", async (c) => {
  const out = await updatePerson(dbFor(c.env), Number(c.req.param("id")), await body<PersonPatch>(c), staff(c).id);
  if (!out.ok) return c.json({ error: out.error }, out.status);
  return c.json({ person: out.person });
});

supplierAccess.post("/people/:id/link", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: "Person not found." }, 404);
  const link = await issueLink(dbFor(c.env), { userId: id, staffUserId: staff(c).id });
  if (!link) return c.json({ error: "This person is disabled. Enable them first." }, 409);
  return c.json({ link: { url: setupUrl(c, link.token), expiresAt: link.expiresAt, purpose: link.purpose } });
});

// ── Pickup requests ─────────────────────────────────────────────────────────────────────────────────────────────

export const supplierPickups = new Hono<{ Bindings: Env }>();
const PICKUP_PAGE = "scm.procurement.po";
supplierPickups.use("*", requirePageAccess(PICKUP_PAGE, "view"));
const mayAct = requirePageAccess(PICKUP_PAGE, "edit");

/** Suppliers whose access is on: the only ones a request can be sent to. */
supplierPickups.get("/suppliers", async (c) => {
  const rows = (await listAccess(dbFor(c.env))).filter((s) => s.enabled);
  return c.json({ suppliers: rows.map((s) => ({ id: s.supplierId, code: s.code, name: s.name })) });
});

supplierPickups.get("/eligible", async (c) => {
  const supplierId = c.req.query("supplierId") ?? "";
  if (!isUuid(supplierId)) return c.json({ error: "Choose a supplier." }, 400);
  return c.json({ lines: await eligibleLines(dbFor(c.env), supplierId) });
});

supplierPickups.get("/", async (c) => {
  const supplierId = c.req.query("supplierId");
  return c.json({ rows: await listPickups(dbFor(c.env), { supplierId: isUuid(supplierId) ? supplierId : null, status: c.req.query("status") ?? null }) });
});

supplierPickups.post("/", mayAct, async (c) => {
  const out = await createPickup(dbFor(c.env), await body<CreateInput>(c), staff(c));
  if (!out.ok) return c.json({ error: out.error }, out.status);
  return c.json({ pickup: out.pickup }, 201);
});

supplierPickups.get("/:id", async (c) => {
  const pickup = await getPickup(dbFor(c.env), c.req.param("id"));
  if (!pickup) return c.json({ error: "Pickup request not found." }, 404);
  return c.json({ pickup });
});

supplierPickups.post("/:id/collect", mayAct, async (c) => {
  const out = await collectPickup(dbFor(c.env), c.req.param("id"), staff(c));
  if (!out.ok) return c.json({ error: out.error }, out.status);
  return c.json({ pickup: out.pickup });
});

supplierPickups.post("/:id/cancel", mayAct, async (c) => {
  const b = await body<{ reason?: unknown }>(c);
  const out = await cancelPickup(dbFor(c.env), c.req.param("id"), b.reason, staff(c));
  if (!out.ok) return c.json({ error: out.error }, out.status);
  return c.json({ pickup: out.pickup });
});
