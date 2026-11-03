/**
 * TaskView — the ONE task view (03 §8 "An open task"; admitted with the owner's
 * round 3 brief of 13 Oct 2026, point 2). Every module's task opens in this
 * same shape, in the Tasks panel and wherever else a task is shown.
 *
 *   Ask Nice Future when the goods will arrive          the task, 13 / 500
 *   ─────────────────────────────────────────────────
 *   [icon] Purchasing / PO-2609-0042              (SA)  page / record · owner
 *   [icon] Deadline     Fri, 9 Oct · 4 days late        one row per fact
 *   [icon] Contact      Nice Future · WhatsApp
 *   [ Steps ][ Route ][ History ][ Files 4 ]
 *   …the chosen tab…
 *
 * The record is the door to its own page. Amber is on the one fact whose date
 * or window has gone by, and nowhere else. The first tab holds the module's
 * own work and stays mounted, so what was typed there survives a look at
 * another tab; the other tabs are drawn when they are opened.
 *
 * The view owns arrangement only. It reads nothing, writes nothing and closes
 * nothing: the owning module supplies every fact, step and file.
 */
import { useState, type ReactNode } from "react";
import Button from "./Button";
import MIcon from "@/components/carres/MIcon";
import Tabs from "./Tabs";
import { avatarColor } from "@/lib/staff-avatar";
import { waLink } from "@/lib/wa-link";
import StepList, { Step } from "./StepList";
export type { StepState } from "./StepList";

/** Shared document-send presentation; modules retain all actions and outcomes. */
export const SendTaskSteps = StepList;
export function SendTaskStep(props: Parameters<typeof Step>[0]) {
  const titles: Record<number, string> = { 1: "Download", 2: "WhatsApp or Email", 3: "Record the result" };
  return <Step {...props} title={props.state === "done" && props.title ? props.title : titles[props.n]} />;
}

/** Exact module PDF only; this action never records a send. */
export function SendTaskDownload({ url, filename, failed }: { url: string | null; filename: string; failed?: boolean }) {
  return <div className="flex flex-col gap-2"><span className="break-words text-meta text-c-secondary">{filename}</span><span><Button disabled={!url} onClick={() => { if (!url) return; const link = document.createElement("a"); link.href = url; link.download = filename; link.click(); }}>Download PDF</Button></span>{!url && <p role={failed ? "alert" : "status"} className="text-meta text-c-secondary">{failed ? "The PDF could not be loaded" : "Loading PDF"}</p>}</div>;
}

/** Opens a channel only; each module retains its own result writer. */
export function SendTaskChannelDoor({ channel, recipient }: { channel: string; recipient: string }) {
  const value = recipient.trim();
  const number = value.replace(/[\s()+-]/g, "");
  const href = channel === "email" && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value) ? `mailto:${value}`
    : channel === "whatsapp" && /^https:\/\/chat\.whatsapp\.com\/[A-Za-z0-9_-]+$/.test(value) ? value
    : channel === "whatsapp" && /^\d{7,15}$/.test(number) ? waLink(value) : null;
  if (channel !== "whatsapp" && channel !== "email") return null;
  return <span><Button disabled={!href} onClick={() => { if (href) window.open(href, "_blank", "noopener,noreferrer"); }}>{channel === "email" ? "Open Email" : "Open WhatsApp"}</Button></span>;
}

export interface TaskViewFact {
  key: string;
  /** A Material Symbols name. */
  icon: string;
  label: string;
  value: ReactNode;
  /** Amber: the one fact whose date or window has gone by. */
  warn?: boolean;
  /** What the fact opens, full width under its row (the Sales Orders behind
   *  `3 Sales Orders`). Drawn only while the owner of the fact passes it. */
  detail?: ReactNode;
}

export interface TaskViewTab {
  key: string;
  /** The word, with its count when it has one (`Files 4`). */
  label: string;
  content: ReactNode;
}

/** `SA` for `Staff A`: the first letters of the first two words that start
 *  with a letter or a number (a `·` between words is not a word). */
export function ownerInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter((word) => /^[\p{L}\p{N}]/u.test(word));
  return words.slice(0, 2).map((word) => word.charAt(0).toUpperCase()).join("");
}

