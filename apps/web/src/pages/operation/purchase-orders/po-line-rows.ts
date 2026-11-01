import { poLineSupplierAnswersOf, type PoDatePromise } from "@carres/shared";

type PoLine = { id: string; qty: number; received_qty: number; cancelled_qty?: number; pending_qty?: number };

/** One row per PO line, for the `Lines` display. Houzs lists POs by line
 *  (frontend/src/pages/scm-v2/po-list-line-columns.tsx). */
export type PoLineRow<R, L> = { key: string; row: R; line: L; pendingQty: number; supplierDates: string[] };

export function poLineRowsOf<L extends PoLine, R extends {
  id: string;
  po: { purchase_order_lines?: L[]; promises?: readonly PoDatePromise[] };
  facts: { version: number };
}>(rows: readonly R[]): Array<PoLineRow<R, L>> {
  return rows.flatMap((row) => {
    const lines = row.po.purchase_order_lines ?? [];
    const answers = poLineSupplierAnswersOf(row.po.promises, row.facts.version, lines.map((line) => line.id));
    return lines.map((line, index) => ({
      key: line.id ?? `${row.id}#${index}`,
      row,
      line,
      pendingQty: line.pending_qty ?? Math.max(0, Number(line.qty) - Number(line.received_qty) - Number(line.cancelled_qty ?? 0)),
      supplierDates: [...new Set((answers.get(line.id)?.batches ?? []).map((batch) => batch.date))],
    }));
  });
}
