// Carres: Team › member › Sales venue › Showroom works for a member with no scm.staff row yet.
import { describe, expect, it } from 'vitest';
import { ensureStaffRowForUser } from './carres-staff-for-user';

/** A D1-shaped fake. `staffAfterSync` is the row the user→staff trigger makes when the UPDATE fires it. */
function fakeDb(opts: { existing?: string | null; staffAfterSync?: string | null }) {
  const seen: Array<{ sql: string; binds: unknown[] }> = [];
  let synced = false;
  return {
    seen,
    db: {
      prepare(sql: string) {
        return {
          bind(...binds: unknown[]) {
            return {
              async first<T>() {
                seen.push({ sql, binds });
                const id = synced ? opts.staffAfterSync : opts.existing;
                return (id ? { id } : null) as T | null;
              },
              async run() {
                seen.push({ sql, binds });
                synced = true;
                return {};
              },
            };
          },
        };
      },
    },
  };
}

describe('ensureStaffRowForUser', () => {
  it('returns the existing row and writes nothing', async () => {
    const f = fakeDb({ existing: 's-1' });
    expect(await ensureStaffRowForUser(f.db, 7)).toBe('s-1');
    expect(f.seen.some((s) => /UPDATE/i.test(s.sql))).toBe(false);
  });

  it("makes a missing row through Houzs's user→staff sync, never by inserting into scm.staff itself", async () => {
    const f = fakeDb({ existing: null, staffAfterSync: 's-new' });
    expect(await ensureStaffRowForUser(f.db, 7)).toBe('s-new');
    const writes = f.seen.filter((s) => /UPDATE|INSERT/i.test(s.sql));
    expect(writes).toHaveLength(1);
    expect(writes[0].sql).toMatch(/UPDATE users SET name = name WHERE id = \?/);
    expect(writes[0].binds).toEqual([7]);
    expect(writes[0].sql).not.toMatch(/scm\.staff/);
  });

  it('leaves a disabled member alone, as the trigger does', async () => {
    const f = fakeDb({ existing: null, staffAfterSync: null });
    expect(await ensureStaffRowForUser(f.db, 7)).toBeNull();
    expect(f.seen.find((s) => /UPDATE/i.test(s.sql))?.sql).toMatch(/status <> 'disabled'/);
  });
});
