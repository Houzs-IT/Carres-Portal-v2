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
  code: string | null;
  constructor(status: number, message: string, code: string | null = null) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

type Listener = () => void;
const signedOutListeners = new Set<Listener>();
/** Called when the server says the session has ended, so the app can show the sign-in page. */
export function onSignedOut(fn: Listener): () => void {
  signedOutListeners.add(fn);
  return () => { signedOutListeners.delete(fn); };
}

const mustChangeListeners = new Set<Listener>();
/** Called when the server refuses a page because the person must choose a new password first. */
export function onMustChangePassword(fn: Listener): () => void {
  mustChangeListeners.add(fn);
  return () => { mustChangeListeners.delete(fn); };
}

const UNREACHABLE = "The server could not be reached. Check your connection and try again.";

async function send(method: string, path: string, init: { body?: BodyInit; json?: boolean; auth?: boolean; timeoutMs?: number }): Promise<Response> {
  const auth = init.auth !== false;
  const token = auth ? supplierToken.get() : "";
  try {
    return await fetch(`${baseUrl}/api/carres-supplier${path}`, {
      method,
      headers: {
        ...(init.json ? { "content-type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: init.body,
      cache: "no-store",
      signal: typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(init.timeoutMs ?? 60_000) : undefined,
    });
  } catch {
    throw new SupplierApiError(0, UNREACHABLE);
  }
}

async function failure(res: Response, auth: boolean): Promise<SupplierApiError> {
  const json = (await res.json().catch(() => null)) as { error?: string; code?: string } | null;
  if (res.status === 401 && auth) {
    supplierToken.clear();
    for (const fn of signedOutListeners) fn();
  }
  if (res.status === 403 && json?.code === "must_change_password") {
    for (const fn of mustChangeListeners) fn();
  }
  return new SupplierApiError(res.status, json?.error || "Something went wrong. Try again in a moment.", json?.code ?? null);
}

async function request<T>(method: string, path: string, body?: unknown, opts: { auth?: boolean } = {}): Promise<T> {
  const auth = opts.auth !== false;
  const res = await send(method, path, { body: body === undefined ? undefined : JSON.stringify(body), json: body !== undefined, auth });
  if (res.ok) {
    const json = (await res.json().catch(() => null)) as T | null;
    if (json) return json;
  }
  throw await failure(res, auth);
}

/** A file the server hands over (a Delivery Order), saved to the person's computer under its own name. */
async function download(path: string, fallbackName: string): Promise<void> {
  const res = await send("GET", path, {});
  if (!res.ok) throw await failure(res, true);
  const blob = await res.blob();
  const named = /filename="([^"]+)"/i.exec(res.headers.get("content-disposition") ?? "")?.[1];
  saveBlob(blob, named || fallbackName);
}

export function saveBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

// ── What the server answers (engine/backend/src/carres/supplier/) ───────────────────────────────────────────────

export type Department = "operation" | "finance";

/** The permission keys, by department. A key the person does not hold hides its page or its button; the server
 *  refuses the same act on its own. */
export const PERMS: Record<Department, readonly string[]> = {
  operation: ["v_orders", "v_forecast", "v_pickups", "a_accept", "a_collect", "a_date", "a_cancel", "a_export", "a_users"],
  finance: ["v_coll", "v_month", "d_names", "d_share", "d_bad", "a_export", "a_stmt", "a_users"],
};

export interface Me {
  user: {
    id: number;
    name: string;
    email: string;
    canOperation: boolean;
    canFinance: boolean;
    mustChangePassword: boolean;
    perms: Record<Department, string[]>;
  };
  supplier: { name: string; code: string };
  badges: { pickupsToAccept: number };
}

/** The answer as it arrived, made whole: a server one step behind these pages answers no `perms`, which reads as
 *  everything the person's departments open (what Carres gave everyone before people had their own access). */
export function normalizeMe(raw: Partial<Omit<Me, "user">> & { user?: Partial<Me["user"]> }): Me {
  const u: Partial<Me["user"]> = raw.user ?? {};
  const canOperation = !!u.canOperation;
  const canFinance = !!u.canFinance;
  const given = (u.perms ?? null) as Partial<Record<Department, string[]>> | null;
  const perms: Record<Department, string[]> = {
    operation: canOperation ? (given ? [...(given.operation ?? [])] : [...PERMS.operation]) : [],
    finance: canFinance ? (given ? [...(given.finance ?? [])] : [...PERMS.finance]) : [],
  };
  return {
    user: {
      id: Number(u.id ?? 0),
      name: String(u.name ?? ""),
      email: String(u.email ?? ""),
      canOperation,
      canFinance,
      mustChangePassword: !!u.mustChangePassword,
      perms,
    },
    supplier: { name: String(raw.supplier?.name ?? ""), code: String(raw.supplier?.code ?? "") },
    badges: { pickupsToAccept: Number(raw.badges?.pickupsToAccept ?? 0) },
  };
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
export interface PickupAsk { kind: "date" | "cancel"; date: string | null; askedAt: string; askedByName: string }
export interface PickupAnswer { kind: "date" | "cancel"; approved: boolean; date: string | null; answeredAt: string; reason: string | null }
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
  /** The supplier person who marked it collected; null when Carres recorded the collection. */
  collectedBySupplierName?: string | null;
  /** Cancelled because the supplier asked and Carres agreed. */
  cancelledBySupplier?: boolean;
  /** The day it moved from, once Carres agreed to a new day. */
  previousExpectedDate?: string | null;
  dateChangedAt?: string | null;
  /** A change the supplier asked for, waiting for Carres. */
  ask?: PickupAsk | null;
  /** Carres's answer to the latest ask. */
  answer?: PickupAnswer | null;
  deliveryOrder?: { name: string; uploadedAt: string; size: number } | null;
  /** One per Sales Order on the request, with its customer. */
  orders?: Array<{ docNo: string; customerName: string }>;
}

export type FinanceOrderState = "on_time" | "behind" | "default" | "completed" | "ended" | "open";
export type InstalmentState = "paid" | "late" | "due" | "upcoming" | "waived" | "unpaid";
export interface ScheduleItem { seq: number; dueDate: string; state: InstalmentState; amountDue: number; share: number; paidOn: string | null }

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
  state: FinanceOrderState | string;
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
  schedule?: ScheduleItem[];
}
export interface FinanceInstalment { seq: number; dueDate: string; amountDue: number; state: InstalmentState | string; paidOn: string | null; paidAmount: number | null; share: number; daysLate: number }
/** What the person may see of the money: names, their share, overdue and bad debt (Settings › Users and access). */
export interface FinanceVisible { names: boolean; share: boolean; bad: boolean }
export type FinanceSummary =
  | { shared: false }
  | { shared: true; asOf: string; visible?: FinanceVisible; totals: FinanceTotals; months: FinanceMonth[]; orders: FinanceOrder[] };
