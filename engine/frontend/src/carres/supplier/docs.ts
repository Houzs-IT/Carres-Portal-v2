// Carres only (not part of Houzs's code): the PDFs a supplier downloads from its own pages.
//
// Made in the browser from what the page already shows, so a PDF can never carry more than the supplier may read:
// a Sales Order with the supplier's items only (no price, cost, phone or note), a Pickup Request, and a subscription
// order's statement (its money only as the person's access allows). They are drawn here, not with the staff
// documents' kit (vendor/scm/lib/pdf-common.ts), because that kit reads the company letterhead through the staff
// sign-in, which a supplier page never touches.
import type { FinanceOrder, FinanceVisible, Order, Pickup, ScheduleItem } from "./api";
import { clock12, fmtDay, fmtStamp, instalmentBadge, money, orderPickupBadge, pickupBadge, stageBadge } from "./ui";

type JsPdf = import("jspdf").jsPDF;
type AutoTable = (doc: JsPdf, options: Record<string, unknown>) => void;

const NAVY: [number, number, number] = [27, 27, 57];
const MUTED: [number, number, number] = [107, 114, 128];
const INK: [number, number, number] = [17, 24, 39];
const LINE: [number, number, number] = [229, 231, 235];

async function start(): Promise<{ doc: JsPdf; table: AutoTable }> {
  const [{ jsPDF }, auto] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  return { doc: new jsPDF({ compress: true, unit: "mm", format: "a4", orientation: "portrait" }), table: auto.default as unknown as AutoTable };
}

/** The letterhead: the company on the left, the document's name and number on the right, a rule under them. */
function head(doc: JsPdf, company: string, title: string, number: string, sub: string): number {
  const w = doc.internal.pageSize.getWidth();
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(...NAVY);
  doc.text(company.toUpperCase(), 14, 18);
  doc.setFontSize(12);
  doc.setTextColor(...INK);
  doc.text(title, w - 14, 15, { align: "right" });
  doc.setFont("courier", "bold");
  doc.setFontSize(11);
  doc.text(number, w - 14, 21, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(...MUTED);
  doc.text(sub, w - 14, 26, { align: "right" });
  doc.setDrawColor(...LINE);
  doc.setLineWidth(0.3);
  doc.line(14, 30, w - 14, 30);
  return 37;
}

/** Two columns of label and value under the letterhead. */
function facts(doc: JsPdf, y: number, rows: Array<[string, string]>): number {
  const w = doc.internal.pageSize.getWidth();
  const colW = (w - 28) / 2;
  let maxY = y;
  rows.forEach(([label, value], i) => {
    const x = 14 + (i % 2) * colW;
    const rowY = y + Math.floor(i / 2) * 11;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    doc.setTextColor(...MUTED);
    doc.text(label.toUpperCase(), x, rowY);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);
    doc.setTextColor(...INK);
    const lines = doc.splitTextToSize(value || "-", colW - 6) as string[];
    doc.text(lines.slice(0, 2), x, rowY + 4.5);
    maxY = Math.max(maxY, rowY + 4.5 + (Math.min(lines.length, 2) - 1) * 4);
  });
  return maxY + 8;
}

function foot(doc: JsPdf, text: string): void {
  const pages = doc.getNumberOfPages();
  const w = doc.internal.pageSize.getWidth();
  const h = doc.internal.pageSize.getHeight();
  for (let p = 1; p <= pages; p += 1) {
    doc.setPage(p);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...MUTED);
    doc.text(text, 14, h - 10);
    doc.text(`Page ${p} of ${pages}`, w - 14, h - 10, { align: "right" });
  }
}

const tableStyle = {
  theme: "plain",
  styles: { font: "helvetica", fontSize: 8.5, cellPadding: 2, textColor: INK, lineColor: LINE, lineWidth: { bottom: 0.2 } },
  headStyles: { fontStyle: "bold", textColor: [75, 85, 99], fillColor: [248, 249, 250], lineWidth: { top: 0.3, bottom: 0.3 } },
  margin: { left: 14, right: 14 },
};

const madeOn = () => `Made ${fmtStamp(new Date().toISOString())} from the supplier pages. No price is shown.`;

/** A Sales Order with only the supplier's own items on it. */
export async function orderPdf(o: Order, supplier: string, company = "Carres"): Promise<void> {
  const { doc, table } = await start();
  let y = head(doc, company, "SALES ORDER", o.docNo, `Your items only · ${supplier}`);
  y = facts(doc, y, [
    ["Customer", o.customerName],
    ["Stage", stageBadge(o.status).label],
    ["SO Date", fmtDay(o.soDate)],
    ["Sale Type", o.saleType.toLowerCase() === "subscription" ? "Subscription" : "Outright"],
    ["Processing Date", fmtDay(o.processingDate) || "Not processed yet"],
    ["Delivery Date", fmtDay(o.deliveryDate) || "Not set yet"],
    ["Delivery Address", o.addressLines.join(", ")],
    ["Pickup", orderPickupBadge(o.pickupState).label],
  ]);
  table(doc, {
    ...tableStyle,
    startY: y,
    head: [["#", "Item", "Item Code", "Specification", "Qty", "Pickup"]],
    body: o.lines.map((l, i) => [
      String(i + 1), `${l.description}${l.modelName ? ` · ${l.modelName}` : ""}`, l.itemCode, l.spec || "Standard", `${l.qty} ${l.uom}`, orderPickupBadge(l.pickup.state).label,
    ]),
    columnStyles: { 0: { cellWidth: 8 }, 2: { font: "courier", cellWidth: 30 }, 4: { halign: "right", cellWidth: 18 }, 5: { cellWidth: 28 } },
  });
  foot(doc, madeOn());
  doc.save(`${o.docNo}.pdf`);
}

