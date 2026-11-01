import { createElement } from "react";
import { QRCodeSVG } from "qrcode.react";
import { renderToStaticMarkup } from "react-dom/server";
import { renderBinLabelsPdf, renderWarehouseDocumentPdf } from "./render";
import type { WarehouseDocData } from "./warehouse-document-template";

function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name}.pdf`;
  a.click();
  URL.revokeObjectURL(url);
}

export async function downloadWarehouseDocument(d: WarehouseDocData) {
  save(await renderWarehouseDocumentPdf(d), d.docNo);
}

/** qrcode.react draws two paths, background then modules; the PDF needs the modules. */
export function qrModules(value: string) {
  const svg = renderToStaticMarkup(createElement(QRCodeSVG, { value }));
  const size = Number(/viewBox="0 0 (\d+) \d+"/.exec(svg)?.[1]);
  const path = [...svg.matchAll(/ d="([^"]+)"/g)].at(-1)?.[1];
  if (!size || !path) throw new Error("The QR code could not be drawn.");
  return { size, path };
}

export async function downloadBinLabels(site: string, bins: { rack: string; bin: string }[]) {
  save(await renderBinLabelsPdf(bins.map((b) => ({
    title: `${b.rack} · ${b.bin}`, subtitle: site, qr: qrModules(`${site} | ${b.rack} | ${b.bin}`),
  }))), `Rack labels ${site}`);
}
