/**
 * The list's More filters beyond the date ranges, following Houzs's
 * so-list-filter-model. Every value rides the URL, as the date ranges do. Only
 * facts already on the list's read are offered.
 */
import { goodsCategoryWordOf, phoneKeysMy } from "@carres/shared";
import type { RegisterRow } from "../sales-order-columns";
import { isDelivered, klDay } from "./outright-columns";

/* The footer's goods words, in this fixed order (fix list 14 Oct, point 7). */
export const FOOTER_CATS = ["Mattress", "Pillow", "Bedframe", "Mattress protector", "Sofa", "Service", "Others"] as const;
export function footerCat(line: Parameters<typeof goodsCategoryWordOf>[0]): (typeof FOOTER_CATS)[number] {
  const word = goodsCategoryWordOf(line);
  return (FOOTER_CATS as readonly string[]).includes(word) ? (word as (typeof FOOTER_CATS)[number]) : "Others";
}

export const RANGE_FILTERS: { key: string; label: string; value: (r: RegisterRow) => number | null }[] = [
  { key: "so", label: "Sales order no.", value: (r) => r.so },
  { key: "balance", label: "Balance", value: (r) => (r.balance.kind === "settled" ? 0 : r.balance.kind === "amount" ? r.balance.value : null) },
  { key: "total", label: "Total", value: (r) => (r.total.kind === "amount" ? r.total.value : null) },
];

/* An order with an earlier placed_at on the same phone is Existing. An unread
   answer or a missing phone is Not recorded, never New. */
export type CustomerType = "New" | "Existing" | "Not recorded";
export function customerTypeOf(
  phone: string | null | undefined,
  placedAt: string | null | undefined,
  firstPlaced: Record<string, string> | undefined,
): CustomerType {
  if (!firstPlaced || !placedAt) return "Not recorded";
  const firsts = phoneKeysMy(phone).flatMap((k) => firstPlaced[k] ?? []);
  if (firsts.length === 0) return "Not recorded";
  return firsts.some((f) => new Date(f) < new Date(placedAt)) ? "Existing" : "New";
}

const remarksOf = (r: RegisterRow) => {
  const control = [r.o.ops_order_control ?? []].flat();
  return [
    ...(r.o.order_annotations ?? []).map((a) => a.content),
    ...control.flatMap((c) => [c.carres_remark, c.warehouse_remark, c.customer_request]),
  ].filter(Boolean).join("\n").toLowerCase();
};

const digits = (s: string) => s.replace(/\D/g, "");
export const TEXT_FILTERS: { key: string; label: string; matches: (r: RegisterRow, typed: string) => boolean }[] = [
  { key: "contact", label: "Contact no.", matches: (r, typed) => digits(typed) !== "" && r.phoneDigits.includes(digits(typed)) },
  { key: "email", label: "Email", matches: (r, typed) => (r.o.customer_email ?? "").toLowerCase().includes(typed.trim().toLowerCase()) },
  { key: "createdBy", label: "Created by", matches: (r, typed) => (r.o.created_by_name ?? "").toLowerCase().includes(typed.trim().toLowerCase()) },
  { key: "remarks", label: "Remarks", matches: (r, typed) => remarksOf(r).includes(typed.trim().toLowerCase()) },
];

export const isOverdue = (r: RegisterRow, today: string) =>
  Boolean(r.o.delivery_date) && klDay(r.o.delivery_date!) < today && !isDelivered(r);
/* The statuses the database itself treats as a live amendment. */
const LIVE_AMENDMENT = ["draft", "submitted", "issued", "accepted"];
const hasPendingAmendment = (r: RegisterRow) => (r.o.amendment_documents ?? []).some((a) => LIVE_AMENDMENT.includes(a.status ?? ""));

