import { useMemo, useState } from "react";
import { appTodayIso, fmtDate } from "@/lib/fmt-date";
import { caseIssueLabel, caseProductCategoryLabel, type CaseSlaClock, type ServiceCase } from "@carres/shared";

/**
 * The Service Cases Board and Calendar, after Houzs ServiceCases.tsx:1424 and
 * :1613. Same urgency words and columns. Houzs counts hours to a stage deadline;
 * Carres has one case deadline counted in working days, so the buckets read that.
 */
export type CaseUrgency = "overdue" | "today" | "soon" | "later" | "none";

const URGENCY: { key: CaseUrgency; label: string; pill: string }[] = [
  { key: "overdue", label: "Overdue", pill: "pill-overdue" },
  { key: "today", label: "Due today", pill: "pill-neutral" },
  { key: "soon", label: "Due soon", pill: "pill-neutral" },
  { key: "later", label: "On track", pill: "pill-confirmed" },
  { key: "none", label: "No SLA", pill: "pill-neutral" },
];

export function caseUrgency(clock: CaseSlaClock): CaseUrgency {
  if (clock.state === "late") return "overdue";
  if (clock.state === "off" || clock.workingDaysLeft === null) return "none";
  if (clock.workingDaysLeft === 0) return "today";
  return clock.workingDaysLeft <= 3 ? "soon" : "later";
}

interface ViewProps {
  rows: readonly ServiceCase[];
  clockOf: (r: ServiceCase) => CaseSlaClock;
  ownerOf: (r: ServiceCase) => string;
  onOpen: (id: string) => void;
}

function CaseCard({ c, clock, owner, onOpen }: { c: ServiceCase; clock: CaseSlaClock; owner: string; onOpen: (id: string) => void }) {
  return (
    <button type="button" onClick={() => onOpen(c.id)} className="block w-full rounded border border-base-200 bg-white px-3 py-2 text-left hover:border-base-400">
      <span className="flex items-center justify-between gap-2">
        <span className="font-mono text-meta font-semibold text-base-900">{c.caseNo}</span>
        {clock.dueIso && <span className="text-meta text-base-500">{fmtDate(clock.dueIso)}</span>}
      </span>
      <span className="mt-1 block truncate text-body text-base-900">{c.customerName}</span>
      {c.productSku && <span className="block truncate font-mono text-meta text-base-500">{c.productSku}</span>}
      <span className="mt-1 flex items-center justify-between gap-2 text-meta text-base-500">
        <span className="truncate">{c.statusLabel ?? "Unset"}</span>
        {owner && <span className="truncate">{owner}</span>}
      </span>
    </button>
  );
}

