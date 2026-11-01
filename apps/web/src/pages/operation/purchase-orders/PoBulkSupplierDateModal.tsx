// design-standard: not-a-list-page — a modal; its table lists the POs being answered.
import { useState } from "react";
import { PO_DELAY_REASONS } from "@carres/shared";
import KitModal from "@/components/kit/Modal";
import KitButton from "@/components/kit/Button";
import { signSupplierAnswerUpload, SUPPLIER_ANSWER_MAX_BYTES, SUPPLIER_ANSWER_MIMES } from "@/components/SupplierAnswerEvidenceUploadField";
import { apiFetch } from "@/lib/api";
import { fmtDate } from "@/lib/fmt-date";
import { supabase } from "@/lib/supabase";
import { applyBulkSupplierDate, dateIsLater, type BulkDateForm, type BulkDateResult, type BulkDateTarget } from "./po-bulk-supplier-date";

const control = "h-8 rounded-control border border-kit-slate-5 bg-white px-2 text-meta";
const labelled = "flex flex-col gap-1 text-meta text-kit-slate-11";

/**
 * Set one supplier date on the ticked POs (Houzs
 * components/scm-v2/PoBulkSupplierDateModal.tsx). Carres has no bulk door: each
 * PO goes through its own `/tomorrow-delivery`, the same route and role gate as
 * `Record supplier answer`, and that door needs evidence and who answered.
 */
