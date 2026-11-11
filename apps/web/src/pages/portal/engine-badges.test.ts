import { beforeEach, describe, expect, it } from "vitest";
import { useEngineBadges } from "./engine-badges";
import { PORTAL_NAV } from "./portal-nav";

describe("Houzs's menu counts from the engine frame", () => {
  beforeEach(() => useEngineBadges.setState({ counts: {} }));

  it("keeps only the five known counts, whole and not negative", () => {
    useEngineBadges.getState().set({ "fair-links-to-settle": 120, "amendment-approvals": 2.7, "po-amendment-approvals": -1, "finance-todo": 9, x: "1" });
    expect(useEngineBadges.getState().counts).toEqual({ "fair-links-to-settle": 120, "amendment-approvals": 2 });
  });

  it("ignores a message that carries no counts", () => {
    useEngineBadges.getState().set({ "fair-links-to-settle": 3 });
    useEngineBadges.getState().set(null);
    expect(useEngineBadges.getState().counts).toEqual({ "fair-links-to-settle": 3 });
  });

  it("the rows Houzs badges carry the same count", () => {
    const op = PORTAL_NAV.find((g) => g.area === "operation")!;
    const badgeOf = (key: string) => op.items.find((i) => i.key === key)?.badge;
    expect(badgeOf("fair-pending")).toBe("fair-links-to-settle");
    expect(badgeOf("amendments")).toBe("amendment-approvals");
    expect(badgeOf("payment-backdate-requests")).toBe("payment-backdate-approvals");
    expect(badgeOf("po-amendments")).toBe("po-amendment-approvals");
    expect(badgeOf("product-requests")).toBe("product-request-approvals");
    expect(badgeOf("product-request")).toBe("product-request-approvals");
  });
});
