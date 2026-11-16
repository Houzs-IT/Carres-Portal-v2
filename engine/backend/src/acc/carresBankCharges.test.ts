// Carres: a payment voucher's bank charges post to the BANK_CHARGES role (docs/finance/MASTER.md §0.0 ruling 1).
// In Chew's chart 900-B001 is a roadshow booth account, so the Houzs code must never be used there.
import { describe, expect, it } from 'vitest';
import { DEFAULT_ROLE_CODES, PV_BANK_CHARGE_ACCOUNT, pvBankChargeLines, resolveRoles } from './rules';

const pv = { pv_number: 'CR-HPV-2611-001', credit_account_code: '310-2000' };

const rolesDb = (rows: Array<{ role: string; account_code: string }>) => ({
  from: () => ({ select: () => ({ eq: async () => ({ data: rows, error: null }) }) }),
});

describe('bank charges account', () => {
  it('keeps the Houzs default when no role is set', () => {
    expect(DEFAULT_ROLE_CODES.BANK_CHARGES).toBe(PV_BANK_CHARGE_ACCOUNT);
    expect(pvBankChargeLines(pv, 500)[0]!.accountCode).toBe(PV_BANK_CHARGE_ACCOUNT);
  });

  it('posts Dr the role account / Cr the paying bank', async () => {
    const roles = await resolveRoles(rolesDb([{ role: 'BANK_CHARGES', account_code: '902-0000' }]), 1);
    const lines = pvBankChargeLines(pv, 500, roles.BANK_CHARGES);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ accountCode: '902-0000', debitSen: 500, creditSen: 0 });
    expect(lines[1]).toMatchObject({ accountCode: '310-2000', debitSen: 0, creditSen: 500 });
  });

  it('posts nothing without a fee', () => {
    expect(pvBankChargeLines(pv, 0, '902-0000')).toEqual([]);
  });
});
