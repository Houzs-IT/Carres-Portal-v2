import { describe, expect, it } from "vitest";
import { addressLines, buildMap, buildTrail, foldForecast, orderPickupState, type OrderLine } from "./orders";
import { cleanAccessInput } from "./access";
import { supplierPublicUrl } from "./address";
import { resetMail, sendMail } from "./mail";
import {
  WORKER_SUBREQUEST_ADDRESS, callerAddress, decoyHash, hashPassword, isEmail, newToken, normEmail, passwordProblem, sha256Hex, verifyPassword,
} from "./credentials";
import { filterAgreement, filterSummary, pickAgreement, pickSummary, signFinanceBody } from "./finance";
import { forSupplier, pickupIds, todayMyt, type StaffPickup } from "./pickups";
import { allPerms, cleanPerms, readPerms } from "./perms";
import { attachmentHeader, deliveryOrderName, isPdf } from "./files";
import { inviteMail } from "./mail";
import { ASK_NOTICE_SOURCE, askAudience, askNoticeWords, noticeSupplierAsk, takeDownAskNotice } from "./ask-notice";

const line = (state: OrderLine["pickup"]["state"], requestNo: string | null = null): OrderLine => ({
  soItemId: "i", lineNo: 0, itemCode: "M1", description: "Mattress", spec: null, category: "MATTRESS", modelName: null, uom: "UNIT", qty: 1,
  pickup: { state, requestId: requestNo ? "r" : null, requestNo, expectedDate: null },
});

describe("orderPickupState", () => {
  it("names where an order's shared lines stand", () => {
    expect(orderPickupState({ lines: 2, requested: 0, accepted: 0, collected: 0 })).toBe("none");
    expect(orderPickupState({ lines: 2, requested: 1, accepted: 0, collected: 0 })).toBe("requested");
    expect(orderPickupState({ lines: 2, requested: 1, accepted: 1, collected: 0 })).toBe("requested");
    expect(orderPickupState({ lines: 2, requested: 0, accepted: 2, collected: 0 })).toBe("accepted");
    // One line accepted and one not asked for yet: still waiting on something.
    expect(orderPickupState({ lines: 2, requested: 0, accepted: 1, collected: 0 })).toBe("requested");
    expect(orderPickupState({ lines: 2, requested: 0, accepted: 1, collected: 1 })).toBe("part_collected");
    expect(orderPickupState({ lines: 2, requested: 0, accepted: 0, collected: 2 })).toBe("collected");
    expect(orderPickupState({ lines: 0, requested: 0, accepted: 0, collected: 0 })).toBe("none");
  });
});

describe("addressLines", () => {
  it("shows the two street lines, then one line of postcode, city and state", () => {
    expect(addressLines({ address1: " 12, Jalan  Satu ", address2: "Taman Dua", postcode: "47000", city: "Klang", customer_state: "Selangor" }))
      .toEqual(["12, Jalan Satu", "Taman Dua", "47000 Klang Selangor"]);
  });
  it("does not repeat a part the street lines already carry, or a city that is also the state", () => {
    expect(addressLines({ address1: "1 Jalan A, 50000 Kuala Lumpur", address2: null, postcode: "50000", city: "Kuala Lumpur", customer_state: "Kuala Lumpur" }))
      .toEqual(["1 Jalan A, 50000 Kuala Lumpur"]);
    expect(addressLines({ address1: "1 Jalan A", postcode: "", city: "Labuan", customer_state: "Labuan" })).toEqual(["1 Jalan A", "Labuan"]);
    expect(addressLines({})).toEqual([]);
  });
});

