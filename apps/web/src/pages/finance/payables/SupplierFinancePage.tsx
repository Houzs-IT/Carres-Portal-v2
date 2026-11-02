import { useMemo, useState } from "react";
import { supplierPayTo, type SupplierFinanceRow } from "@carres/shared/schemas/finance-ap";
import Button from "@/components/kit/Button";
import Tabs from "@/components/kit/Tabs";
import ListPageShell from "@/components/ListPageShell";
import { DataGrid, type DataGridColumn } from "@/components/register/DataGrid";
import ModuleHeader from "@/pages/operation/components/ModuleHeader";
import { appDateIsoOf, fmtDate } from "@/lib/fmt-date";
import { useApOutstanding, useSupplierFinance } from "@/lib/payables-queries";
import { creditorKindWord } from "./payables-words";
import { ReadFailed } from "./PayablesParts";
import SupplierFinanceModal from "./SupplierFinanceModal";
import { amountCell, FINANCE_WIDTH } from "../finance-widths";
import { useFinancePersonalLayouts } from "../finance-layouts";

/**
 * Finance → Payables → Suppliers, at `/finance/suppliers` (migration 0636;
 * Chew 2026-10-03, docs/finance/MASTER.md §3.2).
 *
 * Finance's own tax and bank details for every supplier and other creditor,
 * and (0691) its AutoCount-style code, first, like 400-A001.
 * The supplier itself stays Purchasing's record: its name and kind are read
 * here, never changed. Who last changed the bank details, and when, is on the
 * row, because a changed account number is where a payment can go wrong.
 *
 * FINANCE LOOK (Chew 2026-10-13): the supplier and the account holder wrap
 * rather than being cut. Owed, Advance and Open bills are read from the same
 * outstanding list as AP (Houzs Supplier Maintenance, Weisiang 1 Nov 2026).
 */
const CHIPS = [
  { value: "all", label: "All" }, { value: "trade", label: "Trade" },
  { value: "other", label: "Other" }, { value: "missing", label: "Missing TIN" },
] as const;
type Chip = (typeof CHIPS)[number]["value"];
const inChip = (r: SupplierFinanceRow, chip: Chip) =>
  chip === "all" || (chip === "missing" ? !r.tax_no : (r.kind === "other_creditor") === (chip === "other"));

