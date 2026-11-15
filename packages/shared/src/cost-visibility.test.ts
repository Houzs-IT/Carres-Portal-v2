import { describe, expect, it } from "vitest";
import type { ZodTypeAny } from "zod";
import { COST_ROLES, catalogWithoutCost, rentalAgreementWithoutSupplierShare, seesCost } from "./cost-visibility";
import { catalogResponseSchema, type CatalogResponse } from "./schemas/catalog";
import { APP_ROLES } from "./schemas/principal-accounts";

/* Owner, 16 Nov 2026: what Carres pays and who Carres buys from are for Carres's internal roles. A store login
 * (dealer, salesperson, showroom) never receives them. */

describe("who sees cost", () => {
  it("is Carres's four internal roles, the ones the database's is_internal() names", () => {
    expect([...COST_ROLES].sort()).toEqual(["bd", "finance", "operation", "principal"]);
  });

  it("is never a store login, and never a role nobody decided about", () => {
    for (const role of ["dealer", "salesperson", "showroom"]) expect(seesCost(role)).toBe(false);
    const undecided = APP_ROLES.filter((role) => !(COST_ROLES as readonly string[]).includes(role));
    expect(undecided).toContain("hr");
    for (const role of undecided) expect(seesCost(role)).toBe(false);
    for (const role of ["", "PRINCIPAL", "admin", "service_role"]) expect(seesCost(role)).toBe(false);
  });
});

const SUPPLIER = "00000000-0000-0000-0000-0000000000e1";

function catalog(): CatalogResponse {
  return catalogResponseSchema.parse({
    models: [],
    skus: [
      {
        id: "00000000-0000-0000-0000-00000000bb01", modelId: "00000000-0000-0000-0000-00000000aa01",
        sku: "CLASSIC-Q", variant: "Q", variantKind: "size", price: 1500, cost: 640, supplierId: SUPPLIER,
        supplierCode: "1007(HF)(W)-(Q)", discontinuedAt: null, posActive: true, description: null,
        compartmentId: null, pwpPrice: 990, pricesBySize: { Q: 1500 },
      },
      {
        id: "00000000-0000-0000-0000-00000000bb02", modelId: "00000000-0000-0000-0000-00000000aa01",
        sku: "CLASSIC-K", variant: "K", variantKind: "size", price: 1900, cost: null, supplierId: null,
        discontinuedAt: null,
      },
    ],
    sofaFabrics: [],
    addons: [],
    floorConfig: { id: 1, freeUpToFloor: 2, perFloorPerItem: 50 },
    sofaCombos: [
      {
        id: "00000000-0000-0000-0000-00000000cc01", modelId: "00000000-0000-0000-0000-00000000aa02",
        slots: [["1A"]], tier: null, pricesByHeight: { "24": 2800 }, costByHeight: { "24": 1300 },
        pwpPricesByHeight: { "24": 1999 }, label: null, effectiveFrom: "2026-01-01", active: true,
        discontinuedAt: null, isQuickPick: false, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z",
      },
    ],
    specialAddons: [
      {
        id: "00000000-0000-0000-0000-00000000dd01", code: "USB", label: "USB port", soDescription: "",
        categories: ["sofa"], sellingPrice: 120, cost: 45, optionGroups: [], active: true, sortOrder: 0,
      },
    ],
    fabrics: [
      {
        id: "00000000-0000-0000-0000-00000000ee01", fabricCode: "KN390-7", series: null, description: null,
        supplierCode: "KN390-7", sofaTier: "PRICE_2", bedframeTier: "PRICE_2", active: true, sortOrder: 0, cost: 18.5,
        stock: {
          priceSen: 1850, sohSen: 0, poOutstandingSen: 0, lastMonthUsageSen: 0, oneWeekUsageSen: 0,
          twoWeeksUsageSen: 0, oneMonthUsageSen: 0, shortageSen: 0, reorderPointSen: 0, leadTimeDays: 0,
        },
      },
    ],
    earliestSellDays: 14,
  });
}

/** Every value in `value` stored under a key that names a cost or a supplier, with its path. */
function costAndSupplierValues(value: unknown, path = ""): Array<[string, unknown]> {
  if (Array.isArray(value)) return value.flatMap((item, i) => costAndSupplierValues(item, `${path}[${i}]`));
  if (value === null || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, inner]) =>
    /cost|supplier/i.test(key) ? [[`${path}.${key}`, inner] as [string, unknown]] : costAndSupplierValues(inner, `${path}.${key}`),
  );
}

