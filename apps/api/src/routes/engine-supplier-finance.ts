import { Hono, type Context } from "hono";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  supplierFinanceInstalments,
  supplierFinanceOrder,
  supplierFinanceSummary,
  type SupplierFinanceAgreementRow,
  type SupplierFinanceBillingRow,
} from "@carres/shared";
import { adminClient } from "../lib/supabase";
import { todayIsoMYT } from "../lib/today";
import type { AppEnv } from "../types";

/**
 * Subscription collections for the Supplier Platform's Finance pages (owner, 15 Nov 2026).
 *
 * A supplier signs in to the engine's supplier pages (engine/backend/src/carres/supplier/). Its Finance people read
 * the subscription money their company has a share in: what each order is worth, which months were collected, what
 * is still to come, and who is behind. That money lives HERE (rental_agreements, rental_billings; Stripe reports
 * into them), so the engine asks this route and passes the answer on.
 *
 * TRUST: server to server only, never a browser, and never a supplier. The engine signs
 * `supplier-finance.<ts>.<raw body>` with HMAC-SHA256 under the secret the two Workers already share
 * (SCM_ENGINE_SSO_SECRET here, CARRES_SSO_SECRET on the engine). The purpose word keeps a signature made for
 * sign-on or for staff accounts from passing here; the timestamp bounds replay to one minute. Mounted OUTSIDE the
 * signed-in /api group: there is no Supabase JWT, the signature is the trust boundary.
 *
 * WHAT LEAVES: the columns selected below and nothing else. No Stripe id, payment reference or method, no
 * commission, no phone, email, identity number or signature. The engine answers a supplier only the fields it
 * names again one by one (engine/backend/src/carres/supplier/finance.ts).
 *
 * WHICH AGREEMENTS: every approved agreement that pays a supplier share. Subscription plans do not name their
 * supplier yet (docs/rental/MASTER.md §0: "for now the only supplier is Diglant"), so the engine shows these
 * figures to ONE supplier, the one Settings › Supplier Access marks as the subscription supplier.
 *
 * READ-ONLY: this route writes nothing.
 */
const router = new Hono<AppEnv>();

const MAX_SKEW_MS = 60_000;
/** Above this, the read below (agreements with their instalments, a page at a time) is the wrong tool: the
 *  figures should then be summed in the database. Refused loudly instead of answered slowly or partly. */
export const MAX_AGREEMENTS = 5000;
const PAGE = 500;