describe("buildTrail", () => {
  it("starts with the order coming in, tells each stage once, and never shows Draft", () => {
    const trail = buildTrail("2026-11-01T00:00:00Z", [
      { at: "2026-11-02T00:00:00Z", status: "IN_PRODUCTION" },
      { at: "2026-11-01T00:00:00Z", status: "DRAFT" },
      { at: "2026-11-01T01:00:00Z", status: "confirmed" },
      { at: "2026-11-02T00:00:01Z", status: "IN_PRODUCTION" },
      { at: "2026-11-05T00:00:00Z", status: "" },
    ], []);
    expect(trail.map((t) => t.code)).toEqual(["RECEIVED", "CONFIRMED", "IN_PRODUCTION"]);
  });
  it("a stage that is entered again after another is told again", () => {
    const trail = buildTrail(null, [
      { at: "2026-11-01T00:00:00Z", status: "ON_HOLD" },
      { at: "2026-11-02T00:00:00Z", status: "CONFIRMED" },
      { at: "2026-11-03T00:00:00Z", status: "ON_HOLD" },
    ], []);
    expect(trail.map((t) => t.code)).toEqual(["ON_HOLD", "CONFIRMED", "ON_HOLD"]);
  });
  it("weaves the pickup request in by time and keeps the order coming in first whatever the clocks say", () => {
    const trail = buildTrail("2026-11-20T00:00:00Z", [{ at: "2026-11-02T00:00:00Z", status: "IN_PRODUCTION" }], [{
      requestNo: "CR-PKR-2611-001", expectedDate: "2026-11-10", requestedAt: "2026-11-03T00:00:00Z", acceptedAt: "2026-11-04T00:00:00Z",
      collectedAt: "2026-11-10T00:00:00Z", cancelledAt: null,
    }]);
    expect(trail.map((t) => t.code)).toEqual(["RECEIVED", "IN_PRODUCTION", "PICKUP_REQUESTED", "PICKUP_ACCEPTED", "PICKUP_COLLECTED"]);
    expect(trail[2]).toMatchObject({ ref: "CR-PKR-2611-001", detail: "2026-11-10" });
  });
  it("a move Carres approved is its own entry; the request still names the day first asked for", () => {
    const trail = buildTrail(null, [], [{
      requestNo: "CR-PKR-2611-001", expectedDate: "2026-11-22", previousExpectedDate: "2026-11-20", requestedAt: "2026-11-03T00:00:00Z",
      acceptedAt: "2026-11-04T00:00:00Z", dateChangedAt: "2026-11-05T00:00:00Z", collectedAt: null, cancelledAt: null,
    }]);
    expect(trail.map((t) => [t.code, t.detail])).toEqual([
      ["PICKUP_REQUESTED", "2026-11-20"], ["PICKUP_ACCEPTED", null], ["PICKUP_DATE_CHANGED", "2026-11-22"],
    ]);
  });
});

describe("buildMap", () => {
  it("is five tiles: the order, its pickup request, collected, out for delivery, delivered", () => {
    const map = buildMap({ docNo: "CR-SO-2611-001", status: "CONFIRMED", pickupState: "none", lines: [line("none")] }, []);
    expect(map.map((n) => [n.type, n.state])).toEqual([
      ["Sales Order", "current"], ["Pickup Request", "pending"], ["Collected", "pending"], ["Out for Delivery", "pending"], ["Delivered", "pending"],
    ]);
    expect(map[1]!.doc).toBe("Not requested");
  });
  it("names the request, and says when more than one touches the order", () => {
    const one = buildMap({ docNo: "S", status: "IN_PRODUCTION", pickupState: "requested", lines: [line("requested", "CR-PKR-2611-001")] }, []);
    expect(one[1]).toMatchObject({ doc: "CR-PKR-2611-001", state: "done", meta: "Waiting for you to accept" });
    const two = buildMap({ docNo: "S", status: "IN_PRODUCTION", pickupState: "accepted", lines: [line("accepted", "CR-PKR-2611-001"), line("accepted", "CR-PKR-2611-002")] }, []);
    expect(two[1]).toMatchObject({ doc: "CR-PKR-2611-001 +1", meta: "Accepted" });
  });
  it("marks collected, shipped and delivered from the order's own facts", () => {
    const trail = buildTrail(null, [{ at: "2026-11-08T02:00:00Z", status: "SHIPPED" }, { at: "2026-11-09T02:00:00Z", status: "DELIVERED" }], [{
      requestNo: "R", expectedDate: null, requestedAt: "2026-11-03T00:00:00Z", acceptedAt: null, collectedAt: "2026-11-05T00:00:00Z", cancelledAt: null,
    }]);
    const map = buildMap({ docNo: "S", status: "DELIVERED", pickupState: "collected", lines: [line("collected", "R")] }, trail);
    expect(map.map((n) => n.state)).toEqual(["current", "done", "done", "done", "done"]);
    expect(map.slice(2).map((n) => n.meta)).toEqual(["2026-11-05", "2026-11-08", "2026-11-09"]);
  });
});

describe("foldForecast", () => {
  it("folds months into one row an item and its specification, largest first, undated last", () => {
    const base = { description: "Cloud", modelName: "Cloud", category: "MATTRESS", uom: "UNIT" };
    const f = foldForecast([
      { ...base, itemCode: "M1", spec: "Queen", month: "2026-12", incoming: 2, processing: 0 },
      { ...base, itemCode: "M1", spec: "Queen", month: "", incoming: 1, processing: 0 },
      { ...base, itemCode: "M1", spec: "Queen", month: "2027-01", incoming: 0, processing: 3 },
      { ...base, itemCode: "M1", spec: "King", month: "2026-12", incoming: 1, processing: 0 },
    ]);
    expect(f.months).toEqual(["2026-12", "2027-01", ""]);
    expect(f.rows.map((r) => [r.spec, r.incoming, r.processing, r.total])).toEqual([["Queen", 3, 3, 6], ["King", 1, 0, 1]]);
    expect(f.rows[0]!.byMonth).toEqual({ "2026-12": 2, "": 1, "2027-01": 3 });
  });
});

