/**
 * What a subscription supplier reads of the money it has a share in (the Supplier Platform's Finance pages).
 *
 * The supplier (docs/rental/MASTER.md §0: for now Diglant) is paid a share of each subscription month Carres
 * collects. This file turns agreements and their instalment rows into the figures the supplier sees:
 *
 *   - every order's value, what has been collected, and the share earned so far;
 *   - what is still to come if every month is paid, and the share in it;
 *   - who is behind, by how many months and how much.
 *
 * ONE ARITHMETIC. The share of a COLLECTED month is the figure the payment writer stored on the instalment
 * (`rental_billings.supplier_share`); it is read, never worked out again. The share of a month still to come uses
 * the same formula the writer will use when it is paid (`rentalMonthlySplit`), on the agreement's own rate.
 * "Late" is the meaning the collections screen already uses: an instalment whose due day has passed with no money.
 *
 * NOTHING ELSE LEAVES. The rows carry no Stripe id, payment reference, method, commission, phone, identity number
 * or signature: the types below are the whole list, and the route that builds them selects only these columns.
 */
import { rentalMonthlySplit } from "./rental";

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** docs/rental/MASTER.md §0: six unpaid instalments allow the agreement to be ended. */
export const SUPPLIER_FINANCE_DEFAULT_MONTHS = 6;

export interface SupplierFinanceAgreementRow {
  id: string;
  agreementNo: string;
  soNo: string | null;
  customerName: string;
  item: string;
  termMonths: number;
  monthlyFee: number;
  ratePct: number;
  startDate: string | null;
  status: string;
}

export interface SupplierFinanceBillingRow {
  agreementId: string;
  seq: number;
  /** YYYY-MM-DD. */
  dueDate: string;
  amountDue: number;
  /** due · paid · overdue · waived · written_off */
  status: string;
  /** The Kuala Lumpur day the money was received, YYYY-MM-DD. */
  paidOn: string | null;
  paidAmount: number | null;
  /** The supplier's share stored when the month was collected. */
  supplierShare: number | null;
}

export type SupplierFinanceInstalmentState = "paid" | "late" | "due" | "upcoming" | "waived";

export interface SupplierFinanceInstalment {
  seq: number;
  dueDate: string;
  amountDue: number;
  state: SupplierFinanceInstalmentState;
  paidOn: string | null;
  paidAmount: number | null;
  /** Earned when paid; what will be earned when it is still to come; 0 when waived. */
  share: number;
  daysLate: number;
}

export type SupplierFinanceOrderState = "on_time" | "behind" | "default" | "completed" | "ended";

export interface SupplierFinanceOrder {
  id: string;
  agreementNo: string;
  soNo: string | null;
  customerName: string;
  item: string;
  termMonths: number;
  monthlyFee: number;
  ratePct: number;
  startDate: string | null;
  status: string;
  state: SupplierFinanceOrderState;
  contractValue: number;
  /** The share if every month is paid: earned so far plus still to come. */
  shareTotal: number;
  paidCount: number;
  collected: number;
  shareEarned: number;
  toCollect: number;
  shareToCome: number;
  overdueMonths: number;
  overdueAmount: number;
  overdueShare: number;
  nextDueDate: string | null;
  lastPaidOn: string | null;
}

export interface SupplierFinanceMonth {
  /** YYYY-MM, the month the instalments fall due. */
  month: string;
  due: number;
  dueShare: number;
  collected: number;
  collectedShare: number;
  open: number;
  openShare: number;
}

export interface SupplierFinanceTotals {
  orders: number;
  contractValue: number;
  shareTotal: number;
  collected: number;
  collectedCount: number;
  shareEarned: number;
  toCollect: number;
  shareToCome: number;
  overdueOrders: number;
  overdueMonths: number;
  overdueAmount: number;
  overdueShare: number;
  defaultOrders: number;
}

export interface SupplierFinanceSummary {
  asOf: string;
  totals: SupplierFinanceTotals;
  months: SupplierFinanceMonth[];
  orders: SupplierFinanceOrder[];
}

const isPaid = (b: SupplierFinanceBillingRow) => b.status === "paid";
const isClosedUnpaid = (b: SupplierFinanceBillingRow) => b.status === "waived" || b.status === "written_off";
const isOpen = (b: SupplierFinanceBillingRow) => !isPaid(b) && !isClosedUnpaid(b);

