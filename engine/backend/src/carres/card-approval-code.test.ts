import { describe, expect, it } from 'vitest';
import { cardCodeProblem, soCreateCardRows } from './card-approval-code';

describe('card payment approval code', () => {
  it('refuses a card payment without a code', () => {
    expect(cardCodeProblem([{ method: 'merchant', approvalCode: '  ', amountSen: 100 }])?.code).toBe('card_approval_code_required');
    expect(cardCodeProblem([{ method: 'installment', approvalCode: null }])?.code).toBe('card_approval_code_required');
  });
  it('takes a card payment with a code, and cash or transfer without one', () => {
    expect(cardCodeProblem([{ method: 'merchant', approvalCode: '123456', amountSen: 100 }])).toBeNull();
    expect(cardCodeProblem([{ method: 'cash', amountSen: 100 }, { method: 'transfer', amountSen: 100 }])).toBeNull();
  });
  it('ignores a card row with nothing paid', () => {
    expect(cardCodeProblem([{ method: 'merchant', amountSen: 0 }])).toBeNull();
  });
  it('reads the single deposit fields when there is no payments list', () => {
    expect(soCreateCardRows({ paymentMethod: 'merchant', depositSen: 5000 }, null)).toEqual([{ method: 'merchant', approvalCode: undefined, amountSen: 5000 }]);
    expect(cardCodeProblem(soCreateCardRows({ paymentMethod: 'merchant', depositSen: 0 }, null))).toBeNull();
  });
});
