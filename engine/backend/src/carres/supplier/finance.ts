// Carres only (not part of Houzs's code): the supplier's Finance pages read subscription collections.
//
// WHERE THE MONEY LIVES. Subscription instalments, Stripe and the supplier's share are kept by the Carres portal
// (docs/rental/MASTER.md §0; rental_agreements, rental_billings), not by this engine. The portal works the figures
// out (its arithmetic, one place) and answers them to this Worker only, server to server, over the service binding
// the two Workers already share, signed with their shared secret. A supplier's browser never talks to the portal.
//
// WHAT COMES BACK is already limited by the portal (apps/api/src/routes/engine-supplier-finance.ts): no Stripe id,
// no payment reference, no commission, no phone, no identity number. `pickSummary` / `pickAgreement` below copy the
// named fields one by one, so a field the portal adds later still does not reach a supplier until it is named here.
import type { Env } from "../../types";

type FinanceEnv = Env & {
  CARRES_SSO_SECRET?: string;
  CARRES_PORTAL_API?: string;
  CARRES_PORTAL?: { fetch: (input: string, init?: RequestInit) => Promise<Response> };
};

export type FinanceResult<T> = { ok: true; body: T } | { ok: false; status: 502 | 503 | 404; error: string };

const b64url = (bytes: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** `supplier-finance.<ts>.<body>`: the purpose word keeps this signature from passing as a sign-on or a staff call. */
export async function signFinanceBody(secret: string, body: string, now = Date.now()): Promise<{ ts: string; signature: string }> {
  const ts = String(now);
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return { ts, signature: b64url(await crypto.subtle.sign("HMAC", key, enc.encode(`supplier-finance.${ts}.${body}`))) };
}

const NOT_SET_UP = "Finance is not set up yet. Ask Carres.";
const UNREACHABLE = "The figures could not be loaded. Try again in a moment.";

async function askPortal(env: Env, payload: object): Promise<FinanceResult<unknown>> {
  const e = env as FinanceEnv;
  if (!e.CARRES_SSO_SECRET || e.CARRES_SSO_SECRET.length < 32 || !(e.CARRES_PORTAL || e.CARRES_PORTAL_API)) {
    return { ok: false, status: 503, error: NOT_SET_UP };
  }
  const base = (e.CARRES_PORTAL_API || "https://api.carresofficial.com").replace(/\/+$/, "");
  const body = JSON.stringify(payload);
  const { ts, signature } = await signFinanceBody(e.CARRES_SSO_SECRET, body);
  let res: Response;
  try {
    const call = e.CARRES_PORTAL ? e.CARRES_PORTAL.fetch.bind(e.CARRES_PORTAL) : fetch;
    res = await call(`${base}/engine/supplier-finance`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-carres-engine-ts": ts, "x-carres-engine-signature": signature },
      body,
    });
  } catch {
    return { ok: false, status: 502, error: UNREACHABLE };
  }
  if (res.status === 404) return { ok: false, status: 404, error: "Order not found." };
  if (res.status === 503) return { ok: false, status: 503, error: NOT_SET_UP };
  const json = (await res.json().catch(() => null)) as unknown;
  if (!res.ok || !json || typeof json !== "object") return { ok: false, status: 502, error: UNREACHABLE };
  return { ok: true, body: json };
}

// ── The fields a supplier may read, named one by one ────────────────────────────────────────────────────────────

const num = (v: unknown): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
};
const whole = (v: unknown): number => Math.trunc(num(v));
const text = (v: unknown): string => (v == null ? "" : String(v));
const textOrNull = (v: unknown): string | null => (v == null || v === "" ? null : String(v));
const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

export interface FinanceTotals {
  orders: number;
  contractValue: number;
  shareTotal: number;
  collected: number;
  collectedCount: number;
  shareEarned: number;
  toCollect: number;
  shareToCome: number;
  overdueOrders: number;
  overdueMonths: number;
  overdueAmount: number;
  overdueShare: number;
  defaultOrders: number;
}

export interface FinanceMonth { month: string; due: number; dueShare: number; collected: number; collectedShare: number; open: number; openShare: number }

