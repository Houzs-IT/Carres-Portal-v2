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

/** One instalment of an order, as the summary carries it so the pages can draw an order's months and list what
 *  falls due in a month without asking for each order. "unpaid": an overdue month, for a person who may not see
 *  what is overdue (see filterSummary). */
export interface FinanceScheduleRow { seq: number; dueDate: string; state: string; amountDue: number; share: number; paidOn: string | null }
export interface FinanceSummaryOrder extends FinanceOrder { schedule: FinanceScheduleRow[] }

export interface FinanceSummary { asOf: string; totals: FinanceTotals; months: FinanceMonth[]; orders: FinanceSummaryOrder[] }
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

function pickScheduleRow(v: unknown): FinanceScheduleRow {
  const r = rec(v);
  return { seq: whole(r.seq), dueDate: text(r.dueDate), state: text(r.state), amountDue: num(r.amountDue), share: num(r.share), paidOn: textOrNull(r.paidOn) };
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
    orders: list(b.orders).map((o) => ({ ...pickOrder(o), schedule: list(rec(o).schedule).map(pickScheduleRow) })),
  };
}

// ── What a person may see of the figures (./perms.ts: d_names, d_share, d_bad) ──────────────────────────────────
// Taken out HERE, on the server, before the answer leaves: a person who may not see the customer names, the share
// or what is overdue does not receive them, whatever the page draws. A hidden figure leaves as 0 or "", and
// `visible` says which were hidden, so the page hides the column instead of showing a false zero.

export interface FinanceVisible { names: boolean; share: boolean; bad: boolean }

/** An order's state for a person who may not see what is overdue: behind and in default read as "open". */
const stateFor = (state: string, v: FinanceVisible): string => (!v.bad && (state === "behind" || state === "default") ? "open" : state);
const instalmentStateFor = (state: string, v: FinanceVisible): string => (!v.bad && state === "late" ? "unpaid" : state);

/** The next month to fall due that is not already overdue: what "Next Due" says to a person who may not see what is
 *  overdue (the earliest open month would be a day in the past, which says it is overdue). */
const nextNotLate = (rows: Array<{ seq: number; dueDate: string; state: string }>): string | null =>
  [...rows].sort((a, b) => a.seq - b.seq).find((r) => r.state === "due" || r.state === "upcoming")?.dueDate ?? null;

function filterOrder<T extends FinanceOrder>(o: T, v: FinanceVisible, rows: Array<{ seq: number; dueDate: string; state: string }>): T {
  return {
    ...o,
    customerName: v.names ? o.customerName : "",
    ratePct: v.share ? o.ratePct : 0,
    shareTotal: v.share ? o.shareTotal : 0,
    shareEarned: v.share ? o.shareEarned : 0,
    shareToCome: v.share ? o.shareToCome : 0,
    overdueShare: v.share && v.bad ? o.overdueShare : 0,
    overdueMonths: v.bad ? o.overdueMonths : 0,
    overdueAmount: v.bad ? o.overdueAmount : 0,
    nextDueDate: v.bad ? o.nextDueDate : nextNotLate(rows),
    state: stateFor(o.state, v),
  };
}

export function filterSummary(s: FinanceSummary, v: FinanceVisible): FinanceSummary {
  const t = s.totals;
  return {
    asOf: s.asOf,
    totals: {
      ...t,
      shareTotal: v.share ? t.shareTotal : 0,
      shareEarned: v.share ? t.shareEarned : 0,
      shareToCome: v.share ? t.shareToCome : 0,
      overdueShare: v.share && v.bad ? t.overdueShare : 0,
      overdueOrders: v.bad ? t.overdueOrders : 0,
      overdueMonths: v.bad ? t.overdueMonths : 0,
      overdueAmount: v.bad ? t.overdueAmount : 0,
      defaultOrders: v.bad ? t.defaultOrders : 0,
    },
    months: s.months.map((m) => ({
      ...m,
      dueShare: v.share ? m.dueShare : 0,
      collectedShare: v.share ? m.collectedShare : 0,
      openShare: v.share ? m.openShare : 0,
    })),
    orders: s.orders.map((o) => ({
      ...filterOrder(o, v, o.schedule),
      schedule: o.schedule.map((r) => ({ ...r, state: instalmentStateFor(r.state, v), share: v.share ? r.share : 0 })),
    })),
  };
}

export function filterAgreement(a: FinanceAgreement, v: FinanceVisible): FinanceAgreement {
  return {
    asOf: a.asOf,
    order: filterOrder(a.order, v, a.instalments),
    instalments: a.instalments.map((i) => ({
      ...i,
      state: instalmentStateFor(i.state, v),
      share: v.share ? i.share : 0,
      daysLate: v.bad ? i.daysLate : 0,
    })),
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
