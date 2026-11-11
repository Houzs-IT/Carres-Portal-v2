import { describe, it, expect } from "vitest";
import type { DeliveryOrderRow, DeliveryProofReviewRow, operationOrderListRow } from "@/lib/queries";
import { deliveryMoneyHolds, type DeliveryArrangementRow } from "@carres/shared";
import { buildDeliveryMonitorCards, monitorPaymentOf, needsProof, MONITOR_COPY, siteAccessOf, type DeliveryMonitorCard } from "./delivery-monitor";

/* The card's one consistent example: Friday, 4 September 2026. */
const TODAY = "2026-09-04";

describe("the Payment column says Hold delivery (owner ruling 2026-09-25, §3 · §8.3)", () => {
  /* RM 1,200.00 of goods; `paid` decides what is owed. */
  const priced = (over: Partial<operationOrderListRow> = {}) =>
    order({ id: "pay", so: 1500, paid: 0, order_lines: [{ id: "l", sku: "mattress:M1401F-K", qty: 1, unit_price: 1200 }], ...over });
  const open = (reason: string | null = "Cheque bounced") => ({ status: "open" as const, reason });
  const cleared = { status: "cleared" as const, reason: "Old hold" };

  it.each([
    ["money owed, no approval", priced(), { line1: "Hold delivery", line2: "RM 1,200.00 unpaid", tone: "red" }],
    ["a pending approval keeps the hold", priced({ order_delivery_payment_approvals: [{ status: "pending" }] }), { line1: "Hold delivery", line2: "RM 1,200.00 unpaid", tone: "red" }],
    ["a refused approval keeps the hold", priced({ order_delivery_payment_approvals: [{ status: "refused" }] }), { line1: "Hold delivery", line2: "RM 1,200.00 unpaid", tone: "red" }],
    ["part paid prints what is left", priced({ paid: 450.5 }), { line1: "Hold delivery", line2: "RM 749.50 unpaid", tone: "red" }],
    ["one open Finance exception", priced({ paid: 1200, order_finance_exceptions: [open()] }), { line1: "Hold delivery", line2: "Finance hold · Cheque bounced", tone: "red" }],
    ["several open — the Order Route's count", priced({ paid: 1200, order_finance_exceptions: [open(), open("Duplicate payment")] }), { line1: "Hold delivery", line2: "Finance hold · 2 reasons", tone: "red" }],
    ["an open exception read without its reason", priced({ paid: 1200, order_finance_exceptions: [{ status: "open" }] }), { line1: "Hold delivery", line2: "Finance hold", tone: "red" }],
    ["Finance wins over money owed", priced({ order_finance_exceptions: [open()] }), { line1: "Hold delivery", line2: "Finance hold · Cheque bounced", tone: "red" }],
    ["an approval never clears a Finance hold", priced({ order_finance_exceptions: [open()], order_delivery_payment_approvals: [{ status: "approved" }] }), { line1: "Hold delivery", line2: "Finance hold · Cheque bounced", tone: "red" }],
    ["paid in full", priced({ paid: 1200 }), { line1: "Paid", line2: null, tone: "green" }],
    ["a cleared exception holds nothing", priced({ paid: 1200, order_finance_exceptions: [cleared] }), { line1: "Paid", line2: null, tone: "green" }],
    ["an approval granted before the closure", priced({ order_delivery_payment_approvals: [{ status: "approved" }] }), { line1: "Collect RM 1,200.00", line2: "Cash on delivery", tone: "none" }],
    ["an unpriced order", order({ id: "np", so: 1501, paid: 0 }), { line1: "No price yet", line2: null, tone: "none" }],
  ] as const)("%s", (_name, row, expected) => {
    expect(monitorPaymentOf(row)).toEqual(expected);
  });

  it("is red exactly when the DO money gate holds — one predicate (Law D)", () => {
    for (const paid of [0, 600, 1200]) {
      for (const approvals of [[], [{ status: "pending" }], [{ status: "approved" }]]) {
        for (const exceptions of [[], [open()], [cleared]]) {
          const row = priced({ paid, order_delivery_payment_approvals: approvals, order_finance_exceptions: exceptions });
          expect(monitorPaymentOf(row).tone === "red").toBe(
            deliveryMoneyHolds({ outstanding: 1200 - paid, paymentApprovals: approvals as never, financeExceptions: exceptions }),
          );
        }
      }
    }
  });

  it("never prints a retired word, never a doubled marker, and the retired keys are gone", () => {
    const words = [priced(), priced({ order_finance_exceptions: [open()] })].flatMap((r) => {
      const p = monitorPaymentOf(r);
      return [p.line1, p.line2 ?? ""];
    });
    for (const w of words) {
      expect(w).not.toMatch(/Do not deliver|still to collect|Finance is holding|RM RM/);
    }
    for (const key of ["doNotDeliver", "stillToCollect", "financeHolding"]) {
      expect(MONITOR_COPY).not.toHaveProperty(key);
    }
  });

  });

