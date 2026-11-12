// ----------------------------------------------------------------------------
// Carres: SalePlacePicker — the SO form's Showroom pick, with a Project as the other choice (owner 12 Nov 2026).
// Takes the place of Houzs's FairPicker + FairFallback for Carres, in the same slot and with the caller's own
// select classes (the FairPicker contract), so it looks like the Houzs control it replaces. The rules are in
// salePlace.ts; the server's in backend scm/lib/carres-sale-place.ts.
// ----------------------------------------------------------------------------

import { useEffect, useReducer } from 'react';
import { useQuery } from '@tanstack/react-query';
import { authedFetch } from '../vendor/scm/lib/authed-fetch';
import {
  EMPTY_SALE_PLACE, salePlaceFromKey, salePlaceKey, salePlaceReducer,
  type SalePlaceAction, type SalePlaces, type SalePlaceState, type SalePlaceValue,
} from './salePlace';

/** GET /mfg-sales-orders/sale-places — the active showrooms and live projects of this company. */
export function useSalePlaces(enabled: boolean) {
  return useQuery({
    queryKey: ['carres-sale-places'],
    queryFn: () => authedFetch<SalePlaces>('/mfg-sales-orders/sale-places'),
    enabled,
    staleTime: 5 * 60_000,
  });
}

/**
 * The form's place, defaulted to the salesperson's own showroom and following the salesperson until a person
 * picks (salePlace.ts rules 1-2). `salespersonShowroomId` is the picked salesperson's
 * scm.staff.showroom_warehouse_id; pass `follow: false` on an edit, where the recorded place is loaded instead.
 */
export function useSalePlace(args: {
  enabled: boolean;
  places: SalePlaces | null | undefined;
  salespersonShowroomId: string | null | undefined;
  follow: boolean;
}): [SalePlaceState, (a: SalePlaceAction) => void] {
  const [state, dispatch] = useReducer(salePlaceReducer, EMPTY_SALE_PLACE);
  const { enabled, places, salespersonShowroomId, follow } = args;
  useEffect(() => {
    if (enabled && follow) dispatch({ type: 'salesperson', showroomId: salespersonShowroomId, places });
  }, [enabled, follow, salespersonShowroomId, places]);
  return [state, dispatch];
}

export type SalePlacePickerProps = {
  value: SalePlaceValue | null;
  places: SalePlaces | null | undefined;
  onChange: (next: SalePlaceValue | null) => void;
  disabled?: boolean;
  selectClassName?: string;
  wrapClassName?: string;
  id?: string;
};

export function SalePlacePicker({ value, places, onChange, disabled, selectClassName, wrapClassName, id }: SalePlacePickerProps) {
  const showrooms = places?.showrooms ?? [];
  const projects = places?.projects ?? [];
  const key = salePlaceKey(value);
  /* A recorded place the lists no longer hold (a showroom made inactive, a project archived) still shows. */
  const stray = value && !salePlaceFromKey(key, places) ? value : null;
  return (
    <span className={wrapClassName}>
      <select
        id={id}
        className={selectClassName}
        value={key}
        disabled={disabled}
        onChange={(e) => onChange(salePlaceFromKey(e.target.value, places))}
        aria-label="Showroom"
      >
        <option value="">—</option>
        {stray && <option value={key}>{stray.name}</option>}
        {showrooms.length > 0 && (
          <optgroup label="Showroom">
            {showrooms.map((s) => <option key={s.id} value={`showroom:${s.id}`}>{s.name}</option>)}
          </optgroup>
        )}
        {projects.length > 0 && (
          <optgroup label="Project">
            {projects.map((p) => <option key={p.id} value={`project:${p.id}`}>{p.name}</option>)}
          </optgroup>
        )}
      </select>
    </span>
  );
}

export default SalePlacePicker;
