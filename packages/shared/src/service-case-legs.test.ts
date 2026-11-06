import { describe, expect, it } from "vitest";
import { caseLegLabel, casePickupPicOptions, logisticsConfirmedText } from "./service-case-legs";

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