function order(
  over: Partial<operationOrderListRow> & { id: string; so: number },
): operationOrderListRow {
  return {
    status: "proceed_order",
    operation_stage: "ready_to_dispatch",
    warehouse_id: null,
    customer_name: "kong chai yin",
    customer_phone: null,
    customer_address: "12 Jalan Sekolah, 41000 Klang, Selangor",
    customer_address_city: "Klang",
    customer_address_state: "Selangor",
    building_type: "Landed",
    /* The required Sales facts (owner ruling 2026-09-13) — carried by the
       default fixture so each test is about the ONE thing it names. */
    delivery_floor: 0,
    delivery_has_lift: true,
    placed_at: "2026-08-01T00:00:00Z",
    delivery_date: "2026-09-04",
    delivery_date_tbd: false,
    source_system: null,
    source_ref: null,
    ops_assigned_logistic: null,
    order_lines: [{ id: "l-1", sku: "mattress:M1401F-K", qty: 1 }],
    delivery_partner_id: null,
    request_for_delivery_at: null,
    partner_accepted_at: null,
    partner_rejected_at: null,
    partner_rejected_reason: null,
    delivery_partners: null,
    do_number: null,
    dispatched_at: null,
    delivered_at: null,
    outlet_id: null,
    dealer_id: "d-1",
    dealers: { name: "Carres KL" },
    order_supplier_threads: [],
    order_annotations: [],
    ...over,
  };
}

function arrangement(
  over: Partial<DeliveryArrangementRow> & { order_id: string },
): DeliveryArrangementRow {
  return {
    id: `arr-${over.order_id}`,
    leg: 0,
    partner_id: null,
    partner_name: null,
    confirmed_date: null,
    confirmed_time: null,
    expected_arrival: null,
    logistics_note: null,
    reply_proof_path: null,
    driver_name: null,
    vehicle: null,
    updated_at: "2026-09-01T00:00:00Z",
    updated_by: null,
    ...over,
  };
}

function doc(over: Partial<DeliveryOrderRow> & { id: string; do_number: string }): DeliveryOrderRow {
  return {
    order_id: undefined,
    issued_at: "2026-09-01T00:00:00Z",
    trip_groups: null,
    delivery_date: null,
    time_slot: null,
    logistics_partner: null,
    voided_at: null,
    void_reason: null,
    orders: { id: "a", so: 1301, customer_name: "kong chai yin" },
    ...over,
  };
}

function cards(
  orders: operationOrderListRow[],
  opts?: {
    deliveryOrders?: DeliveryOrderRow[];
    arrangements?: DeliveryArrangementRow[];
    attempts?: { do_number: string | null; result: "delivered" | "partial" | "failed"; reason_key: string | null; recorded_at: string }[];
    proofReviews?: DeliveryProofReviewRow[];
  },
): DeliveryMonitorCard[] {
  const byScope = new Map<string, DeliveryArrangementRow>();
  for (const a of opts?.arrangements ?? []) byScope.set(`${a.order_id}#${a.leg}`, a);
  return buildDeliveryMonitorCards({
    orders,
    deliveryOrders: opts?.deliveryOrders ?? [],
    attempts: opts?.attempts ?? [],
    handoverEvents: [],
    proofReviews: opts?.proofReviews ?? [],
    partnerNameById: new Map(),
    arrangements: byScope,
    todayIso: TODAY,
  });
}


const NO_PROOF_MISSING = { photo: false, signedDo: false };

/* ── 2 · A card is a mapping of recorded facts ─────────────────────────── */

