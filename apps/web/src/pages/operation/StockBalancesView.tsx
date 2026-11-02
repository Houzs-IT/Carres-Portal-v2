// design-standard: not-a-list-page: a view inside WarehouseStockRegister, which owns the page shell.
import { useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { StockRegisterUnit } from "@carres/shared";
import Drawer from "@/components/kit/Drawer";
import { DataGrid, type DataGridColumn } from "@/components/register/DataGrid";
import { fmtDate } from "@/lib/fmt-date";
import { DetailSection, KpiRow } from "./houzs-list-bits";
import { ageWord, stockBalances, type BalanceQty, type StockBalance } from "./stock-balances";

const W = {
  code: "Product Code",
  description: "Description",
  category: "Category",
  stock: "Stock",
  consignment: "Consignment",
  incoming: "Incoming",
  reserved: "Reserved",
  available: "Available",
  cannotSell: "Cannot sell",
  age: "Age",
  site: "Stock Location",
  own: "Own Stock Qty",
  ownHint: "Carres Owned goods held",
  consignmentQty: "Consignment Qty",
  consignmentHint: "Supplier goods held, not ours",
  incomingHint: "On a PO, not received",
  codes: "Product Codes",
  codesHint: "Listed below",
  perWarehouse: "Per-Warehouse Balance",
  eta: "ETA",
  noEta: "no ETA",
  empty: "No product matches these filters.",
  search: "Product code or description…",
};

const QTY_COLUMNS: { key: keyof BalanceQty; label: string }[] = [
  { key: "stock", label: W.stock },
  { key: "consignment", label: W.consignment },
  { key: "incoming", label: W.incoming },
  { key: "reserved", label: W.reserved },
  { key: "available", label: W.available },
  { key: "cannotSell", label: W.cannotSell },
];

const qtyWord = (key: keyof BalanceQty, n: number) => (key === "incoming" && n > 0 ? `+${n}` : String(n));

/** Inventory's per-product view, the Houzs Balances tab: one row per product. Row opens the Sites; chevron opens the POs and SOs. */
export default function StockBalancesView({ units, categoryLabel, isLoading, toolbar }: {
  units: StockRegisterUnit[];
  categoryLabel: (category: string | null) => string;
  isLoading: boolean;
  toolbar: ReactNode;
}) {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [openSku, setOpenSku] = useState<string | null>(null);
  const now = useMemo(() => new Date(), []);
  const all = useMemo(() => stockBalances(units), [units]);
  const q = search.trim().toLowerCase();
  const rows = useMemo(
    () => (q ? all.filter((r) => `${r.sku} ${r.description}`.toLowerCase().includes(q)) : all),
    [all, q],
  );
  const open = openSku ? all.find((r) => r.sku === openSku) ?? null : null;
  const total = (key: keyof BalanceQty) => rows.reduce((sum, r) => sum + r[key], 0);

  const columns: DataGridColumn<StockBalance>[] = [
    {
      key: "sku", label: W.code, width: 170, sortable: true,
      searchValue: (r) => r.sku, exportValue: (r) => r.sku,
      accessor: (r) => (
        <Link className="font-mono text-kit-blue-11 hover:underline" to={`/operation?tab=warehouses&sku=${encodeURIComponent(r.sku)}`} onClick={(e) => e.stopPropagation()}>
          {r.sku}
        </Link>
      ),
    },
    { key: "description", label: W.description, width: 240, sortable: true, overflowText: (r) => r.description, searchValue: (r) => r.description, exportValue: (r) => r.description, accessor: (r) => r.description },
    { key: "category", label: W.category, width: 120, sortable: true, filterType: "enum", filterValue: (r) => categoryLabel(r.category), exportValue: (r) => categoryLabel(r.category), accessor: (r) => categoryLabel(r.category) },
    ...QTY_COLUMNS.map(({ key, label }): DataGridColumn<StockBalance> => ({
      key, label, width: 104, align: "right", sortable: true,
      numberValue: (r) => r[key], exportValue: (r) => r[key], accessor: (r) => qtyWord(key, r[key]),
    })),
    {
      key: "age", label: W.age, width: 80, sortable: true,
      // Oldest first when ascending; a product with no known date sorts last.
      exportValue: (r) => ageWord(r.oldestReceived, now),
      numberValue: (r) => (r.oldestReceived ? new Date(r.oldestReceived).getTime() : Number.MAX_SAFE_INTEGER),
      accessor: (r) => ageWord(r.oldestReceived, now),
    },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="stock-balances">
      {isLoading ? null : (
        <KpiRow items={[
          { label: W.own, value: total("stock"), hint: W.ownHint },
          { label: W.consignmentQty, value: total("consignment"), hint: W.consignmentHint },
          { label: W.incoming, value: total("incoming"), hint: W.incomingHint },
          { label: W.codes, value: rows.length, hint: W.codesHint },
        ]} />
      )}
      <div className="flex min-h-0 flex-1 flex-col pt-2">
        <DataGrid<StockBalance>
          appearance="reference"
          rows={rows}
          columns={columns}
          storageKey="carres.warehouse.inventory.balances.v1"
          rowKey={(r) => r.sku}
          exportName="Inventory balances"
          toolbarStart={toolbar}
          searchPlaceholder={W.search}
          isLoading={isLoading}
          onSearchChange={setSearch}
          rowHeight={40}
          groupBanner={false}
          emptyMessage={W.empty}
          onRowClick={(r) => setOpenSku(r.sku)}
          expandable={{
            canExpand: (r) => r.incomingPos.length + r.reservedSos.length > 0,
            testId: (r) => `balance-expand-${r.sku}`,
            renderExpansion: (r) => (
              <ul className="flex flex-col gap-1 py-2 text-body" data-testid={`balance-documents-${r.sku}`}>
                {r.incomingPos.map((p) => (
                  <li key={p.poNo}>
                    {W.incoming} · <button type="button" className="font-mono text-kit-blue-11 hover:underline" onClick={() => navigate(`/operation/procurement?po=${encodeURIComponent(p.poNo)}`)}>{p.poNo}</button>
                    {" "}· {W.eta} {p.expectedArrival ? fmtDate(p.expectedArrival) : W.noEta} · +{p.qty}
                  </li>
                ))}
                {r.reservedSos.map((s) => (
                  <li key={s.ref}>
                    {W.reserved} · {s.orderId
                      ? <button type="button" className="font-mono text-kit-blue-11 hover:underline" onClick={() => navigate(`/operation/orders/${encodeURIComponent(s.orderId!)}`)}>{s.ref}</button>
                      : <span className="font-mono">{s.ref}</span>}
                    {" "}· {s.qty}
                  </li>
                ))}
              </ul>
            ),
          }}
          statusSummary={(visible) => <span className="block truncate">{visible.length} of {all.length} products</span>}
        />
      </div>
      <Drawer open={!!open} onOpenChange={(next) => { if (!next) setOpenSku(null); }} title={open?.description ?? ""} description={open?.sku}>
        {open ? (
          <DetailSection title={W.perWarehouse}>
            <div className="overflow-x-auto">
              <table className="w-full text-body" data-testid="balance-sites">
                <thead>
                  <tr className="text-c-muted">
                    <th className="py-1 pr-3 text-left font-medium">{W.site}</th>
                    {QTY_COLUMNS.map((c) => <th key={c.key} className="py-1 pl-3 text-right font-medium">{c.label}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {open.sites.map((s) => (
                    <tr key={s.siteName} className="border-t border-c-line">
                      <td className="py-1 pr-3">{s.siteName}</td>
                      {QTY_COLUMNS.map((c) => <td key={c.key} className="py-1 pl-3 text-right">{qtyWord(c.key, s[c.key])}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </DetailSection>
        ) : null}
      </Drawer>
    </div>
  );
}
