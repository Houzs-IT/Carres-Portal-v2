import { useState } from "react";
import { fmtMoney } from "@carres/shared";
import { apiFetch } from "@/lib/api";
import Button from "@/components/kit/Button";

type Source = { docNo: string; qty: number; unitPrice: number } | null;
type Suggestion = { customerAmount: number | null; supplierCost: number | null; sources: { so: Source; po: Source }; reason?: string };

/** Houzs ServiceCases.tsx:7253-7440: Auto-fill looks up the case's SO and PO lines and
 *  offers the amounts; staff apply both, one, or dismiss. Nothing saves until they pick. */
export default function CaseCostSuggestion({ caseId, onApply }: { caseId: string; onApply: (patch: Record<string, unknown>) => Promise<void> }) {
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [fetching, setFetching] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lookUp = async () => {
    setFetching(true);
    setError(null);
    try {
      setSuggestion(await apiFetch<Suggestion>(`/api/ops/service-cases/${caseId}/cost-suggestion`));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setFetching(false);
    }
  };
  const apply = async (customer: boolean, supplier: boolean) => {
    if (!suggestion) return;
    const patch: Record<string, unknown> = {};
    if (customer && suggestion.customerAmount != null) patch.customerAmount = suggestion.customerAmount;
    if (supplier && suggestion.supplierCost != null) patch.supplierCostAmount = suggestion.supplierCost;
    setApplying(true);
    setError(null);
    try {
      await onApply(patch);
      setSuggestion(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setApplying(false);
    }
  };

  const line = (label: string, amount: number | null, src: Source, kind: string) => (
    <div className="flex flex-col gap-0.5">
      <span className="text-meta text-base-500 uppercase tracking-wider">{label}</span>
      <span className="font-mono tabular-nums text-base-900">{amount == null ? `No ${kind} line found` : fmtMoney(amount)}</span>
      {src && <span className="text-meta text-base-500">{src.docNo} · qty {src.qty} × {fmtMoney(src.unitPrice)}</span>}
    </div>
  );

  return (
    <div className="space-y-2">
      <Button variant="neutral" size="sm" onClick={() => void lookUp()} loading={fetching}>{fetching ? "Looking up…" : "Auto-fill"}</Button>
      {error && <p role="alert" className="text-meta text-error-700">{error}</p>}
      {suggestion && (
        <div className="space-y-2 rounded border border-base-200 bg-base-50 p-2">
          {suggestion.reason ? (
            <p className="text-meta text-base-700">{suggestion.reason}</p>
          ) : (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {line("Suggested Customer", suggestion.customerAmount, suggestion.sources.so, "Sales Order")}
              {line("Suggested Supplier", suggestion.supplierCost, suggestion.sources.po, "Purchase Order")}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {!suggestion.reason && (
              <>
                <Button size="sm" onClick={() => void apply(true, true)} loading={applying} disabled={suggestion.customerAmount == null && suggestion.supplierCost == null}>{applying ? "Applying…" : "Apply both"}</Button>
                <Button variant="neutral" size="sm" onClick={() => void apply(true, false)} disabled={applying || suggestion.customerAmount == null}>Customer only</Button>
                <Button variant="neutral" size="sm" onClick={() => void apply(false, true)} disabled={applying || suggestion.supplierCost == null}>Supplier only</Button>
              </>
            )}
            <Button variant="ghost" size="sm" onClick={() => setSuggestion(null)} disabled={applying}>Dismiss</Button>
          </div>
        </div>
      )}
    </div>
  );
}
