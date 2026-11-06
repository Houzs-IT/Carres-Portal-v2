import { describe, expect, it } from "vitest";
import { priceAfterDoInput } from "./price-after-do";

describe("price after DO input", () => {
  it("takes a unit price of zero or more and an optional reason", () => {
    expect(priceAfterDoInput.safeParse({ unitPrice: 0 }).success).toBe(true);
    expect(priceAfterDoInput.safeParse({ unitPrice: 1299.5, reason: "Price was not keyed in" }).success).toBe(true);
  });
  it("refuses a negative price, a missing price and anything else (no qty, no sku)", () => {
    expect(priceAfterDoInput.safeParse({ unitPrice: -1 }).success).toBe(false);
    expect(priceAfterDoInput.safeParse({}).success).toBe(false);
    expect(priceAfterDoInput.safeParse({ unitPrice: 10, qty: 2 }).success).toBe(false);
  });
});
