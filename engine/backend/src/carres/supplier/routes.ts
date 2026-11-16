// Carres only (not part of Houzs's code): the Supplier Platform's public API, /api/carres-supplier/*.
//
// This is the ONLY surface a supplier's browser talks to. It is mounted BEFORE the staff sign-in gate (index.ts), so
// no staff session is involved, and it carries its own gate: a bearer token found in carres_supplier_sessions
// (./session.ts). Four rules hold for every route below:
//   1. The supplier is the one in the SESSION. No route reads a supplier id from the address, the query or the body.
//   2. A read answers only the fields named in ./orders.ts, ./pickups.ts, ./people.ts and ./finance.ts.
//   3. Something that is not this supplier's answers 404, the same as something that does not exist.
//   4. Each page and each button is checked against what the person holds (./perms.ts), here on the server: a page
//      or a button their admin turned off is refused, whatever the screen draws.
// Answers are never cached (Cache-Control: no-store).
import { Hono, type Context, type MiddlewareHandler } from "hono";
import type { Env } from "../../types";
import { clientIp } from "../../middleware/rateLimit";
import { afterResponse } from "../../lib/after-response";
import { dbFor, type Db } from "./db";
import { callerAddress } from "./credentials";
import { changePassword, readLink, resolveSession, signIn, signOut, useLink, type SupplierUser } from "./session";
import { getForecast, getOrder, listOrders } from "./orders";
import {
  acceptPickup, acceptPickups, askPickupChange, checkCollectable, deliveryOrderFile, getSupplierPickup, listSupplierPickups,
  markPickupsCollected, pickupIds, pickupsWaiting, withdrawPickupAsk, type StoredDeliveryOrder, type SupplierActor,
} from "./pickups";
import { filterAgreement, filterSummary, financeAgreement, financeSummary, type FinanceVisible } from "./finance";
import { holds, isDepartment, type Department } from "./perms";
import { addOwnPerson, listOwnPeople, removeOwnPerson, updateOwnPerson } from "./people";
import { sendInvite } from "./invite";
import { sendResetLink } from "./reset";
import { MAX_DO_BYTES, MAX_UPLOAD_BYTES, attachmentHeader, deliveryOrderKey, deliveryOrderName, fileStore, isPdf } from "./files";
import { noticeSupplierAsk, takeDownAskNotice } from "./ask-notice";

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
  user: {
    id: u.id, name: u.name, email: u.email, canOperation: u.canOperation, canFinance: u.canFinance,
    mustChangePassword: u.mustChangePassword,
    perms: { operation: [...u.perms.operation], finance: [...u.perms.finance] },
  },
  supplier: { name: u.supplierName, code: u.supplierCode },
  badges: { pickupsToAccept },
});

/** The number on the Pickup Requests tab, for a person who sees that page. */
const waitingFor = async (db: Db, u: SupplierUser): Promise<number> =>
  (u.canOperation && holds(u, "operation", "v_pickups") ? pickupsWaiting(db, u.supplierId) : 0);

// ── No session needed: sign in, and choosing a password through a one-time link ─────────────────────────────────

app.post("/auth/login", async (c) => {
  const b = await body(c);
  const db = dbFor(c.env);
  const out = await signIn(db, { email: b?.email, password: b?.password, ip: caller(c), userAgent: c.req.header("User-Agent") ?? null });
  if (!out.ok) return c.json({ error: out.error }, out.status);
  return c.json({ token: out.token, expiresAt: out.expiresAt, ...me(out.user, await waitingFor(db, out.user)) });
});

// The link's secret travels in the request BODY, never in the address, so it is not written to an access log.
app.post("/auth/link", async (c) => {
  const b = await body(c);
  const link = await readLink(dbFor(c.env), typeof b?.token === "string" ? b.token : "");
  if (!link) return c.json({ error: "This link is no longer valid. Ask Carres for a new one." }, 404);
  return c.json(link);
});

