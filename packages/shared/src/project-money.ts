/**
 * Projects slice 5 (0754): a fair's money, the Houzs way.
 *
 * Weisiang's decision (Mr Lim, 2026-10-22) and YH (3 Nov 2026, "all follow
 * houzs"): clear Carres rules, implement Houzs. Jess was not part of this.
 *
 * Three sources, one P&L:
 *   · typed lines (project_finance_lines), as Houzs's event ledger;
 *   · the books: posted ledger legs tagged to the project, plus payment
 *     voucher lines Finance has checked but not yet approved. A row the books
 *     fill replaces that row's typed lines, so a fair is never counted twice
 *     (Houzs scm/lib/event-books.ts);
 *   · the Sales Orders at the fair (slice 4).
 * Pure: no I/O. Houzs services/eventPnl.ts is the P&L, ported as is.
 */
import { z } from "zod";

/** The rows of the event page a Finance account can fill (Houzs event-accounts.ts PMS_ROWS). */
export const MONEY_ROWS = ["rental", "setup", "transport_setup_dismantle", "transport_fee", "commission", "others"] as const;
export type MoneyRow = (typeof MONEY_ROWS)[number];
export const isMoneyRow = (v: unknown): v is MoneyRow => typeof v === "string" && (MONEY_ROWS as readonly string[]).includes(v);

export const MONEY_ROW_LABELS: Record<MoneyRow, string> = {
  rental: "Rental",
  setup: "Setup",
  transport_setup_dismantle: "Transport setup & dismantle",
  transport_fee: "Transport Fee",
  commission: "Commission",
  others: "Others Costing",
};

/** The typed line pickers (Houzs pms-ledger-categories.ts). */
export const PROJECT_COST_CATEGORIES = [
  "rental",
  "cogs", "cogs_matt_sofa", "cogs_bedframe", "cogs_accessories",
  "setup",
  "transport", "transport_fee", "transport_setup_dismantle",
  "commission", "merchandise",
  "contractor", "license", "deposit", "permit",
  "accommodation", "staffing", "marketing", "misc",
] as const;
export const PROJECT_INCOME_CATEGORIES = ["sales", "deposit_refund", "rebate", "other_income"] as const;

const CATEGORY_LABELS: Record<string, string> = {
  cogs: "COGS",
  cogs_matt_sofa: "COGS · Matt/Sofa",
  cogs_bedframe: "COGS · Bedframe",
  cogs_accessories: "COGS · Accessories",
  transport: "Transport",
  transport_fee: "Transport Fee",
  transport_setup_dismantle: "Transport setup & dismantle",
  contractor: "Contractor",
  license: "License",
  deposit: "Deposit paid",
  deposit_refund: "Deposit refund",
  other_income: "Other income",
};

/** A category in words; an unknown slug title-cases (Houzs ledgerCategoryLabel). */
export function projectCategoryLabel(cat: string | null | undefined): string {
  const c = (cat ?? "").trim();
  if (!c) return "";
  return CATEGORY_LABELS[c] ?? c.charAt(0).toUpperCase() + c.slice(1).replace(/_/g, " ");
}

/** The row a typed category sits in. COGS and Merchandise are rows no account fills (Houzs rowOfCategory). */
export function rowOfCategory(category: string | null | undefined): MoneyRow | null {
  switch ((category ?? "").trim()) {
    case "rental": return "rental";
    case "setup": return "setup";
    case "transport":
    case "transport_fee": return "transport_fee";
    case "transport_setup_dismantle": return "transport_setup_dismantle";
    case "commission": return "commission";
    case "cogs":
    case "cogs_matt_sofa":
    case "cogs_bedframe":
    case "cogs_accessories":
    case "merchandise": return null;
    default: return "others";
  }
}

/** One tagged leg as the project page reads it (project_books, 0754). */
export interface BooksLeg {
  legId: string;
  accountCode: string;
  accountName: string | null;
  accountKind: string | null;
  projectRow: string | null;
  debit: number;
  credit: number;
  memo: string | null;
  docNo: string;
  entryDate: string | null;
  /** True for a voucher line Finance has checked but not yet approved. */
  checked: boolean;
}

/** The row a leg fills, or null when it is not a project cost (Houzs rowOfLeg). */
export function rowOfLeg(leg: Pick<BooksLeg, "projectRow" | "accountKind">): MoneyRow | null {
  if (isMoneyRow(leg.projectRow)) return leg.projectRow;
  return String(leg.accountKind ?? "").toUpperCase() === "EXPENSE" ? "others" : null;
}

