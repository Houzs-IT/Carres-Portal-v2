/**
 * THE TASKS WORDS — what a task's row says, from the ONE open work set.
 *
 * No second engine: every row is a Work engine item (`useOpenWorkSet`). This
 * file only words what the engine already decided; the list itself (day
 * strip, `To do` · `Waiting` · `Done`, the cards) is `task-cards.ts`.
 */
import { INTERNAL_TASK_KIND, type OperationWorkModule, type OperationWorkSourceHealth } from "@carres/shared";
import { fmtDate } from "@/lib/fmt-date";
import type { WorkRow } from "../use-open-work";

/** The Tasks door's module words — the portal's own destination names
 *  (Receiving work is done in Warehouse). */
export const TASK_MODULE_WORD: Record<OperationWorkModule, string> = {
  orders: "Sales Orders",
  purchasing: "Purchasing",
  receiving: "Warehouse",
  delivery: "Delivery",
  payment: "Payment",
  issue_tracker: "Issue Tracker",
  /* Tasks one employee adds for another (COPY "The internal task words"). */
  workspace: "Staff tasks",
};

/** The modules the Carres task feed carries (its sources): the Module rail lists these. Purchasing,
 *  Receiving, Delivery and the Issue Tracker are worked in the Houzs engine (owner, 11 Nov 2026); their
 *  words stay above only because the lifecycle ledger still names those modules. */
export const TASK_FEED_MODULES: readonly OperationWorkSourceHealth["key"][] = ["orders", "payment", "workspace"];

/** The module's icon, as the side menu draws it (Material Symbols). */
export const TASK_MODULE_SYMBOL: Record<OperationWorkModule, string> = {
  orders: "receipt_long",
  purchasing: "shopping_cart",
  receiving: "warehouse",
  payment: "payments",
  delivery: "local_shipping",
  issue_tracker: "assignment_late",
  workspace: "task_alt",
};

/** Words of the panel's frame and its rows. */
export const TASKS_WORDS = {
  title: "Tasks",
  noDate: "No date",
  setBy: (module: string) => `set by ${module}`,
  failed: "Tasks could not be refreshed",
  lastUpdated: (time: string) => `Last updated ${time}`,
  couldNotRefresh: (source: string) => `Could not refresh ${source}`,
  tryAgain: "Try again",
  forOwner: (name: string) => `For ${name}`,
} as const;

export interface TaskRowWords {
  /** Line 1: the act, naming the party. */
  act: string;
  /** Line 2: the time or the document, then `For {owner}` when covering. */
  detail: string;
  /** The original due date, printed red on a missed row. */
  missedDate: string | null;
  /** `No date · set by {module}` on a row with no working date. */
  noDate: string | null;
}

export function taskRowWords(row: WorkRow): TaskRowWords {
  /* An internal task is named by what its creator typed; its line under
     the name says who added it. */
  const base = row.source.object.kind === INTERNAL_TASK_KIND
    ? { act: row.source.object.label, detail: row.problem }
    : { act: row.line, detail: row.source.object.label };
  const covered = row.ownerState === "covered" && row.normalOwner?.name ? TASKS_WORDS.forOwner(row.normalOwner.name) : null;
  return {
    act: base.act,
    detail: [base.detail, covered].filter(Boolean).join(" · "),
    missedDate: row.timingBucket === "overdue" && row.dueIso ? fmtDate(row.dueIso) : null,
    noDate: row.dueIso === null ? `${TASKS_WORDS.noDate} · ${TASKS_WORDS.setBy(TASK_MODULE_WORD[row.module])}` : null,
  };
}

/** Acts routed to the signed-in acting person (today's cover included). */
export function myTasks(items: readonly WorkRow[], myUserId: string | null): WorkRow[] {
  if (!myUserId) return [];
  return items.filter((item) => item.ownerId === myUserId);
}
