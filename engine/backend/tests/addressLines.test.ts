import { describe, expect, test } from "vitest";
import { addressLinesFromBody, addressLinesOf, nonEmptyAddressLines } from "../src/scm/lib/address-lines";
import { DO_HEADER_LOCKED_FIELDS } from "../src/scm/shared/do-header-lock";

/* Carres (owner bug 14 Nov 2026, mig 2011): every conversion — SO -> DO, DO -> SI, DO -> DR and the
   consignment flows — copies the four address lines through addressLinesOf / addressLinesFromBody. When
   an order used lines 2, 3 AND 4 the old converters kept line 2 and silently dropped 3 and 4. */
describe("address-lines — the four lines a document carries into the next", () => {
  const so = { address1: "12 Jalan Bukit Bintang", address2: "Unit 8-3", address3: "Menara Suria", address4: "Taman Maju" };

  test("a source using all four lines keeps all four (SO -> DO, DO -> SI, DO -> DR)", () => {
    const onDo = addressLinesOf(so);
    expect(onDo).toEqual(so);
    // Chained: the invoice / return made from the DO still has every line.
    expect(addressLinesOf({ ...onDo, debtor_name: "X" })).toEqual(so);
  });

  test("a pre-2011 two-line row converts unchanged — lines 3 and 4 are null", () => {
    expect(addressLinesOf({ address1: "A", address2: "B" })).toEqual({ address1: "A", address2: "B", address3: null, address4: null });
    expect(addressLinesOf(null)).toEqual({ address1: null, address2: null, address3: null, address4: null });
  });

  test("a create/edit body (form-side conversion) carries all four lines", () => {
    expect(addressLinesFromBody({ ...so, city: "KL" })).toEqual(so);
    expect(addressLinesFromBody({ address1: "A" })).toEqual({ address1: "A", address2: null, address3: null, address4: null });
  });

  test("non-empty lines, in order, for one-line summaries", () => {
    expect(nonEmptyAddressLines({ address1: "A", address2: " ", address3: null, address4: "D" })).toEqual(["A", "D"]);
  });

  test("lines 3 and 4 lock with the rest of the DO address once an invoice exists", () => {
    const cols = DO_HEADER_LOCKED_FIELDS.map((f) => f.col);
    expect(cols).toEqual(expect.arrayContaining(["address1", "address2", "address3", "address4"]));
  });
});
