import { Hono } from "hono";
import {
  accountProjectInput, applyBooks, projectCostRateInput, projectMoneyLineInput, projectPnl, projectTotalSalesInput,
  type BooksLeg, type CostRate, type MoneyLine,
} from "@carres/shared/project-money";
import { projectSalesTotals } from "@carres/shared/projects";
import { requireFinance } from "../../lib/auth-guards";
import { readProjectOrders } from "../../lib/project-orders";
import { fail, parseJsonBody } from "../../lib/route-helpers";
import { userClient } from "../../lib/supabase";
import type { AppEnv } from "../../types";

/**
 * /api/finance/projects — a project's money (0754).
 * Weisiang's decision (Mr Lim, 2026-10-22) and YH (3 Nov 2026, "all follow
 * houzs"). Jess was not part of this decision. Follows Houzs
 * scm/lib/event-books.ts (the books on the event page), services/eventPnl.ts
 * (the two P&Ls) and services/eventPnlInputs.ts (the rate card). Only Finance
 * and the principal see a project's money (Houzs projects.finance.view); the
 * database gates every read and write on gl_may_read() as well.
 *
 *   GET   /options                      every project, for a bill, voucher or journal line
 *   GET   /                             each project with its two P&L totals
 *   GET   /:id                          one project: P&L, books lines, typed lines, Sales Orders
 *   POST  /:id/lines · DELETE /lines/:lineId   typed lines (archived, never deleted)
 *   PUT   /:id/total-sales              the Total Sales box
 *   GET   /rates · PUT /rates           brand rate cards
 *   PUT   /accounts/:code               Needs project and the row an account fills
 */
const router = new Hono<AppEnv>();
type Row = Record<string, unknown>;
const num = (v: unknown) => (v == null ? 0 : Number(v));
const numOrNull = (v: unknown) => (v == null ? null : Number(v));

const toLeg = (r: Row): BooksLeg => ({
  legId: String(r.leg_id), accountCode: String(r.account_code), accountName: (r.account_name as string | null) ?? null,
  accountKind: (r.account_kind as string | null) ?? null, projectRow: (r.project_row as string | null) ?? null,
  debit: num(r.debit), credit: num(r.credit), memo: (r.memo as string | null) ?? null, docNo: String(r.doc_no ?? ""),
  entryDate: (r.entry_date as string | null) ?? null, checked: Boolean(r.checked),
});
const toRate = (r: Row | null | undefined): CostRate | null => r ? {
  transportPct: num(r.transport_pct), merchandisePct: num(r.merchandise_pct), commissionNormalPct: num(r.commission_normal_pct),
  commissionBoostPct: numOrNull(r.commission_boost_pct), boostMinGpPct: numOrNull(r.boost_min_gp_pct), boostMinSales: numOrNull(r.boost_min_sales),
} : null;
const toTyped = (l: Row): MoneyLine => ({
  id: String(l.id), kind: l.kind === "income" ? "income" : "cost", category: String(l.category), description: String(l.description),
  amount: num(l.amount), occurredAt: (l.occurredAt as string | null) ?? null, source: null,
});

function money(p: Row, legs: BooksLeg[], so: { count: number; salesRm: number } | null) {
  const books = applyBooks(((p.lines as Row[] | null) ?? []).map(toTyped), legs);
  const pnl = projectPnl({ lines: books.lines, booksRows: new Set(books.rows), lumpSales: numOrNull(p.total_sales), so, rate: toRate(p.rate as Row | null) });
  return { books, pnl };
}

const project = (p: Row) => ({
  id: String(p.id), code: String(p.code), name: String(p.name), brand: (p.brand as string | null) ?? null, status: String(p.status),
  startDate: String(p.start_date), endDate: String(p.end_date), archived: Boolean(p.archived), totalSales: numOrNull(p.total_sales),
  rate: toRate(p.rate as Row | null),
});

router.get("/options", requireFinance, async (c) => {
  const { data, error } = await userClient(c.env, c.var.auth.jwt).rpc("fin_project_options");
  if (error) return fail(c, error);
  return c.json({ rows: ((data ?? []) as Row[]).map((r) => ({ id: String(r.id), code: String(r.code), name: String(r.name), archived: Boolean(r.archived) })) });
});

router.get("/rates", requireFinance, async (c) => {
  const { data, error } = await userClient(c.env, c.var.auth.jwt).rpc("project_cost_rates_list");
  if (error) return fail(c, error);
  return c.json({ rows: ((data ?? []) as Row[]).map((r) => ({ brand: String(r.brand), ...toRate(r)! })) });
});