// Choosing the password signs the person in (./session.ts useLink says why), so the answer is the one signing in
// gives. With the supplier's access off it carries no token: the password is saved and the page says to sign in.
app.post("/auth/link/use", async (c) => {
  const b = await body(c);
  const db = dbFor(c.env);
  const out = await useLink(db, {
    token: typeof b?.token === "string" ? b.token : "", password: b?.password, ip: caller(c), userAgent: c.req.header("User-Agent") ?? null,
  });
  if (!out.ok) return c.json({ error: out.error }, out.status);
  if (!out.session) return c.json({ ok: true, email: out.email });
  const { token, expiresAt, user } = out.session;
  return c.json({ ok: true, email: out.email, token, expiresAt, ...me(user, await waitingFor(db, user)) });
});

// Forgot password (./reset.ts). The answer is the same for every email, and it leaves BEFORE anything is looked
// up: the link is made and emailed after it. So neither the words nor the time they take say whether an email
// signs in here. Only the email is read from the body.
app.post("/auth/forgot", async (c) => {
  const b = await body(c);
  const env = c.env;
  const input = { email: b?.email, ip: caller(c) };
  await afterResponse("carres-supplier forgot password", () => sendResetLink(env, input));
  return c.json({ ok: true });
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

// Who is signed in, signing out and changing one's password: these three answer even while the person still has to
// choose their own password (the gate below). Registered first, so a request for them never reaches that gate.

app.get("/auth/me", async (c) => {
  const u = c.get("supplier");
  return c.json(me(u, await waitingFor(c.get("sdb"), u)));
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

/** A person whose admin gave them a password, and asked them to choose their own, does that before anything else. */
const ownPasswordFirst: MiddlewareHandler<{ Bindings: Env; Variables: Vars }> = async (c, next) => {
  if (c.get("supplier").mustChangePassword) {
    return c.json({ error: "Choose a new password first.", code: "must_change_password" }, 403);
  }
  await next();
};
app.use("*", ownPasswordFirst);

const operation: MiddlewareHandler<{ Bindings: Env; Variables: Vars }> = async (c, next) => {
  if (!c.get("supplier").canOperation) return c.json({ error: "Your account does not open this page." }, 403);
  await next();
};
const finance: MiddlewareHandler<{ Bindings: Env; Variables: Vars }> = async (c, next) => {
  if (!c.get("supplier").canFinance) return c.json({ error: "Your account does not open this page." }, 403);
  await next();
};

const NOT_ALLOWED = "Your account does not allow this.";

/** The person holds at least one of these keys in the department (./perms.ts). */
const need = (department: Department, ...keys: string[]): MiddlewareHandler<{ Bindings: Env; Variables: Vars }> => async (c, next) => {
  const u = c.get("supplier");
  if (!keys.some((k) => holds(u, department, k))) return c.json({ error: NOT_ALLOWED }, 403);
  await next();
};

const actor = (c: Ctx): SupplierActor => {
  const u = c.get("supplier");
  return { supplierId: u.supplierId, userId: u.id, userName: u.name, ip: caller(c) };
};

// Warehouse and Operation ────────────────────────────────────────────────────────────────────────────────────────

app.get("/orders", operation, need("operation", "v_orders"), async (c) => {
  const q = c.req.query();
  return c.json(await listOrders(c.get("sdb"), c.get("supplier").supplierId, {
    view: q.view, q: q.q, page: Number(q.page), pageSize: Number(q.pageSize), sort: q.sort, dir: q.dir,
  }));
});

app.get("/orders/:docNo", operation, need("operation", "v_orders"), async (c) => {
  const order = await getOrder(c.get("sdb"), c.get("supplier").supplierId, c.req.param("docNo"));
  if (!order) return c.json({ error: "Sales Order not found." }, 404);
  return c.json({ order });
});

app.get("/forecast", operation, need("operation", "v_forecast"), async (c) => c.json(await getForecast(c.get("sdb"), c.get("supplier").supplierId)));

app.get("/pickups", operation, need("operation", "v_pickups"), async (c) => {
  return c.json({ rows: await listSupplierPickups(c.get("sdb"), c.get("supplier").supplierId, c.req.query("status") ?? null) });
});

// Several requests accepted with one press, all or none.
app.post("/pickups/accept", operation, need("operation", "v_pickups"), need("operation", "a_accept"), async (c) => {
  const ids = pickupIds((await body(c))?.ids);
  if (!ids) return c.json({ error: "Choose the pickup requests to accept." }, 400);
  const out = await acceptPickups(c.get("sdb"), ids, actor(c));
  if (!out.ok) return c.json({ error: out.error }, out.status);
  return c.json({ pickups: out.pickups });
});

const TOO_LARGE = "The files are too large. Upload at most 10 MB a file.";
const UNREADABLE = "The upload could not be read. Try again.";
const NO_STORE = "Uploads are not set up yet. Ask Carres.";

// Accepted requests marked collected, each with the Delivery Order Carres signed: one PDF for all of them ("one"), or
// one PDF each ("each", the field file_<id>). The files are checked before anything is stored, stored before the
// requests move, and taken away again if the requests could not move.
app.post("/pickups/collect", operation, need("operation", "v_pickups"), need("operation", "a_collect"), async (c) => {
  // A browser says how long an upload is: one larger than every file allowed together is refused before it is read.
  // (Without the header, each file's own limit below still holds.)
  if (Number(c.req.header("content-length") ?? 0) > MAX_UPLOAD_BYTES) return c.json({ error: TOO_LARGE }, 413);
  let form: FormData;
  try { form = await c.req.raw.formData(); } catch { return c.json({ error: UNREADABLE }, 400); }

  let idsRaw: unknown = null;
  try { idsRaw = JSON.parse(String(form.get("ids") ?? "")); } catch { idsRaw = null; }
  const ids = pickupIds(idsRaw);
  if (!ids) return c.json({ error: "Choose the pickups to mark collected." }, 400);
  const mode = form.get("mode");
  if (mode !== "one" && mode !== "each") return c.json({ error: UNREADABLE }, 400);

  const fileFor = new Map<string, File>();
  if (mode === "one") {
    const f = form.get("file");
    if (!(f instanceof File)) return c.json({ error: "Attach the Delivery Order (PDF)." }, 400);
    for (const id of ids) fileFor.set(id, f);
  } else {
    for (const id of ids) {
      const f = form.get(`file_${id}`);
      if (!(f instanceof File)) return c.json({ error: "Attach the Delivery Order for every pickup." }, 400);
      fileFor.set(id, f);
    }
  }
  const files = [...new Set(fileFor.values())];
  const contents = new Map<File, Uint8Array>();
  for (const f of files) {
    if (f.size > MAX_DO_BYTES) return c.json({ error: TOO_LARGE }, 413);
    const bytes = new Uint8Array(await f.arrayBuffer());
    if (!bytes.byteLength) return c.json({ error: "A Delivery Order file is empty." }, 400);
    if (!isPdf(bytes)) return c.json({ error: "A Delivery Order must be a PDF file." }, 400);
    contents.set(f, bytes);
  }

  const u = c.get("supplier");
  const db = c.get("sdb");
  const ready = await checkCollectable(db, ids, u.supplierId);
  if (!ready.ok) return c.json({ error: ready.error }, ready.status);
  const bucket = fileStore(c.env);
  if (!bucket) return c.json({ error: NO_STORE }, 503);

  // A file stored for requests that then could not move is taken away again: nothing is left behind unnamed.
  const stored = new Map<File, StoredDeliveryOrder>();
  const takeBack = () => Promise.all([...stored.values()].map((s) => bucket.delete(s.key).catch(() => undefined)));
  let out: Awaited<ReturnType<typeof markPickupsCollected>>;
  try {
    for (const f of files) {
      const key = deliveryOrderKey(u.supplierId);
      const bytes = contents.get(f)!;
      await bucket.put(key, bytes, { httpMetadata: { contentType: "application/pdf" } });
      stored.set(f, { key, name: deliveryOrderName(f.name), size: bytes.byteLength });
    }
    const byId = new Map(ids.map((id) => [id, stored.get(fileFor.get(id)!)!]));
    out = await markPickupsCollected(db, ids, byId, actor(c));
  } catch (e) {
    await takeBack();
    throw e;
  }
  if (!out.ok) {
    await takeBack();
    return c.json({ error: out.error }, out.status);
  }
  // Collected goods answer any ask that was still waiting on them (./pickups.ts clears it): its notice goes too.
  const env = c.env;
  const collected = out.pickups.map((p) => p.requestNo);
  await afterResponse("carres-supplier ask notice down", async () => {
    for (const no of collected) await takeDownAskNotice(env, no);
  });
  return c.json({ pickups: out.pickups });
});

app.get("/pickups/:id", operation, need("operation", "v_pickups"), async (c) => {
  const pickup = await getSupplierPickup(c.get("sdb"), c.req.param("id"), c.get("supplier").supplierId);
  if (!pickup) return c.json({ error: "Pickup request not found." }, 404);
  return c.json({ pickup });
});

app.get("/pickups/:id/do", operation, need("operation", "v_pickups"), async (c) => {
  const file = await deliveryOrderFile(c.get("sdb"), c.req.param("id"), c.get("supplier").supplierId);
  if (!file) return c.json({ error: "No Delivery Order on this pickup." }, 404);
  const bucket = fileStore(c.env);
  if (!bucket) return c.json({ error: NO_STORE }, 503);
  const obj = await bucket.get(file.key);
  if (!obj) return c.json({ error: "No Delivery Order on this pickup." }, 404);
  return c.body(obj.body, 200, {
    "Content-Type": "application/pdf", "Content-Disposition": attachmentHeader(file.name), "X-Content-Type-Options": "nosniff",
  });
});

app.post("/pickups/:id/accept", operation, need("operation", "v_pickups"), need("operation", "a_accept"), async (c) => {
  const out = await acceptPickup(c.get("sdb"), c.req.param("id"), actor(c));
  if (!out.ok) return c.json({ error: out.error }, out.status);
  return c.json({ pickup: out.pickup });
});

// The supplier ASKS Carres to move the day or to cancel; nothing moves until Carres approves (./pickups.ts).
app.post("/pickups/:id/ask", operation, need("operation", "v_pickups"), async (c) => {
  const b = await body(c);
  const key = b?.kind === "date" ? "a_date" : b?.kind === "cancel" ? "a_cancel" : null;
  if (!key) return c.json({ error: "Say what you are asking Carres for." }, 400);
  if (!holds(c.get("supplier"), "operation", key)) return c.json({ error: NOT_ALLOWED }, 403);
  const out = await askPickupChange(c.get("sdb"), c.req.param("id"), { kind: b?.kind, date: b?.date }, actor(c));
  if (!out.ok) return c.json({ error: out.error }, out.status);
  // The people who can answer it see it on their bell (./ask-notice.ts), after the answer leaves.
  const p = out.pickup;
  const env = c.env;
  await afterResponse("carres-supplier ask notice", () => noticeSupplierAsk(env, {
    requestNo: p.requestNo, supplierName: p.supplierName, kind: p.ask?.kind === "cancel" ? "cancel" : "date",
    currentDate: p.expectedDate, askDate: p.ask?.date ?? null,
  }));
  return c.json({ pickup: p });
});

app.post("/pickups/:id/ask/withdraw", operation, need("operation", "v_pickups"), async (c) => {
  const u = c.get("supplier");
  const now = await getSupplierPickup(c.get("sdb"), c.req.param("id"), u.supplierId);
  if (!now) return c.json({ error: "Pickup request not found." }, 404);
  if (!now.ask) return c.json({ error: "There is no request waiting for Carres on this pickup." }, 409);
  if (!holds(u, "operation", now.ask.kind === "date" ? "a_date" : "a_cancel")) return c.json({ error: NOT_ALLOWED }, 403);
  const out = await withdrawPickupAsk(c.get("sdb"), now.id, actor(c));
  if (!out.ok) return c.json({ error: out.error }, out.status);
  const env = c.env;
  const requestNo = out.pickup.requestNo;
  await afterResponse("carres-supplier ask notice down", () => takeDownAskNotice(env, requestNo));
  return c.json({ pickup: out.pickup });
});

// Finance ────────────────────────────────────────────────────────────────────────────────────────────────────────
// Only the supplier Carres named as the one paid a share of subscription collections has figures to read; any
// other supplier's Finance person gets an empty answer, never another supplier's money. What a person may see of the
// figures is taken out before the answer leaves (./finance.ts filterSummary).

const visibleTo = (u: SupplierUser): FinanceVisible => ({
  names: holds(u, "finance", "d_names"), share: holds(u, "finance", "d_share"), bad: holds(u, "finance", "d_bad"),
});

app.get("/finance/summary", finance, need("finance", "v_coll", "v_month"), async (c) => {
  const u = c.get("supplier");
  if (!u.subscriptionShare) return c.json({ shared: false });
  const out = await financeSummary(c.env);
  if (!out.ok) return c.json({ error: out.error }, out.status);
  const visible = visibleTo(u);
  return c.json({ shared: true, ...filterSummary(out.body, visible), visible });
});

app.get("/finance/orders/:id", finance, need("finance", "v_coll", "v_month"), async (c) => {
  const u = c.get("supplier");
  if (!u.subscriptionShare) return c.json({ error: "Order not found." }, 404);
  const id = c.req.param("id");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return c.json({ error: "Order not found." }, 404);
  const out = await financeAgreement(c.env, id);
  if (!out.ok) return c.json({ error: out.error }, out.status);
  const visible = visibleTo(u);
  return c.json({ ...filterAgreement(out.body, visible), visible });
});

// Settings › Users and access ───────────────────────────────────────────────────────────────────────────────────
// A supplier's admin manages their own company's people, in a department where they hold Manage users (./people.ts).

/** The department named in the query or the body, which the person must manage. */
async function managed(c: Ctx, raw: unknown): Promise<Department | Response> {
  if (!isDepartment(raw)) return c.json({ error: "Choose a department." }, 400);
  if (!holds(c.get("supplier"), raw, "a_users")) return c.json({ error: NOT_ALLOWED }, 403);
  return raw;
}

app.get("/users", async (c) => {
  const department = await managed(c, c.req.query("department"));
  if (department instanceof Response) return department;
  return c.json({ users: await listOwnPeople(c.get("sdb"), c.get("supplier"), department) });
});

app.post("/users", async (c) => {
  const b = await body(c);
  const department = await managed(c, b?.department);
  if (department instanceof Response) return department;
  const u = c.get("supplier");
  const out = await addOwnPerson(c.get("sdb"), u, department, {
    name: b?.name, email: b?.email, how: b?.how, password: b?.password, mustChange: b?.mustChange, perms: b?.perms,
  });
  if (!out.ok) return c.json({ error: out.error }, out.status);
  if (!out.linkToken) return c.json({ user: out.person, mailed: null, mailNote: null });
  const sent = await sendInvite(c.env, { to: out.person.email, name: out.person.name, inviterName: u.name, supplierName: u.supplierName, token: out.linkToken });
  return c.json({ user: out.person, mailed: sent.status === "sent", mailNote: sent.status === "sent" ? null : sent.reason });
});

app.patch("/users/:id", async (c) => {
  const b = await body(c);
  const department = await managed(c, b?.department);
  if (department instanceof Response) return department;
  const out = await updateOwnPerson(c.get("sdb"), c.get("supplier"), department, Number(c.req.param("id")), {
    name: b?.name, perms: b?.perms,
  });
  if (!out.ok) return c.json({ error: out.error }, out.status);
  return c.json({ user: out.person });
});

app.post("/users/:id/remove", async (c) => {
  const b = await body(c);
  const department = await managed(c, b?.department);
  if (department instanceof Response) return department;
  const out = await removeOwnPerson(c.get("sdb"), c.get("supplier"), department, Number(c.req.param("id")));
  if (!out.ok) return c.json({ error: out.error }, out.status);
  return c.json({ ok: true });
});

app.all("*", (c) => c.json({ error: "Not found." }, 404));

export default app;
