/**
 * The Stock Take sheet as Excel: Export Excel, and Upload counted sheet. Houzs's
 * upload reads a photo (StockTakeDetail.tsx:621); Carres reads this same workbook
 * back, because a Unit ID must match exactly and Post writes off whatever is not
 * counted.
 */
export const UNITS_SHEET = "Units";
export const EXTRAS_SHEET = "Goods with no Unit ID";
const YES = new Set(["yes", "y", "1", "true", "x", "counted"]);

export type CountedSheet = { codes: string[]; unknown: string[]; extras: { sku: string; qty: string }[] | null };

export async function downloadCountSheet(countNo: string, units: { code: string; sku: string; counted: boolean }[], extras: { sku: string; qty: string }[]) {
  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
    units.map((u) => ({ "Unit ID": u.code, SKU: u.sku, Counted: u.counted ? "Yes" : "" })), { header: ["Unit ID", "SKU", "Counted"] }), UNITS_SHEET);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
    extras.map((e) => ({ SKU: e.sku, Qty: Number(e.qty) || 0 })), { header: ["SKU", "Qty"] }), EXTRAS_SHEET);
  XLSX.writeFile(wb, `${countNo}.xlsx`);
}

/**
 * Throws, and changes nothing, on a sheet that counted no Unit: Post writes off
 * every Unit not counted, so a wrong file must never read as "none found".
 * `known` is null on an open blind count: the counter cannot see the expected
 * Units, so every Unit ID goes through and the server decides.
 */
export function readCountedRows(rows: Record<string, unknown>[], extraRows: Record<string, unknown>[] | null, known: string[] | null): CountedSheet {
  if (rows.length === 0 || !("Unit ID" in rows[0]!) || !("Counted" in rows[0]!)) {
    throw new Error("This is not a Stock Take sheet: it needs the columns Unit ID and Counted. Export Excel gives the right file.");
  }
  const byUpper = new Map((known ?? []).map((c) => [c.toUpperCase(), c]));
  const seen = new Set<string>();
  const unknown: string[] = [];
  for (const r of rows) {
    const code = String(r["Unit ID"] ?? "").trim();
    if (!code || !YES.has(String(r.Counted ?? "").trim().toLowerCase())) continue;
    if (known === null) seen.add(code);
    else if (byUpper.has(code.toUpperCase())) seen.add(byUpper.get(code.toUpperCase())!);
    else unknown.push(code);
  }
  if (seen.size === 0) throw new Error("No Unit on this sheet is marked as counted. Nothing was changed.");
  const extras = extraRows && extraRows.map((r) => ({ sku: String(r.SKU ?? "").trim(), qty: String(r.Qty ?? "").trim() })).filter((e) => e.sku && Number(e.qty) > 0);
  return { codes: [...seen], unknown, extras };
}

export async function readCountedFile(file: File, known: string[] | null): Promise<CountedSheet> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(await file.arrayBuffer());
  const sheet = wb.Sheets[UNITS_SHEET] ?? wb.Sheets[wb.SheetNames[0]!];
  const extra = wb.Sheets[EXTRAS_SHEET];
  // defval: without it a blank Counted cell drops the key, and the column check would refuse a good file.
  return readCountedRows(
    sheet ? XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" }) : [],
    extra ? XLSX.utils.sheet_to_json<Record<string, unknown>>(extra, { defval: "" }) : null,
    known,
  );
}
