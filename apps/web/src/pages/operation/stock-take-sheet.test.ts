import { describe, expect, it } from "vitest";
import { readCountedFile, readCountedRows } from "./stock-take-sheet";

describe("readCountedRows", () => {
  it("takes only Units marked counted, in the system's own spelling of the code", () => {
    const r = readCountedRows([
      { "Unit ID": "u1", Counted: "Yes" }, { "Unit ID": "U2", Counted: "" }, { "Unit ID": "U9", Counted: 1 },
    ], [{ SKU: "S", Qty: 2 }, { SKU: "", Qty: 1 }], ["U1", "U2"]);
    expect(r).toEqual({ codes: ["U1"], unknown: ["U9"], extras: [{ sku: "S", qty: "2" }] });
  });
  it("refuses a file that would count nothing, so Post cannot write everything off", () => {
    expect(() => readCountedRows([{ "Unit ID": "U1", Counted: "" }], null, ["U1"])).toThrow(/Nothing was changed/);
    expect(() => readCountedRows([{ Item: "U1" }], null, ["U1"])).toThrow(/not a Stock Take sheet/);
    expect(() => readCountedRows([], null, ["U1"])).toThrow(/not a Stock Take sheet/);
  });
  it("on a blind count lets every code through for the server to decide", () => {
    expect(readCountedRows([{ "Unit ID": "U7", Counted: "x" }], null, null).codes).toEqual(["U7"]);
  });
});

describe("readCountedFile", () => {
  it("reads a real workbook whose first row is not counted", async () => {
    const XLSX = await import("xlsx");
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([
      { "Unit ID": "U1", SKU: "S", Counted: "" }, { "Unit ID": "U2", SKU: "S", Counted: "Yes" },
    ]), "Units");
    const bytes = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    const file = { arrayBuffer: async () => bytes } as unknown as File;
    expect((await readCountedFile(file, ["U1", "U2"])).codes).toEqual(["U2"]);
  });
});
