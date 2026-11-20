/** Column header for a seat height. Pool values are free text: a bare number
 *  gains its inch mark, anything typed with one (`25"`) or a word (`DEFAULT`)
 *  shows as typed, so the header never reads `25""`. Shared by the Products
 *  sofa grid and the Supplier SKU mappings so both tables label sizes alike. */
export const seatHeightLabel = (h: string): string => (/^\d+(\.\d+)?$/.test(h.trim()) ? `${h.trim()}"` : h);
