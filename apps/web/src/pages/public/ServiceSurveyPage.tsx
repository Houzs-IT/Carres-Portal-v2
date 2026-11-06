import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { ApiError, apiFetch } from "@/lib/api";
import Button from "@/components/kit/Button";

type View = { alreadySubmitted: boolean; caseNo: string; customerName: string | null; rating: number | null; notes: string | null };

/** 0765 — Houzs frontend/src/pages/SurveyPublic.tsx: the customer rates a closed case, no login. */
export default function ServiceSurveyPage() {
  const { token = "" } = useParams();
  const base = `/public/service-survey/${encodeURIComponent(token)}`;
  const [view, setView] = useState<View | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "dead" | "failed">("loading");
  const [rating, setRating] = useState(0);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    document.title = "Service survey · Carres";
    apiFetch<View>(base)
      .then((v) => { setView(v); setState("ready"); })
      .catch((err) => setState(err instanceof ApiError && err.status === 404 ? "dead" : "failed"));
  }, [base]);

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      await apiFetch(base, { method: "POST", body: JSON.stringify({ rating, notes: notes.trim() || null }) });
      setDone(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (state === "loading") return <main className="min-h-screen bg-kit-canvas p-4 text-body text-kit-slate-11">Loading…</main>;
  if (state !== "ready" || !view) {
    return (
      <main className="min-h-screen bg-kit-canvas p-4">
        <p className="text-body text-kit-slate-12" role="alert">
          {state === "dead" ? "This survey link has expired or does not exist." : "We could not load this survey. Please try again."}
        </p>
      </main>
    );
  }
  const answered = done || view.alreadySubmitted;
  return (
    <main className="min-h-screen bg-kit-canvas px-4 py-4">
      <div className="mx-auto flex w-full max-w-[560px] flex-col gap-4 rounded-work border border-work-line bg-white px-4 py-4">
        <p className="text-label text-kit-slate-11">Service case {view.caseNo}</p>
        <h1 className="text-strong text-kit-slate-12">How was your experience{view.customerName ? `, ${view.customerName.split(" ")[0]}` : ""}?</h1>
        {answered ? (
          <p className="text-body text-kit-slate-12">Thank you. Your feedback has been received.</p>
        ) : (
          <>
            <div role="radiogroup" aria-label="Rating" className="flex gap-2">
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} type="button" role="radio" aria-checked={rating === n} aria-label={`${n} of 5`}
                  onClick={() => setRating(n)}
                  className={`h-11 w-11 rounded border text-strong ${n <= rating ? "border-amber-400 bg-amber-50 text-amber-700" : "border-work-line text-kit-slate-11"}`}>
                  {n}
                </button>
              ))}
            </div>
            <label className="flex flex-col gap-1 text-body text-kit-slate-12">
              Anything to add? (optional)
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} rows={4}
                className="rounded border border-work-line p-2 text-body" />
            </label>
            {error && <p role="alert" className="text-meta text-error-700">{error}</p>}
            <Button onClick={() => void submit()} loading={busy} disabled={rating === 0}>Submit feedback</Button>
          </>
        )}
      </div>
    </main>
  );
}