describe("buildDeliveryMonitorCards", () => {
  it("maps an arranged row's own facts onto one card", () => {
    const out = cards(
      [order({ id: "a", so: 1301 })],
      {
        arrangements: [
          arrangement({
            order_id: "a",
            partner_id: "p-nets",
            partner_name: "NETS",
            confirmed_date: "2026-09-04",
            confirmed_time: "11:00–13:00",
          }),
        ],
      },
    );
    expect(out).toHaveLength(1);
    const c = out[0]!;
    expect(c.orderId).toBe("a");
    expect(c.confirmedDate).toBe("2026-09-04");
    expect(c.confirmedTime).toBe("11:00–13:00");
    expect(c.logisticsPartnerId).toBe("p-nets");
    expect(c.logisticsPartnerName).toBe("NETS");
    expect(c.customerName).toBe("Kong Chai Yin");
    /* City and State — the one locality spelling. */
    expect(c.locality).toBe("Klang, Selangor");
    expect(c.region).toBe("Selangor");
    expect(c.goodsSummary).toBeTruthy();
    expect(c.deliveryOrderId).toBeNull();
    expect(c.doNumber).toBeNull();
    expect(c.missingProof).toEqual(NO_PROOF_MISSING);
    /* The work list's columns read the row itself — it rides the card. */
    expect(c.scope.so).toBe(1301);
  });

  it("carries the issued DO's id and number when one exists", () => {
    const out = cards(
      [order({ id: "a", so: 1301, do_number: "DO-040926-0001" })],
      {
        deliveryOrders: [
          doc({ id: "do-row-1", do_number: "DO-040926-0001", delivery_date: "2026-09-04" }),
        ],
      },
    );
    expect(out[0]!.deliveryOrderId).toBe("do-row-1");
    expect(out[0]!.doNumber).toBe("DO-040926-0001");
  });

  it("a row with no confirmed date stays a card, dateless", () => {
    const out = cards([order({ id: "a", so: 1301, delivery_date: null })]);
    expect(out).toHaveLength(1);
    expect(out[0]!.confirmedDate).toBeNull();
  });

  it("speaks the shared status arithmetic, never its own", () => {
    const out = cards(
      [order({ id: "a", so: 1301 })],
      {
        arrangements: [
          arrangement({
            order_id: "a",
            partner_id: "p-nets",
            partner_name: "NETS",
            confirmed_date: "2026-09-04",
            confirmed_time: "09:00–11:00",
          }),
        ],
      },
    );
    expect(out[0]!.statusKey).toBe("confirmed");
    /* The day is column 8's; the status never repeats it (owner ruling 2026-09-25). */
    expect(out[0]!.statusLabel).toBe("Scheduled");
    expect(out[0]!.statusTone).toBe("green");
    expect(out[0]!.statusSecond).toBe("09:00–11:00");
    /* A SCHEDULED DATE alone completes the arrangement — the time is
       optional (owner ruling 2026-09-24, overwriting 2026-09-11). */
    const dayOnly = cards(
      [order({ id: "a", so: 1301 })],
      { arrangements: [arrangement({ order_id: "a", partner_id: "p-nets", partner_name: "NETS", confirmed_date: "2026-09-04" })] },
    );
    expect(dayOnly[0]!.statusKey).toBe("confirmed");
    expect(dayOnly[0]!.statusLabel).toBe("Scheduled");
    expect(dayOnly[0]!.statusSecond).toBeNull();
  });

  describe("the missing evidence — the Delivery Orders register's own arithmetic", () => {
    const delivered = (over: Partial<operationOrderListRow>, docOver: Partial<DeliveryOrderRow> = {}) =>
      cards(
        [order({ id: "a", so: 1301, do_number: "DO-1", ...over })],
        {
          deliveryOrders: [doc({ id: "do-1", do_number: "DO-1", ...docOver })],
          attempts: [
            { do_number: "DO-1", result: "delivered", reason_key: null, recorded_at: "2026-09-03T10:00:00Z" },
          ],
        },
      )[0]!;

    it("a file that names no document belongs to no delivery's evidence", () => {
      const c = delivered({
        ops_order_control: {
          delivery_photos: [{ path: "legacy.jpg", at: "2026-09-03T11:00:00Z", by: null }],
        },
      });
      expect(c.missingProof.photo).toBe(true);
    });

    it("another DO’s signature neither clears missing proof nor reopens this DO’s review", () => {
      const c = delivered({}, { orders: { id: "a", so: 1301, customer_name: "kong chai yin", do_number: "DO-OTHER", do_file_path: "signed.pdf", do_uploaded_at: "2026-09-03T12:00:00Z" } });
      expect(c.missingProof.signedDo).toBe(true);
      expect(c.proofReview.state).toBe("none");
    });

    it("both on file — nothing owed, the row leaves the queue", () => {
      const c = delivered(
        {
          ops_order_control: {
            delivery_photos: [
              { path: "p.jpg", at: "2026-09-03T11:00:00Z", by: null, doNumber: "DO-1", kind: "photo" },
            ],
          },
        },
        { orders: { id: "a", so: 1301, customer_name: "kong chai yin", do_number: "DO-1", do_file_path: "signed.pdf" } },
      );
      expect(needsProof(c)).toBe(false);
    });

    it("an UNKNOWN photo ledger claims no missing photo", () => {
      // No overlay row at all means the answer is UNKNOWN — not a missing proof.
      const c = delivered({ ops_order_control: null });
      expect(c.missingProof.photo).toBe(false);
    });

    it("a result that never reached the customer owes no proof", () => {
      const c = cards(
        [order({ id: "a", so: 1301, do_number: "DO-1", ops_order_control: { delivery_photos: [] } })],
        {
          deliveryOrders: [doc({ id: "do-1", do_number: "DO-1" })],
          attempts: [
            { do_number: "DO-1", result: "failed", reason_key: "customer_absent", recorded_at: "2026-09-03T10:00:00Z" },
          ],
        },
      )[0]!;
      expect(c.statusKey).toBe("failed");
      expect(c.missingProof).toEqual(NO_PROOF_MISSING);
    });
  });
});

