import { describe, expect, it } from "vitest";
import {
  SUPPLIER_FINANCE_DEFAULT_MONTHS,
  supplierFinanceInstalments,
  supplierFinanceOrder,
  supplierFinanceSummary,
  type SupplierFinanceAgreementRow,
  type SupplierFinanceBillingRow,
} from "./supplier-finance";

const TODAY = "2026-11-15";

const agreement = (over: Partial<SupplierFinanceAgreementRow> = {}): SupplierFinanceAgreementRow => ({
  id: "a1", agreementNo: "RA-1", soNo: "SO-10", customerName: "Tan", item: "Cloud Queen", termMonths: 60, monthlyFee: 59,
  ratePct: 49, startDate: "2026-06-07", status: "active", ...over,
});

/** `paid` months collected on their due day, the rest still open, one a month from 2026-06-07. */
function schedule(agreementId: string, months: number, paid: number, fee = 59, share = 28.91): SupplierFinanceBillingRow[] {
  return Array.from({ length: months }, (_, i) => {
    const d = new Date(Date.UTC(2026, 5 + i, 7)).toISOString().slice(0, 10);
    const isPaid = i < paid;
    return {
      agreementId, seq: i + 1, dueDate: d, amountDue: fee, status: isPaid ? "paid" : "due",
      paidOn: isPaid ? d : null, paidAmount: isPaid ? fee : null, supplierShare: isPaid ? share : null,
    };
  });
}

describe("supplierFinanceOrder", () => {
  it("reads the stored share of collected months and forecasts the rest with the writer's formula", () => {
    // Six months have fallen due by 15 Nov (7 Jun to 7 Nov); all six were paid.
    const o = supplierFinanceOrder(agreement(), schedule("a1", 60, 6), TODAY);
    expect(o.contractValue).toBe(3540);
    expect(o.paidCount).toBe(6);
    expect(o.collected).toBe(354);
    expect(o.shareEarned).toBe(173.46); // 6 x 28.91, the stored figure
    expect(o.toCollect).toBe(3186); // 54 x 59
    expect(o.shareToCome).toBe(1561.14); // 54 x 28.91
    expect(o.shareTotal).toBe(1734.6);
    expect(o).toMatchObject({ state: "on_time", overdueMonths: 0, overdueAmount: 0, nextDueDate: "2026-12-07", lastPaidOn: "2026-11-07" });
  });

  it("uses the share that was STORED, even when it differs from today's rate", () => {
    // The month was collected when the rate was 40%: 23.60 was stored. The agreement now says 49%.
    const rows = schedule("a1", 2, 1, 59, 23.6);
    const o = supplierFinanceOrder(agreement({ termMonths: 2 }), rows, TODAY);
    expect(o.shareEarned).toBe(23.6);
    expect(o.shareToCome).toBe(28.91);
  });

  it("counts months whose day has passed unpaid as overdue, and six of them as default", () => {
    const behind = supplierFinanceOrder(agreement(), schedule("a1", 60, 4), TODAY);
    expect(behind).toMatchObject({ state: "behind", overdueMonths: 2, overdueAmount: 118, overdueShare: 57.82 });

    const none = supplierFinanceOrder(agreement(), schedule("a1", 60, 0), TODAY);
    expect(none.overdueMonths).toBe(SUPPLIER_FINANCE_DEFAULT_MONTHS);
    expect(none.state).toBe("default");
    expect(none.shareEarned).toBe(0);
  });

  it("an instalment due today is not late yet", () => {
    const o = supplierFinanceOrder(agreement(), schedule("a1", 60, 5), "2026-11-07");
    expect(o.overdueMonths).toBe(0);
    expect(o.state).toBe("on_time");
  });

  it("waived and written-off months are neither collected nor still to come", () => {
    const rows = schedule("a1", 3, 1);
    rows[1] = { ...rows[1]!, status: "waived" };
    rows[2] = { ...rows[2]!, status: "written_off" };
    const o = supplierFinanceOrder(agreement({ termMonths: 3 }), rows, TODAY);
    expect(o).toMatchObject({ toCollect: 0, shareToCome: 0, overdueMonths: 0, state: "completed", shareTotal: 28.91 });
  });

  it("names the agreement's own status when it is ended or defaulted by Carres", () => {
    expect(supplierFinanceOrder(agreement({ status: "cancelled" }), schedule("a1", 60, 6), TODAY).state).toBe("ended");
    expect(supplierFinanceOrder(agreement({ status: "defaulted" }), schedule("a1", 60, 6), TODAY).state).toBe("default");
    expect(supplierFinanceOrder(agreement({ status: "completed", termMonths: 6 }), schedule("a1", 6, 6), TODAY).state).toBe("completed");
  });
});