export default function PoBulkSupplierDateModal({ targets, onClose, onChanged }: {
  targets: BulkDateTarget[];
  /** The POs saved, so the page can untick them and leave the failed ones ticked. */
  onClose: (saved: string[]) => void;
  onChanged: () => void;
}) {
  const [form, setForm] = useState<BulkDateForm>({
    date: "", reason: "", remarks: "", channel: "whatsapp", recipient: "", reportedBy: "",
    reportedAt: new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16),
  });
  const [file, setFile] = useState<File | null>(null);
  const [fileProblem, setFileProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<BulkDateResult[] | null>(null);
  const set = (patch: Partial<BulkDateForm>) => setForm((previous) => ({ ...previous, ...patch }));

  const open = targets.filter((target) => !target.blocked);
  const needsReason = open.some((target) => dateIsLater(form.date, target.officialDate));
  const gap = !form.date ? "record the supplier delivery date"
    : needsReason && !form.reason ? "choose why the supplier moved the date"
    : needsReason && form.reason === "Other" && !form.remarks.trim() ? "write why the supplier moved the date"
    : !file ? "add a WhatsApp screenshot"
    : !form.recipient.trim() || !form.reportedBy.trim() ? "name who answered"
    : !form.reportedAt ? "record when the supplier answered"
    : open.length === 0 ? "no PO here can take a date"
    : null;

  async function apply() {
    if (gap || !file) return;
    setBusy(true);
    const done = await applyBulkSupplierDate(targets, form, {
      upload: async (target) => {
        const slot = await signSupplierAnswerUpload(target.poId, target.version, file);
        const { error } = await supabase.storage.from("delivery-orders").uploadToSignedUrl(slot.path, slot.token, file);
        if (error) throw error;
        return slot.path;
      },
      save: (poId, body) => apiFetch(`/api/operation/pos/${encodeURIComponent(poId)}/tomorrow-delivery`, { method: "POST", body: JSON.stringify(body) }),
    });
    setResults(done);
    setBusy(false);
    if (done.some((result) => !result.problem)) onChanged();
  }

  const close = () => onClose((results ?? []).filter((result) => !result.problem).map((result) => result.poId));
  const failed = (results ?? []).filter((result) => result.problem).length;

  return (
    <KitModal open onOpenChange={(next) => { if (!next && !busy) close(); }} title="Set Supplier date" width="wide"
      footer={results ? <KitButton variant="primary" onClick={close}>Close</KitButton> : <>
        <KitButton disabled={busy} onClick={close}>Cancel</KitButton>
        <KitButton variant="primary" disabled={!!gap || busy} loading={busy} onClick={() => void apply()} data-testid="po-bulk-date-apply">
          {gap ? `Save: ${gap}` : `Apply to ${open.length} ${open.length === 1 ? "PO" : "POs"}`}
        </KitButton>
      </>}>
      <div className="flex flex-col gap-3 text-body" data-testid="po-bulk-date">
        {results ? (
          <p className="text-strong" data-testid="po-bulk-date-summary">{results.length - failed} saved · {failed} not saved</p>
        ) : (
          <>
            <p className="text-meta text-kit-slate-11">Applies to every line still to deliver. Each PO is saved on its own.</p>
            <div className="flex flex-wrap items-end gap-3">
              <label className={labelled}>Supplier date
                <input type="date" value={form.date} onChange={(e) => set({ date: e.target.value })} className={control} data-testid="po-bulk-date-input" />
              </label>
              {needsReason ? (
                <label className={labelled}>Reason
                  <select value={form.reason} onChange={(e) => set({ reason: e.target.value })} className={control} data-testid="po-bulk-date-reason">
                    <option value="">Choose a reason</option>
                    {PO_DELAY_REASONS.map((reason) => <option key={reason} value={reason}>{reason}</option>)}
                  </select>
                </label>
              ) : null}
              {needsReason && form.reason === "Other" ? (
                <label className={labelled}>Note
                  <input value={form.remarks} onChange={(e) => set({ remarks: e.target.value })} className={control} />
                </label>
              ) : null}
              <label className={labelled}>Channel
                <select value={form.channel} onChange={(e) => set({ channel: e.target.value as BulkDateForm["channel"] })} className={control}>
                  <option value="whatsapp">WhatsApp</option><option value="email">Email</option><option value="phone">Phone</option><option value="in_person">In person</option>
                </select>
              </label>
              <label className={labelled}>Recipient
                <input value={form.recipient} onChange={(e) => set({ recipient: e.target.value })} className={control} />
              </label>
              <label className={labelled}>Answered by
                <input value={form.reportedBy} onChange={(e) => set({ reportedBy: e.target.value })} className={control} />
              </label>
              <label className={labelled}>Answered by supplier on
                <input type="datetime-local" value={form.reportedAt} onChange={(e) => set({ reportedAt: e.target.value })} className={control} />
              </label>
              <label className={labelled}>Evidence
                <input type="file" accept={SUPPLIER_ANSWER_MIMES.join(",")} className="text-meta" data-testid="po-bulk-date-file" onChange={(e) => {
                  const picked = e.target.files?.[0] ?? null;
                  const bad = picked && (!SUPPLIER_ANSWER_MIMES.includes(picked.type) ? "This file type is not accepted." : picked.size > SUPPLIER_ANSWER_MAX_BYTES ? "This file is too large (max 10 MB)." : null);
                  setFileProblem(bad || null);
                  setFile(bad ? null : picked);
                }} />
              </label>
            </div>
            {fileProblem ? <p className="text-meta text-kit-red-11">{fileProblem}</p> : null}
          </>
        )}
        <div className="max-h-60 overflow-auto rounded-control border border-kit-slate-5">
          <table className="w-full text-left text-meta">
            <thead className="border-b border-kit-slate-5">
              <tr>{["PO No", "PO Delivery Date", results ? "Result" : "Can take a date"].map((head) => <th key={head} scope="col" className="px-2 py-1.5 font-medium text-kit-slate-11">{head}</th>)}</tr>
            </thead>
            <tbody>
              {targets.map((target) => {
                const result = results?.find((item) => item.poId === target.poId);
                const problem = results ? result?.problem : target.blocked;
                return (
                  <tr key={target.poId} className="border-t border-kit-slate-4" data-testid={`po-bulk-date-row-${target.poId}`}>
                    <td className="px-2 py-1.5 font-mono">{target.label}</td>
                    <td className="px-2 py-1.5 tabular-nums">{target.officialDate ? fmtDate(target.officialDate) : "Not recorded"}</td>
                    <td className={`px-2 py-1.5 ${problem ? "text-kit-red-11" : "text-kit-slate-11"}`}>{problem ?? (results ? "Saved" : "Yes")}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </KitModal>
  );
}
