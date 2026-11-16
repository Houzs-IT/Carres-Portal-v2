// Carres only (not part of Houzs's code): the Carres portal's Alerts bell asks which supplier asks wait for Carres.
//
// A supplier may only ASK for a new pickup day or a cancel; nothing changes until Carres approves it in Supplier
// Pickups (owner ruling, 17 Nov 2026). An ask nobody sees runs out: the lorry still goes on the old day, and once the
// asked-for day has passed the ask can only be declined. So the ask must reach Carres where staff already look: the
// portal's Alerts bell (owner, 17 Nov 2026: "need show up in portal notification"). The portal's server reads the
// waiting asks here and the bell lists them; answering one in Supplier Pickups takes it off the bell, because the
// bell reads the asks themselves and keeps no copy.
//
// TRUST: server to server only, never a browser. The portal signs `supplier-asks.<ts>.<raw body>` with HMAC-SHA256
// under the secret the two Workers already share for single sign-on (CARRES_SSO_SECRET here, SCM_ENGINE_SSO_SECRET on
// the portal). The purpose word keeps this signature from passing as a sign-on assertion, a staff-account call or a
// finance call, and the reverse; the time bounds a replay to one minute. Mounted BEFORE the staff gate
// (src/index.ts): there is no staff session, the signature is the trust boundary. The answer names only what the
// bell shows; the portal decides which of its people see the bell (apps/api/src/routes/operation/scm-engine.ts).
import { Hono } from "hono";
import type { Env } from "../../types";
import { dbFor, int, str, strOrNull, type Db } from "./db";

export const ASKS_PURPOSE = "supplier-asks";
const MAX_SKEW_MS = 60_000;
/** The bell lists the oldest asks first; past this many it says how many more wait. */
export const MAX_ASKS = 50;
const MAX_BODY_BYTES = 1_000;

const fromB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

/** Whether `signature` is the portal's, over this body, made within the last minute. */
export async function verifyPortalRequest(secret: string, ts: string, signature: string, body: string, now = Date.now()): Promise<boolean> {
  if (!/^\d{10,16}$/.test(ts) || Math.abs(now - Number(ts)) > MAX_SKEW_MS) return false;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  try {
    return await crypto.subtle.verify("HMAC", key, fromB64url(signature), enc.encode(`${ASKS_PURPOSE}.${ts}.${body}`));
  } catch {
    return false;
  }
}

export interface WaitingAsk {
  id: string;
  requestNo: string;
  supplierName: string;
  kind: "date" | "cancel";
  /** The day the supplier asks for (a move only). */
  askDate: string | null;
  /** The day the pickup is on now. */
  expectedDate: string;
  askedAt: string;
}

/** The asks waiting for Carres's answer, oldest first, and how many there are in all. */
export async function waitingAsks(db: Db): Promise<{ count: number; asks: WaitingAsk[] }> {
  const rows = await db.query(
    `SELECT pr.id::text AS id, pr.request_no, s.name AS supplier_name, pr.ask_kind, pr.ask_date::text AS ask_date,
            pr.expected_date::text AS expected_date,
            to_char(pr.ask_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS asked_at
       FROM public.carres_pickup_requests pr
       JOIN scm.suppliers s ON s.id = pr.supplier_id
      WHERE pr.ask_kind IS NOT NULL
      ORDER BY pr.ask_at, pr.request_no
      LIMIT $1`,
    [MAX_ASKS],
  );
  const counted = await db.query(`SELECT count(*)::int AS n FROM public.carres_pickup_requests WHERE ask_kind IS NOT NULL`);
  return {
    count: int(counted[0]?.n),
    asks: rows.map((r) => ({
      id: str(r.id),
      requestNo: str(r.request_no),
      supplierName: str(r.supplier_name),
      kind: str(r.ask_kind) === "cancel" ? "cancel" : "date",
      askDate: strOrNull(r.ask_date),
      expectedDate: str(r.expected_date),
      askedAt: str(r.asked_at),
    })),
  };
}

type PortalEnv = Env & { CARRES_SSO_SECRET?: string };
const app = new Hono<{ Bindings: PortalEnv }>();

app.post("/supplier-asks", async (c) => {
  const refused = c.json({ error: "Not allowed." }, 401);
  const secret = c.env.CARRES_SSO_SECRET;
  if (!secret || secret.length < 32) return c.json({ error: "Not set up." }, 501);
  const ts = c.req.header("x-carres-portal-ts") ?? "";
  const signature = c.req.header("x-carres-portal-signature") ?? "";
  if (!ts || !signature || Number(c.req.header("content-length") ?? 0) > MAX_BODY_BYTES) return refused;
  const raw = await c.req.text();
  if (raw.length > MAX_BODY_BYTES || !(await verifyPortalRequest(secret, ts, signature, raw))) return refused;
  return c.json(await waitingAsks(dbFor(c.env)));
});

app.all("*", (c) => c.json({ error: "Not found." }, 404));

export default app;