/** Every open case by how close its deadline is. Clear the red column first. */
export function CasesBoard({ rows, clockOf, ownerOf, onOpen }: ViewProps) {
  const open = rows.filter((r) => !r.statusIsClosed);
  if (open.length === 0) return <p className="rounded border border-base-200 bg-white p-12 text-center text-body text-base-500">No open cases</p>;
  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-auto sm:grid-cols-2 lg:grid-cols-5" data-testid="service-cases-board">
      {URGENCY.map((u) => {
        const items = open
          .filter((r) => caseUrgency(clockOf(r)) === u.key)
          .sort((a, z) => (clockOf(a).dueIso ?? "9").localeCompare(clockOf(z).dueIso ?? "9"));
        return (
          <section key={u.key} aria-label={u.label} className="rounded border border-base-200 bg-base-50">
            <header className="flex items-center justify-between border-b border-base-200 px-3 py-2">
              <span className={`pill ${u.pill}`}>{u.label}</span>
              <span className="text-meta font-semibold text-base-500">{items.length}</span>
            </header>
            <div className="space-y-2 p-2">
              {items.length === 0
                ? <p className="px-1 py-4 text-center text-meta text-base-400">Nothing here</p>
                : items.map((c) => <CaseCard key={c.id} c={c} clock={clockOf(c)} owner={ownerOf(c)} onOpen={onOpen} />)}
            </div>
          </section>
        );
      })}
    </div>
  );
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const iso = (y: number, m: number, d: number) => `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/** A month of open cases on their deadline. "+N more" opens that day's list. */
export function CasesCalendar({ rows, clockOf, ownerOf, onOpen }: ViewProps) {
  const today = appTodayIso();
  const [month, setMonth] = useState(() => ({ y: Number(today.slice(0, 4)), m: Number(today.slice(5, 7)) - 1 }));
  const [day, setDay] = useState<string | null>(null);
  const byDay = useMemo(() => {
    const out = new Map<string, ServiceCase[]>();
    for (const r of rows) {
      const due = r.statusIsClosed ? null : clockOf(r).dueIso;
      if (due) out.set(due, [...(out.get(due) ?? []), r]);
    }
    return out;
  }, [rows, clockOf]);
  const first = new Date(Date.UTC(month.y, month.m, 1)).getUTCDay();
  const days = new Date(Date.UTC(month.y, month.m + 1, 0)).getUTCDate();
  const step = (by: number) => {
    const next = new Date(Date.UTC(month.y, month.m + by, 1));
    setMonth({ y: next.getUTCFullYear(), m: next.getUTCMonth() });
    setDay(null);
  };
  const title = new Date(Date.UTC(month.y, month.m, 1)).toLocaleDateString("en-MY", { month: "long", year: "numeric", timeZone: "UTC" });
  return (
    <div className="min-h-0 flex-1 overflow-auto rounded border border-base-200 bg-white p-3" data-testid="service-cases-calendar">
      <div className="mb-2 flex items-center gap-2">
        <button type="button" aria-label="Previous month" onClick={() => step(-1)} className="rounded border border-base-300 px-2 py-1 text-body">‹</button>
        <button type="button" aria-label="Next month" onClick={() => step(1)} className="rounded border border-base-300 px-2 py-1 text-body">›</button>
        <span className="text-body font-semibold text-base-900">{title}</span>
      </div>
      <div className="grid grid-cols-7 gap-px bg-base-200">
        {WEEKDAYS.map((w) => <div key={w} className="bg-base-50 px-2 py-1 text-meta text-base-500">{w}</div>)}
        {Array.from({ length: first }, (_, i) => <div key={`blank-${i}`} className="bg-white" />)}
        {Array.from({ length: days }, (_, i) => {
          const d = iso(month.y, month.m, i + 1);
          const items = byDay.get(d) ?? [];
          return (
            <div key={d} className="min-h-24 bg-white p-1">
              <div className={`text-meta ${d === today ? "font-semibold text-base-900" : "text-base-500"}`}>{i + 1}</div>
              {items.slice(0, 3).map((c) => (
                <button key={c.id} type="button" onClick={() => onOpen(c.id)} title={c.customerName}
                  className={`mt-0.5 block w-full truncate rounded px-1 text-left text-meta ${caseUrgency(clockOf(c)) === "overdue" ? "pill-overdue" : "bg-base-100 text-base-700"}`}>
                  {c.caseNo}
                </button>
              ))}
              {items.length > 3 && (
                <button type="button" onClick={() => setDay(d)} className="mt-0.5 text-meta text-base-500 underline">+{items.length - 3} more</button>
              )}
            </div>
          );
        })}
      </div>
      {day && (
        <div className="mt-3" aria-label={`Cases due ${fmtDate(day)}`}>
          <p className="mb-2 text-body font-semibold text-base-900">{fmtDate(day)}</p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {(byDay.get(day) ?? []).map((c) => <CaseCard key={c.id} c={c} clock={clockOf(c)} owner={ownerOf(c)} onOpen={onOpen} />)}
          </div>
        </div>
      )}
    </div>
  );
}

/** The caption under each stage card. Carres stages are config rows, so a stage
 *  someone adds later has no caption rather than a wrong one. */
const STAGE_DESCRIPTIONS: Record<string, string> = {
  pending: "New case, first review",
  "in progress": "Inspect and fix the issue",
  "follow-up": "Waiting on the customer or supplier",
  resolved: "Closed",
};
export function caseStageDescription(label: string): string {
  return STAGE_DESCRIPTIONS[label.trim().toLowerCase()] ?? "";
}

/** A leading =, +, - or @ would run as a formula when the file opens in Excel. */
function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** Houzs Export All (assr.ts:1224), the columns Carres has data for. */
export function casesCsv(rows: readonly ServiceCase[], clockOf: ViewProps["clockOf"], ownerOf: ViewProps["ownerOf"]): string {
  const headers = ["ASSR No", "SO No", "Delivery Order", "Stage", "Priority", "Customer", "Phone", "Location", "Salesperson",
    "Category", "Issue Category", "Resolution", "Item", "Issue", "Complained Date", "Deadline", "PO No", "Assigned To", "Creditor", "SLA Breached"];
  const lines = rows.map((r) => {
    const clock = clockOf(r);
    return [r.caseNo, r.so == null ? "" : `SO-${r.so}`, (r.doNumbers ?? []).join(" "), r.statusLabel ?? "", r.priority ?? "", r.customerName,
      r.customerPhone ?? "", r.customerAddress ?? "", r.salespersonName ?? "", r.productCategory ? caseProductCategoryLabel(r.productCategory) : "",
      r.issueType ? caseIssueLabel(r.issueType) : "", r.carresAction ?? "", r.productSku ?? "", r.whatHappened ?? "", r.openedAt, clock.dueIso ?? "",
      (r.poNumbers ?? []).join(" "), ownerOf(r), r.supplierName ?? "", clock.state === "late" ? "Yes" : "No"].map(csvCell).join(",");
  });
  return [headers.join(","), ...lines].join("\r\n");
}

export function downloadCasesCsv(rows: readonly ServiceCase[], clockOf: ViewProps["clockOf"], ownerOf: ViewProps["ownerOf"], todayIso: string) {
  // The byte order mark tells Excel the file is UTF-8.
  const url = URL.createObjectURL(new Blob([`\uFEFF${casesCsv(rows, clockOf, ownerOf)}`], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `Service Cases ${todayIso}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