/* ── 4 · An expired window proves nothing ──────────────────────────────── */

describe("expired planned time", () => {
  it("⭐ a confirmed date behind us with no recorded result reads Overdue, naming who must record it (§8.4)", () => {
    const out = cards(
      [order({ id: "a", so: 1301 })],
      {
        arrangements: [
          arrangement({ order_id: "a", partner_id: "p-nets", partner_name: "NETS", confirmed_date: "2026-09-01", confirmed_time: "09:00–11:00" }),
        ],
      },
    );
    // Not failed — the calendar passing records no result; it records that
    // the partner still owes one, in red.
    expect(out[0]!.statusKey).toBe("overdue");
    expect(out[0]!.statusLabel).toBe("Late");
    expect(out[0]!.statusTone).toBe("red");
    expect(out[0]!.statusSecond).toBe("Ask NETS for the result");
    expect(out[0]!.missingProof).toEqual(NO_PROOF_MISSING);
  });
});


describe("the schedule separates customer deliveries from transfers", () => {
  const journey = () => cards([order({ id: "journey", so: 1401, delivery_stops: [
    { leg: 1, partner_id: "p-nets", partner_name: "NETS", from_loc: "Klang WH", to_loc: "Ipoh WH", scheduled_at: "2026-09-04T02:00:00Z", status: "delivered" },
    { leg: 2, partner_id: "p-al", partner_name: "AL", from_loc: "Ipoh WH", to_loc: "Penang WH", scheduled_at: "2026-09-04T04:00:00Z", status: "pending" },
    { leg: 3, partner_id: "p-al", partner_name: "AL", from_loc: "Penang WH", to_loc: "Customer", scheduled_at: "2026-09-05T04:00:00Z", status: "pending" },
  ] as never })]);

  it("keeps an intermediate completion as an arrival even without a DO", () => {
    const set = journey();
    expect(set.map(card => card.eventType)).toEqual(["transfer", "transfer", "delivery"]);
    expect(set[0]).toMatchObject({ statusKey: "arrived", statusLabel: "Arrived at Ipoh WH", statusSecond: null, settled: true, contactOverdue: false });
    expect(set[0]!.missingProof).toEqual({ photo: false, signedDo: false });
  });

  });

describe("the work list's own words — never `scope` (owner correction 2026-09-07)", () => {

  it("work-list copy excludes scope and leg; only the approved expanded route names legs", () => {
    /* Two entries are sentence BUILDERS (`Call by {date}` · `Late — was due
       {date}`); they are checked on a real date so the rule covers the words
       they produce, not just the plain strings beside them. */
    expect(MONITOR_COPY.legOf(1, 2)).toBe("Leg 1 of 2");
    const words = Object.entries(MONITOR_COPY).filter(([key]) => key !== "legOf").map(([, w]) =>
      typeof w === "function"
        ? (w as (...args: never[]) => string)("Tue, 15 Sep" as never, "NETS" as never)
        : w,
    );
    for (const word of words) {
      expect(word).not.toMatch(/\bscopes?\b/i);
      expect(word).not.toMatch(/\blegs?\b/i);
    }
  });
});

