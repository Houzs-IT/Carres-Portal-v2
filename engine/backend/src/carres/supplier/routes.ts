// Carres only (not part of Houzs's code): the Supplier Platform's public API, /api/carres-supplier/*.
//
// This is the ONLY surface a supplier's browser talks to. It is mounted BEFORE the staff sign-in gate (index.ts), so
// no staff session is involved, and it carries its own gate: a bearer token found in carres_supplier_sessions
// (./session.ts). Three rules hold for every route below:
//   1. The supplier is the one in the SESSION. No route reads a supplier id from the address, the query or the body.
//   2. A read answers only the fields named in ./orders.ts, ./pickups.ts and ./finance.ts.
//   3. Something that is not this supplier's answers 404, the same as something that does not exist.
// Answers are never cached (Cache-Control: no-store).
import { Hono, type Context, type MiddlewareHandler } from "hono";
import type { Env } from "../../types";
import { clientIp } from "../../middleware/rateLimit";
import { dbFor, type Db } from "./db";
import { callerAddress } from "./credentials";
import { changePassword, readLink, resolveSession, signIn, signOut, useLink, type SupplierUser } from "./session";
import { getForecast, getOrder, listOrders } from "./orders";
import { acceptPickup, getSupplierPickup, listSupplierPickups, pickupsWaiting } from "./pickups";
import { financeAgreement, financeSummary } from "./finance";

type Vars = { supplier: SupplierUser; sdb: Db; stoken: string };
type Ctx = Context<{ Bindings: Env; Variables: Vars }>;

const app = new Hono<{ Bindings: Env; Variables: Vars }>();

app.use("*", async (c, next) => {
  await next();
  c.header("Cache-Control", "no-store");
});

app.onError((err, c) => {
  console.error("[carres-supplier]", err instanceof Error ? err.message : String(err));
  return c.json({ error: "Something went wrong. Try again in a moment." }, 500);
});

/** The engine's address helper is typed for a context with no variables; it reads only a header. */
const plain = (c: Ctx): Context<{ Bindings: Env }> => c as unknown as Context<{ Bindings: Env }>;

/** The caller's OWN address, or null when the request arrives under an address every caller shares: through the
 *  engine site's /api proxy that is every browser. It is written down beside a sign-in. It is never counted and
 *  never a limit (./credentials.ts callerAddress says why): what limits guessing is the count per email in
 *  ./session.ts, and a link's secret is 32 random bytes, which needs no limit to stay unguessed. */
const caller = (c: Ctx): string | null => callerAddress(clientIp(plain(c)));

const bearer = (c: Ctx): string => {
  const header = c.req.header("Authorization") || "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : "";
};

/** A supplier's requests are a few fields. */
const MAX_BODY_BYTES = 20_000;

/** A small JSON body, or null. Anything larger is refused, and never read past the limit even when the request does
 *  not say how long it is: these routes answer before any sign-in, so an outsider chooses what is sent to them. */
async function body(c: Ctx): Promise<Record<string, unknown> | null> {
  if (Number(c.req.header("content-length") ?? 0) > MAX_BODY_BYTES) return null;
  const stream = c.req.raw.body;
  if (!stream) return null;
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.byteLength;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
}

const me = (u: SupplierUser, pickupsToAccept: number) => ({
  user: { name: u.name, email: u.email, canOperation: u.canOperation, canFinance: u.canFinance },
  supplier: { name: u.supplierName, code: u.supplierCode },
  badges: { pickupsToAccept },
});

// ── No session needed: sign in, and choosing a password through a one-time link ─────────────────────────────────

app.post("/auth/login", async (c) => {
  const b = await body(c);
  const db = dbFor(c.env);
  const out = await signIn(db, { email: b?.email, password: b?.password, ip: caller(c), userAgent: c.req.header("User-Agent") ?? null });
  if (!out.ok) return c.json({ error: out.error }, out.status);
  const waiting = out.user.canOperation ? await pickupsWaiting(db, out.user.supplierId) : 0;
  return c.json({ token: out.token, expiresAt: out.expiresAt, ...me(out.user, waiting) });
});

// The link's secret travels in the request BODY, never in the address, so it is not written to an access log.
app.post("/auth/link", async (c) => {
  const b = await body(c);
  const link = await readLink(dbFor(c.env), typeof b?.token === "string" ? b.token : "");
  if (!link) return c.json({ error: "This link is no longer valid. Ask Carres for a new one." }, 404);
  return c.json(link);
});