describe("credentials", () => {
  it("a token is long and random, and only its hash is ever comparable", async () => {
    const a = newToken();
    const b = newToken();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(43);
    expect(await sha256Hex(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(await sha256Hex(a)).not.toBe(await sha256Hex(b));
    expect(await sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
  it("normalises and checks an email", () => {
    expect(normEmail("  Ana@Supplier.COM ")).toBe("ana@supplier.com");
    expect(normEmail({ $ne: null })).toBe("");
    expect(isEmail("ana@supplier.com")).toBe(true);
    expect(isEmail("ana@supplier")).toBe(false);
    expect(isEmail(`${"a".repeat(250)}@x.co`)).toBe(false);
  });
  it("refuses a short, an endless, a one-letter and an email password", () => {
    expect(passwordProblem("short", "a@b.co")).toMatch(/at least 10/);
    expect(passwordProblem("x".repeat(201), "a@b.co")).toMatch(/at most 200/);
    expect(passwordProblem("aaaaaaaaaaaa", "a@b.co")).toMatch(/more than one/);
    expect(passwordProblem("Ana@Supplier.com", "ana@supplier.com")).toMatch(/email/);
    expect(passwordProblem(["correct horse battery"], "a@b.co")).not.toBeNull();
    expect(passwordProblem("correct horse battery", "a@b.co")).toBeNull();
  });
  it("an address every caller shares is not an address: it is neither counted nor recorded", () => {
    // Through the engine site's /api proxy every browser arrives under Cloudflare's one Worker-to-Worker address.
    expect(callerAddress(WORKER_SUBREQUEST_ADDRESS)).toBeNull();
    expect(callerAddress("2A06:98C0:3600::103 ")).toBeNull();
    expect(callerAddress("unknown")).toBeNull();
    expect(callerAddress("")).toBeNull();
    expect(callerAddress(undefined)).toBeNull();
    expect(callerAddress(null)).toBeNull();
    // A caller's own address is kept as it came, lower-cased, and never longer than an address can be.
    expect(callerAddress(" 203.0.113.9 ")).toBe("203.0.113.9");
    expect(callerAddress("2001:DB8::1")).toBe("2001:db8::1");
    expect(callerAddress("1".repeat(200))).toHaveLength(64);
  });
  it("the decoy is a real hash that no password opens", async () => {
    const decoy = await decoyHash();
    expect(decoy).toBe(await decoyHash());
    expect(await verifyPassword("anything at all", decoy)).toBe(false);
    const real = await hashPassword("correct horse battery");
    expect(await verifyPassword("correct horse battery", real)).toBe(true);
    expect(await verifyPassword("correct horse batterx", real)).toBe(false);
  });
});

describe("the Forgot password email", () => {
  const url = "https://supp.carresofficial.com/supplier/setup#t=TOKEN-abc_123";

  it("says what it is for, carries the link once in each form, and how long the link lives", () => {
    const mail = resetMail({ name: "Ana Ops", companyName: "Carres", url, setup: false });
    expect(mail.subject).toBe("Choose a new password");
    expect(mail.text).toBe([
      "Hello Ana Ops,",
      "",
      "Someone asked for a link to choose a new password for your Carres supplier account.",
      "",
      "Choose a new password:",
      url,
      "",
      "The link works once, for 1 hour. Use at least 10 characters.",
      "",
      "If you did not ask for this, do nothing. Your password stays as it is.",
      "",
      "Carres",
    ].join("\n"));
    expect(mail.html.split(url)).toHaveLength(2);
    expect(mail.html).toContain(">Choose a new password</a>");
    // No dash anywhere in what a person reads.
    expect(mail.text.replace(url, "")).not.toMatch(/[–—]| - /);
  });

  it("a person who never chose a password is told to choose their first", () => {
    const mail = resetMail({ name: "Nina", companyName: "", url, setup: true });
    expect(mail.subject).toBe("Choose your password");
    expect(mail.text).toContain("Someone asked for a link to choose the password for your Carres supplier account.");
    expect(mail.text.endsWith("Carres")).toBe(true);
  });

  it("a name or a company is text, never markup", () => {
    const mail = resetMail({ name: `<img src=x onerror=alert(1)>`, companyName: `A&B "Ltd" <script>`, url: `${url}"><script>`, setup: false });
    expect(mail.html).not.toContain("<img");
    expect(mail.html).not.toContain("<script>");
    expect(mail.html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(mail.html).toContain("A&amp;B &quot;Ltd&quot; &lt;script&gt;");
    expect(mail.html).toContain(`href="${url}&quot;&gt;&lt;script&gt;"`);
  });

  it("is handed to the mail provider with the engine's sender, and nothing else is sent along", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const post = async (u: string, init: RequestInit) => { calls.push({ url: u, init }); return new Response(JSON.stringify({ id: "re_1" }), { status: 200 }); };
    const mail = resetMail({ name: "Ana", companyName: "Carres", url, setup: false });
    expect(await sendMail({ RESEND_API_KEY: "re_key", EMAIL_FROM: " Carres <noreply@carresofficial.com> " }, "ana@supplier.test", mail, post)).toEqual({ status: "sent" });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://api.resend.com/emails");
    expect(calls[0]!.init.method).toBe("POST");
    expect(new Headers(calls[0]!.init.headers).get("authorization")).toBe("Bearer re_key");
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({
      from: "Carres <noreply@carresofficial.com>", to: ["ana@supplier.test"], subject: mail.subject, html: mail.html, text: mail.text,
    });
  });

  it("says in fixed words why a message did not leave, and passes on nothing the provider answered", async () => {
    const mail = resetMail({ name: "Ana", companyName: "Carres", url, setup: false });
    const never = async () => { throw new Error("must not be called"); };
    expect(await sendMail({}, "ana@supplier.test", mail, never)).toEqual({ status: "not_sent", reason: "Email is not set up." });
    const refused = async () => new Response(JSON.stringify({ message: `echo ${url}` }), { status: 422 });
    const out = await sendMail({ RESEND_API_KEY: "k" }, "ana@supplier.test", mail, refused);
    expect(out).toEqual({ status: "not_sent", reason: "The mail service refused the message (422)." });
    expect(JSON.stringify(out)).not.toContain("TOKEN");
    const down = async () => { throw new Error(`network ${url}`); };
    expect(await sendMail({ RESEND_API_KEY: "k" }, "ana@supplier.test", mail, down)).toEqual({ status: "not_sent", reason: "The mail service could not be reached." });
  });
});

describe("the supplier pages' address", () => {
  it("is the supplier's own address once it is named, and the engine site until then", () => {
    expect(supplierPublicUrl({}, "/supplier")).toBe("https://carres-scm.pages.dev/supplier");
    expect(supplierPublicUrl({ ENGINE_PUBLIC_URL: "https://engine.test/" }, "/supplier/setup")).toBe("https://engine.test/supplier/setup");
    expect(supplierPublicUrl({ SUPPLIER_PUBLIC_URL: "https://supp.carresofficial.com/", ENGINE_PUBLIC_URL: "https://engine.test" }, "/supplier/setup"))
      .toBe("https://supp.carresofficial.com/supplier/setup");
    expect(supplierPublicUrl({ SUPPLIER_PUBLIC_URL: "https://supp.carresofficial.com" }, "supplier")).toBe("https://supp.carresofficial.com/supplier");
  });
});

describe("cleanAccessInput", () => {
  const input = (over: Record<string, unknown> = {}) => ({ enabled: true, ownItems: false, subscriptionShare: false, categories: ["mattress"], modelIds: [], skuCodes: [], ...over });
  it("upper-cases categories and drops repeats", () => {
    expect(cleanAccessInput(input({ categories: ["mattress", "MATTRESS", " sofa "] }))).toMatchObject({ ok: true, value: { categories: ["MATTRESS", "SOFA"] } });
  });
  it("only a true switch is on", () => {
    expect(cleanAccessInput(input({ enabled: "true", subscriptionShare: 1, ownItems: "yes" }))).toMatchObject({ ok: true, value: { enabled: false, subscriptionShare: false, ownItems: false } });
  });
  it("refuses access switched on with nothing to share, and a scope that is not a list of words", () => {
    expect(cleanAccessInput(input({ categories: [] }))).toMatchObject({ ok: false });
    expect(cleanAccessInput(input({ categories: "MATTRESS" }))).toMatchObject({ ok: false });
    expect(cleanAccessInput(input({ skuCodes: [{ code: "x" }] }))).toMatchObject({ ok: false });
    expect(cleanAccessInput(input({ modelIds: ["not-a-uuid"] }))).toMatchObject({ ok: false });
    expect(cleanAccessInput(input({ enabled: false, categories: [] }))).toMatchObject({ ok: true });
    // A 3PL's billing supplier sees Deliveries, not Sales Orders: access may be on with nothing shared.
    expect(cleanAccessInput(input({ enabled: true, categories: [] }), true)).toMatchObject({ ok: true, value: { enabled: true, categories: [] } });
  });
});

describe("finance", () => {
  it("passes on only the fields it names, whatever else the portal answers", () => {
    const summary = pickSummary({
      asOf: "2026-11-15", secret: "LEAK",
      totals: { orders: 1, contractValue: 3540, shareTotal: 1734.6, commissionTotal: 708, stripe: "LEAK" },
      months: [{ month: "2026-11", due: 59, dueShare: 28.91, commission: 11.8 }],
      orders: [{ id: "a", agreementNo: "RA-1", customerName: "Tan", ratePct: 49, stripeCustomerId: "cus_LEAK", phone: "0127770001", commissionBasePct: 20 }],
    });
    const text = JSON.stringify(summary);
    for (const word of ["LEAK", "commission", "stripe", "0127770001", "phone"]) expect(text).not.toContain(word);
    expect(summary.orders[0]).toMatchObject({ agreementNo: "RA-1", customerName: "Tan", ratePct: 49, soNo: null, collected: 0 });
    expect(summary.totals.orders).toBe(1);
  });
  it("one order's months keep to the same list", () => {
    const a = pickAgreement({
      asOf: "2026-11-15", order: { id: "a", agreementNo: "RA-1" },
      instalments: [{ seq: 1, dueDate: "2026-06-07", amountDue: 59, state: "paid", paidOn: "2026-06-07", paidAmount: 59, share: 28.91, daysLate: 0, reference: "REF-LEAK", stripeInvoiceId: "in_LEAK", method: "stripe" }],
    });
    expect(JSON.stringify(a)).not.toMatch(/LEAK|method|reference/);
    expect(Object.keys(a.instalments[0]!).sort()).toEqual(["amountDue", "daysLate", "dueDate", "paidAmount", "paidOn", "seq", "share", "state"]);
  });
  it("a body that is not what was expected answers empty figures, not an error", () => {
    expect(pickSummary(null)).toMatchObject({ asOf: "", months: [], orders: [] });
    expect(pickSummary({ orders: "x", totals: [] }).orders).toEqual([]);
  });
  it("signs with its own purpose word", async () => {
    const a = await signFinanceBody("s".repeat(32), "{}", 1_700_000_000_000);
    const b = await signFinanceBody("s".repeat(32), "{}", 1_700_000_000_000);
    expect(a).toEqual(b);
    expect(a.ts).toBe("1700000000000");
    expect((await signFinanceBody("t".repeat(32), "{}", 1_700_000_000_000)).signature).not.toBe(a.signature);
  });
});

describe("pickups", () => {
  it("the supplier's copy of a request is named field by field: staff names, the supplier id and anything new stay behind", () => {
    const line = { soDocNo: "CR-SO-1", soItemId: "i1", itemCode: "M1", description: "Cloud Queen", spec: "QUEEN", modelName: "Cloud", uom: "UNIT", qty: 2 };
    const p = {
      id: "1", requestNo: "CR-PKR-2611-001", supplierId: "sup-1", supplierName: "Maker", expectedDate: "2026-11-20", expectedTime: null,
      note: null, status: "ACCEPTED", requestedAt: "t1", acceptedAt: "t2", acceptedByName: "Ana", collectedAt: null, cancelledAt: null,
      cancelReason: null, soDocNos: ["CR-SO-1"], lineCount: 1, unitCount: 2, collectedBySupplierName: null, cancelledBySupplier: false,
      previousExpectedDate: "2026-11-18", dateChangedAt: "t3",
      ask: { kind: "date", date: "2026-11-25", askedAt: "t4", askedByName: "Ana", askedById: 7 },
      answer: { kind: "date", approved: true, date: "2026-11-20", answeredAt: "t5", reason: null, byName: "Jess" },
      deliveryOrder: { name: "DO-1.pdf", uploadedAt: "t6", size: 1234, key: "carres-supplier-do/sup-1/x.pdf" },
      orders: [{ docNo: "CR-SO-1", customerName: "Tan", phone: "0127770001" }],
      // A column a later edit adds to a line or to the request, and the names of the Carres staff who worked on it.
      lines: [{ ...line, unitCostSen: 12345 }], requestedByName: "Jess", collectedByName: "Ali", cancelledByName: null, internalNote: "margin 40%",
    } as unknown as StaffPickup;
    const out = forSupplier(p) as unknown as Record<string, unknown>;
    expect(Object.keys(out).sort()).toEqual([
      "acceptedAt", "acceptedByName", "answer", "ask", "cancelReason", "cancelledAt", "cancelledBySupplier", "collectedAt",
      "collectedBySupplierName", "dateChangedAt", "deliveryOrder", "expectedDate", "expectedTime", "id", "lineCount", "lines", "note",
      "orders", "previousExpectedDate", "requestNo", "requestedAt", "soDocNos", "status", "supplierName", "unitCount",
    ]);
    expect(out.lines).toEqual([line]);
    expect(out.ask).toEqual({ kind: "date", date: "2026-11-25", askedAt: "t4", askedByName: "Ana" });
    expect(out.answer).toEqual({ kind: "date", approved: true, date: "2026-11-20", answeredAt: "t5", reason: null });
    expect(out.deliveryOrder).toEqual({ name: "DO-1.pdf", uploadedAt: "t6", size: 1234 });
    expect(out.orders).toEqual([{ docNo: "CR-SO-1", customerName: "Tan" }]);
    // No Carres staff name, no supplier id, no file key, nothing a later column adds.
    expect(JSON.stringify(out)).not.toMatch(/Jess|Ali|sup-1|12345|margin|carres-supplier-do|0127770001|askedById/);
  });
  it("a list of request ids is each id once, between one and a hundred, all of them ids", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    expect(pickupIds([id, id])).toEqual([id]);
    expect(pickupIds([])).toBeNull();
    expect(pickupIds([id, "x"])).toBeNull();
    expect(pickupIds("x")).toBeNull();
    expect(pickupIds(Array.from({ length: 101 }, (_, i) => `11111111-1111-4111-8111-${String(i).padStart(12, "0")}`))).toBeNull();
  });
  it("today is the Kuala Lumpur day", () => {
    expect(todayMyt(Date.parse("2026-11-15T15:59:59Z"))).toBe("2026-11-15");
    expect(todayMyt(Date.parse("2026-11-15T16:00:00Z"))).toBe("2026-11-16");
  });
});

describe("permissions", () => {
  it("keeps only the department's own keys, each once, in the screens' order", () => {
    expect(cleanPerms("operation", ["a_export", "v_orders", "v_orders", "v_coll", "x", 7])).toEqual(["v_orders", "a_export"]);
    expect(cleanPerms("finance", ["a_users", "d_share", "v_orders"])).toEqual(["d_share", "a_users"]);
    expect(cleanPerms("operation", "v_orders")).toEqual([]);
  });
  it("a pickup button without the Pickup Requests page is off", () => {
    expect(cleanPerms("operation", ["a_accept", "a_collect", "a_date", "a_cancel", "a_export"])).toEqual(["a_export"]);
    expect(cleanPerms("operation", ["v_pickups", "a_accept"])).toEqual(["v_pickups", "a_accept"]);
  });
  it("reads what is stored only for the departments a person belongs to, and anything else as nothing", () => {
    const stored = JSON.stringify({ operation: allPerms("operation"), finance: allPerms("finance") });
    expect(readPerms(stored, { canOperation: true, canFinance: false })).toEqual({ operation: allPerms("operation"), finance: [] });
    expect(readPerms("not json", { canOperation: true, canFinance: true })).toEqual({ operation: [], finance: [] });
    expect(readPerms("[1,2]", { canOperation: true, canFinance: true })).toEqual({ operation: [], finance: [] });
    expect(readPerms({ finance: ["v_month"] }, { canOperation: false, canFinance: true })).toEqual({ operation: [], finance: ["v_month"] });
  });
});

describe("finance: what a person may see", () => {
  const raw = {
    asOf: "2026-11-16",
    totals: { orders: 1, contractValue: 1200, shareTotal: 588, collected: 300, collectedCount: 3, shareEarned: 147, toCollect: 900, shareToCome: 441, overdueOrders: 1, overdueMonths: 3, overdueAmount: 300, overdueShare: 147, defaultOrders: 0 },
    months: [{ month: "2026-09", due: 100, dueShare: 49, collected: 0, collectedShare: 0, open: 100, openShare: 49 }],
    orders: [{
      id: "a2", agreementNo: "RA-2", soNo: "SO-11", customerName: "Lim", item: "Cloud", termMonths: 12, monthlyFee: 100, ratePct: 49,
      startDate: "2026-06-07", status: "active", state: "behind", contractValue: 1200, shareTotal: 588, paidCount: 3, collected: 300,
      shareEarned: 147, toCollect: 900, shareToCome: 441, overdueMonths: 3, overdueAmount: 300, overdueShare: 147,
      nextDueDate: "2026-09-07", lastPaidOn: "2026-08-07",
      schedule: [
        { seq: 3, dueDate: "2026-08-07", state: "paid", amountDue: 100, share: 49, paidOn: "2026-08-07", stripe: "LEAK" },
        { seq: 4, dueDate: "2026-09-07", state: "late", amountDue: 100, share: 49, paidOn: null },
        { seq: 7, dueDate: "2026-12-07", state: "upcoming", amountDue: 100, share: 49, paidOn: null },
      ],
    }],
  };
  it("the summary carries each order's months, named field by field", () => {
    const s = pickSummary(raw);
    expect(s.orders[0]!.schedule).toHaveLength(3);
    expect(Object.keys(s.orders[0]!.schedule[0]!).sort()).toEqual(["amountDue", "dueDate", "paidOn", "seq", "share", "state"]);
    expect(JSON.stringify(s)).not.toContain("LEAK");
    expect(pickSummary({ orders: [{ id: "x" }] }).orders[0]!.schedule).toEqual([]);
  });
  it("everything visible: nothing changes", () => {
    const s = pickSummary(raw);
    expect(filterSummary(s, { names: true, share: true, bad: true })).toEqual(s);
  });
  it("without customer names: the name is blank", () => {
    const s = filterSummary(pickSummary(raw), { names: false, share: true, bad: true });
    expect(s.orders[0]!.customerName).toBe("");
    expect(JSON.stringify(s)).not.toContain("Lim");
  });
  it("without the share: every share figure and the rate are zero", () => {
    const s = filterSummary(pickSummary(raw), { names: true, share: false, bad: true });
    expect(s.totals).toMatchObject({ shareTotal: 0, shareEarned: 0, shareToCome: 0, overdueShare: 0 });
    expect(s.months[0]).toMatchObject({ dueShare: 0, collectedShare: 0, openShare: 0 });
    expect(s.orders[0]).toMatchObject({ ratePct: 0, shareTotal: 0, shareEarned: 0, shareToCome: 0, overdueShare: 0 });
    expect(s.orders[0]!.schedule.every((r) => r.share === 0)).toBe(true);
    expect(s.orders[0]!.collected).toBe(300);
  });
  it("without overdue and bad debt: nothing says an order is behind", () => {
    const s = filterSummary(pickSummary(raw), { names: true, share: true, bad: false });
    expect(s.totals).toMatchObject({ overdueOrders: 0, overdueMonths: 0, overdueAmount: 0, overdueShare: 0, defaultOrders: 0 });
    expect(s.orders[0]).toMatchObject({ state: "open", overdueMonths: 0, overdueAmount: 0, overdueShare: 0, nextDueDate: "2026-12-07" });
    expect(s.orders[0]!.schedule.map((r) => r.state)).toEqual(["paid", "unpaid", "upcoming"]);
    const a = filterAgreement(pickAgreement({
      asOf: "2026-11-16", order: raw.orders[0],
      instalments: [{ seq: 4, dueDate: "2026-09-07", amountDue: 100, state: "late", paidOn: null, paidAmount: null, share: 49, daysLate: 70 }],
    }), { names: true, share: true, bad: false });
    expect(a.instalments[0]).toMatchObject({ state: "unpaid", daysLate: 0 });
    expect(a.order.state).toBe("open");
  });
});

describe("Delivery Order files", () => {
  const bytes = (s: string) => new TextEncoder().encode(s);
  it("a PDF says so near its start; anything else is not one", () => {
    expect(isPdf(bytes("%PDF-1.7\n..."))).toBe(true);
    expect(isPdf(bytes(`${" ".repeat(500)}%PDF-1.4`))).toBe(true);
    expect(isPdf(bytes(`${" ".repeat(1100)}%PDF-1.4`))).toBe(false);
    expect(isPdf(bytes("<html>%PDF</html>"))).toBe(false);
    expect(isPdf(new Uint8Array())).toBe(false);
  });
  it("keeps the file's own name, without folders, quotes or control characters, ending in .pdf", () => {
    expect(deliveryOrderName("DO-2611-0412.pdf")).toBe("DO-2611-0412.pdf");
    expect(deliveryOrderName("C:\\scans\\DO 12.PDF")).toBe("DO 12.PDF");
    expect(deliveryOrderName("../../a\"b\u0007.pdf")).toBe("ab.pdf");
    expect(deliveryOrderName("signed")).toBe("signed.pdf");
    expect(deliveryOrderName("")).toBe("delivery-order.pdf");
  });
  it("downloads under its name, in plain letters and in full", () => {
    expect(attachmentHeader("DO 1.pdf")).toBe(`attachment; filename="DO 1.pdf"; filename*=UTF-8''DO%201.pdf`);
    expect(attachmentHeader("发货单.pdf")).toBe(`attachment; filename="___.pdf"; filename*=UTF-8''${encodeURIComponent("发货单.pdf")}`);
  });
});

describe("the invite email", () => {
  it("names who added the person, for which company, carries the link once in each form and says how long it lives", () => {
    const url = "https://supp.example.test/supplier/setup#t=SECRET";
    const m = inviteMail({ name: "Ana", inviterName: "Lim", supplierName: "ZZT Maker", companyName: "Carres", url });
    expect(m.subject).toBe("You are invited to the Carres supplier pages");
    expect(m.text).toContain("Lim added you to the Carres supplier pages for ZZT Maker.");
    expect(m.text).toContain("72 hours");
    expect(m.text.split(url)).toHaveLength(2);
    expect(m.html.split(url)).toHaveLength(2);
    expect(inviteMail({ name: "<b>x</b>", inviterName: "a", supplierName: "b", companyName: "c", url }).html).not.toContain("<b>x</b>");
    // A 3PL's people are invited to its delivery pages, never to "supplier pages" (owner, 19 Nov 2026).
    const t = inviteMail({ name: "Ana", inviterName: "Lim", supplierName: "AL Transport", companyName: "Carres", url, logistics: true });
    expect(t.text).toContain("delivery pages for AL Transport");
    expect(t.text).not.toContain("supplier pages");
  });
});

describe("a supplier's ask on the staff bell (owner, 17 Nov 2026)", () => {
  it("names the request first, then the supplier, the days in the one date format, and where to answer", () => {
    const move = askNoticeWords({ requestNo: "CR-PKR-2611-001", supplierName: "RED SOFA", kind: "date", currentDate: "2026-11-24", askDate: "2026-11-26" });
    expect(move).toEqual({
      title: "CR-PKR-2611-001: RED SOFA asks to move the pickup",
      body: "RED SOFA asks Carres to move pickup CR-PKR-2611-001 from 2026/11/24 to 2026/11/26. Nothing changes until you answer it in Supplier Pickups.",
    });
    const cancel = askNoticeWords({ requestNo: "CR-PKR-2611-001", supplierName: "RED SOFA", kind: "cancel", currentDate: "2026-11-24", askDate: null });
    expect(cancel).toEqual({
      title: "CR-PKR-2611-001: RED SOFA asks to cancel the pickup",
      body: "RED SOFA asks Carres to cancel pickup CR-PKR-2611-001, set for 2026/11/24. Nothing changes until you answer it in Supplier Pickups.",
    });
  });

  /** A stand-in for env.DB that answers by what each statement reads and keeps every statement that ran. */
  function fakeEnv(answers: { users?: unknown[]; rolePages?: unknown[]; live?: unknown[] }) {
    const ran: Array<{ sql: string; args: unknown[] }> = [];
    const prepare = (sql: string) => {
      let args: unknown[] = [];
      const stmt = {
        bind(...a: unknown[]) { args = a; return stmt; },
        async all() {
          ran.push({ sql, args });
          if (/FROM users u/.test(sql)) return { results: answers.users ?? [] };
          if (/FROM role_page_access/.test(sql)) return { results: answers.rolePages ?? [] };
          if (/FROM announcements/.test(sql)) return { results: answers.live ?? [] };
          return { results: [] };
        },
        async first() { ran.push({ sql, args }); return null; },
        async run() { ran.push({ sql, args }); return { success: true }; },
      };
      return stmt;
    };
    return { env: { DB: { prepare } } as never, ran };
  }
  const person = (id: number, perms: string[]) => ({
    id, role_id: id, role_permissions: JSON.stringify(perms), position_id: null, position_name: null, department_name: null,
    policy_cohort: null, policy_profile: null, policy_money: null, policy_config: null, policy_fleet: null, policy_duty: null,
  });

  it("goes to everyone who can answer in Supplier Pickups, the Owner role included, and to nobody else", async () => {
    const { env } = fakeEnv({
      // 1: the Owner role (every page). 2: Supply Chain, but not Purchase Orders. 3: Purchase Orders at edit by its
      // role's own page row. 4: Purchase Orders at view only: may read the page, may not answer.
      users: [person(1, ["*"]), person(2, ["scm.access", "scm.so.view_all"]), person(3, ["scm.access"]), person(4, ["scm.access"])],
      rolePages: [{ role_id: 3, page_key: "scm.procurement.po", level: "edit" }, { role_id: 4, page_key: "scm.procurement.po", level: "view" }],
    });
    expect((await askAudience(env)).sort()).toEqual([1, 3]);
  });

  it("is posted as a private notice for the bell's System tab, to those people", async () => {
    const { env, ran } = fakeEnv({ users: [person(1, ["*"]), person(2, ["scm.access"])] });
    await noticeSupplierAsk(env, { requestNo: "CR-PKR-2611-001", supplierName: "RED SOFA", kind: "date", currentDate: "2026-11-24", askDate: "2026-11-26" });
    const insert = ran.find((r) => /INSERT INTO announcements/.test(r.sql))!;
    expect(insert.args).toEqual(expect.arrayContaining([
      "CR-PKR-2611-001: RED SOFA asks to move the pickup", "[1]", "GENERAL", ASK_NOTICE_SOURCE,
    ]));
    // A notice never fails the ask: with no database at all it only logs.
    await expect(noticeSupplierAsk({} as never, { requestNo: "X", supplierName: "", kind: "cancel", currentDate: "2026-11-24", askDate: null })).resolves.toBeUndefined();
  });

  it("comes down for everyone once the ask is answered, taken back or overtaken", async () => {
    const { env, ran } = fakeEnv({ live: [{ id: "ann-1", target_user_ids: "[1,3]" }] });
    await takeDownAskNotice(env, "CR-PKR-2611-001");
    const read = ran.find((r) => /FROM announcements/.test(r.sql))!;
    expect(read.args).toEqual([ASK_NOTICE_SOURCE, "CR-PKR-2611-001: %"]);
    expect(ran.filter((r) => /UPDATE announcements SET is_active = 0/.test(r.sql)).map((r) => r.args)).toEqual([["ann-1"]]);
    // Nothing to take down: nothing is written.
    const quiet = fakeEnv({ live: [] });
    await takeDownAskNotice(quiet.env, "CR-PKR-2611-002");
    expect(quiet.ran.some((r) => /UPDATE/.test(r.sql))).toBe(false);
  });
});
