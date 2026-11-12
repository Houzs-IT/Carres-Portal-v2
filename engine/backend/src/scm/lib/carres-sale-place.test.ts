// Carres: a Sales Order names a Showroom, or a Project instead of a fair (owner 2026-11-12).
import { describe, expect, it } from 'vitest';
import {
  companyUsesShowroomSale, resolveSalePlace, salePlaceColumns, salePlaceMissing, salePlacePickOf,
} from './carres-sale-place';
import type { FairDb } from './fair-binding';

const db = (rows: Array<Record<string, unknown>>, seen: unknown[][] = []): FairDb => ({
  prepare: () => ({ bind: (...vals: unknown[]) => { seen.push(vals); return { all: async <T>() => ({ results: rows as T[] }) }; } }),
});
const sb = (row: Record<string, unknown> | null) => ({
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row, error: null }) }) }) }),
});
const scope = <Q>(q: Q): Q => q;

describe('companyUsesShowroomSale', () => {
  it('is the HOUZS row, which is Carres', () => {
    expect(companyUsesShowroomSale(' houzs ')).toBe(true);
    expect(companyUsesShowroomSale('2990')).toBe(false);
    expect(companyUsesShowroomSale(null)).toBe(false);
  });
});

describe('salePlacePickOf', () => {
  it('says nothing when the body names neither', () => {
    expect(salePlacePickOf({ venue: 'X' })).toBeUndefined();
  });
  it('reads a showroom or a project; a project wins over a showroom', () => {
    expect(salePlacePickOf({ saleShowroomId: ' w1 ', saleProjectId: null })).toEqual({ kind: 'showroom', warehouseId: 'w1' });
    expect(salePlacePickOf({ saleShowroomId: null, saleProjectId: 7 })).toEqual({ kind: 'project', projectId: 7 });
    expect(salePlacePickOf({ saleShowroomId: 'w1', saleProjectId: '7' })).toEqual({ kind: 'project', projectId: 7 });
  });
  it('is null for nothing picked or an unreadable id', () => {
    expect(salePlacePickOf({ saleShowroomId: null, saleProjectId: null })).toBeNull();
    expect(salePlacePickOf({ saleProjectId: 'abc' })).toBeNull();
  });
});

describe('resolveSalePlace', () => {
  it('a showroom is its venue name, No fair', async () => {
    const place = await resolveSalePlace({
      pick: { kind: 'showroom', warehouseId: 'w1' }, db: db([]), projectSql: '', scope,
      sb: sb({ id: 'w1', name: 'PJ Store', venue_name: 'Carres PJ', is_showroom: true, is_active: true }),
    });
    expect(place).toEqual({ kind: 'showroom', venue: 'Carres PJ', projectId: null, fairMatch: 'NO_FAIR' });
    expect(salePlaceColumns(place!)).toEqual({ venue: 'Carres PJ', venue_id: null, project_id: null, fair_match: 'NO_FAIR', fair_date: null });
  });
  it('a showroom with no venue name is named by the warehouse', async () => {
    const place = await resolveSalePlace({
      pick: { kind: 'showroom', warehouseId: 'w1' }, db: db([]), projectSql: '', scope,
      sb: sb({ id: 'w1', name: 'PJ Store', venue_name: null, is_showroom: true, is_active: true }),
    });
    expect(place?.venue).toBe('PJ Store');
  });
  it('refuses a warehouse that is not an active showroom', async () => {
    for (const row of [{ id: 'w1', name: 'WH', is_showroom: false, is_active: true }, { id: 'w1', name: 'S', is_showroom: true, is_active: false }, null]) {
      expect(await resolveSalePlace({ pick: { kind: 'showroom', warehouseId: 'w1' }, db: db([]), projectSql: '', scope, sb: sb(row) })).toBeNull();
    }
  });
  it('a project is its link and its name, company-scoped', async () => {
    const seen: unknown[][] = [];
    const place = await resolveSalePlace({
      pick: { kind: 'project', projectId: 7 }, db: db([{ id: 7, name: 'Sunway Velocity Tower', code: 'P-7' }], seen),
      projectSql: ' AND p.company_id = 1', scope, sb: sb(null),
    });
    expect(place).toEqual({ kind: 'project', venue: 'Sunway Velocity Tower', projectId: 7, fairMatch: 'PICKED' });
    expect(seen[0]).toEqual([7]);
  });
  it('refuses a project the company does not hold live', async () => {
    expect(await resolveSalePlace({ pick: { kind: 'project', projectId: 7 }, db: db([]), projectSql: '', scope, sb: sb(null) })).toBeNull();
  });
});

describe('salePlaceMissing — the Confirm rule', () => {
  it('a venue or a project satisfies it', () => {
    expect(salePlaceMissing({ venue: 'Carres PJ', project_id: null })).toBe(false);
    expect(salePlaceMissing({ venue: null, project_id: 7 })).toBe(false);
    expect(salePlaceMissing({ venue: '  ', project_id: null })).toBe(true);
  });
});