/** A line of the project ledger: typed, or the books'. */
export interface MoneyLine {
  id: string;
  kind: "cost" | "income";
  category: string;
  description: string;
  amount: number;
  occurredAt: string | null;
  /** "books" for a ledger leg; null for a typed line. */
  source: "books" | null;
  docNo?: string;
  accountCode?: string;
}

/** Rows whose books are summed straight in; money only coming back there is taken off, never replaces. */
const SUMMED_ROWS: ReadonlySet<MoneyRow> = new Set<MoneyRow>(["rental", "setup", "transport_setup_dismantle", "others"]);

const sen = (n: number) => Math.round(n * 100);
const round2 = (n: number) => Math.round(n * 100) / 100;

export function booksLinesFor(legs: readonly BooksLeg[]): MoneyLine[] {
  const out: MoneyLine[] = [];
  for (const leg of legs) {
    const row = rowOfLeg(leg);
    if (!row) continue;
    out.push({
      id: `books:${leg.legId}`,
      kind: "cost",
      category: row,
      description: leg.memo?.trim() || leg.accountName || leg.accountCode,
      amount: (sen(leg.debit) - sen(leg.credit)) / 100,
      occurredAt: leg.entryDate,
      source: "books",
      docNo: leg.checked ? `${leg.docNo} (checked)` : leg.docNo,
      accountCode: leg.accountCode,
    });
  }
  return out;
}

/** The typed lines with the books in: a row the books fill gives up its typed lines (Houzs applyEventBooks). */
export function applyBooks(typed: readonly MoneyLine[], legs: readonly BooksLeg[]) {
  const books = booksLinesFor(legs);
  const filled = new Set<MoneyRow>(books.filter((l) => l.amount > 0 || !SUMMED_ROWS.has(l.category as MoneyRow)).map((l) => l.category as MoneyRow));
  const isFilled = (c: string) => {
    const row = rowOfCategory(c);
    return row != null && filled.has(row);
  };
  const kept: MoneyLine[] = [];
  const replaced: MoneyLine[] = [];
  for (const l of typed) (l.kind === "cost" && !l.source && isFilled(l.category) ? replaced : kept).push(l);
  return { lines: [...kept, ...books], rows: MONEY_ROWS.filter((r) => filled.has(r)), replaced };
}

/* ── The P&L (Houzs services/eventPnl.ts) ────────────────────────────────── */

/** The brand's rate card (project_cost_rates). */
export interface CostRate {
  transportPct: number;
  merchandisePct: number;
  commissionNormalPct: number;
  commissionBoostPct: number | null;
  boostMinGpPct: number | null;
  boostMinSales: number | null;
}

/** The Sales Orders at the fair, cancelled left out. Carres orders carry no cost, so cost is 0. */
export interface SoTotals { count: number; salesRm: number }

export type PctFrom = "books" | "typed" | "rate" | "none";
export interface PctRow { amount: number; from: PctFrom; pct: number | null }

export interface PnlColumn {
  sales: number;
  salesFrom: "lines" | "box" | "so" | "none";
  cogs: { mattSofa: number; bedframe: number; accessories: number; other: number; total: number; from: "typed" | "none" };
  rental: number;
  setup: number;
  transportSetupDismantle: number;
  others: number;
  transportFee: PctRow;
  commission: PctRow & { boost: boolean };
  merchandise: PctRow;
  totalCost: number;
  grossProfit: number;
  netProfit: number;
}

export interface ProjectPnl { bySales: PnlColumn; bySo: PnlColumn | null; soCount: number }

