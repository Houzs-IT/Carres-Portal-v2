import { describe, expect, it } from "vitest";
import { piViewOf } from "./OperationPurchaseInvoices";

describe("Purchase Invoices tabs", () => {
  it("reads Partial and Paid from Finance's paid figure, and a stored status first", () => {
    const of = (status: string, paid_total: number, unpaid: number) => piViewOf({ status, paid_total, unpaid });
    expect(of("draft", 0, 100)).toBe("draft");
    expect(of("cancelled", 50, 50)).toBe("cancelled");
    expect(of("confirmed", 0, 100)).toBe("confirmed");
    expect(of("confirmed", 40, 60)).toBe("partial");
    expect(of("confirmed", 100, 0)).toBe("paid");
  });
});
