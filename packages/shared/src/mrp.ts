import { z } from "zod";
import type { ProductCategory } from "./db-types";
import { computeNetRequirements, type DemandLine } from "./net-requirements";
import { categoryLabel, isToOrderCategory } from "./to-order";

/**
 * MRP — one read-only screen of Needed · In Stock · On PO · Shortage per item
 * (YH, 30 Oct 2026; Purchasing MASTER §5.1 "MRP page").
 *
 * It stores nothing and owns no arithmetic: the customer lines come from
 * `loadToOrder`, the read SO Batch Purchase runs on, and the open PO draw is
 * `computeNetRequirements`, so Shortage is what SO Batch Purchase still has to
 * buy. Free Stock is shown and never netted (Jess, 2026-07-21).
 */

export const MRP_WORDS = {
  page: "MRP",
  sku: "SKU",
  item: "Item",
  supplier: "Supplier",
  needed: "Needed",
  inStock: "In Stock",
  onPo: "On PO",
  shortage: "Shortage",
  freeStock: "Free Stock",
  salesOrder: "Sales Order",
  customer: "Customer",
  delivery: "Delivery Date",
  proceedDate: "Proceed Date",
  soDate: "SO Date",
  dateBasis: "Date",
  from: "From",
  to: "To",
  warehouse: "Warehouse",
  coverage: "PO and ETA",
  itemsSheet: "Items",
  linesSheet: "Lines",
  show: "Show",
  category: "Category",
  all: "All",
  shortages: "Shortages",
  total: "Total",
  export: "Export",
  notRecorded: "Not recorded",
  empty: "Nothing is needed for these filters.",
  loadFailed: "Could not be loaded",
  tryAgain: "Try again",
  clearFilters: "Clear all",
  note: "Shortage is Needed less In Stock less On PO. In Stock is held for these orders. Free Stock is held for no order and lowers Shortage only once it is taken on SO Batch Purchase. Each sofa module counts as its own item.",
} as const;

/** One customer line as `loadToOrder` read it, before the open PO draw. */
export interface MrpSourceLine {
  lineId: string;
  orderId: string;
  so: number | null;
  customer: string | null;
  sku: string;
  model: string | null;
  variant: string | null;
  category: ProductCategory;
  supplierName: string | null;
  delivery: string | null;
  warehouse?: string | null;
  proceedDate?: string | null;
  soDate?: string | null;
  /** Incoming Units already reserved for this line, per PO. */
  poHeld?: readonly { poId: string; qty: number }[];
  placedAt: string;
  /** What the customer ordered on this line. */
  needed: number;
  /** Ready Stock units already held for this line. */
  heldInStock: number;
  /** Incoming PO units already reserved for this line. */
  heldOnPo: number;
}

export const mrpLineSchema = z.object({
  lineId: z.string(),
  orderId: z.string(),
  so: z.number().nullable(),
  customer: z.string().nullable(),
  sku: z.string(),
  model: z.string().nullable(),
  variant: z.string().nullable(),
  category: z.string(),
  supplierName: z.string().nullable(),
  delivery: z.string().nullable(),
  warehouse: z.string().nullable().optional(),
  proceedDate: z.string().nullable().optional(),
  soDate: z.string().nullable().optional(),
  /** Which PO covers this line, how much of it, and when that PO is promised. */
  poCover: z.array(z.object({ poId: z.string(), qty: z.number(), eta: z.string().nullable() })).optional(),
  needed: z.number(),
  inStock: z.number(),
  onPo: z.number(),
  shortage: z.number(),
});
export type MrpLine = z.infer<typeof mrpLineSchema>;

export const mrpResponseSchema = z.object({
  lines: z.array(mrpLineSchema),
  freeStockBySku: z.record(z.string(), z.number()),
});
export type MrpResponse = z.infer<typeof mrpResponseSchema>;

/** Draw the open POs across the lines, earliest delivery first, per line.
 *  `openPos` names the POs behind the pool; without it a line carries no poCover. */
