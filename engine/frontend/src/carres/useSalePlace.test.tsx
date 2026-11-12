// Carres: the SO form's Showroom follows the Salesperson until a person picks (owner 12 Nov 2026) — the hook
// the desktop New SO and the phone form use, wired the way they wire it.
import { act, renderHook } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { useSalePlace } from './SalePlacePicker';
import type { SalePlaces } from './salePlace';

const PLACES: SalePlaces = {
  showrooms: [{ id: 'w-pj', name: 'Carres PJ' }, { id: 'w-kl', name: 'Carres KL' }],
  projects: [{ id: 7, name: 'Sunway Velocity Tower' }],
};

type Props = { showroomId: string | null; places: SalePlaces | undefined; follow?: boolean };
const mount = (initial: Props) => renderHook(
  ({ showroomId, places, follow = true }: Props) => useSalePlace({ enabled: true, places, salespersonShowroomId: showroomId, follow }),
  { initialProps: initial },
);

describe('useSalePlace', () => {
  test('(1) a new order is pre-filled from the salesperson\'s showroom, once the list arrives', () => {
    const { result, rerender } = mount({ showroomId: 'w-pj', places: undefined });
    expect(result.current[0].value).toBeNull();
    rerender({ showroomId: 'w-pj', places: PLACES });
    expect(result.current[0].value?.id).toBe('w-pj');
  });

  test('(2) changing the salesperson moves it; after a pick by hand it stays', () => {
    const { result, rerender } = mount({ showroomId: 'w-pj', places: PLACES });
    rerender({ showroomId: 'w-kl', places: PLACES });
    expect(result.current[0].value?.id).toBe('w-kl');
    act(() => result.current[1]({ type: 'pick', value: { kind: 'project', id: 7, name: 'Sunway Velocity Tower' } }));
    rerender({ showroomId: 'w-pj', places: PLACES });
    expect(result.current[0].value).toEqual({ kind: 'project', id: 7, name: 'Sunway Velocity Tower' });
  });

  test('(4) a salesperson with no showroom leaves it empty', () => {
    const { result } = mount({ showroomId: null, places: PLACES });
    expect(result.current[0].value).toBeNull();
  });

  test('an edit does not follow the salesperson', () => {
    const { result } = mount({ showroomId: 'w-pj', places: PLACES, follow: false });
    expect(result.current[0].value).toBeNull();
  });
});
