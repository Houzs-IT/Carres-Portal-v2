// ----------------------------------------------------------------------------
// Carres: where a Sales Order was sold — a SHOWROOM, or a PROJECT instead (owner ruling 12 Nov 2026).
//
// Carres runs no fairs: it sells from showrooms. The Houzs SO form asks for a FAIR (with "Earlier fair? Order
// date" and a "No fair (showroom / direct sale)" tick); for Carres that block is a Showroom pick, with a Project
// as the other choice, and the server requires one of the two on a confirmed order instead of a fair.
//
// NO NEW STORAGE. The existing columns already say it:
//   Showroom  venue = the showroom's venue name (scm.warehouses.venue_name, else its name), venue_id NULL,
//             project_id NULL, fair_match 'NO_FAIR' (a decided state: no fair, nothing for the reconcile)
//   Project   project_id = the project (public.projects, this company, not archived or cancelled),
//             venue = the project's name, venue_id NULL, fair_match 'PICKED'
// The same model fair-binding.ts loadVenueMaster already uses for showroom venues (11 Nov 2026).
//
// The client sends `saleShowroomId` (a scm.warehouses id) or `saleProjectId` (a projects id), never a name:
// the server reads the name itself, company-scoped, so a stale screen cannot write another company's place.
// ----------------------------------------------------------------------------

import type { FairDb } from './fair-binding';
import type { SaveProblem } from '../shared/so-save-problems';

/** Carres is the engine's one company, kept under Houzs's code (row code 'HOUZS', name 'Carres', id 1). */
export const SHOWROOM_SALE_COMPANY_CODES: readonly string[] = ['HOUZS'];

export function companyUsesShowroomSale(companyCode: unknown): boolean {
  return SHOWROOM_SALE_COMPANY_CODES.includes(String(companyCode ?? '').trim().toUpperCase());
}

export type SalePlacePick =
  | { kind: 'showroom'; warehouseId: string }
  | { kind: 'project'; projectId: number };

/** The place a create / edit body names. `undefined` = the body says nothing about it (an edit that leaves it
 *  alone); `null` = it names something unreadable or nothing at all. A project wins over a showroom when a
 *  hand-built body sends both. */
export function salePlacePickOf(body: Record<string, unknown>): SalePlacePick | null | undefined {
  const p = body.saleProjectId;
  const s = body.saleShowroomId;
  if (p === undefined && s === undefined) return undefined;
  if (p != null && p !== '') {
    const id = Number(p);
    return Number.isInteger(id) && id > 0 ? { kind: 'project', projectId: id } : null;
  }
  if (typeof s === 'string' && s.trim() !== '') return { kind: 'showroom', warehouseId: s.trim() };
  return null;
}

export type ResolvedSalePlace = {
  kind: 'showroom' | 'project';
  /** What the order's `venue` column carries, and what every screen and the PDF show. */
  venue: string;
  projectId: number | null;
  fairMatch: 'NO_FAIR' | 'PICKED';
};

export const SALE_PLACE_REQUIRED: SaveProblem = {
  code: 'sale_place_required',
  message: 'Pick the showroom this order was sold from, or a project.',
  field: 'Showroom',
};

export const SALE_PLACE_INVALID: SaveProblem = {
  code: 'sale_place_invalid',
  message: 'That showroom or project is no longer available. Pick another one.',
  field: 'Showroom',
};

const text = (v: unknown): string => (v == null ? '' : String(v).trim());

/**
 * Read the picked place, in this company. Null when it does not exist, is not a showroom / not active, or the
 * project is archived or cancelled. Throws on a failed read (the caller refuses rather than guessing).
 *
 * @param scope       Puts the company predicate on the scm warehouses query.
 * @param projectSql  The company predicate for public.projects (activeCompanySql(c, 'p.company_id')).
 */
export async function resolveSalePlace(args: {
  pick: SalePlacePick;
  db: FairDb;
  projectSql: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the SCM PostgREST client is untyped throughout
  sb: any;
  scope: <Q>(q: Q) => Q;
}): Promise<ResolvedSalePlace | null> {
  if (args.pick.kind === 'project') {
    const rows = await args.db
      .prepare(
        `SELECT p.id AS id, p.name AS name, p.code AS code FROM projects p
          WHERE p.id = ? AND p.archived_at IS NULL
            AND lower(coalesce(p.status, '')) <> 'cancelled'${args.projectSql}`,
      )
      .bind(args.pick.projectId)
      .all<Record<string, unknown>>();
    const row = (rows.results ?? [])[0];
    if (!row) return null;
    const venue = text(row.name) || text(row.code);
    return venue ? { kind: 'project', venue, projectId: args.pick.projectId, fairMatch: 'PICKED' } : null;
  }
  const { data, error } = await args.scope(
    args.sb.from('warehouses').select('id, name, venue_name, is_showroom, is_active').eq('id', args.pick.warehouseId),
  ).maybeSingle();
  if (error) throw new Error(`showroom: ${(error as { message: string }).message}`);
  const w = (data ?? null) as Record<string, unknown> | null;
  if (!w) return null;
  const isShowroom = (w.isShowroom ?? w.is_showroom) === true;
  const isActive = (w.isActive ?? w.is_active) !== false;
  const venue = showroomVenueName(w);
  return isShowroom && isActive && venue ? { kind: 'showroom', venue, projectId: null, fairMatch: 'NO_FAIR' } : null;
}

/** A showroom's name on an order: its venue name, else the warehouse name. One spelling for the picker
 *  (GET /sale-places), the order's venue and reading an order back into the picker. */
export function showroomVenueName(w: Record<string, unknown>): string {
  return text(w.venueName ?? w.venue_name) || text(w.name);
}

/** The order columns a resolved place writes. */
export function salePlaceColumns(place: ResolvedSalePlace): {
  venue: string; venue_id: null; project_id: number | null; fair_match: 'NO_FAIR' | 'PICKED'; fair_date: null;
} {
  return { venue: place.venue, venue_id: null, project_id: place.projectId, fair_match: place.fairMatch, fair_date: null };
}

/** The Carres confirm rule on a stored order: it was sold from a showroom (a venue) or a project. */
export function salePlaceMissing(order: { venue?: string | null; project_id?: number | string | null }): boolean {
  return order.project_id == null && text(order.venue) === '';
}
