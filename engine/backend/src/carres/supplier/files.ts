// Carres only (not part of Houzs's code): the Delivery Order files on the Supplier Platform.
//
// When a supplier marks an accepted pickup collected, it uploads the Delivery Order Carres signed, as a PDF. The file
// is kept in the engine's private file store (the POD_BUCKET binding, under carres-supplier-do/); the pickup request
// keeps only its key and name (migration 2017). The supplier reads it back through its own session and only for its
// own request (./routes.ts); Carres staff through the pickup page (./staff-routes.ts). The store has no public
// address of its own for these files.

/** A Delivery Order may be this large; a whole upload, this large. */
export const MAX_DO_BYTES = 10 * 1024 * 1024;
export const MAX_UPLOAD_BYTES = 30 * 1024 * 1024;

const PDF_MARK = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"

/** A PDF says so near its start ("%PDF-", within the first 1024 bytes as the format allows); a file that does not
 *  is refused, whatever its name or type says. */
export function isPdf(bytes: Uint8Array): boolean {
  const end = Math.min(bytes.length, 1024) - PDF_MARK.length;
  for (let i = 0; i <= end; i++) {
    if (PDF_MARK.every((b, k) => bytes[i + k] === b)) return true;
  }
  return false;
}

/** The name the file is shown and downloaded under: its own name, without any folder, control character or quote,
 *  ending in .pdf. */
export function deliveryOrderName(raw: string): string {
  const base = (raw.split(/[\\/]/).pop() ?? "").replace(/[\u0000-\u001f\u007f"]/g, "").replace(/\s+/g, " ").trim().slice(0, 120);
  if (!base) return "delivery-order.pdf";
  return /\.pdf$/i.test(base) ? base : `${base}.pdf`;
}

/** `attachment`, with the name in plain letters for old programs and in full for the rest. The plain name has no
 *  quote, backslash or percent sign: a reader that decodes it as an address part (the staff client does) must not
 *  trip on one. */
export function attachmentHeader(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\%]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

/** The part of the file store these routes use. */
export interface FileStore {
  put: (key: string, value: Uint8Array, options?: { httpMetadata?: { contentType?: string } }) => Promise<unknown>;
  get: (key: string) => Promise<{ body: ReadableStream } | null>;
  delete: (key: string) => Promise<unknown>;
}

/** The file store, or null where it is not bound (a test that brings none). */
export const fileStore = (env: unknown): FileStore | null => ((env as { POD_BUCKET?: FileStore } | null)?.POD_BUCKET ?? null);

/** A new key for one supplier's Delivery Order: random, so it says nothing and cannot be guessed. */
export const deliveryOrderKey = (supplierId: string): string => `carres-supplier-do/${supplierId}/${crypto.randomUUID()}.pdf`;
