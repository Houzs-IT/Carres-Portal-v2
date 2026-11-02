import { describe, expect, it, vi } from "vitest";
import { applyBulkSupplierDate, bulkDateBody, type BulkDateForm, type BulkDateTarget } from "./po-bulk-supplier-date";

const form: BulkDateForm = { date: "2026-11-10", reason: "Other", remarks: "Factory closed", channel: "whatsapp", recipient: "Ali", reportedBy: "Ali", reportedAt: "2026-11-01T10:00" };
const target = (poId: string, patch: Partial<BulkDateTarget> = {}): BulkDateTarget => ({ poId, label: poId, version: 2, officialDate: "2026-11-05", openLineIds: ["l1", "l2"], blocked: null, ...patch });

describe("bulk Supplier date", () => {
  it("answers every open line with the date, and a reason only when later", () => {
    const later = bulkDateBody(target("A"), form, "A/file.png");
    expect(later.poVersion).toBe(2);
    expect(later.evidence).toEqual(["A/file.png"]);
    expect(later.lines.map((l) => [l.poLineId, l.answer, l.date, l.reason])).toEqual([["l1", "new_date", "2026-11-10", "Other"], ["l2", "new_date", "2026-11-10", "Other"]]);
    const earlier = bulkDateBody(target("B", { officialDate: "2026-11-20" }), form, "B/file.png");
    expect(earlier.lines[0]!.reason).toBeUndefined();
    expect(earlier.lines[0]!.remarks).toBeUndefined();
  });

  it("reports each PO: a refusal or a blocked PO does not stop the rest", async () => {
    const save = vi.fn(async (poId: string) => {
      if (poId === "B") throw Object.assign(new Error("x"), { body: { message: "PO is not open" } });
    });
    const upload = vi.fn(async (t: BulkDateTarget) => `${t.poId}/file.png`);
    const results = await applyBulkSupplierDate(
      [target("A"), target("B"), target("C", { blocked: "Sending not confirmed" }), target("D")], form, { upload, save });
    expect(results.map((r) => [r.poId, r.problem])).toEqual([["A", null], ["B", "PO is not open"], ["C", "Sending not confirmed"], ["D", null]]);
    expect(upload).toHaveBeenCalledTimes(3);
    expect(save.mock.calls.map((c) => c[0])).toEqual(["A", "B", "D"]);
  });

  it("a failed upload is that PO's failure", async () => {
    const results = await applyBulkSupplierDate([target("A")], form, { upload: async () => { throw new Error("net"); }, save: vi.fn() });
    expect(results[0]!.problem).toBe("Could not save. Try again.");
  });
});
