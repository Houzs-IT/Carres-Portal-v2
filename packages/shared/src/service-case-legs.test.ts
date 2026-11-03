import { describe, expect, it } from "vitest";
import { caseBoardLegs, caseLegLabel, casePickupPicOptions, logisticsConfirmedText } from "./service-case-legs";

describe("logisticsConfirmedText", () => {
  const fmt = (iso: string) => `[${iso}]`;

  it("shows the confirmed date once Logistics has one", () => {
    expect(logisticsConfirmedText("2026-11-10", "2026-11-12", fmt)).toBe("Logistics confirmed [2026-11-12].");
  });

  it("waits when only the requested date is set", () => {
    expect(logisticsConfirmedText("2026-11-10", null, fmt)).toBe("Waiting for Logistics to confirm this date.");
  });

  it("asks for a date when neither is set", () => {
    expect(logisticsConfirmedText(null, undefined, fmt)).toBe("Set the date you want; Logistics confirms it.");
  });
});

describe("caseLegLabel", () => {
  it("labels own team and passes an unknown key through", () => {
    expect(caseLegLabel("own")).toBe("Own team");
    expect(caseLegLabel("drone")).toBe("drone");
  });
});

describe("casePickupPicOptions", () => {
  it("puts the supplier first, then drivers, and keeps a typed PIC", () => {
    expect(casePickupPicOptions(["Ali", "Factory A"], "Factory A", "Mr Tan")).toEqual([
      { value: "Mr Tan", label: "Mr Tan" },
      { value: "Factory A", label: "Factory A (Supplier)" },
      { value: "Ali", label: "Ali" },
    ]);
  });
});

describe("caseBoardLegs", () => {
  const blank = { pickup_by: null, pickup_requested_at: null, pickup_confirmed_at: null, actual_pickup_at: null, delivery_by: null, delivery_requested_at: null, delivery_confirmed_at: null };
  it("puts own-team dated legs on the board, request and confirmed apart", () => {
    expect(caseBoardLegs({ ...blank, pickup_by: "own", pickup_requested_at: "2026-11-05", delivery_by: "own", delivery_confirmed_at: "2026-11-09" }, false)).toEqual([
      { leg: "pickup", requested: "2026-11-05", confirmed: null },
      { leg: "delivery", requested: null, confirmed: "2026-11-09" },
    ]);
  });
  it("leaves out supplier legs, undated legs, a picked-up pickup and a closed case", () => {
    expect(caseBoardLegs({ ...blank, pickup_by: "supplier", pickup_requested_at: "2026-11-05" }, false)).toEqual([]);
    expect(caseBoardLegs({ ...blank, pickup_by: "own" }, false)).toEqual([]);
    expect(caseBoardLegs({ ...blank, pickup_by: "own", pickup_requested_at: "2026-11-05", actual_pickup_at: "2026-11-05" }, false)).toEqual([]);
    expect(caseBoardLegs({ ...blank, delivery_by: "own", delivery_requested_at: "2026-11-09" }, true)).toEqual([]);
  });
});
