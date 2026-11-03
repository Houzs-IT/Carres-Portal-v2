import { useState } from "react";
import { caseArrangementMessage, CASE_LEG_CUSTOMER_LABEL } from "@carres/shared";
import { fmtDate } from "@/lib/fmt-date";
import Button from "@/components/kit/Button";
import { CARD_WORDS, draftLink } from "@/components/kit/CompactModuleCard";

/** Houzs assr-arrangement-message.ts: the Service Arrangement WhatsApp for one leg. Houzs sends it
 *  through its gateway; Carres has none, so staff copy it or open WhatsApp. Neither counts as sent. */
export default function CaseArrangementMessage({ c, leg, date }: {
  c: { caseNo: string; customerName: string; customerPhone?: string | null };
  leg: keyof typeof CASE_LEG_CUSTOMER_LABEL;
  date: string | null | undefined;
}) {
  const [status, setStatus] = useState<string | null>(null);
  const message = caseArrangementMessage(c, leg, date, (iso) => fmtDate(iso));
  if (!message) return null;
  const href = draftLink("whatsapp", c.customerPhone ?? "", message);
  const copy = async () => {
    try { await navigator.clipboard.writeText(message); setStatus(CARD_WORDS.copied); } catch { setStatus(CARD_WORDS.copyFallback); }
  };
  return (
    <div className="grid gap-1" data-testid={`case-arrangement-${leg}`}>
      <p className="whitespace-pre-wrap rounded border border-base-200 p-2 text-meta">{message}</p>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="neutral" size="sm" onClick={() => void copy()}>{CARD_WORDS.copyMessage}</Button>
        {href && <a className="text-body text-kit-blue-11" href={href} target="_blank" rel="noreferrer">{CARD_WORDS.openWhatsApp}</a>}
      </div>
      <p className="text-meta text-base-600" role="status">{status ?? "Copying or opening WhatsApp confirms nothing. Record the answer when it comes."}</p>
    </div>
  );
}
