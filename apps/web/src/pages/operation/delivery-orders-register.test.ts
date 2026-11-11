import { describe, it, expect } from "vitest";
import { driverSubmissionOf, tripLinesOf } from "./delivery-orders-register";




describe("tripLinesOf — one arithmetic with the DO page and the print path", () => {
  const lines = [
    { sku: "mattress:M1401F-K", qty: 1 },
    { sku: "sofa:S200-3", qty: 1 },
  ];

  it("trip_groups NULL or empty = the whole order", () => {
    expect(tripLinesOf(lines, null)).toHaveLength(2);
    expect(tripLinesOf(lines, [])).toHaveLength(2);
  });

  it("a split trip carries only its groups' lines", () => {
    const out = tripLinesOf(lines, ["sofa"]);
    expect(out).toHaveLength(1);
    expect(out[0]!.sku).toBe("sofa:S200-3");
  });
});

/**
 * ⭐ THE BINDING (owner ruling 2026-09-11). The defect these tests exist to
 * keep dead: one Sales Order, two Delivery Orders, ONE ledger - and a register
 * that counted the ledger told both rows the same number.
 */
describe("driverSubmissionOf - what came back from THIS trip", () => {
  const ledger = [
    { path: "a.jpg", at: "1", by: null, doNumber: "DO-A", kind: "photo" as const },
    { path: "b.jpg", at: "2", by: null, doNumber: "DO-A", kind: "photo" as const },
    { path: "c.mp4", at: "3", by: null, doNumber: "DO-A", kind: "video" as const },
    { path: "d.jpg", at: "4", by: null, doNumber: "DO-B", kind: "photo" as const },
    { path: "legacy.jpg", at: "5", by: null },
  ];

  it("counts only the files stamped with this document", () => {
    expect(driverSubmissionOf(ledger, "DO-A")).toEqual({
      known: true,
      photos: 2,
      videos: 1,
      unbound: 1,
    });
    expect(driverSubmissionOf(ledger, "DO-B")).toEqual({
      known: true,
      photos: 1,
      videos: 0,
      unbound: 1,
    });
  });

  it("an ABSENT ledger is UNKNOWN, never a fabricated zero", () => {
    expect(driverSubmissionOf(undefined, "DO-A").known).toBe(false);
    expect(driverSubmissionOf(null, "DO-A").known).toBe(false);
    /* A ledger that arrived and holds nothing is a real zero. */
    expect(driverSubmissionOf([], "DO-A")).toEqual({
      known: true,
      photos: 0,
      videos: 0,
      unbound: 0,
    });
  });

  it("a stamped entry with no kind is the photo it could only have been", () => {
    expect(
      driverSubmissionOf([{ path: "x.jpg", at: "1", doNumber: "DO-A" }], "DO-A"),
    ).toEqual({ known: true, photos: 1, videos: 0, unbound: 0 });
  });

  });



