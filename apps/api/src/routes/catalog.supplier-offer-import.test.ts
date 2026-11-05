import { describe, it, expect } from "vitest";
import { mergeOfferImport } from "./catalog";

/** Houzs Supplier Bindings CSV import: blanks keep the stored value, unknown codes are skipped. */
describe("mergeOfferImport", () => {
  const SUP = "00000000-0000-0000-0000-0000000000c2";
  const skuIds = new Map([["BF-1", "s1"], ["BF-2", "s2"]]);
  const stored = new Map([["s1", { supplier_code: "K-1", price: 500, pwp_price: 450 }]]);

  it("keeps stored values where the row is blank and reports unknown codes", () => {
    const r = mergeOfferImport(
      { supplierId: SUP, rows: [{ sku: "BF-1", price: 520 }, { sku: "BF-2", supplierCode: "K-2" }, { sku: "NOPE", price: 1 }] },
      skuIds, stored, "u1", "2026-11-02T00:00:00Z",
    );
    expect(r.unknown).toEqual(["NOPE"]);
    expect(r.upserts).toEqual([
      { sku_id: "s1", supplier_id: SUP, supplier_code: "K-1", price: 520, pwp_price: 450, updated_at: "2026-11-02T00:00:00Z", updated_by: "u1" },
      { sku_id: "s2", supplier_id: SUP, supplier_code: "K-2", price: null, pwp_price: null, updated_at: "2026-11-02T00:00:00Z", updated_by: "u1" },
    ]);
  });

  it("writes one row per SKU when a code repeats, the later cell winning", () => {
    const r = mergeOfferImport({ supplierId: SUP, rows: [{ sku: "BF-2", price: 1 }, { sku: "BF-2", pwpPrice: 2 }] }, skuIds, new Map(), "u1", "t");
    expect(r.upserts).toHaveLength(1);
    expect(r.upserts[0]).toMatchObject({ price: 1, pwp_price: 2 });
  });
});
