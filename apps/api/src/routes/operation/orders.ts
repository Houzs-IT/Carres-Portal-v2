import { Hono } from "hono";
import { bodyTouchesDeliveryDate, salesOrderWorkCompletion } from "../../lib/sales-order-work-completion";
import { actorKindOf, resolveActorIdentities, resolveActorNames, type ActorIdentity } from "../../lib/actor-names";
import { restampStairCarry, touchesStairInputs } from "../../lib/stair-carry-restamp";
import { z } from "zod";
import { ListOperationOrdersQuery, MAX_DELIVERY_FLOOR, reselectPartnerInput, resolveCurrentCustomerCommitment, salesOrderNumberWord, salesOrderParamOf, type PoArrival as OrderPoArrival, type PoArrivalReply as OrderPoArrivalReply, type AllocatedUnit as OrderAllocatedUnit, type CommitmentBundle, normalizeSkuKey, exclusivePoSourceBindings, type IncomingLineUnit, phoneKeysMy } from "@carres/shared";
import { findSalesOrderDocuments } from "../../lib/sales-order-document-search";
import { findOrdersByPhone, phoneSearchDigits } from "../../lib/sales-order-phone-search";
import { requireOperation, requireOperationOrPrincipal } from "../../lib/auth-guards";
import { mapPgError, parseJsonBody, refusalMessage } from "../../lib/route-helpers";
import { userClient } from "../../lib/supabase";
import { todayIsoMYT } from "../../lib/today";

import { skuCategories, storageSkuCategories } from "../../lib/sku-categories";
import { chunk } from "../../lib/purchase-demand-read";
import { outrightOrderFacts, type OutrightOrderFacts, type OutrightOrderInput } from "../../lib/outright-order-facts";
import {
  completionOfOrder,
  type CompletionOrderRow,
  type CompletionReads,
  type CompletionUnitRow,
} from "../../lib/order-completion";
import type { AppEnv } from "../../types";

/**
 * /api/operation/orders — Phase 4 backend orders subsystem.
 *
 * M2 endpoints (list + drawer + actions):
 *   GET    /                       — list with stage/channel/search filters
 *   GET    /:id                    — drawer detail
 *   POST   /:id/assign-partner     — D1 dispatch step 1
 *   POST   /:id/attach-do          — D1 dispatch step 2 (operation_attach_do_and_deliver)
 *   POST   /:id/abandon            — A6 post-proceed cancel
 *   POST   /:id/warehouse          — warehouse pick
 *   POST   /:id/recheck-stock      — E1 re-check stock
 *
 * M4 endpoint:
 *   GET    /:id/print-do           — server-side DO PDF (E2 / spec §17.3)
 *
 * Auth: every route guards with `requireOperation` per-route — NOT a blanket
 * `use("*", ...)` middleware. The blanket pattern leaks across sibling sub-
 * routers mounted at the same path (`resumeDispatchRouter`) and silently
 * 403's traffic the sibling intends to admit (principal). See
 * `lib/auth-guards.ts` docstring + carry-forward
 * `phase-4.5-chunk-2-route-mount-middleware-leak` for the full rationale.
 *
 * Pattern: matches apps/api/src/routes/principal/dealers.ts (multi-endpoint
 * router with per-route role guard + shared mapPgError/parseJsonBody from
 * lib/route-helpers).
 */
const operationOrdersRouter = new Hono<AppEnv>();

/**
 * Pipeline v2 error mapping. Wraps the generic `mapPgError` to expose the
 * 22023 detail code (`wrong_stage` / `warehouse_required`) and, for P0001
 * `insufficient_stock_for_reserve`, pass through the RPC's `hint`
 * ("sku=… warehouse_id=…") so the UI can name the offending pair.
 *
 * The default `mapPgError` collapses 22023 to a generic `invalid_param`
 * code; pipeline v2 contracts (spec §5, migration 0024:354-414) require the
 * actual detail value to surface so the FE can branch on it.
 */
function mapPipelineV2Error(error: { code?: string; message?: string; details?: string; hint?: string }) {
  if (error.code === "22023") {
    return {
      status: 422 as const,
      body: {
        error: "rule_violation",
        code: error.details ?? "invalid_param",
        message: refusalMessage(error) ?? "rule violation",
      },
    };
  }
  if (error.code === "P0001" && error.details === "insufficient_stock_for_reserve") {
    return {
      status: 422 as const,
      body: {
        error: "rule_violation",
        code: error.details,
        message: error.message ?? "insufficient stock to reserve",
        hint: error.hint ?? null,
      },
    };
  }
  return mapPgError(error);
}

/**
 * sku → `Model · Variant`, the ONE human-readable product name in this module.
 *
 * **Extracted by STAGE 1, not written by it.** The detail route has resolved
 * exactly this since 2026-07-16 so the drawer's Items table could show names
 * instead of raw codes; the Sales Orders register needs the same names on the
 * ROW, and the alternative was a second sku→name implementation in the
 * browser. `ERP-ARCHITECTURE.md` Law D: *"If two surfaces must agree on a
 * number they call ONE function — not two implementations that currently
 * agree."* A product name is that kind of fact, so the list and the document
 * call this.
 *
 * The query, the join and the `model · variant` spelling are byte-identical to
 * what the detail route already ran. `order_lines.sku` has no FK to
 * `product_skus`, so this is a separate batched query (`ONE .in("sku", […])`
 * per page), never a PostgREST embed and never one query per order.
 *
 * **A miss is normal and must stay silent.** Measured on production
 * 2026-08-09: of 84 distinct SKUs on live orders only 37 are in the catalog —
 * every NATIVE line resolves, and every AutoCount line misses because an
 * imported "sku" IS free text like `1013Jager/Fab3-King/PC151-01`. There is no
 * name to find, so the caller falls back to that text: it is what the
 * salesperson actually wrote on the order.
 */
async function resolveSkuLabels(
  sb: ReturnType<typeof userClient>,
  skus: readonly (string | null | undefined)[],
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const wanted = [...new Set(skus.filter((s): s is string => !!s))];
  if (wanted.length === 0) return out;
  const { data, error } = await sb
    .from("product_skus")
    .select("sku, variant, product_models(name)")
    .in("sku", wanted);
  if (error) throw error;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const r of (data ?? []) as any[]) {
    const label = [r.product_models?.name ?? "", r.variant ?? ""]
      .filter(Boolean)
      .join(" · ");
    if (label) out[r.sku] = label;
  }
  return out;
}

// ----- GET / list -----
/* ⭐ ONE POPULATION, ONE PREDICATE — owner ruling 2026-09-26 (Orders MASTER
   §0.1 REGISTER CLOSE-OUT item 4). The Sales Orders Register is every
   non-cancelled order Sales has handed to Operation, rentals excluded. It is
   defined HERE, once, and both reads the Register makes — its rows and its
   total — call it, so `{n} of {m}` can never count two different sets.

   Rentals are recognised by the same fact the Register's browser test reads
   (`source_system === "rental"`, `isRental` in sales-order-facts.ts); a NULL
   `source_system` is a native order and stays. The list is shared with
   Delivery, Work, Payments, the dashboard and the old Orders control: this
   predicate rides only `?stage=proceeded`, the parameter the Register sends,
   so what every other caller receives is unchanged. */
const SALES_ORDER_REGISTER_EXCLUDED_STATUSES = "(place,cancelled)";
const SALES_ORDER_REGISTER_NOT_RENTAL = "source_system.is.null,source_system.neq.rental";
export function salesOrderRegisterPopulation<
  Q extends { not(column: string, operator: string, value: string): Q; or(filters: string): Q },
>(q: Q): Q {
  return q
    .not("status", "in", SALES_ORDER_REGISTER_EXCLUDED_STATUSES)
    .or(SALES_ORDER_REGISTER_NOT_RENTAL);
}

/** One page of the Sales Orders Register's paged read — the same size the
 *  one-answer read has always stopped at, so a page spends no more of the
 *  Worker's subrequest budget on its enrichment than that read already does. */
const REGISTER_PAGE = 500;
/* `<placed_at as PostgREST printed it>|<order id>`. Only digits, `T`, `:`,
   `.`, `+`, `-`, `Z` and a uuid may pass, so a cursor can never carry a
   filter into the or() it is spliced into. */