const daysBetween = (from: string, to: string): number =>
  Math.max(0, Math.floor((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000));

/** The supplier's share of one instalment: stored when collected, the writer's own formula when still to come. */
function shareOf(b: SupplierFinanceBillingRow, ratePct: number): number {
  if (isPaid(b)) {
    return b.supplierShare != null ? round2(b.supplierShare) : rentalMonthlySplit(b.paidAmount ?? b.amountDue, ratePct, 0).supplierShare;
  }
  if (isClosedUnpaid(b)) return 0;
  return rentalMonthlySplit(b.amountDue, ratePct, 0).supplierShare;
}

/** One agreement's schedule as the supplier reads it. `today` is the Kuala Lumpur day, YYYY-MM-DD. */
export function supplierFinanceInstalments(
  agreement: Pick<SupplierFinanceAgreementRow, "ratePct">, billings: SupplierFinanceBillingRow[], today: string,
): SupplierFinanceInstalment[] {
  return [...billings].sort((a, b) => a.seq - b.seq).map((b) => {
    const late = isOpen(b) && b.dueDate < today;
    const state: SupplierFinanceInstalmentState = isPaid(b) ? "paid" : isClosedUnpaid(b) ? "waived" : late ? "late" : b.dueDate === today ? "due" : "upcoming";
    return {
      seq: b.seq,
      dueDate: b.dueDate,
      amountDue: round2(b.amountDue),
      state,
      paidOn: isPaid(b) ? b.paidOn : null,
      paidAmount: isPaid(b) ? round2(b.paidAmount ?? 0) : null,
      share: shareOf(b, agreement.ratePct),
      daysLate: late ? daysBetween(b.dueDate, today) : 0,
    };
  });
}

/** One agreement's figures. */
export function supplierFinanceOrder(
  agreement: SupplierFinanceAgreementRow, billings: SupplierFinanceBillingRow[], today: string,
): SupplierFinanceOrder {
  const paid = billings.filter(isPaid);
  const open = billings.filter(isOpen);
  const late = open.filter((b) => b.dueDate < today);
  const sum = (rows: SupplierFinanceBillingRow[], f: (b: SupplierFinanceBillingRow) => number) => round2(rows.reduce((a, b) => a + f(b), 0));
  const shareEarned = sum(paid, (b) => shareOf(b, agreement.ratePct));
  const shareToCome = sum(open, (b) => shareOf(b, agreement.ratePct));
  const overdueMonths = late.length;
  const state: SupplierFinanceOrderState =
    agreement.status === "cancelled" ? "ended"
      : agreement.status === "defaulted" || agreement.status === "repossessed" || overdueMonths >= SUPPLIER_FINANCE_DEFAULT_MONTHS ? "default"
        : overdueMonths > 0 ? "behind"
          : open.length === 0 && paid.length > 0 ? "completed"
            : "on_time";
  const nextDue = [...open].sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];
  const lastPaid = paid.map((b) => b.paidOn).filter((d): d is string => !!d).sort().pop();
  return {
    id: agreement.id,
    agreementNo: agreement.agreementNo,
    soNo: agreement.soNo,
    customerName: agreement.customerName,
    item: agreement.item,
    termMonths: agreement.termMonths,
    monthlyFee: round2(agreement.monthlyFee),
    ratePct: agreement.ratePct,
    startDate: agreement.startDate,
    status: agreement.status,
    state,
    contractValue: round2(agreement.monthlyFee * agreement.termMonths),
    shareTotal: round2(shareEarned + shareToCome),
    paidCount: paid.length,
    collected: sum(paid, (b) => b.paidAmount ?? 0),
    shareEarned,
    toCollect: sum(open, (b) => b.amountDue),
    shareToCome,
    overdueMonths,
    overdueAmount: sum(late, (b) => b.amountDue),
    overdueShare: sum(late, (b) => shareOf(b, agreement.ratePct)),
    nextDueDate: nextDue?.dueDate ?? null,
    lastPaidOn: lastPaid ?? null,
  };
}

/** Every agreement's figures, their totals, and the money by the month it falls due. */
export function supplierFinanceSummary(
  agreements: SupplierFinanceAgreementRow[], billings: SupplierFinanceBillingRow[], today: string,
): SupplierFinanceSummary {
  const byAgreement = new Map<string, SupplierFinanceBillingRow[]>();
  for (const b of billings) byAgreement.set(b.agreementId, [...(byAgreement.get(b.agreementId) ?? []), b]);

  // An agreement with no schedule has nothing to show yet (it is not approved), so it is not an order here.
  const withSchedule = agreements.filter((a) => (byAgreement.get(a.id) ?? []).length > 0);
  const orders = withSchedule
    .map((a) => supplierFinanceOrder(a, byAgreement.get(a.id) ?? [], today))
    .sort((a, b) => b.overdueMonths - a.overdueMonths || (a.startDate ?? "").localeCompare(b.startDate ?? "") || a.agreementNo.localeCompare(b.agreementNo));

  const months = new Map<string, SupplierFinanceMonth>();
  for (const a of withSchedule) {
    for (const b of byAgreement.get(a.id) ?? []) {
      if (isClosedUnpaid(b)) continue;
      const key = b.dueDate.slice(0, 7);
      const m = months.get(key) ?? { month: key, due: 0, dueShare: 0, collected: 0, collectedShare: 0, open: 0, openShare: 0 };
      const share = shareOf(b, a.ratePct);
      m.due += b.amountDue;
      m.dueShare += share;
      if (isPaid(b)) {
        m.collected += b.paidAmount ?? 0;
        m.collectedShare += share;
      } else {
        m.open += b.amountDue;
        m.openShare += share;
      }
      months.set(key, m);
    }
  }

  const total = (f: (o: SupplierFinanceOrder) => number) => round2(orders.reduce((a, o) => a + f(o), 0));
  return {
    asOf: today,
    totals: {
      orders: orders.length,
      contractValue: total((o) => o.contractValue),
      shareTotal: total((o) => o.shareTotal),
      collected: total((o) => o.collected),
      collectedCount: orders.reduce((a, o) => a + o.paidCount, 0),
      shareEarned: total((o) => o.shareEarned),
      toCollect: total((o) => o.toCollect),
      shareToCome: total((o) => o.shareToCome),
      overdueOrders: orders.filter((o) => o.overdueMonths > 0).length,
      overdueMonths: orders.reduce((a, o) => a + o.overdueMonths, 0),
      overdueAmount: total((o) => o.overdueAmount),
      overdueShare: total((o) => o.overdueShare),
      defaultOrders: orders.filter((o) => o.state === "default").length,
    },
    months: [...months.values()]
      .sort((a, b) => a.month.localeCompare(b.month))
      .map((m) => ({
        month: m.month, due: round2(m.due), dueShare: round2(m.dueShare), collected: round2(m.collected),
        collectedShare: round2(m.collectedShare), open: round2(m.open), openShare: round2(m.openShare),
      })),
    orders,
  };
}
