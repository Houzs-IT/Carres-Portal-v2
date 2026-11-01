import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { CreditNoteRow } from "@carres/shared/schemas/finance-credit-note";
import type { CreditNotePrintData } from "@carres/shared/schemas/finance-credit-note";
import ListPageShell from "@/components/ListPageShell";
import Button from "@/components/kit/Button";
import Input from "@/components/kit/Input";
import Modal from "@/components/kit/Modal";
import { DataGrid, type DataGridColumn } from "@/components/register/DataGrid";
import { apiFetch } from "@/lib/api";
import { rm } from "@/lib/format-currency";
import { renderCreditNotePdf } from "@/lib/pdf/render";
import { LoadFailed } from "./other-money-in/parts";

/**
 * Finance · Credit Notes (migration 0730).
 *
 * A credit note is issued against ONE Sales Invoice, posts its own journal
 * (Dr the income the invoice credited / Cr receivables) and comes off what the
 * order still owes. Carres does not refund, so there is no payout here
 * (payment/MASTER.md §13): the old Refunds & Credit Notes history stays
 * read-only and this page is the only door that makes a credit note.
 */
export const CREDIT_NOTES_KEY = ["finance", "credit-notes"] as const;

export default function FinanceCreditNotes() {
  useEffect(() => { document.title = "Customer Credit Notes · Carres"; return () => { document.title = "Carres Portal"; }; }, []);
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: CREDIT_NOTES_KEY,
    queryFn: () => apiFetch<CreditNoteRow[]>("/api/finance/credit-notes"),
    staleTime: 30_000,
  });
  const [issuing, setIssuing] = useState(false);
  const [voiding, setVoiding] = useState<CreditNoteRow | null>(null);
  const [selectedKeys, setSelectedKeys] = useState(new Set<string>());

  const open = async (row: CreditNoteRow) => {
    try {
      const data = await apiFetch<CreditNotePrintData>(`/api/finance/credit-notes/${row.id}/print-data`);
      window.open(URL.createObjectURL(await renderCreditNotePdf(data)), "_blank", "noopener");
    } catch (e) {
      toast.error(`The credit note could not be opened: ${(e as Error).message}`);
    }
  };

  const rows = list.data ?? [];
  const printMany = async (picked: CreditNoteRow[]) => {
    for (const r of picked) await open(r);
  };
  const statusOf = (r: CreditNoteRow) => (r.status === "voided" ? "Voided" : "Issued");
  const soOf = (r: CreditNoteRow) => (r.so != null ? `SO-${r.so}` : "");
  // The Houzs columns (CreditNotes.tsx:345-359); Journal is not on this row.
  const columns: DataGridColumn<CreditNoteRow>[] = [
    { key: "no", label: "Number", width: 160, accessor: (r) => <span className="font-mono font-semibold">{r.credit_note_no}</span>,
      searchValue: (r) => r.credit_note_no, exportValue: (r) => r.credit_note_no },
    { key: "date", label: "Date", width: 120, accessor: (r) => r.note_date, dateValue: (r) => r.note_date, filterType: "date", exportValue: (r) => r.note_date },
    { key: "party", label: "Party", width: 220, wrap: true, accessor: (r) => r.customer_name ?? "", searchValue: (r) => r.customer_name ?? "" },
    { key: "ref", label: "Reference", width: 160, accessor: (r) => r.invoice_no ?? "", searchValue: (r) => r.invoice_no ?? "" },
    { key: "so", label: "SO", width: 110, accessor: soOf, searchValue: soOf },
    { key: "reason", label: "Reason", width: 240, wrap: true, accessor: (r) => r.reason, searchValue: (r) => r.reason },
    { key: "total", label: "Total", width: 130, align: "right", accessor: (r) => <span className="font-mono font-semibold">{rm(r.amount)}</span>,
      numberValue: (r) => r.amount, filterType: "number", exportValue: (r) => r.amount },
    { key: "status", label: "Status", width: 110, accessor: statusOf, filterValue: statusOf, filterType: "enum", exportValue: statusOf },
    { key: "voidReason", label: "Void reason", width: 220, wrap: true, defaultHidden: true, accessor: (r) => r.void_reason ?? "" },
    { key: "actions", label: "", width: 150, accessor: (r) => <span className="whitespace-nowrap">
        <Button size="sm" onClick={() => open(r)}>Open</Button>{" "}
        {r.status === "issued" ? <Button size="sm" onClick={() => setVoiding(r)}>Void</Button> : null}
      </span>, exportValue: () => "" },
  ];
  return (
    <ListPageShell
      register
      title="Customer Credit Notes"
      actions={<Button variant="primary" onClick={() => setIssuing(true)}>Issue credit note</Button>}
    >
      {list.isError && !list.data
        ? <LoadFailed what="The credit notes" onRetry={() => void list.refetch()} />
        : <DataGrid rows={rows} columns={columns} rowKey={(r) => r.id}
            storageKey="carres.finance.customer-credit-notes.v1" appearance="reference" exportName="Customer Credit Notes"
            groupBanner={false} stickyIdentity isLoading={list.isLoading} searchPlaceholder="Search credit notes…"
            emptyMessage="No credit notes yet."
            selectable={{ selectedKeys, onToggle: (key) => setSelectedKeys((before) => {
              const next = new Set(before); if (next.has(key)) next.delete(key); else next.add(key); return next;
            }), onToggleAll: (keys, all) => setSelectedKeys((before) => {
              const next = new Set(before); keys.forEach((key) => { if (all) next.delete(key); else next.add(key); }); return next;
            }) }}
            selectionActions={[{
              kind: "output",
              label: (n) => `Print ${n} ${n === 1 ? "credit note" : "credit notes"}`,
              onClick: (picked) => void printMany(picked as unknown as CreditNoteRow[]),
            }]}
            statusSummary={(visible) => <span data-testid="credit-notes-summary">{visible.length} {visible.length === 1 ? "credit note" : "credit notes"}</span>} />}

      <IssueModal
        open={issuing}
        onClose={() => setIssuing(false)}
        onDone={() => { setIssuing(false); qc.invalidateQueries({ queryKey: CREDIT_NOTES_KEY }); }}
      />
      <VoidModal
        row={voiding}
        onClose={() => setVoiding(null)}
        onDone={() => { setVoiding(null); qc.invalidateQueries({ queryKey: CREDIT_NOTES_KEY }); }}
      />
    </ListPageShell>
  );
}

function IssueModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [invoiceNo, setInvoiceNo] = useState("");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const issue = useMutation({
    mutationFn: () =>
      apiFetch<{ credit_note_no: string }>("/api/finance/credit-notes", {
        method: "POST",
        body: JSON.stringify({ invoiceNo: invoiceNo.trim(), amount: Number(amount), reason: reason.trim() }),
      }),
    onSuccess: (note) => {
      toast.success(`${note.credit_note_no} issued`);
      setInvoiceNo(""); setAmount(""); setReason("");
      onDone();
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const ready = invoiceNo.trim() !== "" && Number(amount) > 0 && reason.trim() !== "";
  return (
    <Modal
      open={open}
      onOpenChange={(o) => { if (!o) onClose(); }}
      title="Issue credit note"
      description="It comes off what the customer owes on this invoice."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!ready} loading={issue.isPending} onClick={() => issue.mutate()}>
            Issue credit note
          </Button>
        </>
      }
    >
      <div className="grid gap-3">
        <Input id="cn-invoice" label="Invoice" required value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} />
        <Input id="cn-amount" label="Amount (RM)" required type="number" inputMode="decimal" min={0} step="0.01"
          value={amount} onChange={(e) => setAmount(e.target.value)} />
        <Input id="cn-reason" label="Reason" required value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
    </Modal>
  );
}

function VoidModal({ row, onClose, onDone }: { row: CreditNoteRow | null; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const void_ = useMutation({
    mutationFn: () =>
      apiFetch(`/api/finance/credit-notes/${row!.id}/void`, { method: "POST", body: JSON.stringify({ reason: reason.trim() }) }),
    onSuccess: () => { toast.success(`${row!.credit_note_no} voided`); setReason(""); onDone(); },
    onError: (e) => toast.error((e as Error).message),
  });
  return (
    <Modal
      open={row !== null}
      onOpenChange={(o) => { if (!o) onClose(); }}
      title={row ? `Void ${row.credit_note_no}` : "Void credit note"}
      description="The customer owes the amount again."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={reason.trim() === ""} loading={void_.isPending} onClick={() => void_.mutate()}>
            Void credit note
          </Button>
        </>
      }
    >
      <Input id="cn-void-reason" label="Reason" required value={reason} onChange={(e) => setReason(e.target.value)} />
    </Modal>
  );
}