export function projectPnl(input: {
  lines: readonly MoneyLine[];
  booksRows: ReadonlySet<string>;
  lumpSales: number | null;
  so: SoTotals | null;
  rate: CostRate | null;
}): ProjectPnl {
  const sum = (kind: string, cats: readonly string[] | null, typedOnly = false) =>
    input.lines
      .filter((l) => l.kind === kind && (cats ? cats.includes(l.category) : true) && (!typedOnly || !l.source))
      .reduce((s, l) => s + sen(l.amount), 0) / 100;
  const shared = {
    rental: sum("cost", ["rental"]),
    setup: sum("cost", ["setup"]),
    transportSetupDismantle: sum("cost", ["transport_setup_dismantle"]),
    others: input.lines.filter((l) => l.kind === "cost" && rowOfCategory(l.category) === "others").reduce((s, l) => s + sen(l.amount), 0) / 100,
  };
  const so = input.so && input.so.count > 0 ? input.so : null;

  const pctRow = (row: string, cats: readonly string[], pct: number | null, sales: number): PctRow => {
    if (input.booksRows.has(row)) return { amount: sum("cost", cats), from: "books", pct: null };
    const typed = sum("cost", cats, true);
    if (typed !== 0) return { amount: typed, from: "typed", pct: null };
    if (pct == null || sales <= 0) return { amount: 0, from: "none", pct: null };
    return { amount: round2((sales * pct) / 100), from: "rate", pct };
  };

  const cogsTyped = {
    mattSofa: sum("cost", ["cogs_matt_sofa"]),
    bedframe: sum("cost", ["cogs_bedframe"]),
    accessories: sum("cost", ["cogs_accessories"]),
    other: sum("cost", ["cogs"]),
  };
  const cogsTotal = round2(cogsTyped.mattSofa + cogsTyped.bedframe + cogsTyped.accessories + cogsTyped.other);
  const cogs: PnlColumn["cogs"] = { ...cogsTyped, total: cogsTotal, from: cogsTotal !== 0 ? "typed" : "none" };

  const column = (sales: number, salesFrom: PnlColumn["salesFrom"]): PnlColumn => {
    const r = input.rate;
    const gpPct = sales > 0 ? ((sales - cogs.total) / sales) * 100 : 0;
    const boost = !!r && r.commissionBoostPct != null
      && (r.boostMinGpPct == null || gpPct >= r.boostMinGpPct)
      && (r.boostMinSales == null || sales >= r.boostMinSales);
    const transportFee = pctRow("transport_fee", ["transport", "transport_fee"], r ? r.transportPct : null, sales);
    const merchandise = pctRow("merchandise", ["merchandise"], r ? r.merchandisePct : null, sales);
    const commissionRow = pctRow("commission", ["commission"], r ? (boost ? r.commissionBoostPct : r.commissionNormalPct) : null, sales);
    const commission = { ...commissionRow, boost: boost && commissionRow.from === "rate" };
    const totalCost = round2(cogs.total + shared.rental + shared.setup + shared.transportSetupDismantle + shared.others
      + transportFee.amount + commission.amount + merchandise.amount);
    return {
      sales, salesFrom, cogs, ...shared, transportFee, commission, merchandise, totalCost,
      grossProfit: round2(sales - cogs.total),
      netProfit: round2(sales - totalCost),
    };
  };

  /* BY TOTAL SALES: the sales lines, else the Total Sales box, else the orders' total. */
  const linesSales = sum("income", ["sales"]);
  const box = Number(input.lumpSales ?? 0);
  const [sales, from]: [number, PnlColumn["salesFrom"]] = linesSales > 0 ? [linesSales, "lines"]
    : box > 0 ? [round2(box), "box"]
    : so && so.salesRm > 0 ? [round2(so.salesRm), "so"]
    : [0, "none"];
  return {
    bySales: column(sales, from),
    bySo: so ? column(round2(so.salesRm), "so") : null,
    soCount: so?.count ?? 0,
  };
}

/* ── Inputs ──────────────────────────────────────────────────────────────── */

const money = z.number().finite().refine((n) => Math.abs(n) < 1e10, "Too large");
const moneyNonNegative = z.number().finite().nonnegative().max(1e10);

export const projectMoneyLineInput = z.object({
  kind: z.enum(["cost", "income"]),
  category: z.string().trim().min(1).max(40),
  description: z.string().trim().min(1, "Say what it is for").max(300),
  amount: money,
  occurredAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
}).strict();
export type ProjectMoneyLineInput = z.infer<typeof projectMoneyLineInput>;

export const projectTotalSalesInput = z.object({ totalSales: moneyNonNegative.nullable() }).strict();

const pct = z.number().finite().min(0).max(100);
export const projectCostRateInput = z.object({
  brand: z.string().trim().min(1).max(120),
  transportPct: pct,
  merchandisePct: pct,
  commissionNormalPct: pct,
  commissionBoostPct: pct.nullable(),
  boostMinGpPct: pct.nullable(),
  boostMinSales: moneyNonNegative.nullable(),
}).strict();
export type ProjectCostRateInput = z.infer<typeof projectCostRateInput>;

/** What Finance sets on an account: does a line on it need its project, and which row it fills. */
export const accountProjectInput = z.object({
  needsProject: z.boolean(),
  projectRow: z.enum(MONEY_ROWS).nullable(),
}).strict();
