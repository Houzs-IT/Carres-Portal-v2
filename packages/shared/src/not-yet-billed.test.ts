import { describe, expect, it } from "vitest";
import { notYetBilled, type NotYetBilledOrder } from "./not-yet-billed";

const order = (over: Partial<NotYetBilledOrder> = {}): NotYetBilledOrder => ({
  id: "o1",
  so: 1375,
  customer_name: "Amy",
  delivered_at: "2026-10-30T02:00:00Z",
  order_lines: [{ id: "l1", qty: 2, unit_price: "100.50" }, { id: "l2", qty: 1, unit_price: 300 }],
  order_addons: [{ qty: 1, unit_price: 50 }],
  invoices: [],
  ops_delivery_orders: [{ do_number: "DO1", voided_at: null }, { do_number: "DO2", voided_at: "2026-10-01" }],
  ...over,
});

describe("notYetBilled", () => {
  it("an order with no invoice owes its whole value, add-ons included", () => {
    expect(notYetBilled(order())).toMatchObject({ delivered_value: 551, already_billed: 0, not_billed: 551, do_numbers: ["DO1"] });
  });

  it("an issued system invoice bills everything", () => {
    expect(notYetBilled(order({ invoices: [{ kind: "sales", status: "issued" }] }))).toBeNull();
  });

  it("a draft, a voided or a storage invoice bills nothing", () => {
    const invoices = [{ kind: "sales", status: "draft" }, { kind: "sales", status: "voided" }, { kind: "storage", status: "issued" }];
    expect(notYetBilled(order({ invoices }))?.not_billed).toBe(551);
  });

  it("office invoices bill their own lines, and the add-ons ride on the first", () => {
    const part = { kind: "sales", status: "issued", snapshot_from: "office", snapshot_lines: [{ order_line_id: "l1", qty: 1 }] };
    expect(notYetBilled(order({ invoices: [part] }))).toMatchObject({ already_billed: 150.5, not_billed: 400.5 });
  });

  it("office invoices that reach every line leave no row", () => {
    const whole = { kind: "sales", status: "issued", snapshot_from: "office",
      snapshot_lines: [{ order_line_id: "l1", qty: 2 }, { order_line_id: "l2", qty: 1 }] };
    expect(notYetBilled(order({ invoices: [whole] }))).toBeNull();
  });

  it("an order worth nothing leaves no row", () => {
    expect(notYetBilled(order({ order_lines: [{ id: "l1", qty: 1, unit_price: 0 }], order_addons: [] }))).toBeNull();
  });
});
