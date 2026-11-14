import { beforeEach, describe, expect, it } from "vitest";
import { useEngineBadges } from "./engine-badges";
import { PORTAL_NAV } from "./portal-nav";

describe("Houzs's menu counts from the engine frame", () => {
  beforeEach(() => useEngineBadges.setState({ counts: {} }));

  it("keeps only the known counts, whole and not negative", () => {
    useEngineBadges.getState().set({ "fair-links-to-settle": 120, "amendment-approvals": 2.7, "po-amendment-approvals": -1, "it-support-replies": 9, x: "1" });
    expect(useEngineBadges.getState().counts).toEqual({ "fair-links-to-settle": 120, "amendment-approvals": 2 });
  });

  it("keeps Houzs Finance's two counts: To do, and Payment requests waiting for Finance", () => {
    useEngineBadges.getState().set({ "finance-todo": 9, "payment-requests-waiting": 4 });
    expect(useEngineBadges.getState().counts).toEqual({ "finance-todo": 9, "payment-requests-waiting": 4 });
  });

  it("ignores a message that carries no counts", () => {
    useEngineBadges.getState().set({ "fair-links-to-settle": 3 });
    useEngineBadges.getState().set(null);
    expect(useEngineBadges.getState().counts).toEqual({ "fair-links-to-settle": 3 });
  });

  it("the rows Houzs badges carry the same count", () => {
    const op = PORTAL_NAV.find((g) => g.area === "operation")!;
    const badgeOf = (key: string) => op.items.find((i) => i.key === key)?.badge;
    expect(badgeOf("amendments")).toBe("amendment-approvals");
    expect(badgeOf("payment-backdate-requests")).toBe("payment-backdate-approvals");
    expect(badgeOf("po-amendments")).toBe("po-amendment-approvals");
    expect(badgeOf("product-requests")).toBe("product-request-approvals");
    expect(badgeOf("product-request")).toBe("product-request-approvals");
    expect(badgeOf("fin-todo")).toBe("finance-todo");
    expect(badgeOf("fin-payment-requests")).toBe("payment-requests-waiting");
  });
});