app.post("/auth/link/use", async (c) => {
  const b = await body(c);
  const out = await useLink(dbFor(c.env), { token: typeof b?.token === "string" ? b.token : "", password: b?.password, ip: caller(c) });
  if (!out.ok) return c.json({ error: out.error }, out.status);
  return c.json({ ok: true, email: out.email });
});

// ── Everything below needs a supplier session ───────────────────────────────────────────────────────────────────

const session: MiddlewareHandler<{ Bindings: Env; Variables: Vars }> = async (c, next) => {
  const token = bearer(c);
  if (!token) return c.json({ error: "Please sign in." }, 401);
  const db = dbFor(c.env);
  const user = await resolveSession(db, token);
  if (!user) return c.json({ error: "Your session has ended. Please sign in again." }, 401);
  c.set("supplier", user);
  c.set("sdb", db);
  c.set("stoken", token);
  await next();
};
app.use("*", session);

const operation: MiddlewareHandler<{ Bindings: Env; Variables: Vars }> = async (c, next) => {
  if (!c.get("supplier").canOperation) return c.json({ error: "Your account does not open this page." }, 403);
  await next();
};
const finance: MiddlewareHandler<{ Bindings: Env; Variables: Vars }> = async (c, next) => {
  if (!c.get("supplier").canFinance) return c.json({ error: "Your account does not open this page." }, 403);
  await next();
};

app.get("/auth/me", async (c) => {
  const u = c.get("supplier");
  return c.json(me(u, u.canOperation ? await pickupsWaiting(c.get("sdb"), u.supplierId) : 0));
});

app.post("/auth/logout", async (c) => {
  await signOut(c.get("sdb"), c.get("stoken"));
  return c.json({ ok: true });
});

app.post("/auth/password", async (c) => {
  const b = await body(c);
  const out = await changePassword(c.get("sdb"), c.get("supplier"), {
    current: b?.current, next: b?.next, ip: caller(c), userAgent: c.req.header("User-Agent") ?? null,
  });
  if (!out.ok) return c.json({ error: out.error }, out.status);
  return c.json({ token: out.token, expiresAt: out.expiresAt });
});

// Warehouse and Operation ────────────────────────────────────────────────────────────────────────────────────────

app.get("/orders", operation, async (c) => {
  const q = c.req.query();
  return c.json(await listOrders(c.get("sdb"), c.get("supplier").supplierId, {
    view: q.view, q: q.q, page: Number(q.page), pageSize: Number(q.pageSize), sort: q.sort, dir: q.dir,
  }));
});

app.get("/orders/:docNo", operation, async (c) => {
  const order = await getOrder(c.get("sdb"), c.get("supplier").supplierId, c.req.param("docNo"));
  if (!order) return c.json({ error: "Sales Order not found." }, 404);
  return c.json({ order });
});

app.get("/forecast", operation, async (c) => c.json(await getForecast(c.get("sdb"), c.get("supplier").supplierId)));

app.get("/pickups", operation, async (c) => {
  return c.json({ rows: await listSupplierPickups(c.get("sdb"), c.get("supplier").supplierId, c.req.query("status") ?? null) });
});

app.get("/pickups/:id", operation, async (c) => {
  const pickup = await getSupplierPickup(c.get("sdb"), c.req.param("id"), c.get("supplier").supplierId);
  if (!pickup) return c.json({ error: "Pickup request not found." }, 404);
  return c.json({ pickup });
});

app.post("/pickups/:id/accept", operation, async (c) => {
  const u = c.get("supplier");
  const out = await acceptPickup(c.get("sdb"), c.req.param("id"), { supplierId: u.supplierId, userId: u.id, userName: u.name, ip: caller(c) });
  if (!out.ok) return c.json({ error: out.error }, out.status);
  return c.json({ pickup: out.pickup });
});

// Finance ────────────────────────────────────────────────────────────────────────────────────────────────────────
// Only the supplier Carres named as the one paid a share of subscription collections has figures to read; any
// other supplier's Finance person gets an empty answer, never another supplier's money.

app.get("/finance/summary", finance, async (c) => {
  if (!c.get("supplier").subscriptionShare) return c.json({ shared: false });
  const out = await financeSummary(c.env);
  if (!out.ok) return c.json({ error: out.error }, out.status);
  return c.json({ shared: true, ...out.body });
});

app.get("/finance/orders/:id", finance, async (c) => {
  if (!c.get("supplier").subscriptionShare) return c.json({ error: "Order not found." }, 404);
  const id = c.req.param("id");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return c.json({ error: "Order not found." }, 404);
  const out = await financeAgreement(c.env, id);
  if (!out.ok) return c.json({ error: out.error }, out.status);
  return c.json(out.body);
});

app.all("*", (c) => c.json({ error: "Not found." }, 404));

export default app;
