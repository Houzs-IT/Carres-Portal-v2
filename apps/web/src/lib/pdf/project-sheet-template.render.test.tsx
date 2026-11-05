// @vitest-environment node
/** Projects slice 7: the sheet prints what the project page holds, and leaves out what is empty. */
import { beforeAll, expect, it } from "vitest";
import { pdf } from "@react-pdf/renderer";
import { ProjectSheetTemplate, type ProjectSheetData } from "./project-sheet-template";
import { registerNotoSansSC } from "./fonts/noto";

beforeAll(() => registerNotoSansSC());

const sample = (): ProjectSheetData => ({
  project: {
    id: "p1", code: "2026-12-SOLO-KL-MITEC-CARRES", name: "KL [Carres] SOLO @ MITEC", stage: "setup", status: "confirmed",
    eventType: "solo", brand: "Carres", state: "Kuala Lumpur", venue: "MITEC", venueAddress: null, organizer: null,
    contractor: "Sample Build", boothNo: "A12", sizeSqm: 54, startDate: "2026-12-04", endDate: "2026-12-06",
    picId: null, picName: "Sample PIC", notes: "Bring the spare mattress.", archivedAt: null, createdAt: "2026-11-02T00:00:00Z",
  },
  team: [{ id: "t1", userId: "u1", name: "Sample Staff", role: "onsite" }],
  checklist: [
    { id: "k1", section: "Before", seq: 1, title: "Book the lorry", dueOffsetDays: -7, status: "done", notes: null, completedByName: "Sample Staff", completedAt: "2026-11-27T02:00:00Z" },
    { id: "k2", section: "Before", seq: 2, title: "Print price tags", dueOffsetDays: -1, status: "pending", notes: null, completedByName: null, completedAt: null },
  ],
  salesOrders: {
    orders: [
      { id: "o1", so: "SO-1001", status: "confirmed", customerName: "Sample Buyer", placedAt: null, total: 1000, paid: 300, balance: 700 },
      { id: "o2", so: "SO-1002", status: "cancelled", customerName: "Sample Two", placedAt: null, total: 900, paid: 0, balance: 900 },
    ],
    totals: { count: 1, total: 1000, paid: 300, balance: 700 },
  },
  printedAt: "3 Nov 2026, 10:00",
});

async function text(data: ProjectSheetData) {
  const stream = await pdf(ProjectSheetTemplate(data)).toBuffer();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(Buffer.concat(chunks)), useSystemFonts: false }).promise;
  try {
    let all = "";
    for (let n = 1; n <= doc.numPages; n++) {
      const c = await (await doc.getPage(n)).getTextContent();
      all += c.items.flatMap((i) => ("str" in i ? [i.str] : [])).join(" ") + "\n";
    }
    // pdf.js splits runs at font changes, so "50%" can come back as "50 %".
    return all.replace(/\s+/g, " ").replace(/ %/g, "%");
  } finally { await doc.destroy(); }
}

it("prints the title, dates, overview, team, orders with totals, checklist and notes", async () => {
  const t = await text(sample());
  for (const want of ["PROJECT SHEET", "4 to 6 Dec 2026", "PIC Sample PIC", "Booth no", "A12", "onsite", "Sample Staff",
    "SO-1001", "1,000.00", "Sample Two · Cancelled", "TOTAL · 1 order, cancelled left out", "CHECKLIST · 50% DONE",
    "Book the lorry", "Fri, 27 Nov 2026", "Bring the spare mattress.", "Page 1 of 1"]) expect(t).toContain(want);
  // A fact with no value prints no label.
  expect(t).not.toContain("Organizer");
});

it("leaves out the sections that have nothing to say", async () => {
  const t = await text({ ...sample(), team: [], checklist: [], salesOrders: null, project: { ...sample().project, notes: null } });
  for (const gone of ["TEAM", "SALES ORDERS", "CHECKLIST", "NOTES"]) expect(t).not.toContain(gone);
  expect(t).toContain("OVERVIEW");
});