const REGISTER_PAGE_CURSOR =
  /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}(?::?\d{2}){0,2})?)\|([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
function registerPageCursorOf(raw: string): { placedAt: string; id: string } | null {
  const m = REGISTER_PAGE_CURSOR.exec(raw);
  return m ? { placedAt: m[1]!, id: m[2]! } : null;
}
/** The cursor after a page: its last row, or `null` when the page was short. */
function registerPageCursorAfter(page: ReadonlyArray<{ id?: string; placed_at?: string | null }>): string | null {
  if (page.length < REGISTER_PAGE) return null;
  const last = page[page.length - 1];
  const cursor = last?.placed_at && last.id ? `${last.placed_at}|${last.id}` : null;
  /* A row whose own facts would not make a valid cursor cannot be paged past;
     failing loudly beats a list that silently stops at it. */
  if (!cursor || !registerPageCursorOf(cursor)) throw new Error("register page cursor unreadable");
  return cursor;
}

operationOrdersRouter.get("/", requireOperation, async (c) => {
  const parsed = ListOperationOrdersQuery.safeParse({
    stage: c.req.query("stage") ?? undefined,
    channel: c.req.query("channel") ?? undefined,
    search: c.req.query("search") ?? undefined,
  });
  if (!parsed.success) {
    return c.json(
      { error: "invalid_query", code: "invalid_param", message: parsed.error.issues[0]?.message ?? "invalid query" },
      422,
    );
  }
  const { stage, channel, search } = parsed.data;
  // 0584 · ONE ORDER, THE SAME ROW. The Work completion probe reads exactly
  // what this list reads — the select AND every enrichment below (po_skus,
  // arrivals, units) — for a single order, so "was it open" has one answer.
  const onlyOrderId = c.req.query("orderId") ?? null;
  if (onlyOrderId !== null && !/^[0-9a-f-]{36}$/i.test(onlyOrderId)) {
    return c.json({ error: "invalid_query", code: "invalid_param", message: "orderId must be an order id" }, 422);
  }
  /* ⭐ `count=only` — HOW MANY ROWS THIS LIST WOULD ANSWER, AND NOTHING ELSE
     (SO BUILD-1c, 2026-10-06). The Sales Order page's `Existing customer ·
     {n} orders ›` opens this list searched by the phone, so `n` is counted
     HERE: the same `listScope`, the same search clauses, the same caller's
     RLS — one head-only exact count instead of the rows (Law D: the number
     and the door can never count two different sets). */
  const countParam = c.req.query("count") ?? null;
  if (countParam !== null && countParam !== "only") {
    return c.json({ error: "invalid_query", code: "invalid_param", message: "count must be only" }, 422);
  }
  const countOnly = countParam === "only";
  /* ⭐ `paged=1` — THE REGISTER'S WHOLE POPULATION, ONE PAGE AT A TIME (SO A3-3,
     2026-10-06, Orders MASTER §0.0 "Register, filters, reports and exports").
     The same scope, search and caller as the one-answer read below, read in
     pages of REGISTER_PAGE ordered by `placed_at` desc, then `id` desc — a
     unique tiebreaker, so orders sharing one `placed_at` can never fall
     between two pages. `after` is the last row of the previous page (its
     `nextCursor`): a keyset, so an order placed or cancelled while the pages
     load moves no other order. Without `paged` nothing below changes — every
     other caller keeps its newest-500 answer. */
  const pagedParam = c.req.query("paged") ?? null;
  if (pagedParam !== null && pagedParam !== "1") {
    return c.json({ error: "invalid_query", code: "invalid_param", message: "paged must be 1" }, 422);
  }
  const paged = pagedParam === "1";
  const afterParam = c.req.query("after") ?? null;
  const after = afterParam === null ? null : registerPageCursorOf(afterParam);
  if (afterParam !== null && (!paged || after === null)) {
    return c.json({ error: "invalid_query", code: "invalid_param", message: "after must be the nextCursor of a paged read" }, 422);
  }

  const sb = userClient(c.env, c.var.auth.jwt);
  // Phase 4.5 Chunk 2 (T9): customer-leg LP fields now live on
  // `order_supplier_threads` (migration 0049 added the columns; 0050 backfilled
  // them from PO). FE OrderCard reads `threads[].delivery_partner_id` instead
  // of order-level `delivery_partner_id` to surface the LP pill. Embedding via
  // PostgREST nested fetch keeps the round-trip count at 1; threads come back
  // as an array per order. The order-level `delivery_partner_id` is kept for
  // print-DO + legacy callers (no change here).
  let q = sb
    .from("orders")
    .select(
      // Migration 0147 (item h, 2026-05-23) — surface the order-level LP
      // request/accept/reject state so the kanban can show a red "LP
      // rejected" badge + the FE can open a reselect dialog. These mirror
      // the per-thread fields on order_supplier_threads but at the order
      // level (customer-leg LP is one per order).
      //
      // The `!orders_delivery_partner_id_fkey` hint on the order-level
      // delivery_partners embed is REQUIRED, not optional: `orders` has TWO
      // FKs to delivery_partners (delivery_partner_id + ops_assigned_logistic,
      // the latter added by migration 0136). A bare `delivery_partners(...)`
      // embed is ambiguous → PostgREST PGRST201 → mapPgError default → 500.
      // Do NOT remove the hint. Same rule for every order-level embed of
      // delivery_partners (print-do-data below + partner/pickups.ts).
      // 2026-06-08 (Jess redesign step 2) — the Orders **control table**
      // (OperationOrdersControl) consumes this same list. It needs a few extra
      // flat columns the kanban OrderCard never used: customer_phone (row
      // subtitle), delivery_date_tbd (交期 cell), source_system + source_ref
      // (CR/TCF/SO ref prefix + the AutoCount→Proceed / native→Placed tab
      // entry rule), ops_assigned_logistic (Inbox-triage LP shown in the 物流
      // cell when no formal LP yet), and a compact order_lines(sku,qty) embed
      // for the 货品 items summary. All additive — the kanban ignores them.
      // ops_assigned_logistic stays a raw id here (resolved to a name client
      // side via the partners list) to avoid a 2nd ambiguous delivery_partners
      // FK embed (orders has two FKs to delivery_partners → PGRST201/500).
      // 2026-06-09 (Jess P2, project-orders-control-spec) — customer_address
      // added so the control table can tag each row KV / Outstation + suggest a
      // default carrier (apps/web/src/lib/region.ts) without opening the drawer.
      // 2026-07-26 (T1, delivery-execution-queue) — booking_stage +
      // confirmed_date + confirmed_time_slot (0277 two-stage booking) so the
      // list's Delivery column + queues can tell the customer's confirmed
      // booking apart from the carrier's provisional date.
      // 2026-07-27 (T7, delivery-execution-queue) — delivery_photos (0280) so
      // the "Upload delivery photo" queue can count delivered orders with no
      // proof attached. Only the LEDGER rides the list (paths, not URLs — a
      // signed view URL is minted per click in the drawer).
      // 2026-07-27 (T11, delivery-execution-queue) — booking_groups (0282) so
      // the Delivery module's detail pane can name what THIS trip carries and
      // what is still owed on a second trip. NULL = the whole order, exactly as
      // 2026-07-27 (C5, portal-core-execution-queue) — `paid` + per-line
      // `unit_price` + the `order_addons` sum, so the list can compute what an
      // order still owes from the ONE money truth (`orders.paid`) through the
      // shared `orderMoney`. The ladder's 🔒 used to read
      // `ops_order_control.balance`, which is NULL on every live row, so the
      // money hold had never once fired.
      // 2026-08-09 (STAGE 1) — the Sales Orders register's fact columns.
      // `salesperson_id` + the two NAME embeds (both FKs are SINGLE —
      // `orders_salesperson_id_fkey`, `orders_outlet_id_fkey` — so a bare
      // embed is unambiguous, unlike delivery_partners). Then every flat fact
      // the customer order itself owns that was not yet on the wire:
      // `channel`, `customer_email`, the five structured address parts (0230),
      // `building_type` (the Sales Portal writes it into the order's own
      // `entry_data.fields`), `delivery_floor` / `delivery_has_lift`,
      // `customer_billing` / `customer_emergency`, `invoice_no` /
      // `invoiced_at`, `payment_method` and `installment_months`. Nothing here
      // is another module's record, nothing is computed. Purely additive: the
      // old control table selects none of these and is unaffected.
      // 2026-08-21 (DELIVERY CARD 02) — `delivery_stops` (0156). Delivery Work
      // draws one row per JOURNEY LEG, and a leg's partner, planned day and
      // result live only in that jsonb. Without it on the wire a KL→JB→Singapore
      // order reads as one trip on the planning screen, which is the one thing
      // the two-leg model exists to prevent. NULL / a single stop still means
      // single-leg, exactly as it did before.
      // 2026-08-24 (POS PARITY) - customer_race / customer_gender /
      // customer_birthday (0200) + delivery_stair_items (0104): the POS asks
      // for them at SO creation and the DETAIL route already serves them; the
      // register could not show a column for a fact its list never carried.
      // Four scalar columns on the SAME single read - no extra subrequest,
      // no new access (operation already reads them on GET /:id).
      //
      // 2026-09-02 (D4) - `ops_delivery_orders(do_number)`: the SO register's
      // DO No column used to cross-join the DELIVERY REGISTER, and that read is
      // `.order("issued_at", desc).limit(500)`. An order whose delivery order
      // fell outside the newest 500 got an empty array, and the cell printed the
      // POSITIVE claim "No delivery order yet" - a register stating as fact
      // something it had only failed to look far enough to see. Past 500 DOs it
      // gets quietly wrong rather than visibly empty, which is the same shape as
      // `claims-facet-counts-a-truncated-page` in carry-forwards.md; that entry
      // rules the fix is server-side in the call that already produces the fact,
      // and explicitly NOT "raise the limit", which only moves the number at
      // which it starts lying. An EMBED, not a second query: PostgREST resolves
      // it inside this same request, so the Worker spends no extra subrequest,
      // and each order carries its own delivery orders with no cap to fall out
      // of. Voided DOs are NOT filtered here - the delivery register does not
      // filter them either, and this column must not start counting differently
      // from the surface it links to.
      //
      // 2026-10-06 (Hold delivery, Delivery MASTER §3) - `reason` joins
      // `order_finance_exceptions(status)`: Monitor's `Payment` cell prints
      // `Finance hold · {reason}` under `Hold delivery` for Operation. One more
      // column on the SAME embed; internal readers only (0355's read policy).
      "id, so, status, operation_stage, warehouse_id, customer_name, customer_phone, customer_address, customer_email, customer_billing, customer_billing_same, customer_emergency, customer_address_line1, customer_address_line2, customer_address_city, customer_address_state, customer_address_postcode, building_type:entry_data->fields->>building_type, customer_race, customer_gender, customer_birthday, delivery_floor, delivery_has_lift, delivery_stair_items, channel, placed_at, proceeded_at, delivery_date, delivery_date_tbd, proceed_date, source_system, source_ref, ops_assigned_logistic, delivery_partner_id, delivery_stops, request_for_delivery_at, partner_accepted_at, partner_rejected_at, partner_rejected_reason, do_number, do_file_path, do_uploaded_at, invoice_no, invoiced_at, payment_method, installment_months, dispatched_at, delivered_at, outlet_id, salesperson_id, dealer_id, paid, credited, original_request:sales_order_revisions(revision,snapshot), dealers(name), outlets(name), salespersons(name), delivery_partners!orders_delivery_partner_id_fkey(id, name), order_lines(id, sku, qty, unit_price, attrs, source_po), order_addons(addon_key, qty, unit_price), ops_delivery_orders(do_number,leg,delivery_date,time_slot,voided_at), ops_delivery_arrangements(leg,partner_id,confirmed_date,confirmed_time), invoice_documents:invoices(id,invoice_no), receipt_documents:order_payments(id,receipt_no), allocated_receipts:payment_allocations(order_payments(id,receipt_no)), amendment_documents:sales_order_amendments(id,status), order_supplier_threads(id, supplier_id, category, operation_stage, po_id, delivery_partner_id, delivery_partners(id, name), confirm_delivery_date, request_for_delivery_at, partner_accepted_at, partner_rejected_at, purchase_orders(placed_at)), order_finance_exceptions(status, reason), order_delivery_payment_approvals(status), ops_sofa_loans(status, item_id, loan_note_no, ops_stock_items(unit_code, identity_scope)), order_annotations(content, tag, created_at), first_history:order_history(by_user_id, occurred_at, metadata), ops_order_control(line_received, customer_request, action_for_logistic, carres_remark, warehouse_remark, logistic_eta, balance, payment_status, storage_from, storage_fee_override, storage_fee_msbf, storage_fee_sof, storage_paid, storage_collected_at, storage_waiver_status, called_customer, line_etas, line_stock_status, assigned_staff, booking_stage, confirmed_date, confirmed_time_slot, delivery_photos, booking_groups, delay_decision, delay_decision_eta, delay_decision_at, delay_detected_at, delay_detected_eta)",
    )
    .eq("original_request.revision", 1)
    /* Created by is the actor on the order's first history row, stamped by
       0387. Revision 1 is not used: not every order has one. Same request. */
    .order("occurred_at", { ascending: true, referencedTable: "first_history" })
    .limit(1, { referencedTable: "first_history" });

  /* The list's scope — stage, the one order, channel — applied by ONE
     function, so the phone read below asks exactly the population the rows
     come from and can never drift from it. */
  const listScope = <Q,>(query: Q): Q => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let s = query as any;
    if (stage === "proceeded") {
      // The Sales Orders Register's population — the ONE predicate its total
      // below is counted with (salesOrderRegisterPopulation).
      s = salesOrderRegisterPopulation(s);
    } else {
      // Pipeline v2 (C3): include `status='place'` rows so the FE kanban can
      // render the "Placed" column. proceed_order + delivered preserved as
      // before; existing M2 tests still pass.
      s = s.in("status", ["place", "proceed_order", "delivered"]);
      if (stage === "placed") {
        // 'placed' is a synthetic stage derived from `status='place'` (pre-push
        // orders may have NULL operation_stage or 'placed' depending on whether
        // they were seeded post-0024). Filter on status, not stage.
        s = s.eq("status", "place");
      } else if (stage !== "all") {
        s = s.eq("operation_stage", stage);
      }
    }
    // Public 'channel' enum kept as 'dealers'|'showrooms' per spec §18.3 (Loo-facing wording).
    // Internally maps to outlet_id IS [NOT] NULL — schema column is outlet_id, not showroom_id.
    if (onlyOrderId) s = s.eq("id", onlyOrderId);
    if (channel === "dealers") s = s.is("outlet_id", null);
    if (channel === "showrooms") s = s.not("outlet_id", "is", null);
    return s as Q;
  };
  q = listScope(q);
  /* The search's one or() filter — built once, applied to the rows below and,
     for `count=only`, to the count. */
  let searchFilter: string | null = null;
  if (search) {
    // Match customer name (ILIKE), the SO number (digits or displayed SO- prefix), AND
    // each imported invoice number. A combined Ref is tokenised into
    // source_ref[] (normalizeRefs), so an exact contains-match makes searching
    // any single invoice — e.g. "CR0854" — find the combined order too (alias).
    // The ref term is sanitised to invoice chars [A-Z0-9/-] so it can't break
    // the PostgREST or()/cs.{} grammar.
    //
    // The name term is the operator's own text. A `,` `(` `)` `"` or `\` in it
    // would end the or() value early — `(03) 1234 5678` failed the whole search
    // — so such a term is double-quoted (PostgREST's reserved-character rule);
    // a plain name rides exactly as before.
    const nameTerm = /[,()"\\]/.test(search)
      ? `"%${search.replace(/[\\"]/g, (ch) => `\\${ch}`)}%"`
      : `%${search}%`;
    const clauses = [`customer_name.ilike.${nameTerm}`];
    const refTerm = search.toUpperCase().replace(/[^A-Z0-9/-]/g, "");
    if (refTerm) clauses.push(`source_ref.cs.{${refTerm}}`);
    if (refTerm) {
      clauses.push(`invoice_no.ilike.%${refTerm}%`, `do_number.ilike.%${refTerm}%`);
      try {
        const linked = await findSalesOrderDocuments(sb, refTerm);
        if (linked.orderIds.length) clauses.push(`id.in.(${linked.orderIds.join(",")})`);
        if (linked.soNumbers.length) clauses.push(`so.in.(${linked.soNumbers.join(",")})`);
      } catch (documentError) {
        const mapped = mapPgError(documentError as { code?: string; message?: string });
        return c.json(mapped.body, mapped.status);
      }
    }
    /* A PHONE typed any way — `019-0000 0075`, `(019) 00000075`,
       `+6019 00000075` — finds the orders whose phone carries those digits.
       The read is the caller's RLS over the list's own scope; the Worker
       decides the match on digits (sales-order-phone-search.ts). A failed
       read fails the search, exactly like the document read above: an
       unread phone is not "no order". */
    const phoneDigits = phoneSearchDigits(search);
    if (phoneDigits) {
      try {
        const phoneOrderIds = await findOrdersByPhone(
          (pattern, from, to) =>
            listScope(sb.from("orders").select("id, customer_phone"))
              .ilike("customer_phone", pattern)
              .order("id", { ascending: true })
              .range(from, to),
          phoneDigits,
        );
        if (phoneOrderIds.length) clauses.push(`id.in.(${phoneOrderIds.join(",")})`);
      } catch (phoneError) {
        const mapped = mapPgError(phoneError as { code?: string; message?: string });
        return c.json(mapped.body, mapped.status);
      }
    }

    const soTerm = /^(?:SO[-\s]?)?(\d+)$/i.exec(search.trim());
    const asInt = soTerm ? Number(soTerm[1]) : NaN;
    if (Number.isSafeInteger(asInt)) clauses.push(`so.eq.${asInt}`);
    searchFilter = clauses.join(",");
    q = q.or(searchFilter);
  }

  if (countOnly) {
    let countQ = listScope(sb.from("orders").select("id", { count: "exact", head: true }));
    if (searchFilter) countQ = countQ.or(searchFilter);
    const { count, error: countError } = await countQ;
    if (countError) {
      const m = mapPgError(countError);
      return c.json(m.body, m.status);
    }
    /* No number is never answered as zero — the page then shows no count. */
    if (typeof count !== "number") {
      return c.json({ error: "count_unavailable", code: "count_unavailable", message: "Sales orders could not be counted." }, 500);
    }
    return c.json({ count });
  }

  if (paged) {
    /* The keyset: strictly after the previous page's last row in
       (placed_at desc, id desc). Both values were validated by
       `registerPageCursorOf`, and the timestamp is quoted for the or() grammar. */
    if (after) {
      q = q.or(`placed_at.lt."${after.placedAt}",and(placed_at.eq."${after.placedAt}",id.lt.${after.id})`);
    }
    q = q.order("placed_at", { ascending: false }).order("id", { ascending: false }).limit(REGISTER_PAGE);
  } else {
    // STAGE 1 FIX 1 — the 200-row trap removed; the agreed cap is 500. Server
    // search (`?search=`, above) is what makes the cap safe: a match beyond the
    // first page is FOUND by asking, never scrolled for. (The Sales Orders
    // Register no longer reads this answer — it pages, above.)
    q = q.order("placed_at", { ascending: false }).limit(500);
  }

  /* ⭐ THE REGISTER'S TOTAL IS A COUNT, NEVER THE ROWS IT HAPPENED TO LOAD
     (Listing Standard follow-up, 2026-09-17). `{n} of {m} sales orders` needs
     `m` = every Sales Order the caller may read in this stage/channel scope —
     rentals excluded, the Register's own path through the SAME predicate as
     its rows (salesOrderRegisterPopulation), and the SEARCH
     NOT applied, so a search answered first still has its denominator. The
     list above stops at 500 rows and a search replaces the rows, so neither
     `rows.length` nor a remembered number is the total. Same RLS client, one
     head-only exact count. A failed count is `null` (unknown) — the page then
     prints no `of` rather than guess. */
  let totalQ = sb
    .from("orders")
    .select("id", { count: "exact", head: true });
  if (stage === "proceeded") {
    totalQ = salesOrderRegisterPopulation(totalQ);
  } else {
    totalQ = totalQ
      .in("status", ["place", "proceed_order", "delivered"])
      .or("source_system.is.null,source_system.neq.rental");
    if (stage === "placed") totalQ = totalQ.eq("status", "place");
    else if (stage !== "all") totalQ = totalQ.eq("operation_stage", stage);
  }
  if (channel === "dealers") totalQ = totalQ.is("outlet_id", null);
  if (channel === "showrooms") totalQ = totalQ.not("outlet_id", "is", null);

  /* A paged read counts once, on its first page; a later page's caller
     already holds the total, so it spends no second count. */
  const [{ data, error }, totalRes] = await Promise.all([q, after ? Promise.resolve(null) : totalQ]);
  const salesOrderTotal =
    totalRes && !totalRes.error && typeof totalRes.count === "number" ? totalRes.count : null;
  if (error) {
    const m = mapPgError(error);
    return c.json(m.body, m.status);
  }

  // ── D1 · THE LIST CAN SEE A PURCHASE ORDER ─────────────────────────────────
  // The Orders ladder asks "has anything been ordered?" and, until this block,
  // the only evidence on the wire was `order_lines.source_po` — a column ONLY
  // the AutoCount importer writes. `order_supplier_threads.po_id` was selected
  // and is dead weight: that table holds ZERO rows.
  //
  // MEASURED on production 2026-08-06, which is why this is a defect and not a
  // nicety: of 28 live orders, 19 are covered by a REAL purchase order and 0
  // carry `source_po`. Four of them — SO-1206 · SO-1213 · SO-1216 · SO-1257 —
  // showed a red "no PO raised yet" dot and an `Issue PO` instruction over
  // goods Purchasing had already bought.
  //
  // The link is the DRAWER'S OWN, not a new one: a PO serves an order through
  // `so` or through `so_refs[]` (see the detail route below, which has used
  // exactly this pair since it was written). Batched into ONE `or` over the
  // page's SO numbers, plus one line fetch — two round trips for the whole
  // list, never one per order.
  //
  // What rides the wire is `po_skus`: the DISTINCT SKUs a purchase order covers
  // for that order. That is the smallest thing that answers the ladder's
  // question, and it is the same shape the drawer already builds (`poSkus`).
  // A page with no covered orders adds `[]` to every row and nothing else.
  const orders = data ?? [];

  // ── STAGE 1 · THE ROW SAYS WHAT THEY BOUGHT, IN WORDS ─────────────────────
  // The register's `Items` column may not print a SKU code. The detail route
  // has resolved `Model · Variant` since 2026-07-16 and now both call
  // `resolveSkuLabels`, so a product cannot be named one way on the row and
  // another way in the document (Law D).
  //
  // ONE extra query for the whole page (every line SKU on it, de-duplicated),
  // never one per order — the same batching rule the PO block below follows.
  // A SKU with no catalog row simply gets no label and the caller falls back
  // to the text the order carries.
  try {
    const labelBySku = await resolveSkuLabels(
      sb,
      orders.flatMap((o: { order_lines?: { sku?: string | null }[] | null }) =>
        (o.order_lines ?? []).map((l) => l.sku),
      ),
    );
    // 2026-08-24 (OTHER GOODS TALLY) - the register footer classified a line
    // from its SKU TEXT ALONE while the SO detail read the catalog first, so
    // the same product counted as `Mattress` on the document and `Other goods`
    // in the footer - a tally the operator trusts and cannot reproduce. Stamp
    // the catalog category onto every list line the same way the DETAIL route
    // has since PR 885, through the same one owner: `skuCategories` is the ONE
    // category reader (Law D - the detail route's own comment explicitly
    // REJECTED folding this into `resolveSkuLabels`, and one batched
    // subrequest per page is the documented price of one owner). Fails OPEN:
    // an outage returns an empty map, category reads null, and the browser
    // falls back to the SKU parser exactly as it did before this line existed.
    const categoryBySku = await skuCategories(
      sb,
      orders.flatMap((o: { order_lines?: { sku?: string | null }[] | null }) =>
        (o.order_lines ?? []).map((l) => l.sku).filter((s): s is string => !!s),
      ),
    );
    for (const o of orders as { order_lines?: ({ sku?: string | null } & Record<string, unknown>)[] | null }[]) {
      for (const l of o.order_lines ?? []) {
        (l as Record<string, unknown>).label = l.sku ? (labelBySku[l.sku] ?? null) : null;
        (l as Record<string, unknown>).category = l.sku ? (categoryBySku.get(l.sku) ?? null) : null;
      }
    }
  } catch (e_label) {
    const m = mapPgError(e_label as { code?: string; message?: string });
    return c.json(m.body, m.status);
  }
  const soNumbers = [
    ...new Set(
      orders
        .map((o: { so?: number | null }) => o.so)
        .filter((s): s is number => typeof s === "number" && Number.isFinite(s)),
    ),
  ];
  const poSkusBySo = new Map<number, Set<string>>();
  const poNumbersBySo = new Map<number, Set<string>>();
  /* DELIVERY MONITOR (2026-09-11) — one entry per purchase order serving this
     sales order, carrying only RECORDED dates. `plannedIso` is our own
     production-days prediction, `originalIso` the immutable date the
     supplier was given, `reply` the latest recorded supplier answer. The
     browser decides what that means; this route never says "delayed". */
  const poArrivalsBySo = new Map<number, OrderPoArrival[]>();
  const openArrivalPoIds = new Set<string>();
  if (soNumbers.length > 0) {
    const inList = soNumbers.join(",");
    const { data: pos, error: e_pos } = await sb
      .from("purchase_orders")
      // DELIVERY MONITOR (2026-09-11) — the ARRIVAL facts the delivery work
      // list needs, and no derived word: the PO's own status, OUR
      // production-days prediction (`eta_date` — `expectedArrivalOf`'s
      // persisted result) and the immutable original the supplier was actually
      // given (`official_delivery_date`, 0428). The latest supplier REPLY is
      // read below. Nothing is CLASSIFIED here: the states and their words
      // belong to ONE shared module the browser reads (Law D).
      .select("id, so, so_refs, status, eta_date, official_delivery_date")
      .or(`so.in.(${inList}),so_refs.ov.{${inList}}`);
    if (e_pos) {
      const m = mapPgError(e_pos);
      return c.json(m.body, m.status);
    }
    const poRows = pos ?? [];
    for (const po of poRows) if (po.status === "open") openArrivalPoIds.add(po.id);
    if (poRows.length > 0) {
      const { data: poLines, error: e_lines } = await sb
        .from("purchase_order_lines")
        /* `qty`/`received_qty` say whether the PO still OWES units: a fully
           received purchase order has no arrival left to report, and an
           arrival date on one would be history dressed as a plan. */
        .select("po_id, sku, qty, received_qty")
        .in(
          "po_id",
          poRows.map((p: { id: string }) => p.id),
        );
      if (e_lines) {
        const m = mapPgError(e_lines);
        return c.json(m.body, m.status);
      }
      const skusByPo = new Map<string, string[]>();
      /* The SKUs this PO still owes — the only ones an arrival date is about. */
      const owedSkusByPo = new Map<string, Set<string>>();
      for (const l of poLines ?? []) {
        const row = l as {
          po_id: string;
          sku: string | null;
          qty?: number | null;
          received_qty?: number | null;
        };
        if (!row.sku) continue;
        const arr = skusByPo.get(row.po_id);
        if (arr) arr.push(row.sku);
        else skusByPo.set(row.po_id, [row.sku]);
        if (Number(row.qty ?? 0) > Number(row.received_qty ?? 0)) {
          const owed = owedSkusByPo.get(row.po_id) ?? new Set<string>();
          owed.add(row.sku);
          owedSkusByPo.set(row.po_id, owed);
        }
      }

      /* ── THE LATEST SUPPLIER REPLY, PER PURCHASE ORDER ────────────────────
         `po_supplier_promises` is append-only and has no "latest" an embed
         could traverse, so it is read the same way the Purchase Orders
         register reads it: one chunked query, newest first, first row wins.
         Only `tomorrow_delivery` — the answer about the ARRIVAL date. A
         per-line balance promise belongs to Purchasing's own screen. */
      const latestReplyByPo = new Map<string, OrderPoArrivalReply>();
      /* A purchase order id is a short document number, so the batch is sized
       * for the WORKER's subrequest budget rather than for URL length — a
       * 500-row page must not spend dozens of round trips on one column. */
      for (const batch of chunk(poRows.map((p: { id: string }) => p.id), 100)) {
        const { data: promises, error: e_promise } = await sb
          .from("po_supplier_promises")
          .select("po_id, answer, about_date, previous_date, new_date, recorded_at")
          .eq("kind", "tomorrow_delivery")
          .in("po_id", batch)
          .order("recorded_at", { ascending: false });
        if (e_promise) {
          const m = mapPgError(e_promise);
          return c.json(m.body, m.status);
        }
        for (const p of promises ?? []) {
          const row = p as {
            po_id: string;
            answer: string;
            about_date: string | null;
            previous_date: string | null;
            new_date: string | null;
            recorded_at: string;
          };
          if (latestReplyByPo.has(row.po_id)) continue;
          latestReplyByPo.set(row.po_id, {
            answer: row.answer,
            aboutIso: row.about_date,
            previousIso: row.previous_date,
            newIso: row.new_date,
            recordedAt: row.recorded_at,
          });
        }
      }
      for (const p of poRows) {
        const po = p as {
          id: string;
          so: number | null;
          so_refs: number[] | null;
          status?: string | null;
          eta_date?: string | null;
          official_delivery_date?: string | null;
        };
        const skus = skusByPo.get(po.id) ?? [];
        // Document lineage does not disappear when goods metadata is missing.
        const documentSources = new Set<number>(po.so_refs ?? []);
        if (typeof po.so === "number") documentSources.add(po.so);
        for (const so of documentSources) {
          const numbers = poNumbersBySo.get(so) ?? new Set<string>();
          numbers.add(po.id);
          poNumbersBySo.set(so, numbers);
        }
        if (skus.length === 0) continue;
        // ONE purchase order may serve several sales orders (the consolidated
        // PO is the normal case here), so every SO it names gets the same set.
        const served = new Set<number>();
        if (typeof po.so === "number") served.add(po.so);
        for (const r of po.so_refs ?? []) served.add(r);
        for (const so of served) {
          const numbers = poNumbersBySo.get(so) ?? new Set<string>();
          numbers.add(po.id);
          poNumbersBySo.set(so, numbers);
          const set = poSkusBySo.get(so) ?? new Set<string>();
          for (const s of skus) set.add(s);
          poSkusBySo.set(so, set);
          const arrivals = poArrivalsBySo.get(so) ?? [];
          arrivals.push({
            poId: po.id,
            status: po.status ?? null,
            owedSkus: [...(owedSkusByPo.get(po.id) ?? [])],
            plannedIso: po.eta_date ?? null,
            originalIso: po.official_delivery_date ?? null,
            reply: latestReplyByPo.get(po.id) ?? null,
          });
          poArrivalsBySo.set(so, arrivals);
        }
      }
    }
  }

  // ── DELIVERY MONITOR (2026-09-11) · WHAT IS PHYSICALLY ALLOCATED ──────────
  //
  // The delivery work list must say whether a delivery's goods are IN and, when
  // they are not, exactly how many pieces are missing. That is Stock's own
  // per-Unit register, and the ONE arithmetic over it is `resolveUnitAllocation`
  // (Card 2) — the same function the order detail, the completion reader and
  // the booking brief already call. This block only READS the units in one
  // batched page-wide query so the list does not ask per order; the counting is
  // the shared resolver's, in the browser, over the very same input shape.
  //
  // Two queries rather than one `or`: a reserved unit is matched by its
  // `reserved_ref` (`SO-1234`) and a sold one by `sold_order_id`, and chunked
  // `.in()` keeps both URLs inside the proxy's limit (the 78-value lesson in
  // `purchase-demand-read`).
  const allocatedUnitsByOrder = new Map<string, OrderAllocatedUnit[]>();
  {
    const orderIds = orders
      .map((o: { id?: string }) => o.id)
      .filter((id): id is string => typeof id === "string" && id.length > 0);
    const soRefByNumber = new Map<string, string>();
    for (const o of orders as { id?: string; so?: number | null }[]) {
      if (typeof o.so === "number" && o.id) soRefByNumber.set(`SO-${o.so}`, o.id);
    }
    const push = (orderId: string, unit: OrderAllocatedUnit) => {
      const rows = allocatedUnitsByOrder.get(orderId) ?? [];
      rows.push(unit);
      allocatedUnitsByOrder.set(orderId, rows);
    };
    /* `SO-1234` is nine characters; 200 of them is a 2KB URL, well inside the
     * proxy limit, and it keeps a 500-row page to three round trips. */
    for (const batch of chunk([...soRefByNumber.keys()], 200)) {
      if (batch.length === 0) continue;
      const { data: reserved, error: e_reserved } = await sb
        .from("ops_stock_items")
        .select("sku, qty, reserved_ref, reserved_order_line_id")
        .eq("status", "reserved")
        .in("reserved_ref", batch);
      if (e_reserved) {
        const m = mapPgError(e_reserved);
        return c.json(m.body, m.status);
      }
      for (const u of reserved ?? []) {
        const row = u as { sku: string | null; qty: number | null; reserved_ref: string | null; reserved_order_line_id?: string | null };
        const orderId = row.reserved_ref ? soRefByNumber.get(row.reserved_ref) : undefined;
        if (!orderId || !row.sku) continue;
        push(orderId, { sku: row.sku, status: "reserved", qty: row.qty ?? 1, orderLineId: row.reserved_order_line_id ?? null });
      }
    }
    /* An order id is a 36-character UUID; 100 of them is a 4KB URL. */
    for (const batch of chunk(orderIds, 100)) {
      if (batch.length === 0) continue;
      const { data: sold, error: e_sold } = await sb
        .from("ops_stock_items")
        .select("sku, qty, sold_order_id, reserved_order_line_id")
        .eq("status", "sold")
        .in("sold_order_id", batch);
      if (e_sold) {
        const m = mapPgError(e_sold);
        return c.json(m.body, m.status);
      }
      for (const u of sold ?? []) {
        const row = u as { sku: string | null; qty: number | null; sold_order_id: string | null; reserved_order_line_id?: string | null };
        if (!row.sold_order_id || !row.sku) continue;
        push(row.sold_order_id, { sku: row.sku, status: "sold", qty: row.qty ?? 1, orderLineId: row.reserved_order_line_id ?? null });
      }
    }
  }

  // Read incoming evidence page-wide, never one request per calendar card.
  // Use the same exclusive source-line rule as the order expansion below.
  const incomingByOrder = new Map<string, IncomingLineUnit[]>();
  const listedOrders = orders as Array<{ id: string; order_lines?: { id: string }[] }>;
  const listedLines = new Map(listedOrders.map(o => [o.id, new Set((o.order_lines ?? []).map(l => l.id))]));
  const candidatePoLines = new Set<string>();
  let sourceReadComplete = true;
  if (openArrivalPoIds.size) {
    for (const batch of chunk(listedOrders.map(o => o.id), 100)) {
      const { data: sources, error, count } = await sb.from("po_line_sources")
        .select("po_id, po_line_id, order_id, order_line_id", { count: "exact" }).in("order_id", batch);
      if (error) { const m = mapPgError(error); return c.json(m.body, m.status); }
      // A server row cap must not turn a partial owner read into exclusivity.
      if (count !== (sources ?? []).length) { sourceReadComplete = false; break; }
      for (const source of sources ?? []) {
        if (source.po_line_id && openArrivalPoIds.has(source.po_id)) candidatePoLines.add(source.po_line_id);
      }
    }
    for (const batch of chunk(sourceReadComplete ? [...candidatePoLines] : [], 100)) {
      const { data: owners, error: ownerError, count: ownerCount } = await sb.from("po_line_sources")
        .select("po_line_id, order_id, order_line_id", { count: "exact" }).in("po_line_id", batch);
      if (ownerError) { const m = mapPgError(ownerError); return c.json(m.body, m.status); }
      if (ownerCount !== (owners ?? []).length) continue;
      const bindings = exclusivePoSourceBindings(owners ?? []);
      const eligible = [...bindings].filter(([, binding]) => listedLines.get(binding.orderId)?.has(binding.lineId)).map(([id]) => id);
      if (!eligible.length) continue;
      const { data: incoming, error: incomingError, count: incomingCount } = await sb.from("ops_stock_items")
        .select("unit_code, po_line_id, qty", { count: "exact" }).eq("status", "incoming").eq("identity_scope", "unit").in("po_line_id", eligible);
      if (incomingError) { const m = mapPgError(incomingError); return c.json(m.body, m.status); }
      if (incomingCount !== (incoming ?? []).length) continue;
      for (const unit of incoming ?? []) {
        const binding = bindings.get(unit.po_line_id);
        if (!binding || !unit.unit_code || !Number.isFinite(unit.qty) || unit.qty <= 0) continue;
        incomingByOrder.set(binding.orderId, [...(incomingByOrder.get(binding.orderId) ?? []), {
          unitCode: unit.unit_code, orderLineId: binding.lineId, qty: unit.qty,
        }]);
      }
    }
  }

  type FirstHistory = { by_user_id: string | null; metadata: unknown };
  type WithFirstHistory = { first_history?: FirstHistory[] };
  /* A failed name read leaves Created by empty; it never takes the list down. */
  const creatorById = await resolveActorIdentities(sb, orders.map((o: WithFirstHistory) => o.first_history?.[0]?.by_user_id))
    .catch(() => new Map<string, ActorIdentity>());
  const createdByNameOf = (first: FirstHistory | undefined) => {
    const identity = first?.by_user_id ? (creatorById.get(first.by_user_id) ?? null) : null;
    return actorKindOf(first?.by_user_id, identity, first?.metadata) === "human" ? (identity?.name ?? null) : null;
  };

  return c.json({
    orders: orders.map(({ first_history, ...o }: { id?: string; so?: number | null } & WithFirstHistory) => ({
      ...o,
      created_by_name: createdByNameOf(first_history?.[0]),
      po_skus: [...(poSkusBySo.get(o.so ?? -1) ?? [])],
      po_numbers: [...(poNumbersBySo.get(o.so ?? -1) ?? [])],
      po_arrivals: poArrivalsBySo.get(o.so ?? -1) ?? [],
      allocated_units: allocatedUnitsByOrder.get(o.id ?? "") ?? [],
      incoming_units: incomingByOrder.get(o.id ?? "") ?? [],
    })),
    ...(after ? {} : { salesOrderTotal }),
    /* A full page may have more behind it; a short page is the last. */
    ...(paged ? { nextCursor: registerPageCursorAfter(orders as Array<{ id?: string; placed_at?: string | null }>) } : {}),
  });
});

// GET /customer-first-placed: the earliest placed_at for each phone, so the list
// can call an order Existing when the same phone was placed earlier. The live
// probe (/api/orders/customer-type) counts the order itself, and the register's
// own rows are narrowed by search and leave out orders outside its population.
// A cancelled order does not make a customer existing; a rental does.
// shortcut: reads every order's phone, move to an RPC when this read gets slow.
const FIRST_PLACED_PAGE = 1000;
operationOrdersRouter.get("/customer-first-placed", requireOperation, async (c) => {
  const sb = userClient(c.env, c.var.auth.jwt);
  const firstPlaced: Record<string, string> = {};
  for (let from = 0; ; from += FIRST_PLACED_PAGE) {
    const { data, error } = await sb
      .from("orders")
      .select("customer_phone, placed_at")
      .neq("status", "cancelled")
      .not("customer_phone", "is", null)
      .not("placed_at", "is", null)
      .order("placed_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + FIRST_PLACED_PAGE - 1);
    if (error) {
      const m = mapPgError(error);
      return c.json(m.body, m.status);
    }
    const rows = (data ?? []) as Array<{ customer_phone: string; placed_at: string }>;
    for (const r of rows) {
      for (const key of phoneKeysMy(r.customer_phone)) firstPlaced[key] ??= r.placed_at;
    }
    if (rows.length < FIRST_PLACED_PAGE) return c.json({ firstPlaced });
  }
});

// ----- GET /by-number/:so — 【DELIVERY】 CARD 19 -----
// The operator's document word (`SO-1362`) resolved to the order's id, so a
// link carrying the number lands on the SAME object page as a link carrying
// the id. A read door only: it answers `{ id, so }` and nothing else; every
// fact is then read by the id through the existing doors (Law C — one door,
// never a second fan-in).
operationOrdersRouter.get("/by-number/:so", requireOperation, async (c) => {
  const ident = salesOrderParamOf(c.req.param("so"));
  if (ident.kind !== "number") {
    return c.json(
      { error: "invalid_so_number", code: "invalid_so_number", message: "Sales Order not found." },
      400,
    );
  }
  const sb = userClient(c.env, c.var.auth.jwt);
  const { data, error } = await sb
    .from("orders")
    .select("id, so")
    .eq("so", ident.so)
    .maybeSingle();
  if (error) {
    const m = mapPgError(error);
    return c.json(m.body, m.status);
  }
  if (!data) {
    return c.json(
      {
        error: "not_found",
        code: "not_found",
        message: "Sales Order not found.",
        so: salesOrderNumberWord(ident.so),
      },
      404,
    );
  }
  return c.json({ id: (data as { id: string }).id, so: ident.so });
});

// ----- GET /:id detail -----
/**
 * ⭐ MONTHLY DEMAND'S FACTS — owner rulings 2026-09-22 / 2026-09-26 (Orders
 * MASTER § Monthly demand).
 *
 * The Register's list stops at 500 rows, newest first, so a month-by-month
 * sum built from it silently drops the OLDEST orders — the `Before` row, the
 * goods owed longest. This read pages until a page comes back short and
 * returns only the facts the arithmetic needs; `monthlyDemandOf`
 * (packages/shared) does the arithmetic in the browser.
 *
 * ONE population: `salesOrderRegisterPopulation`, the Register's own.
 * Delivered = Stock's Units SOLD against the order. A failed read of them
 * fails the read: an unread delivery is not zero delivered.
 *
 * Declared BEFORE `/:id`, which would otherwise read the word as an order id.
 */
const MONTHLY_DEMAND_PAGE = 1000;
/**
 * GET /register-facts — the Order list's two server-owned fact filters
 * (Orders MASTER §Left rail, owner approved 2026-09-22):
 *
 *   obligations  `outstanding` | `none` — CARD 8's derived completion through
 *                the ONE composition the object page calls (`completionOfOrder`):
 *                goods, money in (with storage), money out, loan.
 *   cases        `open` | `closed` | `none` — Service's own truth
 *                (`service_case_statuses.is_closed`); an unreadable read is
 *                `null`, never `none`.
 *
 * Same population as the Register (`salesOrderRegisterPopulation`). Read-only;
 * a fact this reader could not establish is left out, never guessed.
 */
operationOrdersRouter.get("/register-facts", requireOperation, async (c) => {
  const sb = userClient(c.env, c.var.auth.jwt);
  type OrderRow = CompletionOrderRow;
  const orders: OrderRow[] = [];
  for (let from = 0; ; from += MONTHLY_DEMAND_PAGE) {
    const { data, error } = await salesOrderRegisterPopulation(
      sb
        .from("orders")
        .select(
          "id, so, status, paid, credited, delivery_date, delivery_partner_id, ops_assigned_logistic, order_lines(id, sku, qty, unit_price), order_addons(qty, unit_price), ops_order_control(balance, storage_from, storage_fee_override, storage_fee_msbf, storage_fee_sof, storage_collected_at, storage_waiver_status, extension_original_date, assigned_staff, booking_stage, confirmed_date, confirmed_time_slot)",
        ),
    )
      .order("id", { ascending: true })
      .range(from, from + MONTHLY_DEMAND_PAGE - 1);
    if (error) { const m = mapPgError(error); return c.json(m.body, m.status); }
    const page = (data ?? []) as unknown as OrderRow[];
    orders.push(...page);
    if (page.length < MONTHLY_DEMAND_PAGE) break;
  }
  const ids = orders.map((o) => o.id);
  const idBySoRef = new Map(orders.map((o) => [`SO-${o.so}`, o.id]));
  const soRefById = new Map(orders.map((o) => [o.id, `SO-${o.so}`]));

  /* Every row of a batched `.in()` read, paged so no cap hides a row. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const readAll = async <T,>(query: (batch: string[]) => any, keys: string[]): Promise<T[] | null> => {
    const out: T[] = [];
    for (const batch of chunk(keys, 100)) {
      if (batch.length === 0) continue;
      for (let from = 0; ; from += MONTHLY_DEMAND_PAGE) {
        const { data, error } = await query(batch).order("id", { ascending: true }).range(from, from + MONTHLY_DEMAND_PAGE - 1);
        if (error) return null;
        const page = (data ?? []) as T[];
        out.push(...page);
        if (page.length < MONTHLY_DEMAND_PAGE) break;
      }
    }
    return out;
  };
  const UNIT_FIELDS = "id, unit_code, sku, status, condition, warehouse_id, po_no, qty, date_in, sold_at, reserved_ref, sold_order_id";
  type UnitRow = CompletionUnitRow & { reserved_ref: string | null; sold_order_id: string | null };
  const [reserved, sold, refunds, loans, invoices, cases] = await Promise.all([
    readAll<UnitRow>((b) => sb.from("ops_stock_items").select(UNIT_FIELDS).eq("status", "reserved").in("reserved_ref", b), [...idBySoRef.keys()]),
    readAll<UnitRow>((b) => sb.from("ops_stock_items").select(UNIT_FIELDS).eq("status", "sold").in("sold_order_id", b), ids),
    readAll<{ order_id: string; status: CompletionReads["refunds"][number]["status"] }>((b) => sb.from("order_refunds").select("id, order_id, status").in("order_id", b), ids),
    readAll<{ order_id: string } & CompletionReads["loans"][number]>((b) => sb.from("ops_sofa_loans").select("id, order_id, status, source, returned_to_supplier_at").in("order_id", b), ids),
    readAll<{ order_id: string } & NonNullable<CompletionReads["invoices"]>[number]>((b) => sb.from("invoices").select("id, order_id, kind, status, amount, tax_amount, voided_at").in("order_id", b), ids),
    readAll<{ order_id: string; status: { is_closed: boolean | null } | Array<{ is_closed: boolean | null }> | null }>(
      (b) => sb.from("service_cases").select("id, order_id, status:service_case_statuses(is_closed)").in("order_id", b),
      ids,
    ),
  ]);

  const byOrder = <T,>(rows: T[] | null, key: (r: T) => string | null | undefined) => {
    const map = new Map<string, T[]>();
    for (const r of rows ?? []) {
      const id = key(r);
      if (!id) continue;
      map.set(id, [...(map.get(id) ?? []), r]);
    }
    return map;
  };
  /* Completion needs all five of its reads; one that failed leaves
     `obligations` unknown for every order rather than half-computed. */
  const completionReadable = reserved && sold && refunds && loans && invoices;
  const unitsBy = byOrder([...(reserved ?? []), ...(sold ?? [])], (u) =>
    u.status === "sold" ? u.sold_order_id : idBySoRef.get(u.reserved_ref ?? ""),
  );
  const refundsBy = byOrder(refunds, (r) => r.order_id);
  const loansBy = byOrder(loans, (r) => r.order_id);
  const invoicesBy = byOrder(invoices, (r) => r.order_id);
  const casesBy = byOrder(cases, (r) => r.order_id);
  const storageCats = completionReadable
    ? await storageSkuCategories(sb, orders.flatMap((o) => (o.order_lines ?? []).map((l) => String(l.sku))))
    : new Map<string, string>();
  const asOf = todayIsoMYT();

  /* The Outright list's owner facts (PIC, Supplier DO, GRN, delivery day,
     loading, location, Finance hold) — each owner read separately, each with
     its own failure flag, so an unread fact is never printed as unrecorded. */
  const owned = await outrightOrderFacts(
    sb,
    orders as unknown as OutrightOrderInput[],
    reserved,
    (orderId) => soRefById.get(orderId) ?? "",
  );

  const facts: Record<string, { obligations: "outstanding" | "none" | null; cases: "open" | "closed" | "none" | null; stock?: Record<string, string>; owned?: OutrightOrderFacts }> = {};
  for (const o of orders) {
    const obligations = completionReadable
      ? completionOfOrder({
          ord: o,
          commitmentLines: (o.order_lines ?? []).map((l) => ({ sku: l.sku, qty: Number(l.qty) || 0 })),
          units: unitsBy.get(o.id) ?? [],
          refunds: refundsBy.get(o.id) ?? [],
          loans: loansBy.get(o.id) ?? [],
          invoices: (invoicesBy.get(o.id) ?? []) as CompletionReads["invoices"],
          storageCategories: storageCats,
          asOf,
        }).noActionRequired
        ? "none"
        : "outstanding"
      : null;
    let caseFact: "open" | "closed" | "none" | null = null;
    if (cases) {
      const mine = casesBy.get(o.id) ?? [];
      const closed = mine.map((row) => (Array.isArray(row.status) ? row.status[0]?.is_closed : row.status?.is_closed));
      caseFact =
        mine.length === 0
          ? "none"
          : closed.some((v) => v === false)
            ? "open"
            : closed.every((v) => v === true)
              ? "closed"
              : null;
    }
    const stock: Record<string, string> = {};
    const required = new Map<string, number>();
    for (const line of o.order_lines ?? []) required.set(line.sku, (required.get(line.sku) ?? 0) + Number(line.qty));
    for (const sku of required.keys()) {
      // Associated Units alone cannot prove this exact line's latest posted receipt.
      // Keep the display unknown until Stock supplies that source-linked projection.
      stock[sku] = "unknown";
    }
    facts[o.id] = { obligations, cases: caseFact, stock, owned: owned.facts[o.id] };
  }
  return c.json({ facts, failed: { obligations: !completionReadable, cases: cases === null, ...owned.failed } });
});

operationOrdersRouter.get("/monthly-demand", requireOperation, async (c) => {
  const sb = userClient(c.env, c.var.auth.jwt);
  type Row = {
    id: string;
    so: number | null;
    delivery_date: string | null;
    delivery_date_tbd: boolean | null;
    customer_address_state: string | null;
    customer_address_city: string | null;
    outlets?: { name?: string | null } | null;
    dealers?: { name?: string | null } | null;
    order_lines?: Array<{ id: string; sku: string; qty: number; attrs?: Record<string, unknown> | null }> | null;
  };
  const rows: Row[] = [];
  for (let from = 0; ; from += MONTHLY_DEMAND_PAGE) {
    const { data, error } = await salesOrderRegisterPopulation(
      sb
        .from("orders")
        .select(
          "id, so, delivery_date, delivery_date_tbd, customer_address_state, customer_address_city, outlets(name), dealers(name), order_lines(id, sku, qty, attrs)",
        ),
    )
      .order("id", { ascending: true })
      .range(from, from + MONTHLY_DEMAND_PAGE - 1);
    if (error) { const m = mapPgError(error); return c.json(m.body, m.status); }
    const page = (data ?? []) as unknown as Row[];
    rows.push(...page);
    if (page.length < MONTHLY_DEMAND_PAGE) break;
  }

  /* The catalog's category, through the ONE category reader. It fails open: a
     line it cannot place reads null, which the arithmetic counts as
     `Not in catalog` — never dropped. */
  const categoryBySku = await skuCategories(
    sb,
    rows.flatMap((o) => (o.order_lines ?? []).map((l) => l.sku).filter(Boolean)),
  );

  const delivered = new Map<string, Array<{ orderLineId: string | null; sku: string; qty: number }>>();
  /* An order id is a 36-character UUID; 100 of them is a 4KB URL. */
  for (const batch of chunk(rows.map((o) => o.id), 100)) {
    if (batch.length === 0) continue;
    for (let from = 0; ; from += MONTHLY_DEMAND_PAGE) {
      const { data, error } = await sb
        .from("ops_stock_items")
        .select("sku, qty, sold_order_id, reserved_order_line_id")
        .eq("status", "sold")
        .in("sold_order_id", batch)
        .order("id", { ascending: true })
        .range(from, from + MONTHLY_DEMAND_PAGE - 1);
      if (error) { const m = mapPgError(error); return c.json(m.body, m.status); }
      const page = (data ?? []) as Array<{ sku: string | null; qty: number | null; sold_order_id: string | null; reserved_order_line_id?: string | null }>;
      for (const unit of page) {
        if (!unit.sold_order_id || !unit.sku) continue;
        delivered.set(unit.sold_order_id, [
          ...(delivered.get(unit.sold_order_id) ?? []),
          { orderLineId: unit.reserved_order_line_id ?? null, sku: unit.sku, qty: unit.qty ?? 1 },
        ]);
      }
      if (page.length < MONTHLY_DEMAND_PAGE) break;
    }
  }

  return c.json({
    orders: rows.map((o) => ({
      id: o.id,
      so: o.so,
      deliveryDate: o.delivery_date,
      deliveryDateTbd: Boolean(o.delivery_date_tbd),
      salesLocation: o.outlets?.name?.trim() || o.dealers?.name?.trim() || null,
      state: o.customer_address_state,
      city: o.customer_address_city,
      lines: (o.order_lines ?? []).map((l) => ({
        id: l.id,
        sku: l.sku,
        qty: Number(l.qty),
        category: categoryBySku.get(l.sku) ?? null,
        attrs: l.attrs ?? null,
      })),
      delivered: delivered.get(o.id) ?? [],
    })),
  });
});

/* ⭐ AMENDMENTS QUEUE — Weisiang's decision (Mr Lim, WhatsApp 2026-10-22; Jess
   was not part of this decision): every Sales Order amendment waits for an
   approver, the Houzs way (Houzs `Amendments.tsx` + `GET /so-amendments`). This
   overturns Orders MASTER "Staff amendments and Sales Approver" items 1-2.
   Submission already writes nothing on the order and the Principal's decide
   door already applies or rejects it (0564); this read is the approver's list
   of every amendment across orders. Waiting first, newest first within a
   status. A draft was never submitted, so it is not in the queue. Must sit
   above `/:id`, which would otherwise swallow the word.
   Waiting rows are read on their own, unlimited (one live amendment per order,
   0334 `amendments_one_live_per_order`), so an old waiting one is never cut
   off by the history cap.
   Follows Houzs backend/src/scm/routes/so-amendments.ts:305 (`GET /`, one list
   across orders) and frontend/src/pages/scm-v2/Amendments.tsx:2-3 (waiting
   first, newest first) per Weisiang's ruling (2026-10-22): clear Carres rules,
   implement Houzs.
   ponytail: decided history is the newest 1000 only; page it when it outgrows that. */
const AMENDMENT_WAITING = ["submitted", "issued", "accepted"];
const AMENDMENT_DECIDED = ["applied", "rejected", "withdrawn"];
operationOrdersRouter.get("/amendments", requireOperation, async (c) => {
  const sb = userClient(c.env, c.var.auth.jwt);
  const cols = "id, order_id, status, reason, submitted_by, submitted_at, decided_by, decided_at, decision_note, customer_agreement_kind, orders(so, customer_name)";
  const [waitingRes, decidedRes] = await Promise.all([
    sb.from("sales_order_amendments").select(cols).in("status", AMENDMENT_WAITING)
      .order("submitted_at", { ascending: false }),
    sb.from("sales_order_amendments").select(cols).in("status", AMENDMENT_DECIDED)
      .order("submitted_at", { ascending: false }).limit(1000),
  ]);
  const error = waitingRes.error ?? decidedRes.error;
  if (error) {
    const m = mapPipelineV2Error(error);
    return c.json(m.body, m.status);
  }
  type Row = {
    id: string; order_id: string; status: string; reason: string | null;
    submitted_by: string | null; submitted_at: string; decided_by: string | null; decided_at: string | null;
    decision_note: string | null; customer_agreement_kind: string | null;
    orders?: { so?: number | null; customer_name?: string | null } | null;
  };
  const waitingFirst = [...(waitingRes.data ?? []), ...(decidedRes.data ?? [])] as Row[];
  const names = await resolveActorNames(sb, waitingFirst.flatMap((r) => [r.submitted_by, r.decided_by]));
  return c.json({
    amendments: waitingFirst.map((r) => ({
      id: r.id,
      orderId: r.order_id,
      so: r.orders?.so ?? null,
      customerName: r.orders?.customer_name ?? null,
      status: AMENDMENT_WAITING.includes(r.status) ? "waiting" : r.status,
      reason: r.reason,
      submittedBy: (r.submitted_by && names.get(r.submitted_by)) || null,
      submittedAt: r.submitted_at,
      decidedBy: (r.decided_by && names.get(r.decided_by)) || null,
      decidedAt: r.decided_at,
      decisionNote: r.decision_note,
      agreementRecorded: r.customer_agreement_kind != null,
    })),
  });
});

// ─────────────────────────────────────────────────────────────
// STAGE 2 · THE REVISION ENGINE — every write mints a revision (0327).
// The API layer here is a THIN door: validation + ONE RPC call. The RPC owns
// the whitelist, the lines diff, Rev-1 minting and immutability; nothing in
// this file writes orders/order_lines directly.
// ─────────────────────────────────────────────────────────────

/**
 * The editable header keys — mirrors the SAVE RPC whitelist verbatim.
 *
 * STAGE 3 · 0329: `salesperson_id` · `outlet_id` · `dealer_id` · `channel` are
 * NOT here. They moved to the attribution request lane (SUBMIT → APPROVE →
 * APPLY) because they move money between parties (GATES.md GATE 2b, Test 3),
 * and `sales_order_save_revision` now RAISES when a save carries one. CREATE
 * still names them — see `createOrderInput`, which is a birth, not an edit.
 */
const revisionHeaderInput = z
  .object({
    customer_name: z.string().trim().min(1).optional(),
    customer_phone: z.string().nullable().optional(),
    customer_email: z.string().nullable().optional(),
    customer_address: z.string().nullable().optional(),
    customer_address_line1: z.string().nullable().optional(),
    customer_address_line2: z.string().nullable().optional(),
    customer_address_city: z.string().nullable().optional(),
    customer_address_state: z.string().nullable().optional(),
    customer_address_postcode: z.string().nullable().optional(),
    customer_emergency: z.string().nullable().optional(),
    customer_billing: z.string().nullable().optional(),
    proceed_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    /* ⭐ THE OFFICE DOOR ENFORCES THE FLOOR CARRES ACTUALLY CARRIES TO (YH,
       2026-09-01 — audit F-8).
       Two numbers, two jobs, both correct: `MAX_DELIVERY_FLOOR` is 3 because
       Carres does not stair-carry above the 3rd floor (a policy-locked upper
       bound, `constants.ts:1-5`), and `floor_config.free_up_to_floor` is 2
       because floors 1 and 2 carry no charge — so charging begins at the 3rd
       and stops there too.
       The POS clamps to 3 and the shared schema caps at 3
       (`schemas/orders.ts:242`, `:420`, `:747`). THIS door had no ceiling at
       all, so an office-keyed order could store floor 7: a number no shop
       floor can produce, promising a carry nobody performs, on a job Carres
       has said it will not do.
       ⭐ AND THE FLOOR OF THE RANGE FOLLOWS THE POS TOO (YH, 2026-09-01 —
       "office follow POS"). This kept `min(0)` for one commit on the reasoning
       that the office inherits orders where nobody recorded a floor, and that
       raising it would refuse an ordinary correction of a row this door did
       not create.
       MEASURED, AND THE CONCERN DOES NOT HOLD. The office form does not have a
       zero to send: it reads the floor as `delivery_floor ?? 1` in all four
       places it touches it (`SalesOrderWorkspace.tsx:217`, `:537`, `:591`,
       `:1121`), so a null or absent floor already reaches the operator — and
       already saves — as 1. `min(0)` was not protecting an inherited zero; it
       was admitting one that only a non-UI caller could produce.
       Both ends now match the POS exactly: 1 to 3. */
    delivery_floor: z.number().int().min(1).max(MAX_DELIVERY_FLOOR).optional(),
    delivery_has_lift: z.boolean().optional(),
    /**
     * 0354 — the rest of what the Sales Portal asks. The object page's form IS
     * that form (owner ruling 2026-08-15), so a question the portal asks and
     * this door refuses is a field the operator can read and never fix.
     *
     * `.strict()` above is still the guard that matters: goods, price,
     * `delivery_date` and attribution are NOT here, and the RPC refuses them
     * again on its own side.
     */
    customer_race: z.string().nullable().optional(),
    customer_gender: z.string().nullable().optional(),
    customer_birthday: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    customer_address_unknown: z.boolean().optional(),
    customer_billing_same: z.boolean().optional(),
    delivery_stair_items: z.number().int().min(0).nullable().optional(),
    /** 0219's bag — the building type and the operator's own configured
     *  fields. Values only; a null CLEARS one key, and the RPC merges rather
     *  than replacing so an unrelated save never erases a retired field. */
    entry_fields: z.record(z.string().nullable()).optional(),
  })
  .strict();

// GET /:id/commitment — CARD 1's one authoritative read: what is the
// customer's CURRENT committed order, and how did it become this? The RPC
// (sales_order_commitment_bundle, 0340) reads orders/order_lines/addons via
// the snapshot arithmetic, the revision ledger and the change requests —
// and NOTHING from purchasing, units, receiving, booking or legacy stages.
// The shared resolver shapes the answer; Law D — one resolver, everywhere.
operationOrdersRouter.get("/:id/commitment", requireOperation, async (c) => {
  const id = c.req.param("id");
  const sb = userClient(c.env, c.var.auth.jwt);
  const { data, error } = await sb.rpc("sales_order_commitment_bundle", {
    p_order_id: id,
  });
  if (error) {
    const m = mapPgError(error);
    return c.json(m.body, m.status);
  }
  return c.json({
    commitment: resolveCurrentCustomerCommitment(data as unknown as CommitmentBundle),
  });
});

operationOrdersRouter.get("/:id/expansion", requireOperation, async (c) => {
  const id = c.req.param("id");
  const sb = userClient(c.env, c.var.auth.jwt);
  const [{ data: order, error: orderErr }, { data: lines, error: linesErr }, { data: threads, error: threadsErr }, { data: destinations, error: destErr }] = await Promise.all([
    sb.from("orders").select("so").eq("id", id).maybeSingle(),
    sb.from("order_lines").select("id, sku, qty").eq("order_id", id),
    sb.from("order_supplier_threads").select("order_line_id, po_id").eq("order_id", id),
    sb.from("purchasing_destinations").select("id, name, is_default, active"),
  ]);
  const firstError = orderErr ?? linesErr ?? threadsErr ?? destErr;
  if (firstError) { const m = mapPgError(firstError); return c.json(m.body, m.status); }
  if (!order) return c.json({ error: "Order not found" }, 404);

  // Incoming Units already exist on the official PO. Follow the immutable
  // PO-line/source-line link, never a SKU match across the whole PO. A shared
  // PO line does not yet identify which physical Unit belongs to which SO.
  const { data: sources, error: sourceErr } = await sb.from("po_line_sources")
    .select("po_id, po_line_id, order_line_id, qty").eq("order_id", id);
  if (sourceErr) { const m = mapPgError(sourceErr); return c.json(m.body, m.status); }
  const sourceRows = (sources ?? []) as Array<{ po_id: string; po_line_id: string | null; order_line_id: string | null; qty: number }>;
  const sourcePoLineIds = [...new Set(sourceRows.map((s) => s.po_line_id).filter((v): v is string => Boolean(v)))];
  const incomingByLine = new Map<string, string[]>();
  const poLineByUnit = new Map<string, string>();
  const exclusive = new Map<string, string>();
  if (sourcePoLineIds.length) {
    const { data: owners, error: ownerErr, count: ownerCount } = await sb.from("po_line_sources")
      .select("po_line_id, order_id, order_line_id", { count: "exact" }).in("po_line_id", sourcePoLineIds);
    if (ownerErr) { const m = mapPgError(ownerErr); return c.json(m.body, m.status); }
    const ownerRows = (owners ?? []) as Array<{ po_line_id: string; order_id: string | null; order_line_id: string | null }>;
    // A capped owner response cannot prove that no other order shares the PO line.
    for (const [poLineId, binding] of exclusivePoSourceBindings(ownerCount === ownerRows.length ? ownerRows : [])) {
      if (binding.orderId === id) exclusive.set(poLineId, binding.lineId);
    }
    if (exclusive.size) {
      const { data: incoming, error: incomingErr } = await sb.from("ops_stock_items")
        .select("unit_code, po_line_id").in("po_line_id", [...exclusive.keys()])
        .eq("status", "incoming").eq("identity_scope", "unit");
      if (incomingErr) { const m = mapPgError(incomingErr); return c.json(m.body, m.status); }
      for (const unit of (incoming ?? []) as Array<{ unit_code: string; po_line_id: string }>) {
        if (unit.unit_code) poLineByUnit.set(unit.unit_code, unit.po_line_id);
        const lineId = exclusive.get(unit.po_line_id);
        if (lineId && unit.unit_code) incomingByLine.set(lineId, [...(incomingByLine.get(lineId) ?? []), unit.unit_code]);
      }
    }
  }

  const destinationRows = (destinations ?? []) as Array<{ id: string; name: string; is_default: boolean; active?: boolean }>;
  const destinationName = new Map(destinationRows.map((d) => [d.id, d.name]));
  const defaultDeliverTo = destinationRows.find((d) => d.is_default && d.active !== false)?.name ?? null;
  const threadRows = (threads ?? []) as Array<{ order_line_id: string; po_id: string | null }>;
  const poIds = [...new Set([...threadRows.map((t) => t.po_id), ...sourceRows.map((s) => s.po_id)].filter((v): v is string => Boolean(v)))];
  const [{ data: pos, error: posErr }, { data: poLines, error: poLinesErr }, { data: units, error: unitsErr }] = await Promise.all([
    poIds.length ? sb.from("purchase_orders").select("id, destination_id, status").in("id", poIds) : Promise.resolve({ data: [], error: null }),
    poIds.length ? sb.from("purchase_order_lines").select("id, po_id, sku, qty, destination_id").in("po_id", poIds) : Promise.resolve({ data: [], error: null }),
    sb.from("ops_stock_items").select("unit_code, sku, po_line_id, reserved_order_line_id, identity_scope, warehouse_id, holder_party_id").or(`and(status.eq.reserved,reserved_ref.eq.SO-${order.so}),and(status.eq.sold,sold_order_id.eq.${id})`),
  ]);
  const secondError = posErr ?? poLinesErr ?? unitsErr;
  if (secondError) { const m = mapPgError(secondError); return c.json(m.body, m.status); }

  type UnitRow = { unit_code: string | null; sku: string; warehouse_id?: string | null; holder_party_id?: string | null; po_line_id?: string | null; reserved_order_line_id?: string | null; identity_scope?: string | null };
  const unitRows = (units ?? []) as UnitRow[];
  for (const unit of unitRows) {
    if (unit.unit_code && unit.po_line_id) poLineByUnit.set(unit.unit_code, unit.po_line_id);
  }
  const unitPoLineIds = [...new Set(poLineByUnit.values())];
  const { data: unitPoLines, error: unitPoError } = unitPoLineIds.length
    ? await sb.from("purchase_order_lines").select("id, po_id").in("id", unitPoLineIds)
    : { data: [], error: null };
  if (unitPoError) { const m = mapPgError(unitPoError); return c.json(m.body, m.status); }
  const poByUnitLine = new Map(((unitPoLines ?? []) as Array<{ id: string; po_id: string }>).map((line) => [line.id, line.po_id]));
  const unitCoverage = Object.fromEntries([...poLineByUnit].map(([unitId, lineId]) => [unitId, poByUnitLine.get(lineId) ?? null]));
  const warehouseIds = [...new Set(unitRows.map((u) => u.warehouse_id).filter((v): v is string => Boolean(v)))];
  const holderIds = [...new Set(unitRows.map((u) => u.holder_party_id).filter((v): v is string => Boolean(v)))];
  const [{ data: warehouseRows, error: whErr }, { data: holderRows, error: holderErr }] = await Promise.all([
    warehouseIds.length ? sb.from("warehouses").select("id, name").in("id", warehouseIds) : Promise.resolve({ data: [], error: null }),
    holderIds.length ? sb.from("stock_operating_parties").select("id, name").in("id", holderIds) : Promise.resolve({ data: [], error: null }),
  ]);
  const placeError = whErr ?? holderErr;
  if (placeError) { const m = mapPgError(placeError); return c.json(m.body, m.status); }
  const warehouseName = new Map(((warehouseRows ?? []) as Array<{ id: string; name: string }>).map((w) => [w.id, w.name]));
  const holderName = new Map(((holderRows ?? []) as Array<{ id: string; name: string }>).map((h) => [h.id, h.name]));
  const place = unitRows
    .filter((u): u is UnitRow & { unit_code: string } => Boolean(u.unit_code))
    .map((u) => ({
      unitCode: u.unit_code,
      siteName: u.warehouse_id ? warehouseName.get(u.warehouse_id) ?? null : null,
      holderName: u.holder_party_id ? holderName.get(u.holder_party_id) ?? null : null,
    }));

  const activePos = ((pos ?? []) as Array<{ id: string; destination_id: string; status?: string }>).filter((p) => p.status !== "cancelled");
  const poDestination = new Map(activePos.map((p) => [p.id, p.destination_id]));
  const unitLines: Record<string, string | null> = {};
  const verifiedByLine = new Map<string, string[]>();
  const unverifiedBySku = new Map<string, string[]>();
  const orderLineIds = new Set(((lines ?? []) as Array<{ id: string }>).map((line) => line.id));
  for (const unit of unitRows) {
    if (!unit.unit_code) continue;
    unitLines[unit.unit_code] = unit.reserved_order_line_id ?? null;
    const lineId = unit.reserved_order_line_id && orderLineIds.has(unit.reserved_order_line_id) ? unit.reserved_order_line_id : undefined;
    if (lineId) {
      verifiedByLine.set(lineId, [...(verifiedByLine.get(lineId) ?? []), unit.unit_code]);
      continue;
    }
    const key = normalizeSkuKey(unit.sku) || unit.sku;
    unverifiedBySku.set(key, [...(unverifiedBySku.get(key) ?? []), unit.unit_code]);
  }
  // ⭐ AN INCOMING UNIT DECLARES ITS LINE — it does not leave the map and let a
  // reader infer one from its own absence (owner correction 2026-09-11).
  //
  // `exclusive` above already proved the fact: every `po_line_sources` row on
  // that purchase-order line names THIS order and THIS item line, so the
  // document evidences the binding even though `reserved_order_line_id` is
  // still null on goods that have not arrived. Writing it into `unitLines` is
  // what makes the reader's rule safe: a Unit that is ABSENT from this map is
  // a Unit nothing evidenced, and absence can no longer be read as proof.
  for (const [lineId, codes] of incomingByLine) {
    for (const code of codes) unitLines[code] = lineId;
  }
  // ⛔ A COUNTED ROW IS NOT A UNIT (0453, `unit-identity.ts`). The reserved/sold
  // read is not scoped, so a bulk row's technical `QTY-` key can reach
  // `unitIds` — where a `Unit ID` heading would present a database key as an
  // identity. The scope rides the wire so no reader has to guess from a shape.
  const unitScopes: Record<string, string> = {};
  for (const unit of unitRows) {
    if (unit.unit_code) unitScopes[unit.unit_code] = unit.identity_scope ?? "unit";
  }
  const purchaseLines = new Map(((poLines ?? []) as Array<{ id: string; po_id: string; destination_id: string | null }>).map((p) => [p.id, p]));
  return c.json({
    defaultDeliverTo,
    unitCoverage,
    unitLines,
    unitScopes,
    place,
    lines: ((lines ?? []) as Array<{ id: string; sku: string; qty: number }>).map((line) => {
      // A destination belongs to the recorded source allocation, not whichever
      // matching SKU happens to be returned first from a consolidated PO.
      const byDestination = new Map<string, number>();
      for (const source of sourceRows.filter((s) => s.order_line_id === line.id)) {
        const p = source.po_line_id ? purchaseLines.get(source.po_line_id) : undefined;
        if (!p || !poDestination.has(p.po_id)) continue;
        const qty = Math.max(0, Number(source.qty) || 0);
        if (qty <= 0) continue;
        const name = destinationName.get(p.destination_id ?? poDestination.get(p.po_id) ?? "") ?? "Not recorded";
        byDestination.set(name, (byDestination.get(name) ?? 0) + qty);
      }
      const deliverTo = [...byDestination].map(([name, qty]) => ({ name, qty }));
      const unitIds = [...new Set([
        ...(verifiedByLine.get(line.id) ?? []),
        ...(incomingByLine.get(line.id) ?? []),
      ])].sort();
      const unverifiedUnitIds = [...new Set(unverifiedBySku.get(normalizeSkuKey(line.sku) || line.sku) ?? [])].sort();
      const physical = (code: string) => (unitScopes[code] ?? "unit") === "unit";
      const verifiedUnitIds = unitIds.filter(physical);
      return {
        lineId: line.id,
        sku: line.sku,
        // Preserve the existing fan-in contract for Purchasing/Delivery; their
        // readers use unitLines/unitScopes to distinguish binding and identity.
        unitIds: [...new Set([...unitIds, ...unverifiedUnitIds])].sort(),
        verifiedUnitIds,
        unverifiedUnitIds: unverifiedUnitIds.filter(physical),
        unitQuantityMismatch: verifiedUnitIds.length > Math.max(0, Number(line.qty) || 0),
        deliverTo,
      };
    }),
  });
});

// GET /:id/completion — CARD 8's derived answer: Goods + Money (both
// directions) + Loan clear = No Action Required. NEVER stored, no button —
// composed here from the four authoritative reads the earlier cards own:
// Card 1 commitment → Card 2 allocation (goods), Card 4 orderMoney (money in),
// Card 7 refunds (money out), Card 6 loans. Delivered ≠ Complete and
// Cancelled ≠ Complete are properties of the arithmetic, not of any column.
operationOrdersRouter.get("/:id/completion", requireOperation, async (c) => {
  const id = c.req.param("id");
  const sb = userClient(c.env, c.var.auth.jwt);

  const { data: bundle, error: bundleErr } = await sb.rpc(
    "sales_order_commitment_bundle",
    { p_order_id: id },
  );
  if (bundleErr) {
    const m = mapPgError(bundleErr);
    return c.json(m.body, m.status);
  }
  const commitment = resolveCurrentCustomerCommitment(
    bundle as unknown as CommitmentBundle,
  );

  const { data: ord, error: ordErr } = await sb
    .from("orders")
    .select(
      "id, so, status, paid, credited, delivery_date, order_lines(sku, qty, unit_price), order_addons(qty, unit_price), ops_order_control(balance, storage_from, storage_fee_override, storage_fee_msbf, storage_fee_sof, storage_collected_at, storage_waiver_status, extension_original_date)",
    )
    .eq("id", id)
    .maybeSingle();
  if (ordErr) {
    const m = mapPgError(ordErr);
    return c.json(m.body, m.status);
  }
  if (!ord) return c.json({ error: "Order not found" }, 404);
  const soRef = `SO-${ord.so}`;

  const [unitsRes, refundsRes, loansRes, invoicesRes] = await Promise.all([
    sb
      .from("ops_stock_items")
      .select("id, unit_code, sku, status, condition, warehouse_id, po_no, qty, date_in, sold_at")
      .or(
        `and(status.eq.reserved,reserved_ref.eq.${soRef}),and(status.eq.sold,sold_order_id.eq.${id})`,
      ),
    sb.from("order_refunds").select("status").eq("order_id", id),
    sb
      .from("ops_sofa_loans")
      .select("status, source, returned_to_supplier_at")
      .eq("order_id", id),
    // Gate convergence (2026-09-07): the completion reader must see the SAME
    // §2 storage obligation the gate and Payment print.
    sb.from("invoices")
      .select("kind, status, amount, tax_amount, voided_at")
      .eq("order_id", id),
  ]);
  for (const r of [unitsRes, refundsRes, loansRes, invoicesRes]) {
    if (r.error) {
      const m = mapPgError(r.error);
      return c.json(m.body, m.status);
    }
  }

  // CARD-2026-08-28 - the CATALOG owns which rate applies; a SKU the catalog
  // does not hold falls back to the parser, per line.
  const storageCats = await storageSkuCategories(
    sb,
    ((ord.order_lines ?? []) as Array<{ sku: string }>).map((l) => String(l.sku)),
  );
  // The ONE composition the Order list's Obligations filter also calls.
  const completion = completionOfOrder({
    ord: ord as unknown as CompletionOrderRow,
    commitmentLines: commitment.lines.map((l) => ({ sku: l.sku, qty: Number(l.qty) || 0 })),
    units: (unitsRes.data ?? []) as CompletionUnitRow[],
    refunds: (refundsRes.data ?? []) as CompletionReads["refunds"],
    loans: (loansRes.data ?? []) as CompletionReads["loans"],
    invoices: (invoicesRes.data ?? []) as CompletionReads["invoices"],
    storageCategories: storageCats,
    asOf: todayIsoMYT(),
  });

  return c.json({ completion });
});

// POST /:id/save — the ONE edit door. CARD 1: a save that moves the
// CONTRACTUAL fields (items · promised date) must state its cause —
// `staff_correction` (the record was wrong) or `customer_change` (the
// customer asked for something different). The RPC (0340) enforces the
// requirement AFTER the diff — a save that only fixes contact data needs no
// cause and defaults to staff_correction. The RPC also refuses an empty or
// no-op save, refuses on any floor BLOCK, and refuses removing/re-SKUing a
// line in production.
const saveRevisionInput = z
  .object({
    header: revisionHeaderInput,
  })
  .strict();

operationOrdersRouter.post(
  "/:id/save",
  requireOperation,
  // 0584 — an office save that records the Requested Delivery Date (or the
  // customer's "not yet") completes `ask_delivery_date`; a save that does not
  // touch it costs no Work read.
  salesOrderWorkCompletion({
    rules: ["ask_delivery_date"],
    orderId: (c) => c.req.param("id") ?? null,
    when: bodyTouchesDeliveryDate,
  }),
  async (c) => {
  const id = c.req.param("id");
  const raw = await c.req.json().catch(() => ({}));
  const parsed = saveRevisionInput.safeParse(raw);
  if (!parsed.success) {
    return c.json(
      {
        error: "invalid_input",
        code: "invalid_param",
        message: parsed.error.issues[0]?.message ?? "invalid input",
      },
      422,
    );
  }
  const sb = userClient(c.env, c.var.auth.jwt);
  const { data, error } = await sb.rpc("sales_order_save_revision", {
    p_order_id: id,
    p_header: parsed.data.header,
    // Detail/Edit is the safe-correction door. Contractual lines and the
    // promised date travel only through the governed Amendment lane.
    p_lines: null,
    p_change: null,
  });
  if (error) {
    const m = mapPipelineV2Error(error);
    return c.json(m.body, m.status);
  }

  /* 0394 — A STAIR FEE FOLLOWS THE FLOOR THAT CHANGED. This door can move
     `delivery_floor` and `delivery_has_lift`, and the fee 0393 stamped at
     create is priced from them. Without this, changing a floor from 1 to 3
     left the order describing a charge its own inputs no longer produce.

     Deliberately AFTER the save and deliberately non-fatal: the revision is
     already minted, so throwing here would tell the operator their edit failed
     when it did not. A stale fee is the state we were already in; a lost edit
     would be new damage. */
  if (touchesStairInputs(parsed.data.header as Record<string, unknown>)) {
    const restamp = await restampStairCarry(sb, id);
    if (!restamp.ok) {
      console.error("stair carry re-stamp failed", { orderId: id, reason: restamp.reason });
    }
  }
  return c.json(data, 201);
});

/* ⭐ THE OFFICE CREATE DOOR IS RETIRED — owner ruling 2026-09-27 (Jess). A
   customer order is the dealer's or showroom's act in the Sales Portal and
   nowhere else; Operation receives it and never creates it. Measured: every
   one of the 58 `Order created` events from this door came from office logins
   — test data. The permission boundary is kept; a stale client is refused
   before any database client opens. */
operationOrdersRouter.post("/", requireOperation, (c) =>
  c.json(
    {
      error: "This action is no longer available. A Sales Order is created in the Sales Portal.",
      code: "office_create_retired",
    },
    410,
  ),
);

// POST /:id/floors — 3.2's read-only consequence evaluator. A POST for the
// body's sake only: it calls ONE read-only definer function
// (sales_order_floors, 0328) and writes nothing. The 3.3 APPLY RPC calls the
// SAME function pre-mutation — one floor implementation (Law D).
const floorsInput = z.object({
  fields: z.array(z.string().trim().min(1)).min(1),
  proposedLines: z
    .array(z.object({ sku: z.string().trim().min(1), qty: z.number().min(0) }))
    .optional(),
});

operationOrdersRouter.post("/:id/floors", requireOperation, async (c) => {
  const id = c.req.param("id");
  const raw = await c.req.json().catch(() => ({}));
  const parsed = floorsInput.safeParse(raw);
  if (!parsed.success) {
    return c.json(
      { error: "invalid_input", code: "invalid_param", message: parsed.error.issues[0]?.message ?? "invalid input" },
      422,
    );
  }
  const sb = userClient(c.env, c.var.auth.jwt);
  const { data, error } = await sb.rpc("sales_order_floors", {
    p_order_id: id,
    p_changed: parsed.data.fields,
    p_proposed_lines: parsed.data.proposedLines ?? null,
  });
  if (error) {
    const m = mapPipelineV2Error(error);
    return c.json(m.body, m.status);
  }
  return c.json(data);
});

operationOrdersRouter.post("/amendment/:amendmentId/apply", requireOperation, async (c) => {
  const sb = userClient(c.env, c.var.auth.jwt);
  const { data, error } = await sb.rpc("sales_order_apply_amendment", {
    p_amendment_id: c.req.param("amendmentId"),
  });
  if (error) {
    const m = mapPipelineV2Error(error);
    return c.json(m.body, m.status);
  }
  /* Unreachable while ACCEPT is unbuilt — the RPC raises unconditionally. Kept
   * rather than omitted so the day 3.7 lands, the caller already knows the
   * shape of the answer. */
  return c.json(data);
});

// The preview reads every affected owner but writes none of them. It is the
// evidence management reads before deciding, and is recomputed on each read.
operationOrdersRouter.get("/amendment/:amendmentId/impact", requireOperation, async (c) => {
  const sb = userClient(c.env, c.var.auth.jwt);
  const { data, error } = await sb.rpc("sales_order_amendment_impact", {
    p_amendment_id: c.req.param("amendmentId"),
  });
  if (error) {
    const m = mapPipelineV2Error(error);
    return c.json(m.body, m.status);
  }
  return c.json(data);
});

// ----- POST /:id/warehouse — retired (Delivery Card 21) -----
// Exact Unit reservation belongs to SO Batch Purchase → Ready Stock.
// Never call the legacy quantity writer, including for stale clients.
operationOrdersRouter.post("/:id/warehouse", requireOperation, (c) =>
  c.json({ error: "This action is no longer available. Use Ready Stock in SO Batch Purchase.", code: "warehouse_pick_retired" }, 410),
);

// ----- POST /:id/reselect-partner -----
// Migration 0147 (item h, 2026-05-23). Operation reselects a different LP
// after the previous one rejected via lp_reject_order. Clears the reject
// timestamps + reason on the order, writes the new partner + a fresh
// request_for_delivery_at, putting the order back into the new LP's queue.
// RPC raises 22023 detail 'same_partner' if the operator picks the same LP
// that just rejected (no-op user error guard).
operationOrdersRouter.post("/:id/reselect-partner", requireOperation, async (c) => {
  const parsed = await parseJsonBody(c, reselectPartnerInput);
  if (!parsed.ok) return c.json(parsed.body, parsed.status);
  const sb = userClient(c.env, c.var.auth.jwt);
  const { data, error } = await sb.rpc("operation_reselect_partner", {
    p_order_id: c.req.param("id"),
    p_partner_id: parsed.data.partnerId,
  });
  if (error) {
    const m = mapPipelineV2Error(error);
    return c.json(m.body, m.status);
  }
  return c.json(data);
});

// ----- POST /:id/transfer-ready — retired (Delivery Card 21) -----
// Exact Unit reservation belongs to SO Batch Purchase → Ready Stock.
// Never call the legacy quantity writer, including for stale clients.
operationOrdersRouter.post("/:id/transfer-ready", requireOperation, (c) =>
  c.json({ error: "This action is no longer available. Use Ready Stock in SO Batch Purchase.", code: "warehouse_pick_retired" }, 410),
);

// ----- POST /:id/revert-proceed -----
// 2026-05-12 (Loo) — back-arrow from Confirmed column → Placed column.
// No body; just the order id in the path. Both operation and principal can
// trigger. Maps RPC's 22023 wrong_stage into a 422 invalid_param.
operationOrdersRouter.post(
  "/:id/revert-proceed",
  requireOperationOrPrincipal,
  async (c) => {
    const sb = userClient(c.env, c.var.auth.jwt);
    const { data, error } = await sb.rpc(
      "operation_revert_order_proceed_to_placed",
      { p_order_id: c.req.param("id") },
    );
    if (error) {
      const m = mapPipelineV2Error(error);
      return c.json(m.body, m.status);
    }
    return c.json(data);
  },
);

// ----- POST /:id/revert-dispatch -----
// 2026-05-12 (Loo) — back-arrow from Dispatched column → Ready to Dispatch.
// Clears every thread's partner assignment on this order. operation or
// principal.
operationOrdersRouter.post(
  "/:id/revert-dispatch",
  requireOperationOrPrincipal,
  async (c) => {
    const sb = userClient(c.env, c.var.auth.jwt);
    const { data, error } = await sb.rpc(
      "operation_revert_order_dispatched_to_ready",
      { p_order_id: c.req.param("id") },
    );
    if (error) {
      const m = mapPipelineV2Error(error);
      return c.json(m.body, m.status);
    }
    return c.json(data);
  },
);

export default operationOrdersRouter;
