import { PO_DELAY_REASONS, recordSupplierAnswersInput, type RecordSupplierAnswersInput } from "@carres/shared";

type Channel = RecordSupplierAnswersInput["channel"];

export interface BulkDateTarget {
  poId: string;
  label: string;
  version: number;
  officialDate: string | null;
  /** Lines with goods still to deliver; a line all received is refused by the server. */
  openLineIds: string[];
  /** Why this PO cannot take an answer, the same test as `Record supplier answer`. */
  blocked: string | null;
}

export interface BulkDateForm {
  date: string;
  reason: string;
  remarks: string;
  channel: Channel;
  recipient: string;
  reportedBy: string;
  reportedAt: string;
}

export type BulkDateResult = { poId: string; label: string; problem: string | null };

/** The server asks a reason only for a date later than the PO Delivery Date. */
export const dateIsLater = (date: string, official: string | null) => !!date && !!official && date > official;

/** One PO's body for the per-PO door: `new_date` on each line still to deliver. */
export function bulkDateBody(target: BulkDateTarget, form: BulkDateForm, evidencePath: string): RecordSupplierAnswersInput {
  const later = dateIsLater(form.date, target.officialDate);
  return recordSupplierAnswersInput.parse({
    poVersion: target.version,
    channel: form.channel,
    recipient: form.recipient.trim(),
    reportedBy: form.reportedBy.trim(),
    reportedAt: new Date(form.reportedAt).toISOString(),
    evidence: [evidencePath],
    lines: target.openLineIds.map((poLineId) => ({
      poLineId,
      answer: "new_date",
      date: form.date,
      ...(later && form.reason ? { reason: form.reason as (typeof PO_DELAY_REASONS)[number] } : {}),
      ...(later && form.remarks.trim() ? { remarks: form.remarks.trim() } : {}),
    })),
  });
}

/**
 * Saves the date PO by PO, one after another, and keeps going past a failure so
 * every PO ends with its own result. Evidence must sit under each PO's own
 * prefix, so the one file is uploaded once per PO.
 */
export async function applyBulkSupplierDate(
  targets: readonly BulkDateTarget[],
  form: BulkDateForm,
  doors: {
    upload: (target: BulkDateTarget) => Promise<string>;
    save: (poId: string, body: RecordSupplierAnswersInput) => Promise<unknown>;
  },
): Promise<BulkDateResult[]> {
  const results: BulkDateResult[] = [];
  for (const target of targets) {
    if (target.blocked) {
      results.push({ poId: target.poId, label: target.label, problem: target.blocked });
      continue;
    }
    try {
      await doors.save(target.poId, bulkDateBody(target, form, await doors.upload(target)));
      results.push({ poId: target.poId, label: target.label, problem: null });
    } catch (e) {
      const message = (e as { body?: { message?: string } }).body?.message;
      results.push({ poId: target.poId, label: target.label, problem: message ?? "Could not save. Try again." });
    }
  }
  return results;
}