describe("the catalogue a role that does not see cost receives", () => {
  it("carries no cost, no supplier and no supplier item code, anywhere", () => {
    const before = catalog();
    // The fixture really does hold them, or the next line proves nothing.
    expect(costAndSupplierValues(before).filter(([, v]) => v !== null && v !== undefined).map(([p]) => p)).toEqual([
      ".skus[0].cost", ".skus[0].supplierId", ".skus[0].supplierCode", ".sofaCombos[0].costByHeight",
      ".specialAddons[0].cost", ".fabrics[0].supplierCode", ".fabrics[0].cost",
    ]);

    const after = catalogWithoutCost(before);
    expect(costAndSupplierValues(after).filter(([, v]) => v !== null && v !== undefined)).toEqual([]);
    expect(after.fabrics?.[0]?.stock).toBeUndefined();
  });

  it("keeps everything a store sells with", () => {
    const after = catalogWithoutCost(catalog());
    expect(after.skus[0]).toMatchObject({ sku: "CLASSIC-Q", price: 1500, pwpPrice: 990, pricesBySize: { Q: 1500 } });
    expect(after.sofaCombos?.[0]).toMatchObject({ pricesByHeight: { "24": 2800 }, pwpPricesByHeight: { "24": 1999 } });
    expect(after.specialAddons?.[0]).toMatchObject({ code: "USB", sellingPrice: 120 });
    expect(after.fabrics?.[0]).toMatchObject({ fabricCode: "KN390-7", sofaTier: "PRICE_2" });
    expect(after.earliestSellDays).toBe(14);
  });

  it("is still a catalogue the reader accepts, and leaves the one it was given alone", () => {
    const before = catalog();
    const after = catalogWithoutCost(before);
    expect(() => catalogResponseSchema.parse(JSON.parse(JSON.stringify(after)))).not.toThrow();
    expect(before.skus[0]?.cost).toBe(640);
    expect(before.sofaCombos?.[0]?.costByHeight).toEqual({ "24": 1300 });
  });

  it("does not invent lists the catalogue did not have", () => {
    const bare = catalogResponseSchema.parse({
      models: [], skus: [], sofaFabrics: [], addons: [], floorConfig: { id: 1, freeUpToFloor: 0, perFloorPerItem: 0 },
    });
    const after = catalogWithoutCost(bare);
    expect(after.sofaCombos).toBeUndefined();
    expect(after.specialAddons).toBeUndefined();
    expect(after.fabrics).toBeUndefined();
  });
});

/* A NEW FIELD MEANS DECIDING. The catalogue's shape is walked for every key that names a cost or a supplier.
 * Adding one to the catalogue fails here until catalogWithoutCost hides it and it is listed below. */
function costAndSupplierKeys(schema: ZodTypeAny, path = ""): string[] {
  const def = schema._def as { typeName?: string; innerType?: ZodTypeAny; schema?: ZodTypeAny; type?: ZodTypeAny; valueType?: ZodTypeAny; options?: ZodTypeAny[] };
  switch (def.typeName) {
    case "ZodObject":
      return Object.entries((schema as unknown as { shape: Record<string, ZodTypeAny> }).shape).flatMap(([key, inner]) =>
        /cost|supplier/i.test(key) ? [`${path}.${key}`] : costAndSupplierKeys(inner, `${path}.${key}`),
      );
    case "ZodArray":
      return costAndSupplierKeys(def.type as ZodTypeAny, `${path}[]`);
    case "ZodOptional":
    case "ZodNullable":
    case "ZodDefault":
      return costAndSupplierKeys(def.innerType as ZodTypeAny, path);
    case "ZodEffects":
      return costAndSupplierKeys(def.schema as ZodTypeAny, path);
    case "ZodRecord":
      return costAndSupplierKeys(def.valueType as ZodTypeAny, `${path}{}`);
    case "ZodUnion":
      return (def.options ?? []).flatMap((option) => costAndSupplierKeys(option, path));
    default:
      return [];
  }
}

describe("the catalogue's shape", () => {
  it("names a cost or a supplier in exactly the places catalogWithoutCost hides", () => {
    expect(costAndSupplierKeys(catalogResponseSchema).sort()).toEqual([
      ".fabrics[].cost",
      ".fabrics[].supplierCode",
      ".skus[].cost",
      ".skus[].supplierCode",
      ".skus[].supplierId",
      ".sofaCombos[].costByHeight",
      ".specialAddons[].cost",
    ]);
  });
});

describe("a rental agreement a store receives", () => {
  it("has no supplier share and keeps the rest", () => {
    const agreement = { id: "a1", monthlyFee: 199, supplierRatePct: 40, commissionBasePct: 20 };
    const shown = rentalAgreementWithoutSupplierShare(agreement);
    expect(shown).toEqual({ id: "a1", monthlyFee: 199, commissionBasePct: 20 });
    expect("supplierRatePct" in shown).toBe(false);
    expect(agreement.supplierRatePct).toBe(40);
  });
});
