// Carres: a Sales Order is an Outright sale or a Subscription (owner ruling 12 Nov 2026).
// Stored in scm.mfg_sales_orders.sale_type (migration 2006, NOT NULL DEFAULT 'outright').
// The frontend keeps a byte-identical copy at frontend/src/vendor/shared/so-sale-type.ts.

export const SO_SALE_TYPES = ['outright', 'subscription'] as const;
export type SoSaleType = (typeof SO_SALE_TYPES)[number];

/** What every new order starts as, on every surface (desktop, phone, scan, POS). */
export const DEFAULT_SO_SALE_TYPE: SoSaleType = 'outright';

const LABELS: Record<SoSaleType, string> = { outright: 'Outright', subscription: 'Subscription' };

/** The word on screen and on the PDF. An unknown or missing value reads as Outright, as the column defaults. */
export function soSaleTypeLabel(v: unknown): string {
  return LABELS[parseSoSaleType(v) ?? DEFAULT_SO_SALE_TYPE];
}

/** A stored value or a label, case-insensitive, to the stored value. Null for anything else. */
export function parseSoSaleType(v: unknown): SoSaleType | null {
  const s = typeof v === 'string' ? v.trim().toLowerCase() : '';
  return (SO_SALE_TYPES as readonly string[]).includes(s) ? (s as SoSaleType) : null;
}

/** The choices for a picker, in order. */
export const SO_SALE_TYPE_OPTIONS: ReadonlyArray<{ value: SoSaleType; label: string }> =
  SO_SALE_TYPES.map((value) => ({ value, label: LABELS[value] }));