export function buildMrpLines(
  sources: readonly MrpSourceLine[],
  openPoBySku: Readonly<Record<string, number>>,
  today: string,
  openPos: {
    refs?: Readonly<Record<string, readonly { poId: string; qty: number }[]>>;
    eta?: Readonly<Record<string, string | null>>;
  } = {},
): MrpLine[] {
  const eligible = sources.filter((s) => isToOrderCategory(s.category));
  const demand: DemandLine[] = eligible.map((s) => ({
    lineId: s.lineId,
    orderId: s.orderId,
    sku: s.sku,
    category: s.category,
    supplierId: "",
    qty: Math.max(0, s.needed - s.heldInStock - s.heldOnPo),
    deadline: s.delivery,
    leadDays: 0,
    placedAt: s.placedAt,
    committed: true,
  }));
  const net = computeNetRequirements(demand, { openPoBySku }, { today });
  const byLine = new Map(net.lines.map((r) => [r.line.lineId, r]));
  // The engine's draw replayed over the PO list, in the engine's own order, so
  // each line names the POs its On PO figure came from.
  const left = new Map(Object.entries(openPos.refs ?? {}).map(([sku, refs]) => [sku, refs.map((p) => ({ ...p }))]));
  const drawn = new Map<string, { poId: string; qty: number }[]>();
  for (const d of [...demand].sort((a, b) => {
    const ad = a.deadline ?? "9999-12-31";
    const bd = b.deadline ?? "9999-12-31";
    if (ad !== bd) return ad < bd ? -1 : 1;
    return a.placedAt < b.placedAt ? -1 : a.placedAt > b.placedAt ? 1 : 0;
  })) {
    let need = byLine.get(d.lineId)?.coveredByOpenPo ?? 0;
    const taken: { poId: string; qty: number }[] = [];
    for (const p of left.get(d.sku) ?? []) {
      if (need <= 0) break;
      const qty = Math.min(need, p.qty);
      if (qty <= 0) continue;
      p.qty -= qty;
      need -= qty;
      taken.push({ poId: p.poId, qty });
    }
    drawn.set(d.lineId, taken);
  }
  const eta = (poId: string) => openPos.eta?.[poId] ?? null;
  return eligible.map((s) => {
    const r = byLine.get(s.lineId);
    const cover = new Map<string, number>();
    let held = s.heldOnPo;
    for (const p of s.poHeld ?? []) {
      const qty = Math.min(held, p.qty);
      if (qty > 0) cover.set(p.poId, qty);
      held -= qty;
    }
    for (const p of drawn.get(s.lineId) ?? []) cover.set(p.poId, (cover.get(p.poId) ?? 0) + p.qty);
    return {
      lineId: s.lineId,
      orderId: s.orderId,
      so: s.so,
      customer: s.customer,
      sku: s.sku,
      model: s.model,
      variant: s.variant,
      category: s.category,
      supplierName: s.supplierName,
      delivery: s.delivery,
      warehouse: s.warehouse ?? null,
      proceedDate: s.proceedDate ?? null,
      soDate: s.soDate ?? null,
      poCover: [...cover].map(([poId, qty]) => ({ poId, qty, eta: eta(poId) })),
      needed: s.needed,
      inStock: s.heldInStock,
      onPo: s.heldOnPo + (r?.coveredByOpenPo ?? 0),
      shortage: r?.toOrder ?? 0,
    };
  });
}

export interface MrpRow {
  sku: string;
  item: string;
  category: string;
  supplierName: string | null;
  /** Every warehouse under this row's lines; empty when none is recorded. */
  warehouses: string[];
  needed: number;
  inStock: number;
  onPo: number;
  shortage: number;
  freeStock: number;
  lines: MrpLine[];
}

export interface MrpFilters {
  category: string | null;
  /** `YYYY-MM`, `none` for a line with no delivery date, or null for all. */
  month: string | null;
  shortagesOnly: boolean;
  /** A warehouse name, `none` for a line with none, or null for all. */
  warehouse?: string | null;
  /** Which date From and To read. A line with no such date is out while either is set. */
  basis?: MrpDateBasis;
  from?: string;
  to?: string;
}