describe("the ruled rail groups (owner correction 2026-09-07)", () => {

  it("the group headings are the owner's words", () => {
    expect(MONITOR_COPY.railWork).toBe("Work to do");
    expect(MONITOR_COPY.railState).toBe("State");
    expect(MONITOR_COPY.railLogistics).toBe("Logistics");
    expect(MONITOR_COPY.railStatus).toBe("Delivery status");
  });
});

/* ── 8 · The goods, the arrival and the contact deadline ────────────────── */

describe("the row's goods, kept in two cells", () => {
  const withGoods = () =>
    cards([
      order({
        id: "a",
        so: 1301,
        delivery_floor: 3,
        delivery_has_lift: false,
        order_lines: [
          { id: "l-1", sku: "mattress:M1401F-K", qty: 2, label: "Serena · King" },
          { id: "l-2", sku: "Pillow soft", qty: 2 },
          { id: "l-3", sku: "Disposal old mattress", qty: 1 },
        ],
        order_addons: [{ addon_key: "dispose-mattress", qty: 1 }],
        allocated_units: [{ sku: "mattress:M1401F-K", status: "reserved", qty: 1 }],
      }),
    ])[0]!;

  it("MAIN goods and accessories/services are two cells, never one summary", () => {
    const card = withGoods();
    expect(card.items.map((l) => l.name)).toEqual(["Serena · King"]);
    expect(card.extras.map((l) => l.kind)).toEqual(["accessory", "service", "service"]);
  });

  it("a short line names the EXACT missing quantity", () => {
    const card = withGoods();
    expect(card.items[0]!.qty).toBe(2);
    expect(card.items[0]!.shortQty).toBe(1);
    expect(card.readiness.ready).toBe(false);
    /* One mattress short; the pillows are accessories (ready) and the SERVICE
       line is not counted. */
    expect(card.readiness.shortQty).toBe(1);
  });

  it("a service carries no shortage — it moves no Unit", () => {
    const services = withGoods().extras.filter((l) => l.kind === "service");
    expect(services.every((l) => l.shortQty === 0)).toBe(true);
  });

  it("⭐ a service line can never make an order `Not ready` on its own", () => {
    /* Every physical piece is in and the order books a disposal: the register
       holds everything it can hold, so the delivery IS ready. Counting the
       service would have left it short of goods nobody was going to allocate. */
    const card = cards([
      order({
        id: "a",
        so: 1302,
        order_lines: [
          { id: "l-1", sku: "mattress:M1401F-K", qty: 1 },
          { id: "l-2", sku: "Disposal old mattress", qty: 1 },
        ],
        allocated_units: [{ sku: "mattress:M1401F-K", status: "reserved", qty: 1 }],
      }),
    ])[0]!;
    expect(card.readiness.ready).toBe(true);
    expect(card.readiness.shortQty).toBe(0);
    expect(card.arrival).toEqual({ kind: "on_hand" });
  });

  it("the add-on prints its CATALOG name, never its key", () => {
    const card = buildDeliveryMonitorCards({
      orders: [
        order({ id: "a", so: 1301, order_addons: [{ addon_key: "dispose-mattress", qty: 1 }] }),
      ],
      deliveryOrders: [],
      attempts: [],
      handoverEvents: [],
      partnerNameById: new Map(),
      arrangements: new Map(),
      todayIso: TODAY,
      addonNameByKey: new Map([["dispose-mattress", "Dispose old mattress"]]),
    })[0]!;
    const named = card.extras.find((l) => l.key.startsWith("addon-"));
    expect(named!.name).toBe("Dispose old mattress");
    expect(named!.name).not.toContain("dispose-mattress");
  });

  it("the site the crew meets comes from Sales Orders' own answers", () => {
    expect(withGoods().siteAccess).toBe("Floor 3 · No lift");
    expect(siteAccessOf({ delivery_floor: 1, delivery_has_lift: true })).toBe(
      "Floor 1 · Has lift",
    );
    /* Nobody asked is NOT `No lift` — a three-state fact keeps its third state. */
    expect(siteAccessOf({ delivery_floor: null, delivery_has_lift: null })).toBeNull();
  });
});

