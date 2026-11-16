// Carres only (not part of Houzs's code): a supplier's ask reaches Carres on the notification bell.
//
// A supplier may only ASK for a new pickup day or a cancel; nothing changes until Carres approves it in Supplier
// Pickups (owner ruling, 17 Nov 2026). An ask nobody reads runs out: the lorry still goes on the old day, and once the
// asked-for day has passed the ask can only be declined. So the ask is posted where Carres staff already look (owner,
// 17 Nov 2026: "need show up in portal notification"): the bell at the top right of every staff screen, which is the
// engine's own (the portal opens straight into the engine's screens). It goes through the engine's ONE path for a
// machine notice (services/personalNotice.ts): a private notice under the bell's System tab, never a pop-up.
//
// WHO GETS IT: every active person who can answer it, that is who may act in Supplier Pickups (page
// `scm.procurement.po` at edit, the gate in ./staff-routes.ts), resolved person by person with the one resolver
// sign-in uses (services/memberPageAccess.ts), so the list cannot disagree with who can open the page. Unlike the
// amendment notices (services/permissionHolders.ts), the Owner-role people are NOT left out: amendments fire all day
// and would bury them, while an ask is rare and tied to a lorry already booked, and today only Owner-role people can
// act on Supplier Pickups at all. Left out, the ask would reach nobody.
//
// TAKEN DOWN WHEN IT IS DONE: once the ask is answered, taken back or overtaken (the pickup collected or cancelled),
// its notice is switched off for everyone, so the bell shows only asks still waiting. Supplier Pickups stays the
// record; the notice only points there. Neither function here ever throws: a notice must never fail the act that
// caused it.
import type { Env } from "../../types";
import { postPersonalNotice } from "../../services/personalNotice";
import { bustBannerForUser } from "../../services/configCache";
import { resolveMemberPageAccess } from "../../services/memberPageAccess";
import { meetsLevel, type AccessLevel } from "../../services/pageAccess";
import { parsePermissions } from "../../services/permissions";
import { positionGrantsWildcard } from "../../services/positionPolicy";
import { policyRowFromDb } from "../../services/positionPolicyRows";
import { fmtDate } from "../../scm/shared/format";

/** announcements.source: keeps the notice out of the office composer and the pop-up, inside the bell's System tab. */
export const ASK_NOTICE_SOURCE = "supplier_ask";
/** Supplier Pickups' gate for answering an ask (./staff-routes.ts mayAct). */
const ANSWER_PAGE = "scm.procurement.po";

export interface AskNotice {
  requestNo: string;
  supplierName: string;
  kind: "date" | "cancel";
  /** The day the pickup is on now, YYYY-MM-DD. */
  currentDate: string;
  /** The day the supplier asks for (a move only), YYYY-MM-DD. */
  askDate: string | null;
}

/** The notice's words. The title starts with the request number: that is how its notice is found to take it down. */
export function askNoticeWords(a: AskNotice): { title: string; body: string } {
  const who = a.supplierName || "The supplier";
  if (a.kind === "cancel") {
    return {
      title: `${a.requestNo}: ${who} asks to cancel the pickup`,
      body: `${who} asks Carres to cancel pickup ${a.requestNo}, set for ${fmtDate(a.currentDate)}. ` +
        `Nothing changes until you answer it in Supplier Pickups.`,
    };
  }
  return {
    title: `${a.requestNo}: ${who} asks to move the pickup`,
    body: `${who} asks Carres to move pickup ${a.requestNo} from ${fmtDate(a.currentDate)} to ${fmtDate(a.askDate)}. ` +
      `Nothing changes until you answer it in Supplier Pickups.`,
  };
}

interface StaffRow {
  id: number | string;
  role_id: number | string;
  role_permissions: string | null;
  position_id: number | string | null;
  position_name: string | null;
  department_name: string | null;
  policy_cohort: unknown;
  policy_profile: unknown;
  policy_money: unknown;
  policy_config: unknown;
  policy_fleet: unknown;
  policy_duty: unknown;
}

/** Active people who may answer a supplier's ask, by the same resolution as their sign-in (the joins mirror
 *  services/auth.ts getUserBySession). */
