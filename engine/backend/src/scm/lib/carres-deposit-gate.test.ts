// Carres: the 50% deposit rule itself (owner 2026-11-12) — carres-deposit-gate.ts. The routes: tests/carresDepositGate.test.ts.
import { describe, expect, it } from 'vitest';
import { carresDepositProblem, carresDepositProblemForDoc, companyBlocksOnDeposit, DEPOSIT_UNREADABLE, pendingDepositOf } from './carres-deposit-gate';

const sb = (total: number, pays: number[], error: { message: string } | null = null) => ({
  from: (t: string) => ({
    select: () => ({
      eq: () => (t === 'mfg_sales_orders'
        ? { maybeSingle: async () => ({ data: { local_total_sen: total }, error }) }
        : Promise.resolve({ data: pays.map((amount_sen) => ({ amount_sen })), error })),
    }),
  }),
});

describe('carresDepositProblem', () => {
  it('is the HOUZS row, which is Carres; every other company has no money gate', () => {
    expect(companyBlocksOnDeposit(' houzs ')).toBe(true);
    expect(carresDepositProblem({ companyCode: '2990', paidSen: 0, totalSen: 500_00, act: 'proceed' })).toBeNull();
  });
  it('refuses below 50% with paid vs needed, and allows at 50%', () => {
    expect(carresDepositProblem({ companyCode: 'HOUZS', paidSen: 200_00, totalSen: 500_00, act: 'processing_date' })?.message)
      .toBe('Deposit RM 200.00 of RM 250.00 needed (50%) before a Processing Date can be set');
    expect(carresDepositProblem({ companyCode: 'HOUZS', paidSen: 250_00, totalSen: 500_00, act: 'processing_date' })).toBeNull();
  });
  it('never refuses a free order', () => {
    expect(carresDepositProblem({ companyCode: 'HOUZS', paidSen: 0, totalSen: 0, act: 'proceed' })).toBeNull();
  });
});

describe('carresDepositProblemForDoc', () => {
  it('sums the ledger, plus money the same save records', async () => {
    expect(await carresDepositProblemForDoc(sb(500_00, [100_00, 100_00]), 'SO-1', 'HOUZS', 'proceed')).not.toBeNull();
    expect(await carresDepositProblemForDoc(sb(500_00, [100_00, 100_00]), 'SO-1', 'HOUZS', 'proceed', 50_00)).toBeNull();
  });
  it('fails closed when the payments cannot be read', async () => {
    expect(await carresDepositProblemForDoc(sb(500_00, [], { message: 'down' }), 'SO-1', 'HOUZS', 'proceed')).toEqual(DEPOSIT_UNREADABLE);
  });
  it('reads nothing for another company', async () => {
    expect(await carresDepositProblemForDoc(null, 'SO-1', '2990', 'proceed')).toBeNull();
  });
  it('pendingDepositOf takes only a positive number', () => {
    expect(pendingDepositOf({ pendingDepositSen: 150_00 })).toBe(150_00);
    expect(pendingDepositOf({ pendingDepositSen: -5 })).toBe(0);
    expect(pendingDepositOf({})).toBe(0);
  });
});
