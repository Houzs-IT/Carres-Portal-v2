/**
 * WHAT A TASK OPENS — each module's own working panel, in the Tasks area.
 *
 * The host never draws a module's work itself: a row opens that module's
 * panel through the module's EXISTING doors.
 *
 *   internal_task    the task one employee added for another: its own `Mark done`.
 *   everything else  the act itself: what is wrong, what finishes it and
 *                    `Open {object}`, the module destination exactly as the
 *                    Work page opens it.
 *
 * The Purchasing (PO window, PO Duty, supplier answer) and Delivery panels left
 * with their tasks: that work is done in the Houzs engine (owner, 11 Nov 2026),
 * and the Carres task feed no longer carries it.
 *
 * Every panel is drawn in the ONE task view (`TaskFrame`, owner's round 3
 * brief of 13 Oct 2026): the panel supplies its steps and what only its module
 * knows; the frame owns the head, the fact rows and the tabs.
 */
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { INTERNAL_TASK_KIND } from "@carres/shared";
import Button from "@/components/kit/Button";
import StepList, { Step } from "@/components/kit/StepList";
import type { WorkRow } from "../use-open-work";
import InternalTaskPanel from "./InternalTaskPanel";
import TaskFrame from "./TaskFrame";
import { purchasingFileStages } from "./task-files";
import { TASK_VIEW_WORDS as V } from "./task-view";
import type { WorkPanelHost } from "./tasks-host";
import { TASK_MODULE_SYMBOL, TASK_MODULE_WORD } from "./tasks-model";

export type WorkPanelRenderer = (item: WorkRow, host: WorkPanelHost) => ReactNode;

/** Panels keyed by the Work item's object kind. */
export const WORK_PANELS: Partial<Record<string, WorkPanelRenderer>> = {
  /* A task one employee added for another: its own `Mark done`, no module door. */
  [INTERNAL_TASK_KIND]: (item, host) => <InternalTaskPanel key={item.id} item={item} host={host} />,
};

/** The panel a task opens: the registry by object kind, else the act card. */
export function panelFor(item: WorkRow, host: WorkPanelHost): ReactNode {
  const byKind = WORK_PANELS[item.source.object.kind];
  if (byKind) return byKind(item, host);
  return <GenericTaskPanel key={item.id} item={item} />;
}

/* ── Every other act — what is wrong, what finishes it, and the record's own
   page (`Open {object}`), where the owning module's form lives. ─────────── */

const ORDER_KINDS = new Set(["sales_order", "delivery_scope"]);

function GenericTaskPanel({ item }: { item: WorkRow }) {
  const navigate = useNavigate();
  const work = item.source;
  const finish = work.interaction.mode === "read_only" ? work.interaction.reason : work.completionStatement;
  /* A Sales Order task is about one order, by its id (`operation/work.ts`): it has a Route and its document. */
  const orders = ORDER_KINDS.has(work.object.kind) ? [{ orderId: work.object.id, label: work.object.label }] : [];
  return (
    <div className="p-3" data-testid="task-panel-generic">
      <TaskFrame
        head={{ title: item.line, page: TASK_MODULE_WORD[item.module], record: work.object.label, moduleIcon: TASK_MODULE_SYMBOL[item.module], destination: item.destination }}
        orders={orders}
        files={orders.length ? purchasingFileStages(orders, []).slice(0, 1) : []}
        steps={
          <div className="flex flex-col gap-3" data-testid="task-generic-steps">
            <p className="text-body text-c-ink" data-testid="task-generic-problem">{work.problem}</p>
            <StepList aria-label={V.tab.steps}>
              <Step n={1} state="current" title={work.requiredResult}
                /* One sentence, said once: the finish line only when it adds to the title. */
                sub={finish !== work.requiredResult ? <span data-testid="task-generic-finish">{V.finishWhen}: {finish}</span> : undefined}>
                <div><Button variant="primary" size="sm" onClick={() => navigate(item.destination)} data-testid="task-generic-open">{V.open(work.object.label)}</Button></div>
              </Step>
            </StepList>
            {work.nextConsequence ? <p className="text-meta text-c-secondary" data-testid="task-generic-next">{V.then}: {work.nextConsequence}</p> : null}
          </div>
        }
      />
    </div>
  );
}
