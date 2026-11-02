// @vitest-environment node
import { expect, it } from "vitest";
import { pdf } from "@react-pdf/renderer";
import { registerNotoSansSC } from "./fonts/noto";
import { qrModules } from "./warehouse-document-pdf";
import { BinLabelsTemplate, WarehouseDocumentTemplate } from "./warehouse-document-template";

async function bytes(el: Parameters<typeof pdf>[0]) {
  registerNotoSansSC();
  const stream = await pdf(el).toBuffer();
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(Buffer.from(c));
  return Buffer.concat(chunks);
}

it("renders a document with an empty table and signatures", async () => {
  const out = await bytes(WarehouseDocumentTemplate({
    title: "Consignment Note", docNo: "CSN-1", date: "1 Nov 2026", facts: [["Customer", "Ali"]],
    tables: [{ title: "Line Items", headers: ["Item", "Qty"], numeric: ["Qty"], rows: [["SKU", "1"]] }, { title: "Payments", headers: ["Date"], rows: [] }],
    signatures: ["Received by"],
  }));
  expect(out.subarray(0, 4).toString()).toBe("%PDF");
}, 60_000);

it("draws QR labels from the real QR path", async () => {
  const qr = qrModules("KL | L1 | 1");
  expect(qr.size).toBeGreaterThan(20);
  expect(qr.path.length).toBeGreaterThan(100);
  const out = await bytes(BinLabelsTemplate({ labels: [{ title: "L1 · 1", subtitle: "KL", qr }] }));
  expect(out.subarray(0, 4).toString()).toBe("%PDF");
}, 60_000);
