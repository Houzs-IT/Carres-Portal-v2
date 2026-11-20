import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PRODUCT_FINANCE_KEYS } from "../src/scm/lib/finance-keys";

/* Chew 2026-11-20: the SKU Master's Price 2 column shows a SKU's cost even when it
   sits only on cost_price_sen, so GET /mfg-products (the list) now selects it. The
   owner ruled a product cost is for Purchasing + Finance + Sales Director only
   (2026-07-17), and this list is also the catalogue every SO / PO / GRN picker
   loads. So the list must strip it for everyone else. This locks the pair: the
   column on the select and the strip after the read. */

const src = readFileSync(
  fileURLToPath(new URL("../src/scm/routes/mfg-products.ts", import.meta.url)),
  "utf8",
);

describe("GET /mfg-products list: cost_price_sen is gated", () => {
  test("cost_price_sen is a product finance key", () => {
    expect(PRODUCT_FINANCE_KEYS).toContain("cost_price_sen");
  });

  test("the list select carries cost_price_sen only with the strip after it", () => {
    const listStart = src.indexOf("'id, code, name, category, description, base_model");
    expect(listStart).toBeGreaterThan(0);
    const selectLine = src.slice(listStart, src.indexOf("\n", listStart));
    expect(selectLine).toContain("cost_price_sen");
    const after = src.slice(listStart);
    expect(after).toMatch(
      /if \(!canViewScmProductCost\(c\)\) for \(const p of products\) for \(const k of PRODUCT_FINANCE_KEYS\) delete p\[k\];/,
    );
  });
});
