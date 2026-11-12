/**
 * wa-templates — the locked WhatsApp templates (Jess 2026-07-13, two-tone
 * refine; copy source of truth = docs/whatsapp-chase-templates.md).
 *
 * Every audience gets TWO tones:
 *   Reminder — gentle, first contact.
 *   Chase    — firmer follow-up.
 *
 * Audience → lead id (locked): CUSTOMER + LOGISTIC are REF-led, SUPPLIER is
 * PO-led — never the SO number (external parties don't speak SO).
 *
 * Copy rules (locked):
 *  - Multi-line: REAL line breaks ("\n"); `waEncode` turns them into %0A for a
 *    wa.me deep link. Clipboard copy keeps the real breaks.
 *  - {items} = ONE line per item: "{qty}× {model}".
 *  - Customer messages carry NO delivery date and no pressure phrasing
 *    ("settle by", "deliver on time") — the logistic partner contacts the
 *    customer for the final slot; if the customer asks about delivery, ops
 *    replies with the partner's contact.
 *  - {salutation} = the optional preferred-name/title field when set, else the
 *    customer name through the ONE display rule. NEVER auto-infer Mr/Ms.
 */
import { displayCustomerName } from "@/lib/customer-name";

/*
 * `titleCaseName` is DELETED — owner ruling 2026-08-15.
 *
 * It lowercased the tail of every word to soften `LEE WEI YANG` into
 * `Lee Wei Yang`, which reads well until the name is initials: it also turned
 * `KJ NG` into `Kj Ng`, and a WhatsApp message addressed to `Kj` is addressed
 * to nobody. The owner ruled that a greeting obeys the same capitalize-up rule
 * as the screen. `displayCustomerName` is the one entry point, and this
 * function is deleted rather than re-pointed at it, because a second name for
 * one rule is how two rules come back.
 */

/** The customer salutation: the optional preferred-name/title field if set,
 *  else the customer name through the ONE display rule (capitalize up only —
 *  `@/lib/customer-name`). Never auto-infers Mr/Ms. */
export function salutationOf(
  preferred: string | null | undefined,
  customerName: string | null | undefined,
): string {
  const p = (preferred ?? "").trim();
  if (p) return p;
  const n = (customerName ?? "").trim();
  return n ? displayCustomerName(n) : "there";
}

/** RM figure for templates — thousands-separated, no currency prefix
 *  (the template carries "RM " itself). */
export function rmAmount(n: number): string {
  return Math.round(Number(n) || 0).toLocaleString();
}

/** {items} block — ONE line per item: "{qty}× {model}". */
/** One labelled message line; an absent value omits the whole line — a message
 *  never prints a dash for a value (no dash anywhere, owner ruling 2026-09-26). */
function factLine(label: string, value: string | null | undefined, suffix = ""): string {
  return value ? `${label}: ${value}${suffix}\n` : "";
}

export function itemsBlock(lines: { sku: string; qty: number }[]): string {
  if (lines.length === 0) return "";
  return lines.map((l) => `${l.qty}× ${l.sku}`).join("\n");
}

// ── CUSTOMER (money) — REF-led, no delivery date, no pressure ───────────────
export interface CustomerChaseInput {
  /** Resolved salutation (see salutationOf). */
  salutation: string;
  ref: string | null;
  /** Live Outstanding = Total − Collected, already thousands-formatted. */
  outstanding: string;
  lines: { sku: string; qty: number }[];
}

/** Gentle first contact. */
export function buildCustomerReminder(i: CustomerChaseInput): string {
  return (
    `Hi ${i.salutation},\n` +
    `Just a friendly reminder regarding your order.\n` +
    `\n` +
    factLine("REF", i.ref) +
    `Outstanding: RM ${i.outstanding}\n` +
    factLine("Item", itemsBlock(i.lines)) +
    `\n` +
    `Do let us know once arranged. Thank you!`
  );
}

/** Delivery-eve FINAL reminder (page-rebuild §3.2, Jess 2026-07-15): the
 *  Balance panel's Remind switches to this tone when delivery is today/
 *  tomorrow and the balance is still owing. This is the ONE customer template
 *  allowed to reference delivery timing — the locked "no delivery date" rule
 *  still holds for the ordinary reminder/chase. `when` = "today"/"tomorrow". */
export function buildCustomerFinalReminder(
  i: CustomerChaseInput & { when: string },
): string {
  return (
    `Hi ${i.salutation},\n` +
    `Final reminder.\n` +
    `Your delivery is arranged for ${i.when} and the balance below is still outstanding.\n` +
    `\n` +
    factLine("REF", i.ref) +
    `Outstanding: RM ${i.outstanding}\n` +
    factLine("Item", itemsBlock(i.lines)) +
    `\n` +
    `Kindly settle before delivery so everything can proceed as planned. Thank you!`
  );
}