export async function askAudience(env: Env): Promise<number[]> {
  const people = await env.DB.prepare(
    `SELECT u.id, u.role_id, r.permissions AS role_permissions, u.position_id,
            p.name AS position_name, d.name AS department_name,
            pp.cohort AS policy_cohort, pp.profile AS policy_profile,
            pp.can_move_money AS policy_money, pp.can_write_config AS policy_config,
            pp.is_fleet AS policy_fleet, pp.duty AS policy_duty
       FROM users u
       JOIN roles r ON r.id = u.role_id
       LEFT JOIN positions p ON p.id = u.position_id
       LEFT JOIN position_policy pp ON pp.position_id = u.position_id
       LEFT JOIN departments d ON d.id = u.department_id
      WHERE u.status = 'active'`,
  ).all<StaffRow>();
  const rows = await env.DB.prepare(`SELECT role_id, page_key, level FROM role_page_access`).all<{ role_id: number | string; page_key: string; level: string }>();
  const byRole = new Map<number, Array<{ page_key: string; level: string }>>();
  for (const r of rows.results ?? []) {
    const key = Number(r.role_id);
    if (!byRole.has(key)) byRole.set(key, []);
    byRole.get(key)!.push({ page_key: r.page_key, level: r.level });
  }
  const out: number[] = [];
  for (const u of people.results ?? []) {
    const permissionsSet = new Set(parsePermissions(u.role_permissions));
    const policy = policyRowFromDb({
      position_id: u.position_id, cohort: u.policy_cohort, profile: u.policy_profile, can_move_money: u.policy_money,
      can_write_config: u.policy_config, is_fleet: u.policy_fleet, duty: u.policy_duty,
    });
    if (!permissionsSet.has("*") && positionGrantsWildcard(u.position_name ?? null, policy)) permissionsSet.add("*");
    const { pageAccess } = resolveMemberPageAccess({
      permissionsSet,
      positionId: u.position_id == null ? null : Number(u.position_id),
      positionName: u.position_name ?? null,
      departmentName: u.department_name ?? null,
      positionPolicy: policy,
      roleRows: byRole.get(Number(u.role_id)) ?? [],
    });
    const level: AccessLevel = pageAccess[ANSWER_PAGE] ?? "none";
    if (meetsLevel(level, "edit")) out.push(Number(u.id));
  }
  return out.filter((n) => Number.isFinite(n) && n > 0);
}

/** Tell the people who can answer it that a supplier asked. Never throws. */
export async function noticeSupplierAsk(env: Env, a: AskNotice): Promise<void> {
  try {
    const userIds = await askAudience(env);
    const { title, body } = askNoticeWords(a);
    await postPersonalNotice(env, { userIds, category: "GENERAL", title, body, source: ASK_NOTICE_SOURCE });
  } catch (e) {
    console.error("[supplier-ask-notice] post failed:", (e as Error).message);
  }
}

/** The ask on this request is answered, taken back or overtaken: switch its notice off for everyone. Never throws. */
export async function takeDownAskNotice(env: Env, requestNo: string): Promise<void> {
  if (!requestNo) return;
  try {
    const live = await env.DB.prepare(
      `SELECT id, target_user_ids FROM announcements WHERE source = ? AND is_active = 1 AND title LIKE ?`,
    ).bind(ASK_NOTICE_SOURCE, `${requestNo}: %`).all<{ id: string; target_user_ids: string | null }>();
    const found = live.results ?? [];
    if (!found.length) return;
    for (const n of found) {
      await env.DB.prepare(`UPDATE announcements SET is_active = 0 WHERE id = ?`).bind(n.id).run();
    }
    // The notice changes only its targets' bells: refresh just those.
    const targets = new Set<number>();
    for (const n of found) {
      try {
        for (const id of JSON.parse(n.target_user_ids ?? "[]") as unknown[]) {
          const uid = Number(id);
          if (Number.isFinite(uid) && uid > 0) targets.add(uid);
        }
      } catch { /* a malformed target list refreshes nobody */ }
    }
    for (const uid of targets) await bustBannerForUser(env, uid);
  } catch (e) {
    console.error("[supplier-ask-notice] take down failed:", (e as Error).message);
  }
}
