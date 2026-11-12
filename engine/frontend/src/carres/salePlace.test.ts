// Carres: the SO form's Showroom default (owner 12 Nov 2026) — salePlace.ts.
import { describe, expect, test } from 'vitest';
import {
  EMPTY_SALE_PLACE, salePlaceFromKey, salePlaceFromOrder, salePlaceKey, salePlacePayload, salePlaceReducer,
  type SalePlaces,
} from './salePlace';

const PLACES: SalePlaces = {
  showrooms: [{ id: 'w-pj', name: 'Carres PJ' }, { id: 'w-kl', name: 'Carres KL' }],
  projects: [{ id: 7, name: 'Sunway Velocity Tower' }],
};

describe('(1) a new order starts with the salesperson\'s own showroom', () => {
  test('pre-filled from the salesperson\'s showroom', () => {
    const s = salePlaceReducer(EMPTY_SALE_PLACE, { type: 'salesperson', showroomId: 'w-pj', places: PLACES });
    expect(s.value).toEqual({ kind: 'showroom', id: 'w-pj', name: 'Carres PJ' });
    expect(s.manual).toBe(false);
  });

  test('fills in once the showroom list arrives, when the salesperson was known first', () => {
    const before = salePlaceReducer(EMPTY_SALE_PLACE, { type: 'salesperson', showroomId: 'w-pj', places: null });
    expect(before.value).toBeNull();
    const after = salePlaceReducer(before, { type: 'salesperson', showroomId: 'w-pj', places: PLACES });
    expect(after.value?.id).toBe('w-pj');
  });

  test('(4) a salesperson with no showroom leaves it empty, to be picked', () => {
    expect(salePlaceReducer(EMPTY_SALE_PLACE, { type: 'salesperson', showroomId: null, places: PLACES }).value).toBeNull();
    // A showroom that is no longer an active showroom is not filled in either.
    expect(salePlaceReducer(EMPTY_SALE_PLACE, { type: 'salesperson', showroomId: 'w-gone', places: PLACES }).value).toBeNull();
  });
});

describe('(2) changing the salesperson moves the showroom, unless one was picked by hand', () => {
  test('follows the new salesperson\'s showroom', () => {
    const pj = salePlaceReducer(EMPTY_SALE_PLACE, { type: 'salesperson', showroomId: 'w-pj', places: PLACES });
    const kl = salePlaceReducer(pj, { type: 'salesperson', showroomId: 'w-kl', places: PLACES });
    expect(kl.value).toEqual({ kind: 'showroom', id: 'w-kl', name: 'Carres KL' });
  });

  test('a new salesperson with no showroom empties it', () => {
    const pj = salePlaceReducer(EMPTY_SALE_PLACE, { type: 'salesperson', showroomId: 'w-pj', places: PLACES });
    expect(salePlaceReducer(pj, { type: 'salesperson', showroomId: null, places: PLACES }).value).toBeNull();
  });

  test('a showroom picked by hand stays', () => {
    const picked = salePlaceReducer(EMPTY_SALE_PLACE, { type: 'pick', value: { kind: 'showroom', id: 'w-kl', name: 'Carres KL' } });
    const after = salePlaceReducer(picked, { type: 'salesperson', showroomId: 'w-pj', places: PLACES });
    expect(after.value?.id).toBe('w-kl');
  });

  test('a project picked by hand stays', () => {
    const picked = salePlaceReducer(EMPTY_SALE_PLACE, { type: 'pick', value: { kind: 'project', id: 7, name: 'Sunway Velocity Tower' } });
    expect(salePlaceReducer(picked, { type: 'salesperson', showroomId: 'w-pj', places: PLACES }).value?.kind).toBe('project');
  });

  test('an order opened for edit keeps its recorded place', () => {
    const loaded = salePlaceReducer(EMPTY_SALE_PLACE, { type: 'load', value: { kind: 'showroom', id: 'w-kl', name: 'Carres KL' } });
    expect(salePlaceReducer(loaded, { type: 'salesperson', showroomId: 'w-pj', places: PLACES }).value?.id).toBe('w-kl');
  });
});

describe('(3) the place a save sends, and reading an order back', () => {
  test('a showroom or a project, never both', () => {
    expect(salePlacePayload({ kind: 'showroom', id: 'w-pj', name: 'Carres PJ' })).toEqual({ saleShowroomId: 'w-pj', saleProjectId: null });
    expect(salePlacePayload({ kind: 'project', id: 7, name: 'x' })).toEqual({ saleShowroomId: null, saleProjectId: 7 });
    expect(salePlacePayload(null)).toEqual({ saleShowroomId: null, saleProjectId: null });
  });

  test('an order reads back as its project, else the showroom its venue names', () => {
    expect(salePlaceFromOrder({ venue: 'Sunway Velocity Tower', project_id: 7 }, PLACES)).toEqual({ kind: 'project', id: 7, name: 'Sunway Velocity Tower' });
    expect(salePlaceFromOrder({ venue: ' carres  kl ', project_id: null }, PLACES)?.id).toBe('w-kl');
    expect(salePlaceFromOrder({ venue: 'Mid Valley', project_id: null }, PLACES)).toBeNull();
  });

  test('the select key round-trips', () => {
    const v = { kind: 'project' as const, id: 7, name: 'Sunway Velocity Tower' };
    expect(salePlaceFromKey(salePlaceKey(v), PLACES)).toEqual(v);
    expect(salePlaceFromKey('', PLACES)).toBeNull();
  });
});