const enc = new TextEncoder();
const fromB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (ch) => ch.charCodeAt(0));
const b64url = (bytes: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const signedText = (ts: string, body: string) => `supplier-finance.${ts}.${body}`;

/** What the engine sends (engine/backend/src/carres/supplier/finance.ts signs the same way). Exported for tests. */
export async function signFinanceRequest(secret: string, body: string, now = Date.now()): Promise<{ ts: string; signature: string }> {
  const ts = String(now);
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return { ts, signature: b64url(await crypto.subtle.sign("HMAC", key, enc.encode(signedText(ts, body)))) };
}

export async function verifyFinanceRequest(
  secret: string, ts: string | undefined, signature: string | undefined, body: string, now = Date.now(),
): Promise<boolean> {
  if (!ts || !signature || !/^\d{10,16}$/.test(ts)) return false;
  if (Math.abs(now - Number(ts)) > MAX_SKEW_MS) return false;
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  try {
    return await crypto.subtle.verify("HMAC", key, fromB64url(signature), enc.encode(signedText(ts, body)));
  } catch {
    return false;
  }
}

/** Agreements that are orders to a supplier: approved (they have a schedule) and paying a supplier share. */
const NOT_ORDERS = ["pending_approval", "rejected"];

const AGREEMENT_COLUMNS =
  "id, agreement_no, so_doc_no, sku, term_months, monthly_fee, supplier_rate_pct, start_date, status, " +
  "customers!rental_agreements_customer_id_fkey(name), " +
  "orders!rental_agreements_order_id_fkey(so), " +
  "rental_billings!rental_billings_agreement_id_fkey(seq, due_date, amount_due, status, paid_at, paid_amount, supplier_share)";

type Raw = Record<string, unknown>;
const num = (v: unknown): number => Number(v ?? 0);
const one = (v: unknown): Raw | null => (Array.isArray(v) ? ((v[0] as Raw | undefined) ?? null) : ((v as Raw | null) ?? null));

/** The Kuala Lumpur day a payment was received. */
const dayMYT = (iso: unknown): string | null => {
  const at = typeof iso === "string" ? Date.parse(iso) : NaN;
  return Number.isFinite(at) ? new Date(at + 8 * 3_600_000).toISOString().slice(0, 10) : null;
};

/** The Sales Order a supplier knows: the engine's, the one on its Sales Orders page (0781), when the agreement
 *  names it; otherwise the portal order it was sold through. */
function soNoOf(raw: Raw): string | null {
  const engine = typeof raw.so_doc_no === "string" ? raw.so_doc_no.trim() : "";
  if (engine) return engine;
  const so = one(raw.orders)?.so;
  return so == null ? null : `SO-${String(so)}`;
}

function toRows(raw: Raw, itemNames: Map<string, string>): { agreement: SupplierFinanceAgreementRow; billings: SupplierFinanceBillingRow[] } {
  const id = String(raw.id);
  const sku = String(raw.sku ?? "");
  return {
    agreement: {
      id,
      agreementNo: String(raw.agreement_no ?? ""),
      soNo: soNoOf(raw),
      customerName: String(one(raw.customers)?.name ?? ""),
      item: itemNames.get(sku) || sku,
      termMonths: num(raw.term_months),
      monthlyFee: num(raw.monthly_fee),
      ratePct: num(raw.supplier_rate_pct),
      startDate: raw.start_date == null ? null : String(raw.start_date),
      status: String(raw.status ?? ""),
    },
    billings: (Array.isArray(raw.rental_billings) ? (raw.rental_billings as Raw[]) : []).map((b) => ({
      agreementId: id,
      seq: num(b.seq),
      dueDate: String(b.due_date),
      amountDue: num(b.amount_due),
      status: String(b.status ?? ""),
      paidOn: dayMYT(b.paid_at),
      paidAmount: b.paid_amount == null ? null : num(b.paid_amount),
      supplierShare: b.supplier_share == null ? null : num(b.supplier_share),
    })),
  };
}

async function itemNamesFor(sb: SupabaseClient, skus: string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  const unique = [...new Set(skus.filter(Boolean))];
  for (let i = 0; i < unique.length; i += 200) {
    const { data, error } = await sb.from("product_skus").select("sku, description").in("sku", unique.slice(i, i + 200));
    if (error) throw new Error(error.message);
    for (const r of (data ?? []) as Raw[]) {
      const description = String(r.description ?? "").trim();
      if (description) names.set(String(r.sku), description);
    }
  }
  return names;
}

/** The engine sends `{"view":"summary"}` or `{"view":"agreement","id":"<uuid>"}`: well under this. */
export const MAX_BODY_BYTES = 2_000;

/** The request body as text, or null when it is longer than the engine ever sends. Read a piece at a time and
 *  dropped at the limit, so a body that does not say how long it is cannot be poured into memory either. */
async function smallBody(c: Context<AppEnv>): Promise<string | null> {
  if (Number(c.req.header("content-length") ?? 0) > MAX_BODY_BYTES) return null;
  const stream = c.req.raw.body;
  if (!stream) return "";
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
  return new TextDecoder().decode(bytes);
}

async function readSigned(c: Context<AppEnv>): Promise<{ ok: true; body: Raw } | { ok: false; res: Response }> {
  const secret = c.env.SCM_ENGINE_SSO_SECRET;
  if (!secret || secret.length < 32) {
    return { ok: false, res: c.json({ error: "not_set_up", message: "Supplier finance is not set up." }, 503) };
  }
  const refused = { ok: false as const, res: c.json({ error: "unauthorized", message: "Request could not be verified." }, 401) };
  // This door answers anyone on the internet. A call with no signature, or an old one, is refused BEFORE its body
  // is read, and no body is read past the few bytes the engine sends.
  const ts = c.req.header("x-carres-engine-ts");
  const signature = c.req.header("x-carres-engine-signature");
  if (!ts || !signature || !/^\d{10,16}$/.test(ts) || Math.abs(Date.now() - Number(ts)) > MAX_SKEW_MS) return refused;
  const raw = await smallBody(c);
  if (raw === null) return refused;
  const ok = await verifyFinanceRequest(secret, ts, signature, raw);
  if (!ok) return refused;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    return { ok: true, body: parsed as Raw };
  } catch {
    return { ok: false, res: c.json({ error: "invalid_input", message: "Body must be JSON." }, 422) };
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

router.post("/", async (c) => {
  const signed = await readSigned(c);
  if (!signed.ok) return signed.res;
  const sb = adminClient(c.env);
  const today = todayIsoMYT();

  if (signed.body.view === "agreement") {
    const id = String(signed.body.id ?? "");
    if (!UUID.test(id)) return c.json({ error: "not_found", message: "Order not found." }, 404);
    const { data, error } = await sb.from("rental_agreements").select(AGREEMENT_COLUMNS)
      .eq("id", id).gt("supplier_rate_pct", 0).not("status", "in", `(${NOT_ORDERS.join(",")})`).maybeSingle();
    if (error) return c.json({ error: "read_failed", message: "The figures could not be read." }, 500);
    const raw = data as Raw | null;
    if (!raw) return c.json({ error: "not_found", message: "Order not found." }, 404);
    const names = await itemNamesFor(sb, [String(raw.sku ?? "")]);
    const { agreement, billings } = toRows(raw, names);
    if (!billings.length) return c.json({ error: "not_found", message: "Order not found." }, 404);
    return c.json({
      asOf: today,
      order: supplierFinanceOrder(agreement, billings, today),
      instalments: supplierFinanceInstalments(agreement, billings, today),
    });
  }

  if (signed.body.view !== "summary") return c.json({ error: "invalid_input", message: "Unknown view." }, 422);

  const raws: Raw[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb.from("rental_agreements").select(AGREEMENT_COLUMNS)
      .gt("supplier_rate_pct", 0).not("status", "in", `(${NOT_ORDERS.join(",")})`)
      .order("created_at", { ascending: true }).order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) return c.json({ error: "read_failed", message: "The figures could not be read." }, 500);
    const page = (data ?? []) as unknown as Raw[];
    raws.push(...page);
    if (raws.length > MAX_AGREEMENTS) {
      return c.json({ error: "too_many", message: "There are too many subscription orders to total this way. Tell Carres IT." }, 503);
    }
    if (page.length < PAGE) break;
  }
  const names = await itemNamesFor(sb, raws.map((r) => String(r.sku ?? "")));
  const rows = raws.map((r) => toRows(r, names));
  return c.json(supplierFinanceSummary(rows.map((r) => r.agreement), rows.flatMap((r) => r.billings), today));
});

export default router;
