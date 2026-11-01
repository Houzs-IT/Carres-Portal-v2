/**
 * What a row opens first, as on Houzs: the order at a glance, read from the
 * list's own row, with doors to the full page, print and Copy as new. Nothing
 * here writes. Cards, the list's second face, open the same drawer.
 */
import { lineName } from "../sales-order-facts";
import { skuKey } from "../sales-order-register-readings";
import type { RegisterRow } from "../sales-order-columns";
import { CBtn, Drawer, KvRow } from "../so-detail/ui";
import { COLUMNS, isDelivered, rm, type CellContext } from "./outright-columns";

const ORDER_FACTS = ["agent", "salesLoc", "ref", "soDate", "processing", "reqDate", "payMethod"];
const CUSTOMER_FACTS = ["debtor", "phone", "email", "addr1", "addr2", "city", "postcode", "state", "buildingType"];
const MONEY_FACTS = ["soTotal", "paid", "balance"];

export function OrderQuickView({
  row,
  ctx,
  catalogNames,
  right,
  onClose,
  onOpenFull,
  onPrint,
  onCopy,
}: {
  row: RegisterRow | null;
  ctx: CellContext;
  catalogNames: Map<string, { name: string; variant: string }>;
  right: number;
  onClose: () => void;
  onOpenFull: (r: RegisterRow) => void;
  onPrint: (r: RegisterRow) => void;
  onCopy: (r: RegisterRow) => void;
}) {
  if (!row) return null;
  const facts = (keys: string[]) =>
    keys.map((k) => <KvRow key={k} label={COLUMNS[k]!.label} value={COLUMNS[k]!.cell(row, ctx).t} />);
  const heading = (words: string) => <h3 className="pb-1 pt-3.5 text-[13px] font-medium text-c-ink first:pt-0">{words}</h3>;
  const lines = (row.o.order_lines ?? []).filter((l) => Number(l.qty) > 0);
  return (
    <Drawer open title={`SO-${row.so}`} onClose={onClose} width={440} right={right} testId="outright-quick-view">
      <div className="flex flex-wrap gap-1.5 pb-3">
        <CBtn kind="normal" icon="open_in_full" onClick={() => onOpenFull(row)}>Open full page</CBtn>
        <CBtn kind="normal" icon="print" onClick={() => onPrint(row)}>Print SO</CBtn>
        <CBtn kind="normal" icon="content_copy" onClick={() => onCopy(row)}>Copy as new</CBtn>
      </div>
      <KvRow label="Delivery" value={isDelivered(row) ? "Delivered" : "Open"} />
      {heading("Order")}
      {facts(ORDER_FACTS)}
      {heading("Customer and delivery")}
      {facts(CUSTOMER_FACTS)}
      {heading(`Line Items (${lines.length})`)}
      {lines.length === 0 ? <p className="text-[13px] text-c-secondary">No items on this order</p> : null}
      {lines.map((l, i) => (
        <div key={l.id ?? `${l.sku}-${i}`} className="flex items-start justify-between gap-3 border-t border-c-row-line py-2 text-[13px]" data-testid="quick-view-line">
          <span className="flex min-w-0 flex-col">
            <span className="break-words text-c-ink">{catalogNames.get(skuKey(l.sku))?.name ?? lineName(l)}</span>
            <span className="break-words text-[12px] text-c-secondary">{l.sku} · Qty {Number(l.qty)}</span>
          </span>
          <span className="shrink-0 tabular-nums text-c-ink">{rm(Number(l.unit_price ?? 0) * Number(l.qty))}</span>
        </div>
      ))}
      {heading("Money")}
      {facts(MONEY_FACTS)}
    </Drawer>
  );
}

/** The list's second face (Houzs's Cards toggle). A card opens the quick view. */
export function OrderCards({ rows, onOpen }: { rows: RegisterRow[]; onOpen: (r: RegisterRow) => void }) {
  return (
    <div className="grid min-h-0 flex-1 auto-rows-min grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-2.5 overflow-y-auto p-2.5" data-testid="outright-cards">
      {rows.map((r) => (
        <button
          key={r.id}
          type="button"
          onClick={() => onOpen(r)}
          data-testid={`outright-card-${r.so}`}
          className="flex min-w-0 flex-col gap-1 rounded-[10px] border border-c-card-border bg-c-card px-3.5 py-3 text-left hover:bg-c-hover"
        >
          <span className="flex items-center justify-between gap-2">
            <span className="text-[13px] font-semibold text-c-ink">SO-{r.so}</span>
            <span className="text-[12px] text-c-secondary">{isDelivered(r) ? "Delivered" : "Open"}</span>
          </span>
          <span className="truncate text-[15px] font-medium text-c-ink">{r.customer || "Not recorded"}</span>
          <span className="truncate text-[12px] text-c-secondary">{COLUMNS.soDate!.cell(r, {} as CellContext).t} · {COLUMNS.salesLoc!.cell(r, {} as CellContext).t}</span>
          <span className="mt-1 flex items-end justify-between gap-2 border-t border-c-row-line pt-2">
            <span className="truncate text-[12px] text-c-secondary">{COLUMNS.ref!.cell(r, {} as CellContext).t}</span>
            <span className="shrink-0 text-[15px] font-medium tabular-nums text-c-ink">{COLUMNS.soTotal!.cell(r, {} as CellContext).t}</span>
          </span>
        </button>
      ))}
    </div>
  );
}
