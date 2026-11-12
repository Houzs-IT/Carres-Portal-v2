import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { requireOperationOrPrincipal } from "../../lib/auth-guards";
import { userClient } from "../../lib/supabase";
import type { AppEnv } from "../../types";

/**
 * Tasks board (migration 0162) — COO/manager assigns work to the operation
 * team; staff CLAIM a task (records who took it) + mark it done. A 1-hour SLA
 * (sla_minutes, default 60) drives an in-app overdue flag (open past SLA),
 * surfaced as a red sidebar badge via /operation/badges (tasksOverdue).
 *
 *   GET    /          — full feed (joined member names + overdue) via RPC
 *   GET    /members   — operation+principal staff for the assign dropdown
 *   POST   /          — create (created_by = authed user)
 *   PATCH  /:id       — claim / done / reopen / cancel / edit (claimed_by = authed user)
 *   DELETE /:id       — delete
 */
const tasksRouter = new Hono<AppEnv>();

tasksRouter.get("/", requireOperationOrPrincipal, async (c) => {
  const sb = userClient(c.env, c.var.auth.jwt);
  const { data, error } = await sb.rpc("ops_tasks_feed");
  if (error) throw new HTTPException(500, { message: error.message });
  return c.json({ tasks: (data ?? []).map(shape) });
});

interface RawTaskFeed {
  id: string;
  title: string;
  detail: string | null;
  status: string;
  priority: string;
  created_by: string;
  created_by_name: string | null;
  assigned_to: string | null;
  assigned_to_name: string | null;
  claimed_by: string | null;
  claimed_by_name: string | null;
  claimed_at: string | null;
  sla_minutes: number;
  due_at: string | null;
  done_at: string | null;
  related_order_id: string | null;
  related_so: number | null;
  escalated_at: string | null;
  escalate_reason: string | null;
  escalate_note: string | null;
  created_at: string;
  updated_at: string;
  overdue: boolean;
}

function shape(r: RawTaskFeed) {
  return {
    id: r.id,
    title: r.title,
    detail: r.detail,
    status: r.status,
    priority: r.priority,
    createdBy: r.created_by,
    createdByName: r.created_by_name,
    assignedTo: r.assigned_to,
    assignedToName: r.assigned_to_name,
    claimedBy: r.claimed_by,
    claimedByName: r.claimed_by_name,
    claimedAt: r.claimed_at,
    slaMinutes: r.sla_minutes,
    dueAt: r.due_at,
    doneAt: r.done_at,
    relatedOrderId: r.related_order_id,
    relatedSo: r.related_so,
    escalatedAt: r.escalated_at,
    escalateReason: r.escalate_reason,
    escalateNote: r.escalate_note,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    overdue: r.overdue,
  };
}

export default tasksRouter;
