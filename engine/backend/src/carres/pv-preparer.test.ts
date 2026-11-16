import { describe, expect, it } from 'vitest';
import { preparerMayCheck } from './pv-preparer';

describe('preparer may not check', () => {
  it('refuses the person who prepared it', () => {
    expect(preparerMayCheck({ submitted_by: 'Ah Ming' }, 'ah ming ')).toMatchObject({ ok: false, error: 'preparer_cannot_check' });
  });
  it('lets someone else check', () => {
    expect(preparerMayCheck({ submitted_by: 'Ah Ming' }, 'Chew')).toEqual({ ok: true });
  });
  it('does not refuse when the preparer is unknown', () => {
    expect(preparerMayCheck({ submitted_by: null }, 'Chew')).toEqual({ ok: true });
  });
});