export default function SupplierFinancePage() {
  const personalLayouts = useFinancePersonalLayouts("finance_supplier_finance");
  const query = useSupplierFinance();
  const [editing, setEditing] = useState<SupplierFinanceRow | null>(null);
  const outstanding = useApOutstanding();
  const [chip, setChip] = useState<Chip>("all");
  const rows = useMemo(() => (query.data ?? []).filter((r) => inChip(r, chip)), [query.data, chip]);
  const owedOf = useMemo(() => new Map((outstanding.data ?? []).map((o) => [o.supplier_id, o])), [outstanding.data]);
  // Where the money goes first, so it is whole on a 1440px screen with the
  // menu open; the tax facts after it. A detail nobody keyed is an empty cell
  // (UI MASTER §6.0: no glyph, no absence word for an optional fact).
  const columns = useMemo<DataGridColumn<SupplierFinanceRow>[]>(() => [
    // 0691 (Chew 2026-10-12): Finance's AutoCount-style code, first, as AutoCount lists creditors.
    { key: "code", label: "Code", width: FINANCE_WIDTH.code, accessor: (r) => r.code ?? "", searchValue: (r) => r.code ?? "" },
    { key: "supplier", label: "Supplier", width: FINANCE_WIDTH.party, wrap: true, accessor: (r) => r.name,
      searchValue: (r) =>
        [r.name, r.tax_no, r.registration_no, r.bank_name, r.bank_account_no, r.bank_account_holder].filter(Boolean).join(" ") },
    { key: "bank", label: "Bank", width: 130, accessor: (r) => r.bank_name ?? "",
      filterValue: (r) => r.bank_name ?? "", filterType: "enum" },
    { key: "account", label: "Account No", width: 140, accessor: (r) => r.bank_account_no ?? "" },
    { key: "holder", label: "Account holder", width: 200, wrap: true, accessor: (r) => r.bank_account_holder ?? "" },
    { key: "changed", label: "Last changed", width: 200, defaultHidden: true,
      accessor: (r) => (r.updated_at
        ? [fmtDate(r.updated_at, { time: true }), r.updated_by_name].filter(Boolean).join(" · ")
        : ""),
      dateValue: (r) => (r.updated_at ? appDateIsoOf(r.updated_at) : null), filterType: "date" },
    { key: "tax", label: "Tax No", width: 130, defaultHidden: true, accessor: (r) => r.tax_no ?? "" },
    { key: "registration", label: "Registration No", width: 140, defaultHidden: true, accessor: (r) => r.registration_no ?? "" },
    { key: "kind", label: "Creditor Type", width: 130, accessor: (r) => creditorKindWord(r.kind),
      filterValue: (r) => creditorKindWord(r.kind), filterType: "enum" },
    { key: "owed", label: "Owed", width: FINANCE_WIDTH.amount, align: "right",
      accessor: (r) => { const o = owedOf.get(r.supplier_id); return o ? amountCell(o.net_owing) : ""; },
      numberValue: (r) => { const o = owedOf.get(r.supplier_id); return o ? Number(o.net_owing) : null; },
      exportValue: (r) => { const o = owedOf.get(r.supplier_id); return o ? Number(o.net_owing) : ""; } },
    { key: "advance", label: "Advance", width: FINANCE_WIDTH.amount, align: "right",
      accessor: (r) => { const o = owedOf.get(r.supplier_id); return o ? amountCell(o.advance_open) : ""; },
      numberValue: (r) => { const o = owedOf.get(r.supplier_id); return o ? Number(o.advance_open) : null; },
      exportValue: (r) => { const o = owedOf.get(r.supplier_id); return o ? Number(o.advance_open) : ""; } },
    { key: "bills", label: "Open bills", width: 100, align: "right",
      accessor: (r) => String(owedOf.get(r.supplier_id)?.open_bills ?? ""),
      numberValue: (r) => owedOf.get(r.supplier_id)?.open_bills ?? null },
  ], [owedOf]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ModuleHeader destinationHeader testId="supplier-finance-destination-header" word="Suppliers"
        docTitle="Suppliers · Carres" />
      {query.isError ? <ReadFailed what="Supplier details" onRetry={() => void query.refetch()} /> : <>
        <div className="shrink-0 px-4 pt-2">
          <Tabs label="Supplier view" value={chip} onValueChange={(v) => setChip(v as Chip)} tabs={CHIPS} />
        </div>
        <ListPageShell register>
          <DataGrid
            rows={rows}
            columns={columns}
            rowKey={(r) => r.supplier_id}
            rowTestId={(r) => `supplier-finance-row-${r.supplier_id}`}
            storageKey="carres.finance.supplier-finance.v3"
            appearance="reference"
            look="finance" personalLayouts={personalLayouts} fillColumn="supplier"
            exportName="Suppliers"
            groupBanner={false}
            stickyIdentity
            isLoading={!query.isSuccess}
            searchPlaceholder="Search suppliers…"
            emptyMessage="No supplier yet. Purchasing adds suppliers; an other creditor is added from a bill."
            expandTitle="Inspect supplier"
            onRowDoubleClick={(r) => setEditing(r)}
            expandable={{
              renderExpansion: (r) => (
                <div className="p-4 text-body flex flex-col items-start gap-1">
                  <p>{r.code ? `${r.code} · ` : ""}{r.name} · {creditorKindWord(r.kind)}</p>
                  <p>
                    {supplierPayTo(r)
                      ? `Pay to ${supplierPayTo(r)}`
                      : "No bank account on file. A payment to this supplier names no account."}
                  </p>
                  <div className="mt-2">
                    <Button variant="neutral" onClick={() => setEditing(r)}>
                      Edit details
                    </Button>
                  </div>
                </div>
              ),
            }}
            statusSummary={(visible) => {
              const withBank = visible.filter((r) => r.bank_account_no).length;
              return (
                <span data-testid="supplier-finance-summary">
                  {visible.length} {visible.length === 1 ? "supplier" : "suppliers"} · {withBank} with a bank account
                </span>
              );
            }}
          />
        </ListPageShell>
      </>}
      {editing && <SupplierFinanceModal key={editing.supplier_id} supplier={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