export interface FinanceOrder {
  id: string;
  agreementNo: string;
  soNo: string | null;
  customerName: string;
  item: string;
  termMonths: number;
  monthlyFee: number;
  ratePct: number;
  startDate: string | null;
  status: string;
  state: string;
  contractValue: number;
  shareTotal: number;
  paidCount: number;
  collected: number;
  shareEarned: number;
  toCollect: number;
  shareToCome: number;
  overdueMonths: number;
  overdueAmount: number;
  overdueShare: number;
  nextDueDate: string | null;
  lastPaidOn: string | null;
}

export interface FinanceInstalment {
  seq: number;
  dueDate: string;
  amountDue: number;
  state: string;
  paidOn: string | null;
  paidAmount: number | null;
  share: number;
  daysLate: number;
}

export interface FinanceSummary { asOf: string; totals: FinanceTotals; months: FinanceMonth[]; orders: FinanceOrder[] }
export interface FinanceAgreement { asOf: string; order: FinanceOrder; instalments: FinanceInstalment[] }

function pickOrder(v: unknown): FinanceOrder {
  const o = rec(v);
  return {
    id: text(o.id), agreementNo: text(o.agreementNo), soNo: textOrNull(o.soNo), customerName: text(o.customerName), item: text(o.item),
    termMonths: whole(o.termMonths), monthlyFee: num(o.monthlyFee), ratePct: num(o.ratePct), startDate: textOrNull(o.startDate),
    status: text(o.status), state: text(o.state), contractValue: num(o.contractValue), shareTotal: num(o.shareTotal),
    paidCount: whole(o.paidCount), collected: num(o.collected), shareEarned: num(o.shareEarned), toCollect: num(o.toCollect),
    shareToCome: num(o.shareToCome), overdueMonths: whole(o.overdueMonths), overdueAmount: num(o.overdueAmount),
    overdueShare: num(o.overdueShare), nextDueDate: textOrNull(o.nextDueDate), lastPaidOn: textOrNull(o.lastPaidOn),
  };
}

export function pickSummary(v: unknown): FinanceSummary {
  const b = rec(v);
  const t = rec(b.totals);
  return {
    asOf: text(b.asOf),
    totals: {
      orders: whole(t.orders), contractValue: num(t.contractValue), shareTotal: num(t.shareTotal), collected: num(t.collected),
      collectedCount: whole(t.collectedCount), shareEarned: num(t.shareEarned), toCollect: num(t.toCollect), shareToCome: num(t.shareToCome),
      overdueOrders: whole(t.overdueOrders), overdueMonths: whole(t.overdueMonths), overdueAmount: num(t.overdueAmount),
      overdueShare: num(t.overdueShare), defaultOrders: whole(t.defaultOrders),
    },
    months: list(b.months).map((m) => {
      const r = rec(m);
      return {
        month: text(r.month), due: num(r.due), dueShare: num(r.dueShare), collected: num(r.collected),
        collectedShare: num(r.collectedShare), open: num(r.open), openShare: num(r.openShare),
      };
    }),
    orders: list(b.orders).map(pickOrder),
  };
}

export function pickAgreement(v: unknown): FinanceAgreement {
  const b = rec(v);
  return {
    asOf: text(b.asOf),
    order: pickOrder(b.order),
    instalments: list(b.instalments).map((i) => {
      const r = rec(i);
      return {
        seq: whole(r.seq), dueDate: text(r.dueDate), amountDue: num(r.amountDue), state: text(r.state), paidOn: textOrNull(r.paidOn),
        paidAmount: r.paidAmount == null ? null : num(r.paidAmount), share: num(r.share), daysLate: whole(r.daysLate),
      };
    }),
  };
}

export async function financeSummary(env: Env): Promise<FinanceResult<FinanceSummary>> {
  const r = await askPortal(env, { view: "summary" });
  return r.ok ? { ok: true, body: pickSummary(r.body) } : r;
}

export async function financeAgreement(env: Env, id: string): Promise<FinanceResult<FinanceAgreement>> {
  const r = await askPortal(env, { view: "agreement", id });
  return r.ok ? { ok: true, body: pickAgreement(r.body) } : r;
}