describe("Expected arrival — recorded dates only", () => {
  const arrivalOf = (po: Record<string, unknown>) =>
    cards([
      order({
        id: "a",
        so: 1301,
        order_lines: [{ id: "l-1", sku: "mattress:M1401F-K", qty: 1 }],
        allocated_units: [],
        po_arrivals: [
          {
            poId: "PO-1",
            status: "open",
            owedSkus: ["mattress:M1401F-K"],
            plannedIso: null,
            originalIso: null,
            reply: null,
            ...po,
          },
        ],
      }),
    ])[0]!.arrival;

  it("no reply prints OUR date, and the note says it is not a confirmation", () => {
    expect(arrivalOf({ originalIso: "2026-09-20" })).toMatchObject({
      kind: "planned",
      dateIso: "2026-09-20",
    });
  });

  it("a REVISED date keeps the original beside it — never a lone delay icon", () => {
    expect(
      arrivalOf({
        originalIso: "2026-09-20",
        reply: {
          answer: "delayed",
          aboutIso: "2026-09-20",
          previousIso: null,
          newIso: "2026-09-28",
          recordedAt: "2026-09-05T00:00:00Z",
        },
      }),
    ).toMatchObject({
      kind: "moved",
      dateIso: "2026-09-28",
      originalIso: "2026-09-20",
      later: true,
    });
  });

  it("an open purchase order with NO date states WHOSE gap it is, never a guess", () => {
    /* Nobody asked and nobody could compute: the gap is OURS, and saying the
       factory failed to answer would blame a supplier nobody contacted. */
    expect(arrivalOf({})).toMatchObject({ kind: "no_calculation" });
  });

  it("a date behind us with no goods is the supplier exception", () => {
    expect(arrivalOf({ originalIso: "2026-08-01" })).toMatchObject({
      kind: "passed",
      dateIso: "2026-08-01",
    });
  });

  it("goods already in the register answer `on_hand`, whatever a PO says", () => {
    const card = cards([
      order({
        id: "a",
        so: 1301,
        order_lines: [{ id: "l-1", sku: "mattress:M1401F-K", qty: 1 }],
        allocated_units: [{ sku: "mattress:M1401F-K", status: "reserved", qty: 1 }],
        po_arrivals: [
          {
            poId: "PO-1",
            status: "open",
            owedSkus: ["mattress:M1401F-K"],
            plannedIso: "2026-09-20",
            originalIso: "2026-09-20",
            reply: null,
          },
        ],
      }),
    ])[0]!;
    expect(card.readiness.ready).toBe(true);
    expect(card.arrival).toEqual({ kind: "on_hand" });
  });
});

describe("the contact deadline — three working days, counted once", () => {
  const chaseCard = (over: Partial<operationOrderListRow> = {}) =>
    cards([order({ id: "a", so: 1301, ...over })])[0]!;

  it("T−3 working days before the requested date, Sunday skipped", () => {
    /* Fri 18 Sep − 3 working days on the Mon–Sat week: Thu 17, then Wed 16
       is MALAYSIA DAY and is skipped, Tue 15, Mon 14. The holiday set is the
       injected Malaysian one every other delivery clock counts on. */
    expect(chaseCard({ delivery_date: "2026-09-18" }).contactDueIso).toBe("2026-09-14");
  });

  it("a customer who named no day has no deadline, and is never late", () => {
    const card = chaseCard({ delivery_date: null, delivery_date_tbd: true });
    expect(card.contactDueIso).toBeNull();
    expect(card.contactOverdue).toBe(false);
  });

  it("a missed deadline KEEPS the day it missed", () => {
    /* Requested Fri 28 Aug: Thu 27, Wed 26, then Tue 25 is Maulidur Rasul
       and is skipped, so the deadline was Mon 24 Aug. TODAY is 4 Sep. */
    const card = chaseCard({ delivery_date: "2026-08-28" });
    expect(card.contactDueIso).toBe("2026-08-24");
    expect(card.contactOverdue).toBe(true);
  });

  it("⭐ a SCHEDULED DATE closes the deadline — the time is optional (owner ruling 2026-09-24)", () => {
    const halfway = cards([order({ id: "a", so: 1301, delivery_date: "2026-08-28" })], {
      arrangements: [arrangement({ order_id: "a", confirmed_date: "2026-09-10" })],
    })[0]!;
    expect(halfway.booked).toBe(true);
    expect(halfway.contactOverdue).toBe(false);

    /* A recorded time changes nothing about the deadline. */
    const booked = cards([order({ id: "a", so: 1301, delivery_date: "2026-08-28" })], {
      arrangements: [
        arrangement({
          order_id: "a",
          confirmed_date: "2026-09-10",
          confirmed_time: "09:00–11:00",
        }),
      ],
    })[0]!;
    expect(booked.booked).toBe(true);
    expect(booked.contactOverdue).toBe(false);
  });

  });

