// Carres only (not part of Houzs's code): the Supplier Platform's own link to the server.
//
// A supplier is not staff. These pages never use the staff client (api/client.ts) or its token: they talk only to
// /api/carres-supplier/* with the supplier's own token, which that API alone accepts. The token is kept for the
// browser tab (sessionStorage), so closing the tab on a shared warehouse computer signs the person out.
const baseUrl =
  (import.meta.env.VITE_API_URL as string) ||
  (import.meta.env.PROD ? "" : "http://localhost:8787");

const TOKEN_KEY = "carres.supplier.session";

export const supplierToken = {
  get(): string {
    try { return window.sessionStorage.getItem(TOKEN_KEY) ?? ""; } catch { return ""; }
  },
  set(token: string): void {
    try { window.sessionStorage.setItem(TOKEN_KEY, token); } catch { /* private mode: the session lasts this page */ }
  },
  clear(): void {
    try { window.sessionStorage.removeItem(TOKEN_KEY); } catch { /* nothing kept */ }
  },
};

export class SupplierApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

type Listener = () => void;
const signedOutListeners = new Set<Listener>();
/** Called when the server says the session has ended, so the app can show the sign-in page. */
export function onSignedOut(fn: Listener): () => void {
  signedOutListeners.add(fn);
  return () => { signedOutListeners.delete(fn); };
}

async function request<T>(method: string, path: string, body?: unknown, opts: { auth?: boolean } = {}): Promise<T> {
  const auth = opts.auth !== false;
  const token = auth ? supplierToken.get() : "";
  let res: Response;
  try {
    res = await fetch(`${baseUrl}/api/carres-supplier${path}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
      signal: typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(60_000) : undefined,
    });
  } catch {
    throw new SupplierApiError(0, "The server could not be reached. Check your connection and try again.");
  }
  const json = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (res.ok && json) return json;
  if (res.status === 401 && auth) {
    supplierToken.clear();
    for (const fn of signedOutListeners) fn();
  }
  throw new SupplierApiError(res.status, json?.error || "Something went wrong. Try again in a moment.");
}

// ── What the server answers (engine/backend/src/carres/supplier/) ───────────────────────────────────────────────

export interface Me {
  user: { name: string; email: string; canOperation: boolean; canFinance: boolean };
  supplier: { name: string; code: string };
  badges: { pickupsToAccept: number };
}

export type PickupLineState = "none" | "requested" | "accepted" | "collected";
export type OrderPickupState = "none" | "requested" | "accepted" | "part_collected" | "collected";

export interface OrderLine {
  soItemId: string;
  lineNo: number;
  itemCode: string;
  description: string;
  spec: string | null;
  category: string;
  modelName: string | null;
  uom: string;
  qty: number;
  pickup: { state: PickupLineState; requestId: string | null; requestNo: string | null; expectedDate: string | null };
}

export interface Order {
  docNo: string;
  soDate: string | null;
  status: string;
  saleType: string;
  processingDate: string | null;
  deliveryDate: string | null;
  customerName: string;
  addressLines: string[];
  receivedAt: string | null;
  lineCount: number;
  unitCount: number;
  pickupState: OrderPickupState;
  lines: OrderLine[];
}

export interface TrailEntry { at: string; kind: "received" | "stage" | "pickup"; code: string; ref: string | null; detail: string | null }
export interface MapNode { type: string; doc: string; meta: string; state: "done" | "current" | "pending"; requestId?: string | null }
export interface OrderDetail extends Order { trail: TrailEntry[]; map: MapNode[] }

export type OrderView = "all" | "incoming" | "processing" | "delivered";
export interface OrderList { rows: Order[]; total: number; page: number; pageSize: number; counts: Record<OrderView, number> }

export interface ForecastRow {
  itemCode: string;
  description: string;
  spec: string | null;
  modelName: string | null;
  category: string;
  uom: string;
  incoming: number;
  processing: number;
  total: number;
  byMonth: Record<string, number>;
}
export interface Forecast { rows: ForecastRow[]; months: string[]; totals: { incoming: number; processing: number; total: number; orders: number } }

export type PickupStatus = "REQUESTED" | "ACCEPTED" | "COLLECTED" | "CANCELLED";
export interface PickupLine { soDocNo: string; soItemId: string; itemCode: string; description: string; spec: string | null; modelName: string | null; uom: string; qty: number }
export interface Pickup {
  id: string;
  requestNo: string;
  supplierName: string;
  expectedDate: string;
  expectedTime: string | null;
  note: string | null;
  status: PickupStatus;
  requestedAt: string | null;
  acceptedAt: string | null;
  acceptedByName: string | null;
  collectedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  soDocNos: string[];
  lineCount: number;
  unitCount: number;
  lines: PickupLine[];
}

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
export interface FinanceInstalment { seq: number; dueDate: string; amountDue: number; state: string; paidOn: string | null; paidAmount: number | null; share: number; daysLate: number }
export type FinanceSummary =
  | { shared: false }
  | { shared: true; asOf: string; totals: FinanceTotals; months: FinanceMonth[]; orders: FinanceOrder[] };
export interface FinanceAgreement { asOf: string; order: FinanceOrder; instalments: FinanceInstalment[] }

const qs = (params: Record<string, string | number | undefined>): string => {
  const out = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") out.set(k, String(v));
  const s = out.toString();
  return s ? `?${s}` : "";
};

export const supplierApi = {
  signIn: (email: string, password: string) =>
    request<Me & { token: string; expiresAt: string }>("POST", "/auth/login", { email, password }, { auth: false }),
  signOut: () => request<{ ok: true }>("POST", "/auth/logout"),
  me: () => request<Me>("GET", "/auth/me"),
  changePassword: (current: string, next: string) => request<{ token: string; expiresAt: string }>("POST", "/auth/password", { current, next }),
  readLink: (token: string) => request<{ name: string; email: string; purpose: string }>("POST", "/auth/link", { token }, { auth: false }),
  /** Choosing the password signs the person in: the answer then carries what signing in answers. With the
   *  supplier's access off it carries only the email, and the person is sent to the sign-in page. */
  useLink: (token: string, password: string) =>
    request<{ ok: true; email: string } & Partial<Me & { token: string; expiresAt: string }>>("POST", "/auth/link/use", { token, password }, { auth: false }),

  orders: (p: { view?: OrderView; q?: string; page?: number; pageSize?: number; sort?: string; dir?: "asc" | "desc" }) =>
    request<OrderList>("GET", `/orders${qs(p)}`),
  order: (docNo: string) => request<{ order: OrderDetail }>("GET", `/orders/${encodeURIComponent(docNo)}`),
  forecast: () => request<Forecast>("GET", "/forecast"),

  pickups: (status?: PickupStatus) => request<{ rows: Pickup[] }>("GET", `/pickups${qs({ status })}`),
  pickup: (id: string) => request<{ pickup: Pickup }>("GET", `/pickups/${encodeURIComponent(id)}`),
  acceptPickup: (id: string) => request<{ pickup: Pickup }>("POST", `/pickups/${encodeURIComponent(id)}/accept`),

  finance: () => request<FinanceSummary>("GET", "/finance/summary"),
  financeOrder: (id: string) => request<FinanceAgreement>("GET", `/finance/orders/${encodeURIComponent(id)}`),
};