export default function TaskView({ title, moduleIcon, page, record, openRecordLabel, onOpenRecord, owner, ownerKey, facts, afterFacts, tabs, initialTab, tabsLabel, "data-testid": testId }: {
  /** The task, in the words its list card uses. */
  title: string;
  /** The module's icon, a Material Symbols name. */
  moduleIcon: string;
  /** The page the record lives on (`Purchasing`). */
  page: string;
  /** The record the task is about (`PO-2609-0042`); `null` when it has none. */
  record: string | null;
  /** The record's door, spoken (`Open PO-2609-0042`). */
  openRecordLabel?: string;
  onOpenRecord?: () => void;
  /** Who does this task now; `null` when nobody is assigned. */
  owner: string | null;
  ownerKey?: string | null;
  facts: readonly TaskViewFact[];
  /** One act about the task itself, between the facts and the tabs (the
   *  Tasks area's `Record as sent`). The owner of the act draws it. */
  afterFacts?: ReactNode;
  /** The first tab is the module's own work. */
  tabs: readonly TaskViewTab[];
  initialTab?: string;
  /** What the tabs switch between, for a screen reader. */
  tabsLabel: string;
  "data-testid"?: string;
}) {
  const first = tabs[0]?.key ?? "";
  const [chosen, setChosen] = useState(initialTab ?? first);
  const tab = tabs.some((t) => t.key === chosen) ? chosen : first;
  /* A tab is drawn from the moment it is first opened and then kept. */
  const [opened, setOpened] = useState<ReadonlySet<string>>(() => new Set([first, tab]));
  const choose = (key: string) => {
    setChosen(key);
    setOpened((previous) => (previous.has(key) ? previous : new Set(previous).add(key)));
  };
  return (
    <article className="flex flex-col rounded-lg border border-c-card-border bg-white" aria-label={title} data-kit="task-view" data-testid={testId}>
      <h3 className="break-words border-b border-c-row-line px-3 py-3 text-body font-medium text-c-ink" data-testid="task-view-title">{title}</h3>
      <div className="flex flex-col gap-2 px-3 pb-1 pt-2.5">
        <div className="flex min-h-5 items-center gap-1.5 text-meta" data-testid="task-view-head">
          <MIcon name={moduleIcon} size={16} className="shrink-0 text-c-secondary" />
          <span className="shrink-0 text-c-secondary">{page}</span>
          {record ? (
            <>
              <span className="shrink-0 text-c-muted" aria-hidden="true">/</span>
              {onOpenRecord ? (
                <button type="button" onClick={onOpenRecord} aria-label={openRecordLabel} title={openRecordLabel}
                  className="min-w-0 break-words text-left font-medium text-c-ink underline decoration-c-chip-border underline-offset-2 outline-none hover:decoration-c-ink focus-visible:[outline:var(--c-focus)]"
                  data-testid="task-view-record">
                  {record}
                </button>
              ) : <span className="min-w-0 break-words font-medium text-c-ink" data-testid="task-view-record">{record}</span>}
            </>
          ) : null}
          <span className="flex-1" />
          {owner ? (
            <span className="grid h-task-avatar min-w-task-avatar shrink-0 place-items-center rounded-full px-1 text-label" style={{ background: avatarColor(ownerKey ?? owner).bg, color: avatarColor(ownerKey ?? owner).fg }} title={owner} aria-label={owner} data-testid="task-view-owner">
              {ownerInitials(owner)}
            </span>
          ) : null}
        </div>
        {facts.length > 0 ? (
          /* ONE grid for every fact, so the values start on one line: icon,
             then the label (as wide as the longest, at most 104), then the
             value. A longer label wraps; a value is never cut. */
          <dl className="m-0 grid grid-cols-[16px_fit-content(88px)_minmax(0,1fr)] items-center gap-x-2 text-body" data-testid="task-view-facts">
            {facts.map((fact) => (
              <div key={fact.key} className="contents" data-warn={fact.warn || undefined} data-testid={`task-view-fact-${fact.key}`}>
                <dt className="col-span-2 grid min-h-9 grid-cols-subgrid items-center border-t border-c-row-line py-2 text-meta text-c-secondary">
                  <MIcon name={fact.icon} size={16} className="mt-[2px]" />
                  <span className="min-w-0 break-words">{fact.label}</span>
                </dt>
                <dd className="m-0 flex min-h-9 min-w-0 flex-wrap items-center gap-1.5 break-words border-t border-c-row-line py-2 text-body text-c-ink">{fact.warn && <MIcon name="schedule" size={16} className="shrink-0 text-c-warn-fg" />}{fact.value}</dd>
                {fact.detail ? <dd className="col-span-3 m-0 min-w-0" data-testid={`task-view-fact-detail-${fact.key}`}>{fact.detail}</dd> : null}
              </div>
            ))}
          </dl>
        ) : null}
      </div>
      {afterFacts}
      {tabs.length > 1 ? (
        <div className="px-3 pb-1 pt-2" data-testid="task-view-tabs">
          <Tabs variant="segmented" fill label={tabsLabel} value={tab} onValueChange={choose}
            tabs={tabs.map((t) => ({ value: t.key, label: t.label }))} />
        </div>
      ) : null}
      {tabs.map((t) => (opened.has(t.key) ? (
        <div key={t.key} role="tabpanel" aria-label={t.label} hidden={t.key !== tab} className={t.key === tab ? "min-w-0 px-3 pb-3 pt-3" : undefined} data-testid={`task-view-panel-${t.key}`}>
          {t.content}
        </div>
      ) : null))}
    </article>
  );
}