describe("supplierFinanceInstalments", () => {
  it("says for each month whether it was paid, is late, or is still to come", () => {
    const rows = supplierFinanceInstalments(agreement(), schedule("a1", 8, 4), TODAY);
    expect(rows.map((r) => r.state)).toEqual(["paid", "paid", "paid", "paid", "late", "late", "upcoming", "upcoming"]);
    expect(rows[0]).toMatchObject({ seq: 1, paidOn: "2026-06-07", paidAmount: 59, share: 28.91, daysLate: 0 });
    expect(rows[4]).toMatchObject({ seq: 5, dueDate: "2026-10-07", paidOn: null, paidAmount: null, share: 28.91, daysLate: 39 });
  });

  it("carries only the fields a supplier may read", () => {
    const row = supplierFinanceInstalments(agreement(), schedule("a1", 1, 1), TODAY)[0]!;
    expect(Object.keys(row).sort()).toEqual(["amountDue", "daysLate", "dueDate", "paidAmount", "paidOn", "seq", "share", "state"]);
  });
});

describe("supplierFinanceSummary", () => {
  const a = agreement();
  const b = agreement({ id: "a2", agreementNo: "RA-2", soNo: "SO-11", customerName: "Lim", monthlyFee: 100, termMonths: 12, ratePct: 49, startDate: "2026-06-07" });
  const pending = agreement({ id: "a3", agreementNo: "RA-3", status: "active" }); // no schedule at all
  const rows = [...schedule("a1", 60, 6), ...schedule("a2", 12, 3, 100, 49)];

  it("totals every order and leaves out an agreement that has no schedule", () => {
    const s = supplierFinanceSummary([a, b, pending], rows, TODAY);
    expect(s.asOf).toBe(TODAY);
    expect(s.orders.map((o) => o.agreementNo)).toEqual(["RA-2", "RA-1"]); // the one behind first
    expect(s.totals).toEqual({
      orders: 2,
      contractValue: 4740, // 3540 + 1200
      shareTotal: 2322.6, // 1734.60 + 588
      collected: 654, // 354 + 300
      collectedCount: 9,
      shareEarned: 320.46, // 173.46 + 147
      toCollect: 4086, // 3186 + 900
      shareToCome: 2002.14, // 1561.14 + 441
      overdueOrders: 1,
      overdueMonths: 3,
      overdueAmount: 300,
      overdueShare: 147,
      defaultOrders: 0,
    });
  });

  it("the totals are the sum of the orders, and earned plus to come is the whole share", () => {
    const s = supplierFinanceSummary([a, b], rows, TODAY);
    const sum = (f: (o: (typeof s.orders)[number]) => number) => Math.round(s.orders.reduce((x, o) => x + f(o), 0) * 100) / 100;
    expect(s.totals.shareEarned).toBe(sum((o) => o.shareEarned));
    expect(s.totals.shareToCome).toBe(sum((o) => o.shareToCome));
    expect(s.totals.shareTotal).toBe(Math.round((s.totals.shareEarned + s.totals.shareToCome) * 100) / 100);
    expect(s.totals.collected + s.totals.toCollect).toBe(s.totals.contractValue);
  });

  it("groups the money by the month it falls due", () => {
    const s = supplierFinanceSummary([a, b], rows, TODAY);
    const june = s.months.find((m) => m.month === "2026-06")!;
    expect(june).toEqual({ month: "2026-06", due: 159, dueShare: 77.91, collected: 159, collectedShare: 77.91, open: 0, openShare: 0 });
    const october = s.months.find((m) => m.month === "2026-10")!;
    // RA-1 paid October; RA-2 did not.
    expect(october).toEqual({ month: "2026-10", due: 159, dueShare: 77.91, collected: 59, collectedShare: 28.91, open: 100, openShare: 49 });
    expect(s.months[0]!.month).toBe("2026-06");
    const dueShare = Math.round(s.months.reduce((x, m) => x + m.dueShare, 0) * 100) / 100;
    expect(dueShare).toBe(s.totals.shareTotal);
  });

  it("answers no customer contact, payment reference or commission", () => {
    const s = supplierFinanceSummary([a], schedule("a1", 2, 1), TODAY);
    const keys = Object.keys(s.orders[0]!).sort();
    expect(keys).toEqual([
      "agreementNo", "collected", "contractValue", "customerName", "id", "item", "lastPaidOn", "monthlyFee", "nextDueDate",
      "overdueAmount", "overdueMonths", "overdueShare", "paidCount", "ratePct", "shareEarned", "shareToCome", "shareTotal",
      "soNo", "startDate", "state", "status", "termMonths", "toCollect",
    ]);
  });
});
