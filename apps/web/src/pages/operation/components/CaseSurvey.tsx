import { useState } from "react";
import { apiFetch } from "@/lib/api";
import Button from "@/components/kit/Button";

/** 0765 — Houzs ServiceCases.tsx:5265-5285 and :7775-7840: the rating on a closed case, or a
 *  survey link staff copy and share by hand. */
export default function CaseSurvey({ caseId, rating, notes }: { caseId: string; rating: number | null; notes: string | null }) {
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch<{ token: string }>(`/api/ops/service-cases/${caseId}/survey-token`, { method: "POST" });
      const url = `${window.location.origin}/survey/${res.token}`;
      setLink(url);
      try { await navigator.clipboard.writeText(url); setCopied(true); } catch { setCopied(false); }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      {rating ? (
        <>
          <p className="text-body font-semibold text-base-900" aria-label={`${rating} of 5`}>{"★".repeat(rating)}{"☆".repeat(5 - rating)} {rating}/5</p>
          {notes && <p className="text-meta text-base-700">{notes}</p>}
        </>
      ) : (
        <p className="text-meta text-base-500">No rating yet. Send the customer a survey link:</p>
      )}
      {link ? (
        <div className="space-y-1">
          <p className="text-meta text-base-500 uppercase tracking-wider">Share this link with the customer</p>
          <input readOnly aria-label="Survey link" value={link} onFocus={(e) => e.currentTarget.select()}
            className="w-full rounded border border-base-200 px-2 py-1 font-mono text-meta" />
          <p className="text-meta text-base-500">{copied ? "Survey link copied." : "Copy the link from the box above."}</p>
        </div>
      ) : (
        <Button variant="neutral" size="sm" onClick={() => void generate()} loading={busy}>{busy ? "Generating…" : "Generate Survey Link"}</Button>
      )}
      {error && <p role="alert" className="text-meta text-error-700">{error}</p>}
    </div>
  );
}
