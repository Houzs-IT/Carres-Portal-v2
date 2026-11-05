import type { CatalogResponse } from "@carres/shared";
import type { SupplierRow } from "@/lib/queries";
import { csvCell } from "@/lib/sku-csv";

/**
 * SUPPLIER ITEMS — the identity chain Loo named, as ONE row.
 *
 *     internal SKU code  <>  item name  <>  supplier SKU  <>  supplier name
 *
 * ⭐ THIS IS A JOIN, NEVER A SECOND TABLE. Loo asked that adding a SKU also
 * update the Suppliers tab; the cheap-looking way to do that is a synced copy,
 * and it would be a defect — two records of one fact, drifting the first time
 * a write misses one of them (ownership Laws C and D). A join has nothing to
 * keep in step: the catalog IS the list, read a second way.
 *
 * Composed CLIENT-SIDE from bundles the screens already hold, plus (0388) the
 * one-read offers list — an offer is a supplier's item too, or recording it
 * would change nothing anyone can see here.
 */
export interface SupplierItemRow {
  /** `${supplierId}:${skuId}` — stable across reorders, unique per row. */
  key: string;
  supplierId: string;
  supplierName: string;
  /** THEIR code for it. `null` = we have not recorded one yet — the column
   *  landed on 2026-08-21 (0375), so most rows are null until someone keys the
   *  quotation in. That emptiness is the POINT of this screen. */
  supplierCode: string | null;
  description: string | null;
  /** OUR code. */
  sku: string;
  /** OUR name: `Model · Variant`, or the model alone when a category carries
   *  no variant axis (accessory / service). */
  ourName: string;
  category: string | null;
  /** 0388 — HOW this supplier relates to the item. `supplies` = the SKU's
   *  supplier SLOT (POs route here). `quoted` = an offer on file only. One
   *  supplier can be both for one SKU; the slot row wins and the offer is not
   *  printed twice. */
  source: "supplies" | "quoted";
}

/**
 * INNER join on supplier_id: a SKU nobody supplies is not a supplier's item,
 * and printing it here with an empty Supplier column would invite someone to
 * "fix" a row that is correct — service and guarantee SKUs have no supplier by
 * design (0171 made the column nullable for exactly them).
 *
 * A SKU whose supplier_id points at a supplier the roster does not return is
 * DROPPED rather than shown with a blank name: that is a data fault worth
 * finding in the catalog, not a row to render.
 */
export function buildSupplierItems(
  catalog: CatalogResponse | undefined,
  suppliers: readonly SupplierRow[] | undefined,
  /* 0388 — the offers table, joined the same way the slot is. Optional so
     every existing caller (and a browser against an older Worker) renders
     exactly what it rendered before: slot rows only. */
  offers: ReadonlyArray<{ skuId: string; supplierId: string; supplierCode: string | null }> = [],
): SupplierItemRow[] {
  if (!catalog || !suppliers?.length) return [];
  const supplierById = new Map(suppliers.map((s) => [s.id, s]));
  const modelById = new Map(catalog.models.map((m) => [m.id, m]));
  const skuById = new Map(catalog.skus.map((s) => [s.id, s]));

  const rows: SupplierItemRow[] = [];
  const seen = new Set<string>();
  for (const sku of catalog.skus) {
    if (!sku.supplierId) continue;
    const supplier = supplierById.get(sku.supplierId);
    if (!supplier) continue;
    const model = modelById.get(sku.modelId);
    seen.add(`${supplier.id}:${sku.id}`);
    rows.push({
      key: `${supplier.id}:${sku.id}`,
      supplierId: supplier.id,
      supplierName: supplier.name,
      supplierCode: sku.supplierCode ?? null,
      description: sku.description ?? null,
      sku: sku.sku,
      ourName: [model?.name ?? "", sku.variant].filter(Boolean).join(" · "),
      category: model?.category ?? null,
      source: "supplies",
    });
  }
  /* An offer is this supplier's item too — that is the whole point of
     recording it. The SAME data-fault stance as the slot: an offer pointing at
     a SKU or supplier the bundles do not hold is DROPPED, not rendered blank.
     Where one supplier is both slot and offer for one SKU, the slot row wins
     and the pair prints once. */
  for (const offer of offers) {
    const pair = `${offer.supplierId}:${offer.skuId}`;
    if (seen.has(pair)) continue;
    const supplier = supplierById.get(offer.supplierId);
    const sku = skuById.get(offer.skuId);
    if (!supplier || !sku) continue;
    seen.add(pair);
    const model = modelById.get(sku.modelId);
    rows.push({
      key: pair,
      supplierId: supplier.id,
      supplierName: supplier.name,
      supplierCode: offer.supplierCode,
      description: sku.description ?? null,
      sku: sku.sku,
      ourName: [model?.name ?? "", sku.variant].filter(Boolean).join(" · "),
      category: model?.category ?? null,
      source: "quoted",
    });
  }
  /* Supplier first, then OUR code — the order someone reads a quotation in:
     find the supplier, then walk their items. */
  rows.sort(
    (a, b) => a.supplierName.localeCompare(b.supplierName) || a.sku.localeCompare(b.sku),
  );
  return rows;
}

/** How many of a supplier's items still have no supplier code — the number
 *  that says how much of the quotation is left to key in. */
export function missingSupplierCodeCount(rows: readonly SupplierItemRow[]): number {
  return rows.filter((r) => !r.supplierCode?.trim()).length;
}

/* ── Price list CSV (Houzs SupplierBindingsCsv: export, then import with a preview) ── */

export const PRICE_LIST_HEADER = ["Our code", "Their code", "Price", "PWP price"] as const;

/** The supplier's items as a price list, ready to edit and import back. */
export function priceListCsv(
  items: readonly SupplierItemRow[],
  offers: ReadonlyArray<{ skuId: string; price?: number | null; pwpPrice?: number | null }>,
): string {
  const bySku = new Map(offers.map((o) => [o.skuId, o]));
  const lines = [PRICE_LIST_HEADER.join(",")];
  for (const r of items) {
    const o = bySku.get(r.key.split(":")[1] ?? "");
    lines.push([r.sku, r.supplierCode, o?.price, o?.pwpPrice].map(csvCell).join(","));
  }
  return lines.join("\n");
}

export interface PriceListRow { sku: string; supplierCode?: string; price?: number; pwpPrice?: number }

/** Read an edited price list. A blank cell is left out so the stored value stays. */
export function readPriceList(records: ReadonlyArray<Record<string, string>>): { rows: PriceListRow[]; problems: string[] } {
  const pick = (r: Record<string, string>, names: string[]) => {
    const key = Object.keys(r).find((k) => names.includes(k.trim().toLowerCase().replace(/[_\s]+/g, " ")));
    return key ? (r[key] ?? "").trim() : "";
  };
  const rows: PriceListRow[] = [];
  const problems: string[] = [];
  records.forEach((r, i) => {
    const sku = pick(r, ["our code", "sku", "internal code"]);
    if (!sku) return;
    const row: PriceListRow = { sku };
    const code = pick(r, ["their code", "supplier code", "supplier sku"]);
    if (code) row.supplierCode = code;
    for (const [field, names] of [["price", ["price", "price rm"]], ["pwpPrice", ["pwp price", "pwp price rm"]]] as const) {
      const raw = pick(r, [...names]).replace(/^rm\s*/i, "").replace(/,/g, "");
      if (!raw) continue;
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0) { problems.push(`Row ${i + 2}: ${field === "price" ? "Price" : "PWP price"} "${raw}" is not a number.`); continue; }
      row[field] = n;
    }
    rows.push(row);
  });
  return { rows, problems };
}
