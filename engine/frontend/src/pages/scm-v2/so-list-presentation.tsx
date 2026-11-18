// Presentation keys only. The original 20-field preset remains the export baseline.
export const SO_CARRES_PRESENTATION = {
  baselinePresetId: "so-houzs",
  pairs: [
    ["doc_no", "so_date"], ["processing_date", "sales_exemption_expiry"],
    ["debtor_name", "reference"], ["city", "customer_state"], ["salesperson", "venue"],
    ["branding", "item_group"], ["item_code", "detail_description"],
    ["detail_description_2", "line_location"], ["qty", "uom"],
    ["unit_price", "currency"], ["amount", "balance"],
  ],
  defaultFields: ["doc_no", "so_date", "processing_date", "sales_exemption_expiry", "debtor_name", "reference",
    "city", "customer_state", "salesperson", "venue", "item_code", "detail_description", "detail_description_2",
    "qty", "uom", "amount", "balance"],
};

export function soDisplayDate(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(`${value.slice(0, 10)}T12:00:00Z`);
  if (!Number.isFinite(date.getTime())) return value;
  return <span className="carres-so-date">{date.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })}, <span className="carres-so-weekday">{date.toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" })}</span></span>;
}
