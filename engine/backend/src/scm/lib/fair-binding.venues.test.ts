import { describe, expect, it } from 'vitest';
import { loadVenueMaster, type FairDb } from './fair-binding';

/** A stand-in database: the project venues query, then the showroom warehouses query. */
function db(projectVenues: object[], showrooms: object[], seen: string[] = []): FairDb {
  return {
    prepare(sql: string) {
      seen.push(sql);
      return { bind: () => ({ all: async () => ({ results: (sql.includes('scm.warehouses') ? showrooms : projectVenues) as never[] }) }) };
    },
  };
}

describe('loadVenueMaster (Carres): project venues and showroom venues', () => {
  it('adds showroom venues after the project venues, with showroom ids, and drops a showroom already listed by name', async () => {
    const out = await loadVenueMaster(
      db([{ id: 1, name: 'MITEC Hall 4' }], [{ id: 'w-1', venue_name: 'Carres PJ Showroom' }, { id: 'w-2', venue_name: 'mitec hall 4' }, { id: 'w-3', venue_name: '  ' }]),
      ' AND company_id = 1',
    );
    expect(out).toEqual([{ id: '1', name: 'MITEC Hall 4' }, { id: 'showroom:w-1', name: 'Carres PJ Showroom' }]);
  });

  it('keeps the company rule on the showroom query too', async () => {
    const seen: string[] = [];
    await loadVenueMaster(db([], [], seen), ' AND company_id = 7');
    expect(seen.find((s) => s.includes('scm.warehouses'))).toContain('AND company_id = 7');
  });
});
