// Carres: the FOUR address lines a document carries into the next one, in one place.
//
// WHY. Sales Orders, customers, DP orders and consignment orders store address1..4; until migration 2011
// the Delivery Order, Sales Invoice, Delivery Return and the consignment Delivery Order / Return stored only
// two. Each converter folded lines 3 and 4 into line 2 ONLY when line 2 was empty, so an order using lines
// 2, 3 and 4 silently lost 3 and 4 on every document made from it (owner bug, 14 Nov 2026).
//
// Every conversion (SO -> DO, DO -> SI, SO -> SI, DO -> DR, consignment order -> consignment DO,
// consignment DO -> consignment return) now copies the four lines one to one through this helper, so the
// lines cannot be dropped by one converter and kept by another. A row from before 2011 reads null for 3
// and 4, which copies as null: an old two-line document converts exactly as before.

export type AddressLines = {
  address1: string | null;
  address2: string | null;
  address3: string | null;
  address4: string | null;
};

function line(v: unknown): string | null {
  return v == null ? null : String(v);
}

/** The four address lines of a source row (DB column names), copied verbatim; absent lines are null. */
export function addressLinesOf(row: Record<string, unknown> | null | undefined): AddressLines {
  return {
    address1: line(row?.address1),
    address2: line(row?.address2),
    address3: line(row?.address3),
    address4: line(row?.address4),
  };
}

/** The four address lines from a create/edit request body (camel and DB names are the same keys). */
export function addressLinesFromBody(body: Record<string, unknown>): AddressLines {
  return {
    address1: (body.address1 as string) ?? null,
    address2: (body.address2 as string) ?? null,
    address3: (body.address3 as string) ?? null,
    address4: (body.address4 as string) ?? null,
  };
}

/** The non-empty lines, in order — for one-line summaries and printouts. */
export function nonEmptyAddressLines(row: Record<string, unknown> | null | undefined): string[] {
  const l = addressLinesOf(row);
  return [l.address1, l.address2, l.address3, l.address4]
    .map((s) => (s == null ? '' : s.trim()))
    .filter((s) => s !== '');
}