router.put("/rates", requireFinance, async (c) => {
  const body = await parseJsonBody(c, projectCostRateInput);
  if (!body.ok) return c.json(body.body, body.status);
  const d = body.data;
  const { error } = await userClient(c.env, c.var.auth.jwt).rpc("project_cost_rate_set", {
    p_brand: d.brand, p_transport_pct: d.transportPct, p_merchandise_pct: d.merchandisePct, p_commission_normal_pct: d.commissionNormalPct,
    p_commission_boost_pct: d.commissionBoostPct, p_boost_min_gp_pct: d.boostMinGpPct, p_boost_min_sales: d.boostMinSales,
  });
  if (error) return fail(c, error);
  return c.json({ ok: true });
});

router.put("/accounts/:code", requireFinance, async (c) => {
  const body = await parseJsonBody(c, accountProjectInput);
  if (!body.ok) return c.json(body.body, body.status);
  const { error } = await userClient(c.env, c.var.auth.jwt).rpc("gl_account_project_set", {
    p_code: c.req.param("code"), p_needs_project: body.data.needsProject, p_project_row: body.data.projectRow,
  });
  if (error) return fail(c, error);
  return c.json({ ok: true });
});

/** The list: each project's P&L totals. Sales Orders are left to the one-project page. */
router.get("/", requireFinance, async (c) => {
  const sb = userClient(c.env, c.var.auth.jwt);
  const projects = await sb.rpc("project_money", { p_project_ids: null });
  if (projects.error) return fail(c, projects.error);
  const rows = (projects.data ?? []) as Row[];
  const legs = rows.length ? await sb.rpc("project_books", { p_project_ids: rows.map((p) => p.id) }) : { data: [], error: null };
  if (legs.error) return fail(c, legs.error);
  const byProject = new Map<string, BooksLeg[]>();
  for (const r of (legs.data ?? []) as Row[]) {
    const k = String(r.project_id);
    byProject.set(k, [...(byProject.get(k) ?? []), toLeg(r)]);
  }
  return c.json({
    rows: rows.map((p) => {
      const { pnl } = money(p, byProject.get(String(p.id)) ?? [], null);
      return { ...project(p), sales: pnl.bySales.sales, totalCost: pnl.bySales.totalCost, netProfit: pnl.bySales.netProfit };
    }),
  });
});

router.get("/:id", requireFinance, async (c) => {
  const sb = userClient(c.env, c.var.auth.jwt);
  const id = c.req.param("id");
  const [p, legs, so] = await Promise.all([
    sb.rpc("project_money", { p_project_ids: [id] }),
    sb.rpc("project_books", { p_project_ids: [id] }),
    readProjectOrders(sb, id),
  ]);
  if (p.error) return fail(c, p.error);
  if (legs.error) return fail(c, legs.error);
  if (so.error) return fail(c, so.error);
  const row = ((p.data ?? []) as Row[])[0];
  if (!row) return c.json({ error: "not_found", code: "project_not_found", message: "That project does not exist." }, 404);
  const totals = projectSalesTotals(so.orders);
  const { books, pnl } = money(row, ((legs.data ?? []) as Row[]).map(toLeg), { count: totals.count, salesRm: totals.total });
  return c.json({ project: project(row), pnl, lines: books.lines, replaced: books.replaced, booksRows: books.rows, orders: so.orders });
});

router.post("/:id/lines", requireFinance, async (c) => {
  const body = await parseJsonBody(c, projectMoneyLineInput);
  if (!body.ok) return c.json(body.body, body.status);
  const d = body.data;
  const { data, error } = await userClient(c.env, c.var.auth.jwt).rpc("project_money_line_add", {
    p_project_id: c.req.param("id"), p_kind: d.kind, p_category: d.category, p_description: d.description,
    p_amount: d.amount, p_occurred_at: d.occurredAt ?? null,
  });
  if (error) return fail(c, error);
  return c.json({ id: data }, 201);
});

router.delete("/lines/:lineId", requireFinance, async (c) => {
  const { error } = await userClient(c.env, c.var.auth.jwt).rpc("project_money_line_archive", { p_line_id: c.req.param("lineId") });
  if (error) return fail(c, error);
  return c.json({ ok: true });
});

router.put("/:id/total-sales", requireFinance, async (c) => {
  const body = await parseJsonBody(c, projectTotalSalesInput);
  if (!body.ok) return c.json(body.body, body.status);
  const { error } = await userClient(c.env, c.var.auth.jwt).rpc("project_total_sales_set", {
    p_project_id: c.req.param("id"), p_total: body.data.totalSales,
  });
  if (error) return fail(c, error);
  return c.json({ ok: true });
});

export default router;