export const CHOICE_FILTERS: {
  key: string;
  label: string;
  choices: { value: string; label: string }[];
  matches: (r: RegisterRow, value: string, today: string, customerType: CustomerType) => boolean;
}[] = [
  {
    key: "overdue", label: "Overdue",
    choices: [{ value: "yes", label: "Delivery date passed, not delivered" }],
    matches: (r, _value, today) => isOverdue(r, today),
  },
  {
    key: "category", label: "Item category",
    choices: FOOTER_CATS.map((c) => ({ value: c, label: c })),
    matches: (r, value) => (r.o.order_lines ?? []).some((l) => footerCat(l) === value),
  },
  {
    key: "amendment", label: "Pending amendment",
    choices: [{ value: "yes", label: "Has a pending amendment" }, { value: "no", label: "No pending amendment" }],
    matches: (r, value) => hasPendingAmendment(r) === (value === "yes"),
  },
  {
    key: "customerType", label: "Customer type",
    choices: [{ value: "New", label: "New" }, { value: "Existing", label: "Existing" }],
    matches: (_r, value, _today, customerType) => customerType === value,
  },
];

const MORE_PREFIXES = ["min.", "max.", "has.", "is."];
export const isMoreFilterParam = (key: string) => MORE_PREFIXES.some((p) => key.startsWith(p));

export function matchesMoreFilters(r: RegisterRow, params: URLSearchParams, today: string, customerType: CustomerType = "Not recorded"): boolean {
  for (const f of RANGE_FILTERS) {
    const min = params.get(`min.${f.key}`), max = params.get(`max.${f.key}`);
    if (!min && !max) continue;
    const v = f.value(r);
    if (v == null || (min && v < Number(min)) || (max && v > Number(max))) return false;
  }
  for (const f of TEXT_FILTERS) {
    const typed = params.get(`has.${f.key}`);
    if (typed && !f.matches(r, typed)) return false;
  }
  for (const f of CHOICE_FILTERS) {
    const value = params.get(`is.${f.key}`);
    if (value && !f.matches(r, value, today, customerType)) return false;
  }
  return true;
}

/** One chip for each filter in use: its words and the params it clears. */
export function moreFilterChips(params: URLSearchParams): { key: string; label: string; params: string[] }[] {
  const out: { key: string; label: string; params: string[] }[] = [];
  for (const f of RANGE_FILTERS) {
    const min = params.get(`min.${f.key}`), max = params.get(`max.${f.key}`);
    if (min || max) out.push({ key: `min-${f.key}`, label: `${f.label}: ${min || "Any"} to ${max || "Any"}`, params: [`min.${f.key}`, `max.${f.key}`] });
  }
  for (const f of TEXT_FILTERS) {
    const typed = params.get(`has.${f.key}`);
    if (typed) out.push({ key: `has-${f.key}`, label: `${f.label}: ${typed}`, params: [`has.${f.key}`] });
  }
  for (const f of CHOICE_FILTERS) {
    const value = params.get(`is.${f.key}`);
    const word = f.choices.find((c) => c.value === value)?.label;
    if (word) out.push({ key: `is-${f.key}`, label: `${f.label}: ${word}`, params: [`is.${f.key}`] });
  }
  return out;
}

/* Houzs's date presets. Weeks start on Monday. */
export const DATE_PRESETS = [
  { value: "yesterday", label: "Yesterday" },
  { value: "today", label: "Today" },
  { value: "tomorrow", label: "Tomorrow" },
  { value: "last_week", label: "Last week" },
  { value: "this_week", label: "This week" },
  { value: "next_week", label: "Next week" },
  { value: "last_month", label: "Last month" },
  { value: "this_month", label: "This month" },
  { value: "next_month", label: "Next month" },
] as const;

const iso = (d: Date) => d.toISOString().slice(0, 10);
const utc = (today: string) => {
  const [y, m, d] = today.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!));
};
const addDays = (today: string, n: number) => {
  const d = utc(today);
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
};

export function presetRange(preset: string, today: string): { from: string; to: string } | null {
  const monday = addDays(today, -((utc(today).getUTCDay() + 6) % 7));
  const week = (n: number) => ({ from: addDays(monday, 7 * n), to: addDays(monday, 7 * n + 6) });
  const month = (n: number) => {
    const d = utc(today);
    return { from: iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1))), to: iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n + 1, 0))) };
  };
  const day = (n: number) => ({ from: addDays(today, n), to: addDays(today, n) });
  switch (preset) {
    case "yesterday": return day(-1);
    case "today": return day(0);
    case "tomorrow": return day(1);
    case "last_week": return week(-1);
    case "this_week": return week(0);
    case "next_week": return week(1);
    case "last_month": return month(-1);
    case "this_month": return month(0);
    case "next_month": return month(1);
    default: return null;
  }
}