/** Houzs Mrp.tsx:224 dateBasis. Its `orderBy` is left out: Carres keeps no order-by date per line. */
export type MrpDateBasis = "delivery" | "proceed" | "so";

const dateOn = (l: MrpLine, basis: MrpDateBasis) =>
  (basis === "delivery" ? l.delivery : basis === "proceed" ? l.proceedDate : l.soDate) ?? null;

/**
 * Combined rows per SKU. Filtering happens AFTER the draw, so a filter can
 * never hand one order's PO cover to another and the rows always add up to
 * the lines under them. Biggest Shortage first.
 */
export function mrpRows(
  lines: readonly MrpLine[],
  freeStockBySku: Readonly<Record<string, number>>,
  filters: MrpFilters,
): MrpRow[] {
  const bySku = new Map<string, MrpRow>();
  for (const l of lines) {
    if (filters.category != null && l.category !== filters.category) continue;
    if (filters.month != null && (l.delivery?.slice(0, 7) ?? "none") !== filters.month) continue;
    if (filters.warehouse != null && (l.warehouse ?? "none") !== filters.warehouse) continue;
    if (filters.from || filters.to) {
      const day = dateOn(l, filters.basis ?? "delivery");
      if (!day || (filters.from && day < filters.from) || (filters.to && day > filters.to)) continue;
    }
    let row = bySku.get(l.sku);
    if (!row) {
      row = {
        sku: l.sku,
        item: [l.model, l.variant].filter(Boolean).join(" ") || l.sku,
        category: l.category,
        supplierName: l.supplierName,
        warehouses: [],
        needed: 0,
        inStock: 0,
        onPo: 0,
        shortage: 0,
        freeStock: freeStockBySku[l.sku] ?? 0,
        lines: [],
      };
      bySku.set(l.sku, row);
    }
    if (l.warehouse && !row.warehouses.includes(l.warehouse)) row.warehouses.push(l.warehouse);
    row.needed += l.needed;
    row.inStock += l.inStock;
    row.onPo += l.onPo;
    row.shortage += l.shortage;
    row.lines.push(l);
  }
  return [...bySku.values()]
    .filter((r) => !filters.shortagesOnly || r.shortage > 0)
    .sort((a, b) => b.shortage - a.shortage || (a.sku < b.sku ? -1 : 1));
}

/** One line's PO cover: `PO-2051 · 3 · ETA 12 Nov 2026`. `fmt` is the caller's date spelling. */
export function mrpCoverText(l: Pick<MrpLine, "poCover">, fmt: (iso: string) => string): string {
  return (l.poCover ?? [])
    .map((p) => [p.poId, String(p.qty), ...(p.eta ? [`ETA ${fmt(p.eta)}`] : [])].join(" · "))
    .join("; ");
}

/** The xlsx export (Houzs mrp-export-workbook.ts): one sheet per SKU, one per customer line. */
export function mrpExportSheets(rows: readonly MrpRow[], fmt: (iso: string) => string) {
  const W = MRP_WORDS;
  const day = (d: string | null | undefined) => (d ? fmt(d) : "");
  return {
    items: [
      [W.warehouse, W.sku, W.item, W.category, W.supplier, W.needed, W.inStock, W.onPo, W.shortage, W.freeStock],
      ...rows.map((r) => [
        r.warehouses.join(", "), r.sku, r.item, categoryLabel(r.category), r.supplierName ?? "",
        r.needed, r.inStock, r.onPo, r.shortage, r.freeStock,
      ]),
    ],
    lines: [
      [W.warehouse, W.sku, W.item, W.salesOrder, W.customer, W.delivery, W.proceedDate, W.soDate, W.needed, W.inStock, W.onPo, W.shortage, W.coverage],
      ...rows.flatMap((r) => r.lines.map((l) => [
        l.warehouse ?? "", r.sku, r.item, l.so != null ? `SO-${l.so}` : "", l.customer ?? "",
        day(l.delivery), day(l.proceedDate), day(l.soDate),
        l.needed, l.inStock, l.onPo, l.shortage, mrpCoverText(l, fmt),
      ])),
    ],
  };
}