/** Firmer follow-up. */
export function buildCustomerChase(i: CustomerChaseInput): string {
  return (
    `Hi ${i.salutation},\n` +
    `Following up on your order.\n` +
    `The balance below is still outstanding.\n` +
    `\n` +
    factLine("REF", i.ref) +
    `Outstanding: RM ${i.outstanding}\n` +
    factLine("Item", itemsBlock(i.lines)) +
    `\n` +
    `Kindly arrange payment so we can proceed. Thank you!`
  );
}

// ── LOGISTIC partner — REF-led (never SO) ────────────────────────────────────
export interface LogisticChaseInput {
  logistic: string | null;
  ref: string | null;
  customer: string | null;
  region: string | null;
  lines: { sku: string; qty: number }[];
  /** Display deadline, e.g. "6 Jul 26" or "TBD". */
  deadline: string;
  overdue: boolean;
}

/** Gentle first contact — ask for the arrangement. */
export function buildLogisticReminder(i: LogisticChaseInput): string {
  return (
    `Hi ${i.logistic ?? "team"},\n` +
    `Friendly reminder.\n` +
    `This delivery still needs an arrangement.\n` +
    `\n` +
    factLine("REF", i.ref) +
    factLine("Customer", i.customer, i.region ? ` (${i.region})` : "") +
    factLine("Item", itemsBlock(i.lines)) +
    `Deadline: ${i.deadline}\n` +
    `\n` +
    `Please confirm the delivery date + time slot with the customer. Thank you!`
  );
}

/** Firmer follow-up — the deadline is at risk / passed. */
export function buildLogisticChase(i: LogisticChaseInput): string {
  return (
    `Hi ${i.logistic ?? "team"},\n` +
    `Following up.\n` +
    `This delivery is still not booked${i.overdue ? " and the deadline has passed" : ""}.\n` +
    `\n` +
    factLine("REF", i.ref) +
    factLine("Customer", i.customer, i.region ? ` (${i.region})` : "") +
    factLine("Item", itemsBlock(i.lines)) +
    `Deadline: ${i.deadline}${i.overdue ? " · passed" : ""}\n` +
    `\n` +
    `Please confirm the delivery date + time slot with the customer today. Thank you!`
  );
}

// ── SUPPLIER — PO-led (never SO) ─────────────────────────────────────────────
export interface SupplierChaseInput {
  poNo: string | null;
  ref: string | null;
  lines: { sku: string; qty: number }[];
  /** Display date the stock is needed by. */
  deadline: string;
}

/** Gentle first contact — ask for the ETA. */
export function buildSupplierReminder(i: SupplierChaseInput): string {
  return (
    `Hi,\n` +
    `Friendly reminder.\n` +
    `Checking the stock ETA for this PO.\n` +
    `\n` +
    factLine("PO", i.poNo) +
    factLine("Our ref", i.ref) +
    factLine("Item", itemsBlock(i.lines)) +
    `Needed by: ${i.deadline}\n` +
    `\n` +
    `Please advise when the stock will be ready. Thank you!`
  );
}

/** Firmer follow-up — still no ETA / stock late. */
export function buildSupplierChase(i: SupplierChaseInput): string {
  return (
    `Hi,\n` +
    `Following up.\n` +
    `We still need the stock ETA for this PO.\n` +
    `\n` +
    factLine("PO", i.poNo) +
    factLine("Our ref", i.ref) +
    factLine("Item", itemsBlock(i.lines)) +
    `Needed by: ${i.deadline}\n` +
    `\n` +
    `Please confirm the ready date today so we can plan the delivery. Thank you!`
  );
}





// ── LOGISTIC GROUP — ONE message per partner, covering many deliveries ───────
// Mirrors the supplier group message, but a delivery is DISTINCT per customer
// (different address + date), so we DON'T aggregate by SKU across orders — each
// order is its own block: REF · customer (region) · items · deadline. One
// WhatsApp group per partner (NETS/AL/TEOW/TT) gets a single message listing
// every selected order — Remind (before deadline) or Chase (already late).
export interface PartnerGroupRow {
  ref: string | null;
  customer: string | null;
  region: string | null;
  /** Display deadline, e.g. "6 Jul 26" or "TBD". */
  deadline: string;
  overdue: boolean;
  items: { sku: string; qty: number }[];
}