/** A pickup request: when Carres collects, and every line it collects, by Sales Order. */
export async function pickupPdf(p: Pickup, supplier: string, company = "Carres"): Promise<void> {
  const { doc, table } = await start();
  const customer = new Map((p.orders ?? []).map((o) => [o.docNo, o.customerName]));
  let y = head(doc, company, "PICKUP REQUEST", p.requestNo, supplier);
  y = facts(doc, y, [
    ["Carres collects on", `${fmtDay(p.expectedDate)}${p.expectedTime ? `, ${clock12(p.expectedTime)}` : ""}`],
    ["Status", pickupBadge(p).label],
    ["Requested by Carres", fmtStamp(p.requestedAt)],
    ["Accepted", p.acceptedAt ? `${fmtStamp(p.acceptedAt)}${p.acceptedByName ? ` · ${p.acceptedByName}` : ""}` : "Not accepted yet"],
    ["Sales Orders", p.soDocNos.join(", ")],
    ["Note from Carres", p.note || "No note"],
  ]);
  table(doc, {
    ...tableStyle,
    startY: y,
    head: [["SO No", "Customer", "Item", "Item Code", "Specification", "Qty"]],
    body: p.lines.map((l) => [l.soDocNo, customer.get(l.soDocNo) ?? "", `${l.description}${l.modelName ? ` · ${l.modelName}` : ""}`, l.itemCode, l.spec || "Standard", `${l.qty} ${l.uom}`]),
    foot: [["", "", "", "", "Total", `${p.unitCount} units`]],
    footStyles: { fontStyle: "bold", fillColor: [248, 249, 250] },
    columnStyles: { 0: { font: "courier", cellWidth: 28 }, 3: { font: "courier", cellWidth: 26 }, 5: { halign: "right", cellWidth: 20 } },
  });
  foot(doc, `Made ${fmtStamp(new Date().toISOString())} from the supplier pages.`);
  doc.save(`${p.requestNo}.pdf`);
}

/** A subscription order's statement: its figures and every instalment, as far as the person may see them. */
export async function statementPdf(o: FinanceOrder, schedule: ScheduleItem[], visible: FinanceVisible, supplier: string, company = "Carres"): Promise<void> {
  const { doc, table } = await start();
  const title = o.soNo ?? o.agreementNo;
  let y = head(doc, company, "STATEMENT", title, `Subscription order · ${supplier}`);
  const rows: Array<[string, string]> = [
    ["Agreement No", o.agreementNo],
    ["Sales Order", o.soNo ?? "Not linked"],
    ...(visible.names ? [["Customer", o.customerName] as [string, string]] : []),
    ["Item", o.item],
    ["Start Date", fmtDay(o.startDate) || "Not started"],
    ["Monthly", money(o.monthlyFee)],
    ["Order Value", money(o.contractValue)],
    ["Paid So Far", `${money(o.collected)} · ${o.paidCount} of ${o.termMonths} months`],
    ...(visible.share ? [["Your Share Earned", money(o.shareEarned)] as [string, string], ["Your Share to Come", money(o.shareToCome)] as [string, string]] : []),
    ...(visible.bad ? [["Overdue", o.overdueMonths ? `${money(o.overdueAmount)} · ${o.overdueMonths} months` : "None"] as [string, string]] : []),
  ];
  y = facts(doc, y, rows);
  const firstOpen = schedule.find((s) => s.state === "due" || s.state === "upcoming")?.seq;
  table(doc, {
    ...tableStyle,
    startY: y,
    head: [["Month", "Due Date", "Status", "Received On", "Instalment", ...(visible.share ? ["Your Share"] : [])]],
    body: schedule.map((s) => [
      `#${s.seq}`, fmtDay(s.dueDate), instalmentBadge(s.state, s.seq === firstOpen).label, fmtDay(s.paidOn) || (s.state === "late" ? "Not received" : ""),
      money(s.amountDue), ...(visible.share ? [money(s.share)] : []),
    ]),
    columnStyles: { 0: { cellWidth: 16 }, 4: { halign: "right" }, 5: { halign: "right" } },
  });
  foot(doc, `Made ${fmtStamp(new Date().toISOString())} from the supplier pages. Figures as Carres's books show them.`);
  doc.save(`${title}-statement.pdf`);
}