export interface FinanceAgreement { asOf: string; visible?: FinanceVisible; order: FinanceOrder; instalments: FinanceInstalment[] }

export interface Person {
  id: number;
  name: string;
  email: string;
  status: "active" | "invited";
  self: boolean;
  perms: string[];
  lastLoginAt: string | null;
}

export interface NewPerson {
  department: Department;
  name: string;
  email: string;
  how: "invite" | "password";
  password?: string;
  mustChange?: boolean;
  perms: string[];
}

const qs = (params: Record<string, string | number | undefined>): string => {
  const out = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") out.set(k, String(v));
  const s = out.toString();
  return s ? `?${s}` : "";
};

type SignedIn = Me & { token: string; expiresAt: string };

export const supplierApi = {
  signIn: async (email: string, password: string) => {
    const out = await request<SignedIn>("POST", "/auth/login", { email, password }, { auth: false });
    return { token: out.token, me: normalizeMe(out) };
  },
  signOut: () => request<{ ok: true }>("POST", "/auth/logout"),
  me: async () => normalizeMe(await request<Me>("GET", "/auth/me")),
  changePassword: (current: string, next: string) => request<{ token: string; expiresAt: string }>("POST", "/auth/password", { current, next }),
  readLink: (token: string) => request<{ name: string; email: string; purpose: string }>("POST", "/auth/link", { token }, { auth: false }),
  /** Choosing the password signs the person in: the answer then carries what signing in answers. With the
   *  supplier's access off it carries only the email, and the person is sent to the sign-in page. */
  useLink: async (token: string, password: string) => {
    const out = await request<{ ok: true; email: string } & Partial<SignedIn>>("POST", "/auth/link/use", { token, password }, { auth: false });
    return { email: out.email, token: out.token ?? null, me: out.token && out.user ? normalizeMe(out) : null };
  },
  /** Forgot password: ask for a link by email. The answer is the same for every email, so it never says whether
   *  the email signs in here. */
  forgot: (email: string) => request<{ ok: true }>("POST", "/auth/forgot", { email }, { auth: false }),

  orders: (p: { view?: OrderView; q?: string; page?: number; pageSize?: number; sort?: string; dir?: "asc" | "desc" }) =>
    request<OrderList>("GET", `/orders${qs(p)}`),
  order: (docNo: string) => request<{ order: OrderDetail }>("GET", `/orders/${encodeURIComponent(docNo)}`),
  forecast: () => request<Forecast>("GET", "/forecast"),

  pickups: (status?: PickupStatus) => request<{ rows: Pickup[] }>("GET", `/pickups${qs({ status })}`),
  pickup: (id: string) => request<{ pickup: Pickup }>("GET", `/pickups/${encodeURIComponent(id)}`),
  acceptPickups: (ids: string[]) => request<{ pickups: Pickup[] }>("POST", "/pickups/accept", { ids }),
  /** Mark accepted requests collected, with the Delivery Order Carres signed: one PDF for all, or one each. */
  collectPickups: async (ids: string[], files: { mode: "one"; file: File } | { mode: "each"; files: Record<string, File> }) => {
    const form = new FormData();
    form.set("ids", JSON.stringify(ids));
    form.set("mode", files.mode);
    if (files.mode === "one") form.set("file", files.file, files.file.name);
    else for (const [id, f] of Object.entries(files.files)) form.set(`file_${id}`, f, f.name);
    const res = await send("POST", "/pickups/collect", { body: form, timeoutMs: 120_000 });
    if (res.ok) {
      const json = (await res.json().catch(() => null)) as { pickups: Pickup[] } | null;
      if (json) return json;
    }
    throw await failure(res, true);
  },
  askDate: (id: string, date: string) => request<{ pickup: Pickup }>("POST", `/pickups/${encodeURIComponent(id)}/ask`, { kind: "date", date }),
  askCancel: (id: string) => request<{ pickup: Pickup }>("POST", `/pickups/${encodeURIComponent(id)}/ask`, { kind: "cancel" }),
  withdrawAsk: (id: string) => request<{ pickup: Pickup }>("POST", `/pickups/${encodeURIComponent(id)}/ask/withdraw`),
  deliveryOrder: (id: string, name: string) => download(`/pickups/${encodeURIComponent(id)}/do`, name),

  finance: () => request<FinanceSummary>("GET", "/finance/summary"),
  financeOrder: (id: string) => request<FinanceAgreement>("GET", `/finance/orders/${encodeURIComponent(id)}`),

  people: (department: Department) => request<{ users: Person[] }>("GET", `/users${qs({ department })}`),
  /** `hadAccount`: the email was a colleague in the other department; they now hold this one too and sign in as before. */
  addPerson: (p: NewPerson) => request<{ user: Person; mailed: boolean | null; mailNote: string | null; hadAccount?: boolean }>("POST", "/users", p),
  changePerson: (id: number, department: Department, patch: { name?: string; perms?: string[] }) =>
    request<{ user: Person }>("PATCH", `/users/${id}`, { department, ...patch }),
  removePerson: (id: number, department: Department) => request<{ ok: true }>("POST", `/users/${id}/remove`, { department }),
};
