// ----------------------------------------------------------------------------
// Carres: the SO form's "where was this sold" — a SHOWROOM, or a PROJECT instead (owner ruling 12 Nov 2026).
//
// Carres runs no fairs. Where Houzs's SO form asks for a Fair (with "Earlier fair? Order date" and the
// "No fair (showroom / direct sale)" tick), Carres asks for a Showroom, with a Project as the other choice.
// One logic for the desktop New SO, the SO detail edit and the phone form; each only renders it.
//
// THE DEFAULT (owner, 12 Nov 2026):
//   1. A new order starts with the salesperson's own showroom (Team › member › Sales venue › Showroom,
//      scm.staff.showroom_warehouse_id), so their orders land under it with nothing to pick.
//   2. Changing the Salesperson moves the Showroom to the new salesperson's showroom, unless the user has
//      already picked a showroom or a project by hand.
//   3. The user can always pick another showroom, or a Project instead.
//   4. A salesperson with no showroom leaves it empty, and it must be picked before saving.
//
// The server stores it in existing columns (backend scm/lib/carres-sale-place.ts): a showroom is the order's
// venue (No fair), a project is its project_id with the project's name as the venue.
// ----------------------------------------------------------------------------

/** Carres is the engine's one company, kept under Houzs's code (row code 'HOUZS', name 'Carres'). */
export function companyUsesShowroomSale(companyCode: string | null | undefined): boolean {
  return (companyCode ?? '').trim().toUpperCase() === 'HOUZS';
}

export type SalePlaceShowroom = { id: string; name: string };
export type SalePlaceProject = { id: number; name: string };
export type SalePlaces = { showrooms: SalePlaceShowroom[]; projects: SalePlaceProject[] };

export type SalePlaceValue =
  | { kind: 'showroom'; id: string; name: string }
  | { kind: 'project'; id: number; name: string };

/** What the form holds: the place, and whether a person picked it (then the salesperson no longer moves it). */
export type SalePlaceState = { value: SalePlaceValue | null; manual: boolean };

export const EMPTY_SALE_PLACE: SalePlaceState = { value: null, manual: false };

/** The salesperson's own showroom as a value, or null when they have none or it is not an active showroom. */
export function showroomOf(showroomId: string | null | undefined, places: SalePlaces | null | undefined): SalePlaceValue | null {
  const id = (showroomId ?? '').trim();
  if (!id || !places) return null;
  const s = places.showrooms.find((r) => r.id === id);
  return s ? { kind: 'showroom', id: s.id, name: s.name } : null;
}

export type SalePlaceAction =
  /** The salesperson is known or changed (also when the showroom list arrives). */
  | { type: 'salesperson'; showroomId: string | null | undefined; places: SalePlaces | null | undefined }
  /** A person picked a showroom or a project (null = cleared). */
  | { type: 'pick'; value: SalePlaceValue | null }
  /** An existing order opened for edit: its recorded place is a decision, never replaced by a default. */
  | { type: 'load'; value: SalePlaceValue | null };

export function salePlaceReducer(state: SalePlaceState, action: SalePlaceAction): SalePlaceState {
  switch (action.type) {
    case 'pick':
      return { value: action.value, manual: true };
    case 'load':
      return { value: action.value, manual: true };
    case 'salesperson': {
      if (state.manual) return state;
      const next = showroomOf(action.showroomId, action.places);
      return sameValue(next, state.value) ? state : { value: next, manual: false };
    }
  }
}

function sameValue(a: SalePlaceValue | null, b: SalePlaceValue | null): boolean {
  if (a === null || b === null) return a === b;
  return a.kind === b.kind && a.id === b.id;
}

const norm = (s: string | null | undefined) => (s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

/** An order's stored place as a value: its project when it has one, else the showroom its venue names. */
export function salePlaceFromOrder(
  order: { venue?: string | null; project_id?: number | string | null },
  places: SalePlaces | null | undefined,
): SalePlaceValue | null {
  const venue = (order.venue ?? '').trim();
  if (order.project_id != null && String(order.project_id).trim() !== '') {
    const id = Number(order.project_id);
    const p = places?.projects.find((r) => r.id === id);
    return Number.isInteger(id) ? { kind: 'project', id, name: p?.name ?? venue } : null;
  }
  if (!venue || !places) return null;
  const s = places.showrooms.find((r) => norm(r.name) === norm(venue));
  return s ? { kind: 'showroom', id: s.id, name: s.name } : null;
}

/** The body keys a save carries. Both keys always, so the server reads exactly the one picked. */
export function salePlacePayload(value: SalePlaceValue | null): { saleShowroomId: string | null; saleProjectId: number | null } {
  return {
    saleShowroomId: value?.kind === 'showroom' ? value.id : null,
    saleProjectId: value?.kind === 'project' ? value.id : null,
  };
}

/** The select's option value for a place, and back. */
export function salePlaceKey(value: SalePlaceValue | null): string {
  return value ? `${value.kind}:${value.id}` : '';
}

export function salePlaceFromKey(key: string, places: SalePlaces | null | undefined): SalePlaceValue | null {
  if (!places) return null;
  if (key.startsWith('showroom:')) {
    const s = places.showrooms.find((r) => r.id === key.slice('showroom:'.length));
    return s ? { kind: 'showroom', id: s.id, name: s.name } : null;
  }
  if (key.startsWith('project:')) {
    const id = Number(key.slice('project:'.length));
    const p = places.projects.find((r) => r.id === id);
    return p ? { kind: 'project', id: p.id, name: p.name } : null;
  }
  return null;
}

/** The refusal shown before saving when nothing is picked (rule 4). */
export const SALE_PLACE_MISSING = 'Pick the showroom this order was sold from, or a project.';
