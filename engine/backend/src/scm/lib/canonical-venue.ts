// Single source of truth for venue-name canonicalization.
//
// The system has historically stored the venue as free text on TWO surfaces — the
// PMS `projects.venue` (+ the `project_venues` picker) and the SCM showroom side
// (`scm.mfg_sales_orders.venue`, `scm.warehouses.venue_name`). Each was cleaned up by
// separate one-shot backfills, so the same place drifted back apart. This module is
// imported by the runtime write paths so every surface that writes or displays a venue
// resolves through the same map.
//
// KEEP IN SYNC — the same rule is spelled out in the database too:
//   * Carres (what the engine runs): scm.canonicalize_venue(), last defined by
//     backend/scripts/carres-db/migrations/2007_carres_no_venue_aliases.sql, behind the
//     BEFORE INSERT/UPDATE triggers on mfg_sales_orders.venue, warehouses.venue_name,
//     projects.venue and project_venues.name
//   * the D1 test mirror: migrations/141 created the triggers, 181 drops them for Carres
//   * Houzs history only (not applied to Carres): migrations-pg/*_venue_canonicalize.sql
//     and scripts/backfill-canonicalize-venue.mjs
// backend/tests/venueCanonicalSql.test.ts fails the build if the Carres guards fall
// out of step with this map.

/** canonical display name -> the raw variants that must fold into it (compare key form).
 *
 * Carres: EMPTY on purpose. The engine runs for Carres only, and Carres has no venue
 * aliases. Houzs's one row folded "PJ Showroom" (and its spellings) into "2990s PJ",
 * a 2990 showroom name. Carres's real showroom is the PJ-HQ warehouse named
 * "PJ Showroom", and the Carres SO Showroom picker saves that name as the order
 * venue, so the Houzs row would have renamed Carres orders, warehouses and project
 * venues to a 2990 name that must never appear in Carres. Carres's database guard
 * scm.canonicalize_venue() is made alias-free by carres-db migration
 * 2007_carres_no_venue_aliases.sql, and the D1 test mirror's alias triggers are
 * dropped by migrations/181_carres_drop_venue_aliases.sql. Blank/trim behaviour is
 * unchanged. Add a row here only for a real Carres alias, and update both guards. */
export const VENUE_CANONICAL_MAP: Record<string, string[]> = {};

/** Normalize a name to its lookup key: lower-case, trimmed, inner whitespace collapsed. */
export function venueKey(name: string): string {
  return name.toLowerCase().trim().replace(/\s+/g, " ");
}

// Reverse index: variant key -> canonical name (built once).
const VARIANT_TO_CANONICAL: Record<string, string> = (() => {
  const idx: Record<string, string> = {};
  for (const [canonical, variants] of Object.entries(VENUE_CANONICAL_MAP)) {
    idx[venueKey(canonical)] = canonical;
    for (const v of variants) idx[venueKey(v)] = canonical;
  }
  return idx;
})();

/**
 * Fold a venue string to its canonical form. Blank stays blank (null); an unknown
 * venue is returned trimmed but otherwise unchanged (we only unify known aliases).
 */
export function canonicalizeVenue(name: string | null | undefined): string | null {
  if (name == null) return null;
  const trimmed = name.trim();
  if (!trimmed) return null;
  return VARIANT_TO_CANONICAL[venueKey(trimmed)] ?? trimmed;
}

/** All lookup keys that fold into a given canonical name — for SQL backfills. */
export function variantKeysFor(canonical: string): string[] {
  const key = venueKey(canonical);
  return Object.entries(VARIANT_TO_CANONICAL)
    .filter(([, c]) => venueKey(c) === key)
    .map(([variant]) => variant);
}
